export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_VALIDITY_SECONDS = 300;

const OTP_THROTTLE_KEY = 'quizhub-v2:otp-throttle';
const PRUNE_AFTER_MS = 30 * 60 * 1000;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface OtpEntry {
  cooldownUntil: number;
  expiresAt: number;
}

export interface OtpTiming {
  sent: boolean;
  cooldownSeconds: number;
  remainingSeconds: number;
  cooldownUntil: number | null;
  expiresAt: number | null;
}

const EMPTY_TIMING: OtpTiming = {
  sent: false,
  cooldownSeconds: 0,
  remainingSeconds: 0,
  cooldownUntil: null,
  expiresAt: null,
};

const memoryEntries = new Map<string, OtpEntry>();

function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

function pruneEntries(entries: Map<string, OtpEntry>, now: number): void {
  for (const [key, entry] of entries.entries()) {
    if (now - entry.expiresAt > PRUNE_AFTER_MS) {
      entries.delete(key);
    }
  }
}

function loadRawEntries(): Map<string, OtpEntry> {
  const result = new Map(memoryEntries);
  try {
    const raw = globalThis.sessionStorage?.getItem(OTP_THROTTLE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const key of Object.keys(parsed)) {
          if (DANGEROUS_KEYS.has(key)) continue;
          const entry = (parsed as Record<string, unknown>)[key] as Partial<OtpEntry> | null;
          if (
            entry
            && typeof entry === 'object'
            && typeof entry.cooldownUntil === 'number'
            && Number.isFinite(entry.cooldownUntil)
            && typeof entry.expiresAt === 'number'
            && Number.isFinite(entry.expiresAt)
          ) {
            const existing = result.get(key);
            if (!existing || entry.expiresAt > existing.expiresAt) {
              result.set(key, { cooldownUntil: entry.cooldownUntil, expiresAt: entry.expiresAt });
            }
          }
        }
      }
    }
  } catch {
    // Ignore storage read failures and rely on memory fallback
  }
  return result;
}

function readEntries(now = Date.now()): Map<string, OtpEntry> {
  const result = loadRawEntries();
  pruneEntries(result, now);
  return result;
}

function writeEntries(entries: Map<string, OtpEntry>): void {
  memoryEntries.clear();
  for (const [key, value] of entries.entries()) {
    memoryEntries.set(key, value);
  }
  try {
    const obj: Record<string, OtpEntry> = {};
    for (const [key, value] of entries.entries()) {
      if (!DANGEROUS_KEYS.has(key)) {
        obj[key] = value;
      }
    }
    globalThis.sessionStorage?.setItem(OTP_THROTTLE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage write failures and keep memory state
  }
}

function toTiming(entry: OtpEntry | undefined, now: number): OtpTiming {
  if (!entry) return EMPTY_TIMING;
  return {
    sent: true,
    cooldownSeconds: Math.max(0, Math.ceil((entry.cooldownUntil - now) / 1000)),
    remainingSeconds: Math.max(0, Math.ceil((entry.expiresAt - now) / 1000)),
    cooldownUntil: entry.cooldownUntil,
    expiresAt: entry.expiresAt,
  };
}

export function getOtpTiming(email: string, now = Date.now()): OtpTiming {
  const key = normalizeEmailKey(email);
  if (!key) return EMPTY_TIMING;
  const entries = readEntries(now);
  return toTiming(entries.get(key), now);
}

export function recordOtpSent(email: string, now = Date.now()): OtpTiming {
  const key = normalizeEmailKey(email);
  if (!key) return EMPTY_TIMING;
  const entries = readEntries(now);
  const nextEntry: OtpEntry = {
    cooldownUntil: now + OTP_COOLDOWN_SECONDS * 1000,
    expiresAt: now + OTP_VALIDITY_SECONDS * 1000,
  };
  entries.set(key, nextEntry);
  writeEntries(entries);
  return toTiming(nextEntry, now);
}

export function clearOtpTiming(email: string): void {
  const key = normalizeEmailKey(email);
  if (!key) return;
  const entries = loadRawEntries();
  if (entries.delete(key)) {
    writeEntries(entries);
  }
}

export function resetAllOtpTimingsForTests(): void {
  memoryEntries.clear();
  try {
    globalThis.sessionStorage?.removeItem(OTP_THROTTLE_KEY);
  } catch {
    // Ignore cleanup errors
  }
}
