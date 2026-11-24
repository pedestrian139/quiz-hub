import type {
  BankData,
  ChapterMeta,
  NotesData,
  Question,
  QuestionOrigin,
  QuestionType,
} from '../types/quiz';
import notesJson from './notes.json';

export const NOTES = notesJson as unknown as NotesData;

const fallbackChapters: ChapterMeta[] = NOTES.chapters.map((c) => ({
  id: c.id,
  short: c.short,
  title: c.title,
  description: c.overview,
}));

const bankModules = import.meta.glob<BankData>('./bank.json', {
  eager: true,
  import: 'default',
});

const loadedBank: BankData | undefined = bankModules['./bank.json'];

const emptyBank: BankData = {
  meta: {
    title: '人工智能导论题库',
    version: '1.0.0',
    generatedAt: NOTES.meta.generatedAt,
    counts: {
      total: 0,
      byType: { choice: 0, multi: 0, tf: 0, short: 0, analysis: 0 },
      byOrigin: {
        comprehensive_bank: 0,
        video_popup: 0,
        review_notes_synthesized: 0,
      },
    },
  },
  chapters: fallbackChapters,
  questions: [],
};

export const BANK: BankData = loadedBank ?? emptyBank;

export const QUESTIONS: Question[] = BANK.questions;

export const CHAPTERS: ChapterMeta[] =
  Array.isArray(BANK.chapters) && BANK.chapters.length > 0
    ? [...BANK.chapters].sort((a, b) => a.id - b.id)
    : fallbackChapters;

export const ALL_CHAPTER_IDS: number[] = CHAPTERS.map((c) => c.id);

export const CHAPTER_BY_ID: ReadonlyMap<number, ChapterMeta> = new Map(
  CHAPTERS.map((c) => [c.id, c]),
);

export const QUESTION_TYPES: QuestionType[] = ['choice', 'multi', 'tf', 'short', 'analysis'];
export const QUESTION_ORIGINS: QuestionOrigin[] = [
  'comprehensive_bank',
  'video_popup',
  'review_notes_synthesized',
];

function countBy<K extends string>(keys: K[], pick: (q: Question) => K): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const q of QUESTIONS) {
    const k = pick(q);
    if (k in out) out[k] += 1;
  }
  return out;
}

/** Live counts derived from the questions array (always consistent with what the UI can queue). */
export const COUNTS = {
  total: QUESTIONS.length,
  byType: countBy(QUESTION_TYPES, (q) => q.type),
  byOrigin: countBy(QUESTION_ORIGINS, (q) => q.source.origin),
};

export const SECTION_COUNT: number = NOTES.chapters.reduce((n, c) => n + c.sections.length, 0);

/** Display names for the 6 practice modes / question types. */
export const TYPE_NAME: Record<QuestionType, string> = {
  choice: '单选题',
  multi: '多选题',
  tf: '判断题',
  short: '简答题',
  analysis: '综合分析题',
};

export const TYPE_SHORT: Record<QuestionType, string> = {
  choice: '单选',
  multi: '多选',
  tf: '判断',
  short: '简答',
  analysis: '综合分析',
};

export function chapterLabel(id: number): string {
  const ch = CHAPTER_BY_ID.get(id);
  return ch ? `第 ${id} 章 · ${ch.short}` : `第 ${id} 章`;
}
