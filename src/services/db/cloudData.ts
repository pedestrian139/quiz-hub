import { createEmptyStore } from '../../core/storage';
import type { BankData, UserStore } from '../../types/quiz';
import { sanitizeUserStore } from '../../utils/bankDb';
import type { BankRecord } from '../../utils/quizImportTypes';
import type { ApiConfig } from '../apiConfig';
import { getDatabaseClient, invokeDatabaseFunction } from './client';
import type { GuestData } from './guestData';

export interface AccountProfile {
  id: string;
  email: string | null;
  phone: string | null;
  nickname: string;
  isGuest: false;
}

interface ProfileRow { user_id: string; email: string | null; phone: string | null; nickname: string }
interface BankRow {
  bank_id: string;
  name: string;
  description: string | null;
  source_format: BankRecord['sourceFormat'] | null;
  created_at_ms: number;
  updated_at_ms: number;
  data: BankData;
  revision: number;
}
interface ProgressRow { store: UserStore; revision: number; reset_at: string | null }
interface ApiConfigRow {
  provider: ApiConfig['provider'];
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
  has_key: boolean;
}

export interface VersionedBank { bank: BankRecord; revision: number }
export interface VersionedProgress { store: UserStore; revision: number; resetAt: string | null }
export type CloudApiSummary = Omit<ApiConfig, 'apiKey'> & { hasKey: boolean };
export interface GuestImportBatch { importId: string; sourceId: string; sourceVersion: number }
export interface GuestImportConflicts { skippedBankIds: string[]; skippedApiConfig: boolean }
export type GuestImportResult = GuestImportConflicts | { supersededBy: number };

const PROFILE_FIELDS = 'user_id,email,phone,nickname';

function toProfile(row: ProfileRow): AccountProfile {
  return { id: row.user_id, email: row.email, phone: row.phone, nickname: row.nickname, isGuest: false };
}

function toBank(row: BankRow): VersionedBank {
  return { revision: row.revision, bank: {
    id: row.bank_id, name: row.name, description: row.description ?? undefined, builtin: false,
    sourceFormat: row.source_format ?? undefined, createdAt: row.created_at_ms, updatedAt: row.updated_at_ms, data: row.data,
  } };
}

function toProgress(row: ProgressRow): VersionedProgress {
  return { store: sanitizeUserStore(row.store), revision: row.revision, resetAt: row.reset_at };
}

function toApiSummary(row: ApiConfigRow): CloudApiSummary {
  return {
    provider: row.provider, baseUrl: row.base_url, model: row.model, temperature: row.temperature,
    maxTokens: row.max_tokens, timeoutMs: row.timeout_ms, storageScope: 'local', hasKey: row.has_key,
  };
}

async function currentSession() {
  const { data, error } = await getDatabaseClient().auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('请先登录。');
  return data.session;
}

export async function loadProfile(userId: string): Promise<AccountProfile> {
  const { data, error } = await getDatabaseClient().from('profiles').select(PROFILE_FIELDS).eq('user_id', userId).single();
  if (error) throw error;
  return toProfile(data);
}

export async function updateNickname(nickname: string): Promise<AccountProfile> {
  const session = await currentSession();
  const clean = nickname.trim();
  if (!clean || Array.from(clean).length > 80) throw new Error('昵称须为 1–80 个字符。');
  const { data, error } = await getDatabaseClient().from('profiles').update({ nickname: clean })
    .eq('user_id', session.user.id).select(PROFILE_FIELDS)
    .setHeader('Authorization', `Bearer ${session.access_token}`).single();
  if (error) throw error;
  return toProfile(data);
}

export async function listCloudBanks(): Promise<VersionedBank[]> {
  const session = await currentSession();
  const { data, error } = await getDatabaseClient().from('quiz_banks')
    .select('bank_id,name,description,source_format,created_at_ms,updated_at_ms,data,revision')
    .eq('user_id', session.user.id).eq('builtin', false).order('updated_at_ms', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toBank);
}

export async function saveCloudBank(bank: BankRecord, revision = 0): Promise<VersionedBank> {
  if (bank.builtin) throw new Error('内置题库由应用提供。');
  const session = await currentSession();
  const { data, error } = await getDatabaseClient().rpc('quizhub_save_bank', { p_bank: bank, p_revision: revision })
    .setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  return toBank(data as BankRow);
}

export async function deleteCloudBank(bankId: string, revision: number): Promise<void> {
  const session = await currentSession();
  const { error } = await getDatabaseClient().rpc('quizhub_delete_bank', { p_bank_id: bankId, p_revision: revision })
    .setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
}

export async function loadCloudProgress(bankId: string): Promise<VersionedProgress> {
  const session = await currentSession();
  const { data, error } = await getDatabaseClient().from('quiz_progress').select('store,revision,reset_at')
    .eq('user_id', session.user.id).eq('bank_id', bankId).maybeSingle();
  if (error) throw error;
  return data ? toProgress(data) : { store: createEmptyStore(), revision: 0, resetAt: null };
}

async function writeCloudProgress(bankId: string, store: UserStore, revision: number, reset: boolean): Promise<VersionedProgress> {
  const session = await currentSession();
  const { data, error } = await getDatabaseClient().rpc('quizhub_save_progress', {
    p_bank_id: bankId, p_store: sanitizeUserStore(store), p_revision: revision, p_reset: reset,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  return toProgress(data as ProgressRow);
}

export function saveCloudProgress(bankId: string, store: UserStore, revision: number): Promise<VersionedProgress> {
  return writeCloudProgress(bankId, store, revision, false);
}

export function resetCloudProgress(bankId: string, revision: number): Promise<VersionedProgress> {
  return writeCloudProgress(bankId, createEmptyStore(), revision, true);
}

export async function loadCloudApiConfig(): Promise<CloudApiSummary | null> {
  const session = await currentSession();
  const { data, error } = await getDatabaseClient().from('user_api_configs')
    .select('provider,base_url,model,temperature,max_tokens,timeout_ms,has_key')
    .eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data ? toApiSummary(data) : null;
}

async function userData<T>(action: string, fields: Record<string, unknown> = {}): Promise<T> {
  const session = await currentSession();
  return invokeDatabaseFunction<T>('user-data', { action, ...fields, ownerId: session.user.id }, session.access_token);
}

export async function saveCloudApiConfig(config: ApiConfig): Promise<CloudApiSummary> {
  if (config.storageScope === 'session') throw new Error('仅当前标签页的配置留在本地。');
  const row = await userData<ApiConfigRow>('save_api_config', { config });
  return toApiSummary(row);
}

export async function restoreCloudApiConfig(): Promise<ApiConfig | null> {
  const { config, apiKey } = await userData<{ config: ApiConfigRow | null; apiKey: string }>('restore_api_config');
  if (!config) return null;
  const { hasKey: _hasKey, ...preferences } = toApiSummary(config);
  return { ...preferences, apiKey };
}

export async function clearCloudApiConfig(): Promise<void> {
  await userData('clear_api_config');
}

export async function uploadGuestData(ownerId: string, batch: GuestImportBatch, data: GuestData): Promise<GuestImportResult> {
  const session = await currentSession();
  if (session.user.id !== ownerId) throw new Error('登录账号已变更，请重新确认游客迁移。');
  return invokeDatabaseFunction('user-data', { action: 'import_guest', ownerId,
    importId: batch.importId, sourceId: batch.sourceId, sourceVersion: batch.sourceVersion, ...data,
  }, session.access_token);
}
