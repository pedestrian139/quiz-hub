import type {
  GradeResult,
  HomeStats,
  MasteryLevel,
  ModeStats,
  Question,
  QuestionType,
  QuizFilterOptions,
  SessionResult,
  UserRecord,
  UserStore,
} from '../types/quiz';
import { formatElapsed } from './questionUtils';

function matchesSearch(q: Question, query: string): boolean {
  const fields: string[] = [
    q.stem,
    ...(q.options ?? []),
    q.explain,
    ...(q.tags ?? []),
    ...(q.keyPoints ?? []),
    typeof q.answer === 'string' ? q.answer : '',
    q.source.ref,
    q.sectionId ?? '',
  ];
  return fields.some((field) => field.toLowerCase().includes(query));
}

export function buildQueue(
  questions: Question[],
  opts: QuizFilterOptions,
  rng: () => number = Math.random,
): Question[] {
  const indexed = questions.map((q, idx) => ({ q, idx }));
  let pool: { q: Question; idx: number }[];

  if (opts.onlyIds !== undefined) {
    const idSet = new Set(opts.onlyIds);
    if (idSet.size === 0) {
      return [];
    }
    pool = indexed.filter(({ q }) => idSet.has(q.id));
  } else {
    const chapterSet = new Set(opts.chapters);
    const originSet = opts.origins !== undefined ? new Set(opts.origins) : null;
    const query = opts.search?.trim().toLowerCase() ?? '';

    pool = indexed.filter(({ q }) => {
      if (opts.mode !== 'all' && q.type !== opts.mode) {
        return false;
      }
      if (!chapterSet.has(q.chapter)) {
        return false;
      }
      if (originSet !== null && !originSet.has(q.source.origin)) {
        return false;
      }
      if (query.length > 0 && !matchesSearch(q, query)) {
        return false;
      }
      return true;
    });
  }

  let ordered: Question[];
  if (opts.order === 'seq') {
    ordered = [...pool]
      .sort((a, b) => a.q.chapter - b.q.chapter || a.idx - b.idx)
      .map((item) => item.q);
  } else {
    ordered = pool.map((item) => item.q);
    for (let i = ordered.length - 1; i > 0; i--) {
      const raw = rng();
      const j = Math.max(0, Math.min(i, Math.floor(raw * (i + 1))));
      const tmp = ordered[i];
      ordered[i] = ordered[j];
      ordered[j] = tmp;
    }
  }

  if (Number.isFinite(opts.count) && opts.count > 0) {
    return ordered.slice(0, Math.floor(opts.count));
  }
  return ordered;
}

export function computeHomeStats(
  questions: Question[],
  store: UserStore,
): HomeStats {
  const validIds = new Set(questions.map((q) => q.id));
  let practicedCount = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let favCount = 0;

  for (const [id, rec] of Object.entries(store.records)) {
    if (!validIds.has(id)) continue;
    practicedCount += 1;
    if (rec.ok === 1) {
      correctCount += 1;
    } else {
      wrongCount += 1;
    }
  }

  for (const [id, isFav] of Object.entries(store.fav)) {
    if (validIds.has(id) && isFav === true) {
      favCount += 1;
    }
  }

  const accuracyPct =
    practicedCount > 0 ? Math.round((correctCount / practicedCount) * 100) : null;

  return {
    totalCount: questions.length,
    practicedCount,
    correctCount,
    wrongCount,
    favCount,
    accuracyPct,
  };
}

export function computeModeStats(
  questions: Question[],
  store: UserStore,
  mode: 'all' | QuestionType,
): ModeStats {
  const scoped =
    mode === 'all' ? questions : questions.filter((q) => q.type === mode);
  const stats = computeHomeStats(scoped, store);
  return {
    mode,
    ...stats,
  };
}

export function gradeObjectiveQuestion(
  q: Question,
  userChoice: number | number[] | boolean,
): GradeResult {
  if (q.type === 'choice') {
    const isCorrect =
      typeof q.answer === 'number' &&
      typeof userChoice === 'number' &&
      Number.isInteger(userChoice) &&
      userChoice >= 0 &&
      (!q.options || userChoice < q.options.length) &&
      userChoice === q.answer;
    return { isCorrect };
  }

  if (q.type === 'multi') {
    if (
      !Array.isArray(q.answer) ||
      !Array.isArray(userChoice) ||
      q.answer.length === 0 ||
      userChoice.length === 0
    ) {
      return { isCorrect: false };
    }
    const allValidIndices = userChoice.every(
      (idx) =>
        typeof idx === 'number' &&
        Number.isInteger(idx) &&
        idx >= 0 &&
        (!q.options || idx < q.options.length),
    );
    if (!allValidIndices) {
      return { isCorrect: false };
    }
    const userSet = new Set(userChoice);
    const ansSet = new Set(q.answer);
    const isCorrect =
      userSet.size === ansSet.size &&
      Array.from(ansSet).every((idx) => userSet.has(idx));
    return { isCorrect };
  }

  if (q.type === 'tf') {
    const isCorrect =
      typeof q.answer === 'boolean' &&
      typeof userChoice === 'boolean' &&
      userChoice === q.answer;
    return { isCorrect };
  }

  return { isCorrect: false };
}

