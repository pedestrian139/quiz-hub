import type {
  MasteryLevel,
  Question,
  QuestionOrigin,
  QuizFilterOptions,
  SessionResult,
  UserRecord,
} from '../types/quiz';

export type CountOption = 10 | 20 | 30 | 0;

export interface FilterState {
  chapters: number[];
  origin: 'all' | QuestionOrigin;
  count: CountOption;
  order: 'random' | 'seq';
}

export type SessionKind = 'mode' | 'wrong' | 'fav' | 'retry' | 'review';

export interface SessionConfig {
  kind: SessionKind;
  title: string;
  opts: QuizFilterOptions;
}

export interface SessionSpec {
  id: number;
  config: SessionConfig;
  queue: Question[];
}

export interface ResultSpec {
  id: number;
  config: SessionConfig;
  queue: Question[];
  answers: Record<string, UserRecord>;
  mastery: Record<string, MasteryLevel>;
  result: SessionResult;
}

export type QuizView =
  | { type: 'home' }
  | { type: 'session'; spec: SessionSpec }
  | { type: 'result'; spec: ResultSpec };

export interface QuizActions {
  answerObjective: (
    q: Question,
    choice: number | number[] | boolean,
  ) => { record: UserRecord; isCorrect: boolean };
  rateSubjective: (questionId: string, level: MasteryLevel) => UserRecord;
  toggleFav: (questionId: string) => boolean;
}

export type ToastTone = 'info' | 'success' | 'error';
export type Notify = (message: string, tone?: ToastTone) => void;

export function safeConfirm(message: string): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
    return true;
  } catch {
    return true;
  }
}

export function safeAlert(message: string): void {
  try {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message);
    }
  } catch {
    // Ignore alert errors in restricted environments
  }
}
