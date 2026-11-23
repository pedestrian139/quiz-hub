// Section 1: Question Bank Schema (PROJECT.md § Interface Contracts 1)
export type QuestionType = 'choice' | 'multi' | 'tf' | 'short' | 'analysis';
export type QuestionOrigin =
  | 'comprehensive_bank'
  | 'video_popup'
  | 'review_notes_synthesized';

export interface ChapterMeta {
  id: number;          // 1..9
  short: string;       // e.g. "人工智能概述"
  title: string;       // e.g. "第一章 人工智能概述"
  description?: string;
}

export interface QuestionSource {
  origin: QuestionOrigin;
  file: string;
  ref: string;                 // e.g. "Ch1 判断题 #1", "p.38", "ch2.s3"
  duplicatesMerged?: string[]; // refs of deduplicated duplicates merged into this entry
  note?: string;               // e.g. source ambiguity note
}

export interface Question {
  id: string;                  // unique stable ID, e.g. "qb-c1-tf01", "vid-p01", "syn-c1-s1-01"
  type: QuestionType;
  chapter: number;             // 1..9
  sectionId?: string;          // e.g. "ch1.s1" linking to notes.json
  stem: string;
  options?: string[];          // required for 'choice' & 'multi'
  answer: number | number[] | boolean | string;
  // choice -> 0-based index (number)
  // multi  -> sorted 0-based indices (number[])
  // tf     -> boolean (true=正确/对, false=错误/错)
  // short | analysis -> string reference answer
  explain: string;
  keyPoints?: string[];        // optional bullet points for short/analysis
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

// Section 2: Knowledge Handbook Schema (PROJECT.md § Interface Contracts 2)
export interface NoteTable {
  caption?: string;
  headers: string[];
  rows: string[][];
}

export interface NoteSection {
  id: string;          // "ch1.s1" .. "ch9.s8" (64 sections total)
  chapterId: number;   // 1..9
  title: string;       // Section heading
  summary: string;     // Concise 1-2 sentence takeaway
  keyPoints: string[]; // Structured bullet points (typo-normalized)
  terms?: { term: string; definition: string }[];
  tables?: NoteTable[];
  callout?: string;    // Exam focus / easily confused reminder
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

// Section 3: Core Engine & Storage Types (PROJECT.md § Interface Contracts 3 + Engine Types)
export type MasteryLevel = 0 | 1 | 2; // 0=不会, 1=有点模糊, 2=完全会

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

export interface QuizFilterOptions {
  mode: 'all' | QuestionType;
  chapters: number[];
  origins?: QuestionOrigin[];
  onlyIds?: string[];
  search?: string;
  count: number; // 0 = all matching questions
  order: 'random' | 'seq';
}

export interface HomeStats {
  totalCount: number;
  practicedCount: number;
  correctCount: number;
  wrongCount: number;
  favCount: number;
  accuracyPct: number | null; // null when practicedCount === 0
}

export interface ModeStats extends HomeStats {
  mode: 'all' | QuestionType;
}

export interface GradeResult {
  isCorrect: boolean;
}

export interface SessionResult {
  totalCount: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  accuracyPct: number;        // 0 when answeredCount === 0
  completionPct: number;      // 0 when totalCount === 0
  elapsedMs: number;          // clamped >= 0
  elapsedFormatted: string;   // "m:ss"
  wrongQuestionIds: string[]; // in queue order
}

export type ImportStoreResult =
  | { ok: true; store: UserStore }
  | { ok: false; error: string };
