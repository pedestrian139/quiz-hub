import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { accountPracticeScope, LEGACY_GUEST_SCOPE } from '../../src/core/practiceScope';
import { loadStore, saveStore } from '../../src/core/storage';
import { createDefaultApiConfig, loadApiConfig, saveApiConfig } from '../../src/services/apiConfig';
import { getBankDb } from '../../src/utils/bankDb';
import { getActiveGuestPracticeScope, claimGuestPracticeScope } from '../../src/services/db/guestOwnership';
import { adoptGuestData, readGuestData } from '../../src/services/db/guestData';

it('isolates practice progress, API settings, banks and bank progress when IDs are shared across namespaces', async () => {
  const first = accountPracticeScope('first');
  const second = accountPracticeScope('second');
  const progress = { records: { question: { ok: 1 as const, ts: 10 } }, fav: { question: true }, mastery: {} };
  const api = { ...createDefaultApiConfig(), apiKey: 'first-key' };
  expect(saveStore(progress, first)).toBe(true);
  expect(saveApiConfig(api, first)).toBe(true);
  await getBankDb(first).createCustomBank({ id: 'bank', name: 'First', chapters: [], questions: [] });
  await getBankDb(second).createCustomBank({ id: 'bank', name: 'Second', chapters: [], questions: [] });
  await getBankDb(first).saveBankProgress('bank', progress);
  expect(loadStore(first)).toEqual(progress);
  expect(loadStore(second).records).toEqual({});
  expect(loadStore(LEGACY_GUEST_SCOPE).records).toEqual({});
  expect(loadApiConfig(first).apiKey).toBe('first-key');
  expect(loadApiConfig(second).apiKey).toBe('');
  expect((await getBankDb(first).listCustomBanks()).map((bank) => bank.name)).toEqual(['First']);
  expect((await getBankDb(second).listCustomBanks()).map((bank) => bank.name)).toEqual(['Second']);
  expect((await getBankDb(second).getBankProgress('bank')).records).toEqual({});
});

it('rotates a claimed guest slot once and only restores the archived data to its verified owner', async () => {
  const source = await getActiveGuestPracticeScope();
  const owner = accountPracticeScope('owner');
  const other = accountPracticeScope('other');
  const progress = { records: {}, fav: { imported: true }, mastery: {} };
  saveStore(progress, source);
  await getBankDb(source).createCustomBank({ id: 'guest-bank', name: 'Guest bank', chapters: [], questions: [] });

  expect(await Promise.all([claimGuestPracticeScope(source, 'owner'), claimGuestPracticeScope(source, 'other')]))
    .toEqual([true, false]);
  const nextGuest = await getActiveGuestPracticeScope();
  expect(nextGuest).not.toBe(source);
  expect(await readGuestData(nextGuest)).toEqual({ banks: [], progress: [], apiConfig: null });
  expect(await claimGuestPracticeScope(source, 'owner')).toBe(true);

  const archived = await readGuestData(source);
  await adoptGuestData(archived, source, owner);
  expect(loadStore(owner)).toEqual(progress);
  expect(loadStore(other).fav).toEqual({});
  expect((await getBankDb(owner).listCustomBanks()).map(({ id }) => id)).toEqual(['guest-bank']);
  await getBankDb(owner).deleteCustomBank('guest-bank');
  await adoptGuestData(archived, source, owner);
  expect(await getBankDb(owner).listCustomBanks()).toEqual([]);
});