export function computeSessionResult(
  queue: Question[],
  answered: Record<string, UserRecord>,
  elapsedMs: number,
): SessionResult {
  const totalCount = queue.length;
  let answeredCount = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;
  const wrongQuestionIds: string[] = [];

  for (const q of queue) {
    const rec = Object.prototype.hasOwnProperty.call(answered, q.id)
      ? answered[q.id]
      : undefined;
    if (!rec) {
      unansweredCount += 1;
      continue;
    }
    answeredCount += 1;
    if (rec.ok === 1) {
      correctCount += 1;
    } else {
      wrongCount += 1;
      wrongQuestionIds.push(q.id);
    }
  }

  const accuracyPct =
    answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
  const completionPct =
    totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
  const safeElapsedMs =
    Number.isFinite(elapsedMs) && elapsedMs > 0 ? Math.floor(elapsedMs) : 0;

  return {
    totalCount,
    answeredCount,
    correctCount,
    wrongCount,
    unansweredCount,
    accuracyPct,
    completionPct,
    elapsedMs: safeElapsedMs,
    elapsedFormatted: formatElapsed(safeElapsedMs),
    wrongQuestionIds,
  };
}

export function recordObjectiveAnswer(
  store: UserStore,
  q: Question,
  userChoice: number | number[] | boolean,
  ts: number = Date.now(),
): { store: UserStore; record: UserRecord; isCorrect: boolean } {
  const { isCorrect } = gradeObjectiveQuestion(q, userChoice);
  const normalizedChoice = Array.isArray(userChoice)
    ? Array.from(new Set(userChoice)).sort((a, b) => a - b)
    : userChoice;
  const record: UserRecord = {
    ok: isCorrect ? 1 : 0,
    choice: normalizedChoice,
    ts,
  };
  const nextStore: UserStore = {
    records: { ...store.records, [q.id]: record },
    fav: { ...store.fav },
    mastery: { ...store.mastery },
  };
  return { store: nextStore, record, isCorrect };
}

export function recordSubjectiveMastery(
  store: UserStore,
  questionId: string,
  level: MasteryLevel,
  ts: number = Date.now(),
): UserStore {
  const record: UserRecord = {
    ok: level === 2 ? 1 : 0,
    ts,
  };
  return {
    records: { ...store.records, [questionId]: record },
    fav: { ...store.fav },
    mastery: { ...store.mastery, [questionId]: level },
  };
}

export function toggleFavorite(store: UserStore, questionId: string): UserStore {
  const nextFav = { ...store.fav };
  if (nextFav[questionId]) {
    delete nextFav[questionId];
  } else {
    nextFav[questionId] = true;
  }
  return {
    records: { ...store.records },
    fav: nextFav,
    mastery: { ...store.mastery },
  };
}

export function clearWrongRecords(store: UserStore): UserStore {
  const nextRecords: Record<string, UserRecord> = {};
  for (const [id, rec] of Object.entries(store.records)) {
    if (rec.ok === 1) {
      nextRecords[id] = rec;
    }
  }
  const nextMastery: Record<string, MasteryLevel> = {};
  for (const [id, level] of Object.entries(store.mastery)) {
    if (level === 2) {
      nextMastery[id] = level;
    }
  }
  return {
    records: nextRecords,
    fav: { ...store.fav },
    mastery: nextMastery,
  };
}

export function getWrongQuestions(
  questions: Question[],
  store: UserStore,
): Question[] {
  return questions
    .map((q, idx) => ({ q, idx }))
    .filter(({ q }) => store.records[q.id]?.ok === 0)
    .sort((a, b) => a.q.chapter - b.q.chapter || a.idx - b.idx)
    .map(({ q }) => q);
}

export function getFavoriteQuestions(
  questions: Question[],
  store: UserStore,
): Question[] {
  return questions
    .map((q, idx) => ({ q, idx }))
    .filter(({ q }) => store.fav[q.id] === true)
    .sort((a, b) => a.q.chapter - b.q.chapter || a.idx - b.idx)
    .map(({ q }) => q);
}
