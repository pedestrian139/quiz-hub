import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const STORAGE_KEY = 'ai-intro-quiz-v1';

export type QuestionType = 'choice' | 'multi' | 'tf' | 'short' | 'analysis';
export type QuestionOrigin =
  | 'comprehensive_bank'
  | 'video_popup'
  | 'review_notes_synthesized';

export interface ChapterMeta {
  id: number;
  short: string;
  title: string;
  description?: string;
}

export interface QuestionSource {
  origin: QuestionOrigin;
  file: string;
  ref: string;
  duplicatesMerged?: string[];
  note?: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  chapter: number;
  sectionId?: string;
  stem: string;
  options?: string[];
  answer: number | number[] | boolean | string;
  explain: string;
  keyPoints?: string[];
  tags?: string[];
  source: QuestionSource;
}

export interface BankData {
  meta: {
    title: string;
    version: string;
    generatedAt: string;
    counts: {
      total: number;
      byType: Record<QuestionType, number>;
      byOrigin: Record<QuestionOrigin, number>;
    };
  };
  chapters: ChapterMeta[];
  questions: Question[];
}

export interface NoteTable {
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface NoteSection {
  id: string;
  chapterId: number;
  title: string;
  summary: string;
  keyPoints: string[];
  terms?: { term: string; definition: string }[];
  tables?: NoteTable[];
  callout?: string;
}

export interface NoteChapter {
  id: number;
  short: string;
  title: string;
  overview: string;
  sections: NoteSection[];
}

export interface NotesAppendix {
  id: string;
  title: string;
  type: 'timeline_figures' | 'confusing_pairs' | 'answer_templates' | 'short_index';
  tables?: NoteTable[];
  items?: { title: string; content: string; questionId?: string }[];
}

export interface NotesData {
  meta: { title: string; version: string; generatedAt: string };
  overview: { title: string; bullets: string[]; examTips: string[] };
  chapters: NoteChapter[];
  appendices: NotesAppendix[];
}

export type MasteryLevel = 0 | 1 | 2;

export interface UserRecord {
  ok: 0 | 1;
  choice?: number | number[] | boolean;
  ts: number;
}

export interface UserStore {
  records: Record<string, UserRecord>;
  fav: Record<string, boolean>;
  mastery: Record<string, MasteryLevel>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

let cachedBank: BankData | null = null;
let cachedNotes: NotesData | null = null;

export function loadBankCatalog(): BankData {
  if (!cachedBank) {
    const bankPath = path.join(PROJECT_ROOT, 'src', 'data', 'bank.json');
    const raw = fs.readFileSync(bankPath, 'utf-8');
    cachedBank = JSON.parse(raw) as BankData;
  }
  return cachedBank;
}

export function loadNotesCatalog(): NotesData {
  if (!cachedNotes) {
    const notesPath = path.join(PROJECT_ROOT, 'src', 'data', 'notes.json');
    const raw = fs.readFileSync(notesPath, 'utf-8');
    cachedNotes = JSON.parse(raw) as NotesData;
  }
  return cachedNotes;
}

export function pickQuestions(filter?: {
  type?: QuestionType;
  chapter?: number;
  chapters?: number[];
  origin?: QuestionOrigin;
  hasKeyPoints?: boolean;
  withoutKeyPoints?: boolean;
  minAnswerLen?: number;
  limit?: number;
  excludeIds?: string[];
}): Question[] {
  const bank = loadBankCatalog();
  const excluded = new Set(filter?.excludeIds ?? []);
  let list = bank.questions.filter((q) => {
    if (excluded.has(q.id)) return false;
    if (filter?.type && q.type !== filter.type) return false;
    if (filter?.chapter !== undefined && q.chapter !== filter.chapter) return false;
    if (filter?.chapters && !filter.chapters.includes(q.chapter)) return false;
    if (filter?.origin && q.source.origin !== filter.origin) return false;
    if (filter?.hasKeyPoints && (!q.keyPoints || q.keyPoints.length === 0)) return false;
    if (filter?.withoutKeyPoints && q.keyPoints && q.keyPoints.length > 0) return false;
    if (
      filter?.minAnswerLen !== undefined &&
      typeof q.answer === 'string' &&
      q.answer.length < filter.minAnswerLen
    ) {
      return false;
    }
    return true;
  });

  if (filter?.limit !== undefined) {
    list = list.slice(0, filter.limit);
  }
  return list;
}

export function pickQuestion(filter?: Parameters<typeof pickQuestions>[0]): Question {
  const list = pickQuestions({ ...filter, limit: 1 });
  if (list.length === 0 || !list[0]) {
    throw new Error(`No question matched filter: ${JSON.stringify(filter)}`);
  }
  return list[0];
}

export function buildQuestionStemMap(bank = loadBankCatalog()): Map<string, Question> {
  const map = new Map<string, Question>();
  for (const q of bank.questions) {
    map.set(q.stem.trim(), q);
    map.set(q.stem.replace(/\s+/g, ' ').trim(), q);
  }
  return map;
}

export function findQuestionByStem(
  stemText: string,
  map: Map<string, Question>,
): Question {
  const trimmed = stemText.trim();
  const normalized = stemText.replace(/\s+/g, ' ').trim();
  const hit = map.get(trimmed) ?? map.get(normalized);
  if (hit) return hit;

  for (const [k, q] of map.entries()) {
    if (normalized.includes(k) || k.includes(normalized)) {
      return q;
    }
  }
  throw new Error(`Unable to match rendered stem in bank.json: "${normalized.slice(0, 80)}"`);
}

export function getCorrectChoiceFor(q: Question): number | number[] | boolean {
  if (q.type === 'choice' && typeof q.answer === 'number') return q.answer;
  if (q.type === 'multi' && Array.isArray(q.answer)) return [...q.answer];
  if (q.type === 'tf' && typeof q.answer === 'boolean') return q.answer;
  throw new Error(`Question ${q.id} (${q.type}) does not have an objective answer`);
}

export function getWrongChoiceFor(q: Question): number | number[] | boolean {
  if (q.type === 'choice' && typeof q.answer === 'number') {
    const optCount = q.options?.length ?? 4;
    return (q.answer + 1) % optCount;
  }
  if (q.type === 'tf' && typeof q.answer === 'boolean') {
    return !q.answer;
  }
  if (q.type === 'multi' && Array.isArray(q.answer)) {
    const optCount = q.options?.length ?? 4;
    const correctSet = new Set(q.answer);
    const wrongIndices: number[] = [];
    for (let i = 0; i < optCount; i++) {
      if (!correctSet.has(i)) wrongIndices.push(i);
    }
    if (wrongIndices.length > 0) return wrongIndices;
    return q.answer.length > 1 ? [q.answer[0]!] : [0];
  }
  throw new Error(`Question ${q.id} (${q.type}) does not have an objective answer`);
}

export function getPartialWrongChoiceFor(q: Question): number[] {
  if (q.type !== 'multi' || !Array.isArray(q.answer)) {
    throw new Error(`Question ${q.id} is not multi`);
  }
  if (q.answer.length > 1) {
    return [q.answer[0]!];
  }
  const optCount = q.options?.length ?? 4;
  const extra = q.answer[0] === 0 ? 1 : 0;
  return extra < optCount ? [q.answer[0]!, extra] : [0, 1];
}

export function makeEmptyStore(): UserStore {
  return { records: {}, fav: {}, mastery: {} };
}

export function makeSeededStore(opts?: {
  correctIds?: string[];
  wrongIds?: string[];
  favIds?: string[];
  mastery?: Record<string, MasteryLevel>;
  extraRecords?: Record<string, UserRecord>;
  baseTs?: number;
}): UserStore {
  const store = makeEmptyStore();
  let ts = opts?.baseTs ?? 1_700_000_000_000;

  for (const id of opts?.correctIds ?? []) {
    const bank = loadBankCatalog();
    const q = bank.questions.find((item) => item.id === id);
    const choice =
      q && (q.type === 'choice' || q.type === 'multi' || q.type === 'tf')
        ? getCorrectChoiceFor(q)
        : undefined;
    store.records[id] = choice !== undefined ? { ok: 1, choice, ts: ts++ } : { ok: 1, ts: ts++ };
  }

  for (const id of opts?.wrongIds ?? []) {
    const bank = loadBankCatalog();
    const q = bank.questions.find((item) => item.id === id);
    const choice =
      q && (q.type === 'choice' || q.type === 'multi' || q.type === 'tf')
        ? getWrongChoiceFor(q)
        : undefined;
    store.records[id] = choice !== undefined ? { ok: 0, choice, ts: ts++ } : { ok: 0, ts: ts++ };
  }

  for (const id of opts?.favIds ?? []) {
    store.fav[id] = true;
  }

  if (opts?.mastery) {
    for (const [id, level] of Object.entries(opts.mastery)) {
      store.mastery[id] = level;
      if (!store.records[id]) {
        store.records[id] = { ok: level === 2 ? 1 : 0, ts: ts++ };
      }
    }
  }

  if (opts?.extraRecords) {
    Object.assign(store.records, opts.extraRecords);
  }

  return store;
}

function normalizeHashTarget(hashRoute: string): string {
  if (!hashRoute || hashRoute === '/') return './#/';
  if (hashRoute.startsWith('./#')) return hashRoute;
  if (hashRoute.startsWith('#')) return `./${hashRoute}`;
  if (hashRoute.startsWith('/')) return `./#${hashRoute}`;
  return `./#/${hashRoute}`;
}

export async function seedStoreAndReload(
  page: Page,
  store: UserStore,
  targetHashRoute = '#/',
): Promise<void> {
  const target = normalizeHashTarget(targetHashRoute);
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify(store)] as const,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
}

export async function seedRawStoreAndReload(
  page: Page,
  rawPayload: string,
  targetHashRoute = '#/',
): Promise<void> {
  const target = normalizeHashTarget(targetHashRoute);
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [STORAGE_KEY, rawPayload] as const,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
}

export async function seedCorruptedStoreAndReload(
  page: Page,
  variant: 'bad-json' | 'wrong-shape' | 'array' | 'null' | string,
  targetHashRoute = '#/',
): Promise<void> {
  let payload = variant;
  if (variant === 'bad-json') payload = '{broken_json:::[';
  else if (variant === 'wrong-shape') payload = '{"records":"bad","fav":123,"mastery":null}';
  else if (variant === 'array') payload = '[]';
  else if (variant === 'null') payload = 'null';
  await seedRawStoreAndReload(page, payload, targetHashRoute);
}

export async function seedStaleIdsStoreAndReload(
  page: Page,
  opts?: {
    validCorrectIds?: string[];
    validWrongIds?: string[];
    validFavIds?: string[];
    staleCount?: number;
  },
  targetHashRoute = '#/',
): Promise<UserStore> {
  const store = makeSeededStore({
    correctIds: opts?.validCorrectIds,
    wrongIds: opts?.validWrongIds,
    favIds: opts?.validFavIds,
  });

  const staleCount = opts?.staleCount ?? 2;
  for (let i = 1; i <= staleCount; i++) {
    const staleId = `__stale_removed_q${i}`;
    store.records[staleId] = { ok: 0, choice: 0, ts: 1_700_000_000_000 + i };
    store.fav[staleId] = true;
    store.mastery[staleId] = 1;
  }

  await seedStoreAndReload(page, store, targetHashRoute);
  return store;
}

export async function readRawPersistedStore(page: Page): Promise<string | null> {
  return page.evaluate((key: string) => window.localStorage.getItem(key), STORAGE_KEY);
}

export async function readPersistedStore(page: Page): Promise<UserStore | null> {
  const raw = await readRawPersistedStore(page);
  if (!raw) return null;
  return JSON.parse(raw) as UserStore;
}

export async function clearPersistedStore(page: Page): Promise<void> {
  await page.evaluate((key: string) => {
    window.localStorage.removeItem(key);
  }, STORAGE_KEY);
}

export async function captureJsonExport(
  page: Page,
  triggerExport: () => Promise<void>,
): Promise<{ filename: string; raw: string; parsed: unknown }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    triggerExport(),
  ]);

  const filename = download.suggestedFilename();
  const filePath = await download.path();
  let raw = '';
  if (filePath) {
    raw = fs.readFileSync(filePath, 'utf-8');
  } else {
    const stream = await download.createReadStream();
    if (!stream) {
      throw new Error('Download produced neither file path nor readable stream');
    }
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    raw = Buffer.concat(chunks).toString('utf-8');
  }

  const parsed = JSON.parse(raw) as unknown;
  return { filename, raw, parsed };
}

export async function importJsonFile(
  fileInput: Locator,
  payload: unknown | string,
  filename = 'ai-intro-quiz-backup.json',
): Promise<void> {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  await fileInput.setInputFiles({
    name: filename,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf-8'),
  });
}

export async function assertExportImportRoundtrip(
  page: Page,
  exportBtn: Locator,
  resetAction: () => Promise<void>,
  importInput: Locator,
): Promise<UserStore> {
  const before = await readPersistedStore(page);
  expect(before, 'Expected persisted store before export').not.toBeNull();

  const exported = await captureJsonExport(page, () => exportBtn.click());
  await resetAction();
  await page.reload({ waitUntil: 'domcontentloaded' });

  const afterReset = await readPersistedStore(page);
  expect(Object.keys(afterReset?.records ?? {})).toHaveLength(0);

  await importJsonFile(importInput, exported.raw, exported.filename);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const afterImport = await readPersistedStore(page);
  expect(afterImport).toEqual(before);
  return afterImport!;
}
