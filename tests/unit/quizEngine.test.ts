import { describe, expect, it } from 'vitest';
import {
  buildQueue,
  clearWrongRecords,
  computeHomeStats,
  computeModeStats,
  computeSessionResult,
  getFavoriteQuestions,
  getWrongQuestions,
  gradeObjectiveQuestion,
  recordObjectiveAnswer,
  recordSubjectiveMastery,
  toggleFavorite,
} from '../../src/core/quizEngine';
import type { Question, QuizFilterOptions, UserRecord } from '../../src/types/quiz';
import {
  EMPTY_STORE,
  MOCK_QUESTIONS,
  MOCK_STORE,
  MOCK_STORE_WITH_STALE_IDS,
} from './fixtures/mockBank';

const ALL_CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function baseOpts(overrides: Partial<QuizFilterOptions> = {}): QuizFilterOptions {
  return {
    mode: 'all',
    chapters: ALL_CHAPTERS,
    count: 0,
    order: 'seq',
    ...overrides,
  };
}

describe('quizEngine', () => {
  describe('buildQueue', () => {
    it('QE-01: filters by mode (all and each of the 5 QuestionTypes)', () => {
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ mode: 'all' }))).toHaveLength(12);
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ mode: 'choice' }))).toHaveLength(4);
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ mode: 'multi' }))).toHaveLength(2);
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ mode: 'tf' }))).toHaveLength(3);
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ mode: 'short' }))).toHaveLength(2);
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ mode: 'analysis' }))).toHaveLength(1);
    });

    it('QE-02: filters by chapters (single, multiple, and empty -> [])', () => {
      const ch1 = buildQueue(MOCK_QUESTIONS, baseOpts({ chapters: [1] }));
      expect(ch1.map((q) => q.id)).toEqual(['qb-c1-choice-01', 'qb-c1-tf-01']);

      const ch147 = buildQueue(MOCK_QUESTIONS, baseOpts({ chapters: [1, 4, 7] }));
      expect(ch147.every((q) => [1, 4, 7].includes(q.chapter))).toBe(true);
      expect(ch147).toHaveLength(6);

      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ chapters: [] }))).toEqual([]);
    });

    it('QE-03: filters by origins (subset, multiple, undefined, and empty -> [])', () => {
      const videoOnly = buildQueue(
        MOCK_QUESTIONS,
        baseOpts({ origins: ['video_popup'] }),
      );
      expect(videoOnly).toHaveLength(3);
      expect(videoOnly.every((q) => q.source.origin === 'video_popup')).toBe(true);

      const multiOrigin = buildQueue(
        MOCK_QUESTIONS,
        baseOpts({ origins: ['comprehensive_bank', 'video_popup'] }),
      );
      expect(multiOrigin).toHaveLength(8);

      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ origins: undefined }))).toHaveLength(12);
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ origins: [] }))).toEqual([]);
    });

    it('QE-04: filters by trimmed case-insensitive search across stem/options/tags/explain/ref', () => {
      // Matches tag / stem case-insensitively ('attention' / 'transformer')
      const nlp = buildQueue(MOCK_QUESTIONS, baseOpts({ search: '  transformer  ' }));
      expect(nlp.map((q) => q.id)).toEqual(['vid-c7-choice-01', 'syn-c7-analysis-01']);

      // Matches option text
      const optMatch = buildQueue(MOCK_QUESTIONS, baseOpts({ search: 'Dropout' }));
      expect(optMatch.map((q) => q.id)).toEqual(['qb-c4-multi-02']);

      // Matches source.ref
      const refMatch = buildQueue(MOCK_QUESTIONS, baseOpts({ search: 'p.31' }));
      expect(refMatch.map((q) => q.id)).toEqual(['vid-c4-choice-01']);

      // Whitespace-only search does not filter
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ search: '   ' }))).toHaveLength(12);
    });

    it('QE-05: handles onlyIds as explicit allowlist independent of chapters/mode/origins/search', () => {
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ onlyIds: [] }))).toEqual([]);

      const subset = buildQueue(
        MOCK_QUESTIONS,
        baseOpts({
          onlyIds: ['qb-c1-choice-01', 'syn-c7-analysis-01', 'missing-id'],
          chapters: [],
          mode: 'tf',
          origins: [],
          search: 'no-match-anywhere',
        }),
      );
      expect(subset.map((q) => q.id)).toEqual(['qb-c1-choice-01', 'syn-c7-analysis-01']);

      expect(
        buildQueue(MOCK_QUESTIONS, baseOpts({ onlyIds: ['missing-only'] })),
      ).toEqual([]);
    });

    it('QE-06: order="seq" sorts by chapter asc preserving bank order and never mutates input', () => {
      const unsorted: Question[] = [
        MOCK_QUESTIONS[11], // ch9
        MOCK_QUESTIONS[1],  // ch1 second in bank
        MOCK_QUESTIONS[0],  // ch1 first in bank
        MOCK_QUESTIONS[4],  // ch4
      ];
      const snapshot = [...unsorted];

      const sorted = buildQueue(unsorted, baseOpts({ order: 'seq' }));
      expect(sorted.map((q) => q.id)).toEqual([
        'qb-c1-tf-01',
        'qb-c1-choice-01',
        'vid-c4-choice-01',
        'qb-c9-choice-01',
      ]);
      expect(unsorted).toEqual(snapshot);
    });

    it('QE-07: order="random" uses deterministic Fisher-Yates with injected rng without drops/dups/mutation', () => {
      const snapshot = [...MOCK_QUESTIONS];
      let step = 0;
      const deterministicRng = () => {
        step += 1;
        return (step * 0.37) % 1;
      };

      const q1 = buildQueue(
        MOCK_QUESTIONS,
        baseOpts({ order: 'random' }),
        deterministicRng,
      );
      expect(q1).toHaveLength(MOCK_QUESTIONS.length);
      expect(new Set(q1.map((q) => q.id))).toEqual(
        new Set(MOCK_QUESTIONS.map((q) => q.id)),
      );
      expect(MOCK_QUESTIONS).toEqual(snapshot);

      // Edge: rng returning 1 should clamp j <= i and never introduce undefined
      const edgeRng = () => 1;
      const q2 = buildQueue(MOCK_QUESTIONS, baseOpts({ order: 'random' }), edgeRng);
      expect(q2).toHaveLength(MOCK_QUESTIONS.length);
      expect(q2.every((item) => item !== undefined)).toBe(true);
    });

    it('QE-08: count caps result length when > 0 and returns all when 0 or > length', () => {
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ count: 0 }))).toHaveLength(12);
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ count: 3 }))).toHaveLength(3);
      expect(buildQueue(MOCK_QUESTIONS, baseOpts({ count: 99 }))).toHaveLength(12);
    });
  });

  describe('stats aggregation', () => {
    it('QE-09: computeHomeStats on EMPTY_STORE returns zeroes and null accuracyPct', () => {
      expect(computeHomeStats(MOCK_QUESTIONS, EMPTY_STORE)).toEqual({
        totalCount: 12,
        practicedCount: 0,
        correctCount: 0,
        wrongCount: 0,
        favCount: 0,
        accuracyPct: null,
      });
    });

    it('QE-10: computeHomeStats on MOCK_STORE computes counts accurately and ignores fav=false', () => {
      expect(computeHomeStats(MOCK_QUESTIONS, MOCK_STORE)).toEqual({
        totalCount: 12,
        practicedCount: 4,
        correctCount: 2,
        wrongCount: 2,
        favCount: 2,
        accuracyPct: 50,
      });
    });

    it('QE-11: computeHomeStats ignores stale IDs absent from questions bank', () => {
      expect(computeHomeStats(MOCK_QUESTIONS, MOCK_STORE_WITH_STALE_IDS)).toEqual({
        totalCount: 12,
        practicedCount: 4,
        correctCount: 2,
        wrongCount: 2,
        favCount: 2,
        accuracyPct: 50,
      });
    });

    it('QE-12: computeModeStats scopes to mode, handles all-wrong (0%) and 0-practiced (null)', () => {
      expect(computeModeStats(MOCK_QUESTIONS, MOCK_STORE_WITH_STALE_IDS, 'all')).toEqual({
        mode: 'all',
        totalCount: 12,
        practicedCount: 4,
        correctCount: 2,
        wrongCount: 2,
        favCount: 2,
        accuracyPct: 50,
      });

      expect(computeModeStats(MOCK_QUESTIONS, MOCK_STORE, 'choice')).toEqual({
        mode: 'choice',
        totalCount: 4,
        practicedCount: 1,
        correctCount: 1,
        wrongCount: 0,
        favCount: 0,
        accuracyPct: 100,
      });

      expect(computeModeStats(MOCK_QUESTIONS, MOCK_STORE, 'tf')).toEqual({
        mode: 'tf',
        totalCount: 3,
        practicedCount: 1,
        correctCount: 0,
        wrongCount: 1,
        favCount: 1,
        accuracyPct: 0,
      });

      expect(computeModeStats(MOCK_QUESTIONS, MOCK_STORE, 'analysis')).toEqual({
        mode: 'analysis',
        totalCount: 1,
        practicedCount: 0,
        correctCount: 0,
        wrongCount: 0,
        favCount: 0,
        accuracyPct: null,
      });
    });
  });

  describe('gradeObjectiveQuestion', () => {
    it('QE-13: grades choice questions safely', () => {
      const q = MOCK_QUESTIONS[0]; // answer: 1, 4 options
      expect(gradeObjectiveQuestion(q, 1)).toEqual({ isCorrect: true });
      expect(gradeObjectiveQuestion(q, 0)).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, -1)).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, 99)).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, 1.5)).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, true)).toEqual({ isCorrect: false });
    });

    it('QE-14: grades multi questions via order-independent exact set equality', () => {
      const q = MOCK_QUESTIONS[3]; // answer: [0, 2], 4 options
      expect(gradeObjectiveQuestion(q, [0, 2])).toEqual({ isCorrect: true });
      expect(gradeObjectiveQuestion(q, [2, 0])).toEqual({ isCorrect: true });
      expect(gradeObjectiveQuestion(q, [0])).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, [0, 1, 2])).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, [0, 0])).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, [])).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, [0, 99])).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(q, [-1, 2])).toEqual({ isCorrect: false });
    });

    it('QE-15: grades tf questions and returns { isCorrect: false } for short/analysis', () => {
      const tfTrue = MOCK_QUESTIONS[1]; // answer: true
      const tfFalse = MOCK_QUESTIONS[2]; // answer: false
      const shortQ = MOCK_QUESTIONS[6];
      const analysisQ = MOCK_QUESTIONS[9];

      expect(gradeObjectiveQuestion(tfTrue, true)).toEqual({ isCorrect: true });
      expect(gradeObjectiveQuestion(tfTrue, false)).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(tfFalse, false)).toEqual({ isCorrect: true });
      expect(gradeObjectiveQuestion(tfFalse, 0)).toEqual({ isCorrect: false });

      expect(gradeObjectiveQuestion(shortQ, 0)).toEqual({ isCorrect: false });
      expect(gradeObjectiveQuestion(analysisQ, true)).toEqual({ isCorrect: false });
    });
  });

  describe('computeSessionResult', () => {
    it('QE-16: separates accuracyPct and completionPct and preserves wrongQuestionIds in queue order', () => {
      const queue = MOCK_QUESTIONS.slice(0, 4);
      const answered: Record<string, UserRecord> = {
        'qb-c1-choice-01': { ok: 1, choice: 1, ts: 10 },
        'qb-c1-tf-01': { ok: 0, choice: false, ts: 20 },
        'vid-c2-tf-01': { ok: 0, choice: true, ts: 30 },
        'extra-not-in-queue': { ok: 0, choice: 0, ts: 40 },
      };

      const res = computeSessionResult(queue, answered, 65000);
      expect(res).toEqual({
        totalCount: 4,
        answeredCount: 3,
        correctCount: 1,
        wrongCount: 2,
        unansweredCount: 1,
        accuracyPct: 33,
        completionPct: 75,
        elapsedMs: 65000,
        elapsedFormatted: '1:05',
        wrongQuestionIds: ['qb-c1-tf-01', 'vid-c2-tf-01'],
      });
    });

    it('QE-17: handles zero answered, empty queue, negative/NaN elapsedMs without NaN', () => {
      const queue = MOCK_QUESTIONS.slice(0, 2);
      expect(computeSessionResult(queue, {}, -5000)).toEqual({
        totalCount: 2,
        answeredCount: 0,
        correctCount: 0,
        wrongCount: 0,
        unansweredCount: 2,
        accuracyPct: 0,
        completionPct: 0,
        elapsedMs: 0,
        elapsedFormatted: '0:00',
        wrongQuestionIds: [],
      });

      expect(computeSessionResult([], {}, Number.NaN)).toEqual({
        totalCount: 0,
        answeredCount: 0,
        correctCount: 0,
        wrongCount: 0,
        unansweredCount: 0,
        accuracyPct: 0,
        completionPct: 0,
        elapsedMs: 0,
        elapsedFormatted: '0:00',
        wrongQuestionIds: [],
      });
    });
  });

  describe('pure store mutation and list helpers', () => {
    it('recordObjectiveAnswer grades and normalizes multi choice immutably', () => {
      const qMulti = MOCK_QUESTIONS[3]; // answer: [0, 2]
      const { store: s1, record, isCorrect } = recordObjectiveAnswer(
        EMPTY_STORE,
        qMulti,
        [2, 0, 2],
        12345,
      );
      expect(isCorrect).toBe(true);
      expect(record).toEqual({ ok: 1, choice: [0, 2], ts: 12345 });
      expect(s1.records[qMulti.id]).toEqual(record);
      expect(EMPTY_STORE.records).toEqual({});
    });

    it('recordSubjectiveMastery syncs mastery and records.ok (2->1, 1/0->0)', () => {
      const s1 = recordSubjectiveMastery(EMPTY_STORE, 'syn-c5-short-01', 1, 100);
      expect(s1.mastery['syn-c5-short-01']).toBe(1);
      expect(s1.records['syn-c5-short-01']).toEqual({ ok: 0, ts: 100 });

      const s2 = recordSubjectiveMastery(s1, 'syn-c5-short-01', 2, 200);
      expect(s2.mastery['syn-c5-short-01']).toBe(2);
      expect(s2.records['syn-c5-short-01']).toEqual({ ok: 1, ts: 200 });
    });

    it('toggleFavorite toggles fav key cleanly', () => {
      const s1 = toggleFavorite(EMPTY_STORE, 'qb-c1-choice-01');
      expect(s1.fav['qb-c1-choice-01']).toBe(true);
      const s2 = toggleFavorite(s1, 'qb-c1-choice-01');
      expect('qb-c1-choice-01' in s2.fav).toBe(false);
    });

    it('clearWrongRecords removes ok=0 records and mastery<2 while preserving ok=1, mastery=2, fav', () => {
      const cleared = clearWrongRecords(MOCK_STORE);
      expect(cleared.records).toEqual({
        'qb-c1-choice-01': { ok: 1, choice: 1, ts: 1732340000000 },
        'qb-c3-multi-01': { ok: 1, choice: [0, 2], ts: 1732340020000 },
      });
      expect(cleared.mastery).toEqual({
        'syn-c7-analysis-01': 2,
      });
      expect(cleared.fav).toEqual(MOCK_STORE.fav);
    });

    it('getWrongQuestions and getFavoriteQuestions sort by chapter asc and ignore stale IDs', () => {
      const wrong = getWrongQuestions(MOCK_QUESTIONS, MOCK_STORE_WITH_STALE_IDS);
      expect(wrong.map((q) => q.id)).toEqual(['qb-c1-tf-01', 'syn-c5-short-01']);

      const favs = getFavoriteQuestions(MOCK_QUESTIONS, MOCK_STORE_WITH_STALE_IDS);
      expect(favs.map((q) => q.id)).toEqual(['qb-c1-tf-01', 'syn-c5-short-01']);
    });

    it('handles Phase 1 questions missing explain in search and preserves aiExplanations across store mutations', () => {
      const legacyNoExplain = {
        ...MOCK_QUESTIONS[0],
        explain: undefined,
      } as unknown as Question;

      expect(() =>
        buildQueue([legacyNoExplain], baseOpts({ search: '1956' })),
      ).not.toThrow();
      expect(buildQueue([legacyNoExplain], baseOpts({ search: '1956' }))).toHaveLength(1);

      const storeWithAi = {
        ...EMPTY_STORE,
        aiExplanations: {
          'qb-c1-choice-01': { content: 'AI 缓存解析', updatedAt: 999 },
        },
      };

      const { store: afterObj } = recordObjectiveAnswer(storeWithAi, MOCK_QUESTIONS[0], 1, 1000);
      expect(afterObj.aiExplanations).toEqual(storeWithAi.aiExplanations);

      const afterSubj = recordSubjectiveMastery(afterObj, 'syn-c5-short-01', 1, 1001);
      expect(afterSubj.aiExplanations).toEqual(storeWithAi.aiExplanations);

      const afterFav = toggleFavorite(afterSubj, 'qb-c1-choice-01');
      expect(afterFav.aiExplanations).toEqual(storeWithAi.aiExplanations);

      const afterClear = clearWrongRecords(afterFav);
      expect(afterClear.aiExplanations).toEqual(storeWithAi.aiExplanations);
    });
  });
});
