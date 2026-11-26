import type { BankData, QuestionType } from '../types/quiz';

export const BUILTIN_AI_BANK_ID = 'builtin-ai-intro';
export const BUILTIN_GUIDE_BANK_ID = 'builtin-quizhub-guide';

export function isBuiltinBankId(bankId: string): boolean {
  return bankId === BUILTIN_AI_BANK_ID || bankId === BUILTIN_GUIDE_BANK_ID;
}

export const QUIZHUB_SHARE_SCHEMA = 'quizhub-bank-v2';

export type ImportSourceFormat = 'xlsx' | 'csv' | 'docx' | 'txt' | 'json';

export interface BankRecord {
  id: string;
  name: string;
  description?: string;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
  sourceFormat?: ImportSourceFormat | 'manual';
  data: BankData;
}

export interface QuizHubSharePackage {
  schema: typeof QUIZHUB_SHARE_SCHEMA;
  exportedAt: string;
  bank: {
    name: string;
    description?: string;
    data: BankData;
  };
}

export interface ImportIssue {
  severity: 'error' | 'warning';
  field?: 'stem' | 'type' | 'options' | 'answer' | 'chapter' | 'general';
  message: string;
}

export interface DraftQuestion {
  tempId: string;
  sourceLoc: string;
  sourceFormat: ImportSourceFormat | 'manual';
  type: QuestionType;
  chapter: number;
  chapterName: string;
  stem: string;
  options: string[];
  answer: number | number[] | boolean | string;
  rawAnswer: string;
  explain: string;
  explanation?: string;
  aiAnalysis?: string;
  keyPoints: string[];
  tags: string[];
  sourceRef: string;
  sourceNote?: string;
  preserveOrigin?: 'comprehensive_bank' | 'video_popup' | 'review_notes_synthesized';
  aiInferredAnswer?: boolean;
  washedByAi?: boolean;
  issues: ImportIssue[];
  included: boolean;
}

export interface ImportParseResult {
  format: ImportSourceFormat;
  suggestedName: string;
  suggestedDescription?: string;
  drafts: DraftQuestion[];
  notes: string[];
  fatalError?: string;
}
