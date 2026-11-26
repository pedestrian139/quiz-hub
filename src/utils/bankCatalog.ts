import { BANK } from '../data/catalog';
import legacyBank from '../data/legacy-ai-intro-bank.json';
import type {
  BankData,
  ChapterMeta,
  Question,
  QuestionOrigin,
  QuestionType,
} from '../types/quiz';
import { BUILTIN_AI_BANK_ID, BUILTIN_GUIDE_BANK_ID, type BankRecord } from './quizImportTypes';

export function computeV1BankCounts(questions: Question[]): BankData['meta']['counts'] {
  const byType: Record<QuestionType, number> = {
    choice: 0,
    multi: 0,
    tf: 0,
    short: 0,
    analysis: 0,
  };
  const byOrigin: Record<QuestionOrigin, number> = {
    comprehensive_bank: 0,
    video_popup: 0,
    review_notes_synthesized: 0,
  };

  for (const q of questions) {
    if (q.type in byType) {
      byType[q.type] += 1;
    }
    const origin = q.source?.origin;
    if (origin && origin in byOrigin) {
      byOrigin[origin] += 1;
    } else {
      byOrigin.comprehensive_bank += 1;
    }
  }

  return {
    total: questions.length,
    byType,
    byOrigin,
  };
}

export const BUILTIN_AI_BANK: BankRecord = {
  id: BUILTIN_AI_BANK_ID,
  name: legacyBank.meta.title,
  description: '旧版内置题库 · 恢复原有练习进度',
  builtin: true,
  createdAt: 0,
  updatedAt: 0,
  data: legacyBank as BankData,
};

export const BUILTIN_GUIDE_BANK: BankRecord = {
  id: BUILTIN_GUIDE_BANK_ID,
  name: 'QuizHub 使用引导示例题库',
  description: 'QuizHub 内置使用引导示例题库 · 展示单选、多选、公式渲染与 AI 深度解析功能',
  builtin: true,
  createdAt: 0,
  updatedAt: 0,
  data: BANK,
};

export interface BankViewModel {
  bank: BankRecord;
  questions: Question[];
  chapters: ChapterMeta[];
  allChapterIds: number[];
  chapterById: ReadonlyMap<number, ChapterMeta>;
  counts: BankData['meta']['counts'];
  distinctOrigins: QuestionOrigin[];
  hasMultipleOrigins: boolean;
  getChapterLabel: (id: number) => string;
}

const ORIGIN_ORDER: QuestionOrigin[] = [
  'comprehensive_bank',
  'video_popup',
  'review_notes_synthesized',
];

export function buildBankViewModel(bank: BankRecord): BankViewModel {
  const questions = Array.isArray(bank.data.questions) ? bank.data.questions : [];
  const chapterMap = new Map<number, ChapterMeta>();

  if (Array.isArray(bank.data.chapters)) {
    for (const ch of bank.data.chapters) {
      if (Number.isInteger(ch.id) && ch.id > 0) {
        chapterMap.set(ch.id, ch);
      }
    }
  }

  for (const q of questions) {
    if (Number.isInteger(q.chapter) && q.chapter > 0 && !chapterMap.has(q.chapter)) {
      chapterMap.set(q.chapter, {
        id: q.chapter,
        short: `第 ${q.chapter} 章`,
        title: `第 ${q.chapter} 章`,
      });
    }
  }

  const chapters = Array.from(chapterMap.values()).sort((a, b) => a.id - b.id);
  const allChapterIds = chapters.map((c) => c.id);
  const counts = computeV1BankCounts(questions);
  const distinctOrigins = ORIGIN_ORDER.filter((o) => counts.byOrigin[o] > 0);

  return {
    bank,
    questions,
    chapters,
    allChapterIds,
    chapterById: chapterMap,
    counts,
    distinctOrigins,
    hasMultipleOrigins: distinctOrigins.length > 1,
    getChapterLabel(id: number): string {
      const ch = chapterMap.get(id);
      return ch ? `第 ${id} 章 · ${ch.short}` : `第 ${id} 章`;
    },
  };
}
