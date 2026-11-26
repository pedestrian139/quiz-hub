import type { MasteryLevel, Question, UserRecord } from '../../types/quiz';

export type WrongBookSort = 'wrongCount' | 'recent';

export interface WrongChoiceSnapshot {
  choice?: number | number[] | boolean;
  label: string;
  ts: number;
}

export interface WrongBookMetaEntry {
  wrongCount: number;
  lastWrongTs: number;
  lastObservedTs: number;
  wrongChoices: WrongChoiceSnapshot[];
}

export interface WrongBookMetaStore {
  version: 1;
  byBank: Record<string, Record<string, WrongBookMetaEntry>>;
}

export interface WrongBookItem {
  key: string;
  bankId: string;
  bankName: string;
  isBuiltin: boolean;
  chapterLabel: string;
  question: Question;
  record: UserRecord;
  mastery?: MasteryLevel;
  wrongCount: number;
  lastWrongTs: number;
  wrongChoices: WrongChoiceSnapshot[];
}

export interface SmartWrongBookProps {
  initialBankId?: string;
  titleId?: string;
  onClose?: () => void;
  className?: string;
}
