import { isObjectiveQuestion } from '../../core/questionUtils';
import { recordObjectiveAnswer, recordSubjectiveMastery } from '../../core/quizEngine';
import type { MasteryLevel, Question, UserStore } from '../../types/quiz';
import { buildBankViewModel } from '../../utils/bankCatalog';
import type { BankRecord } from '../../utils/quizImportTypes';
import type { WrongBookItem, WrongBookMetaStore, WrongBookSort } from './types';
import {
  DANGEROUS_KEYS,
  formatChoiceSnapshotLabel,
  isValidChoiceForQuestion,
  isWrongRecord,
  normalizeChoiceValue,
  sanitizeTimestamp,
} from './wrongBookMeta';

export function collectWrongBookItems(
  banks: readonly BankRecord[],
  progressByBank: Record<string, UserStore>,
  meta: WrongBookMetaStore,
): WrongBookItem[] {
  const items: WrongBookItem[] = [];

  for (const bank of banks) {
    if (DANGEROUS_KEYS.has(bank.id)) continue;
    const store = Object.prototype.hasOwnProperty.call(progressByBank, bank.id)
      ? progressByBank[bank.id]
      : undefined;
    if (!store) continue;

    const vm = buildBankViewModel(bank);
    const bankMeta = Object.prototype.hasOwnProperty.call(meta.byBank, bank.id)
      ? meta.byBank[bank.id]
      : undefined;

    for (const q of bank.data.questions) {
      if (DANGEROUS_KEYS.has(q.id)) continue;
      const rec = Object.prototype.hasOwnProperty.call(store.records, q.id)
        ? store.records[q.id]
        : undefined;
      if (!isWrongRecord(q, rec) || !rec) {
        continue;
      }

      const metaEntry =
        bankMeta && Object.prototype.hasOwnProperty.call(bankMeta, q.id)
          ? bankMeta[q.id]
          : undefined;
      const mastery = Object.prototype.hasOwnProperty.call(store.mastery, q.id)
        ? store.mastery[q.id]
        : undefined;

      const safeRecTs = sanitizeTimestamp(rec.ts, 0);
      const safeMetaLastWrongTs = sanitizeTimestamp(metaEntry?.lastWrongTs, 0);
      const wrongChoices =
        metaEntry && metaEntry.wrongChoices.length > 0
          ? metaEntry.wrongChoices
          : isValidChoiceForQuestion(q, rec.choice)
            ? [
                {
                  choice: normalizeChoiceValue(rec.choice),
                  label: formatChoiceSnapshotLabel(q, rec.choice),
                  ts: safeRecTs,
                },
              ]
            : [];

      const chapterMeta = vm.chapterById.get(q.chapter);
      const chapterLabel = chapterMeta
        ? chapterMeta.title || chapterMeta.short
        : `第 ${q.chapter} 章`;

      items.push({
        key: `${bank.id}::${q.id}`,
        bankId: bank.id,
        bankName: bank.name,
        isBuiltin: bank.builtin,
        chapterLabel,
        question: q,
        record: rec,
        ...(mastery !== undefined ? { mastery } : {}),
        wrongCount: metaEntry?.wrongCount ?? 1,
        lastWrongTs: Math.max(safeMetaLastWrongTs, safeRecTs),
        wrongChoices,
      });
    }
  }

  return items;
}

export function filterAndSortWrongItems(
  items: readonly WrongBookItem[],
  options: { bankId?: string; sort?: WrongBookSort } = {},
): WrongBookItem[] {
  const { bankId = 'all', sort = 'wrongCount' } = options;
  const filtered =
    bankId === 'all' ? [...items] : items.filter((item) => item.bankId === bankId);

  filtered.sort((a, b) => {
    if (sort === 'wrongCount') {
      return (
        b.wrongCount - a.wrongCount ||
        b.lastWrongTs - a.lastWrongTs ||
        a.key.localeCompare(b.key)
      );
    }
    return (
      b.lastWrongTs - a.lastWrongTs ||
      b.wrongCount - a.wrongCount ||
      a.key.localeCompare(b.key)
    );
  });

  return filtered;
}

export function markQuestionMasteredInStore(
  store: UserStore,
  q: Question,
  ts: number = Date.now(),
): UserStore {
  if (DANGEROUS_KEYS.has(q.id)) {
    return store;
  }
  if (isObjectiveQuestion(q.type)) {
    const answer = q.answer;
    if (
      typeof answer === 'number' ||
      typeof answer === 'boolean' ||
      Array.isArray(answer)
    ) {
      const res = recordObjectiveAnswer(store, q, answer, ts);
      if (res.record.ok === 1) {
        return res.store;
      }
    }
    return {
      records: { ...store.records, [q.id]: { ok: 1, ts } },
      fav: { ...store.fav },
      mastery: { ...store.mastery },
    };
  }
  return recordSubjectiveMastery(store, q.id, 2, ts);
}

export function recordRetryWrongInStore(
  store: UserStore,
  q: Question,
  choiceOrLevel: number | number[] | boolean | MasteryLevel,
  ts: number = Date.now(),
): UserStore {
  if (DANGEROUS_KEYS.has(q.id)) {
    return store;
  }
  if (isObjectiveQuestion(q.type)) {
    return recordObjectiveAnswer(
      store,
      q,
      choiceOrLevel as number | number[] | boolean,
      ts,
    ).store;
  }
  const level: MasteryLevel =
    choiceOrLevel === 0 || choiceOrLevel === 1 ? choiceOrLevel : 0;
  return recordSubjectiveMastery(store, q.id, level, ts);
}
