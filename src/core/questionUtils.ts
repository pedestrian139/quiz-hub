import type { Question, QuestionOrigin, QuestionType } from '../types/quiz';

export function getOptionLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    return '?';
  }
  if (index < 26) {
    return String.fromCharCode(65 + index);
  }
  return String(index + 1);
}

export function formatAnswerText(q: Question): string {
  switch (q.type) {
    case 'choice': {
      if (typeof q.answer === 'number' && Number.isInteger(q.answer) && q.answer >= 0) {
        const label = getOptionLabel(q.answer);
        const optionText = q.options?.[q.answer];
        return optionText !== undefined ? `${label}. ${optionText}` : label;
      }
      return String(q.answer ?? '');
    }
    case 'multi': {
      if (Array.isArray(q.answer)) {
        const uniqueSorted = Array.from(
          new Set(
            q.answer.filter(
              (idx): idx is number => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0,
            ),
          ),
        ).sort((a, b) => a - b);
        return uniqueSorted.map((idx) => getOptionLabel(idx)).join('、');
      }
      return String(q.answer ?? '');
    }
    case 'tf': {
      if (q.answer === true) return '正确';
      if (q.answer === false) return '错误';
      return String(q.answer ?? '');
    }
    case 'short':
    case 'analysis':
      return typeof q.answer === 'string' ? q.answer : String(q.answer ?? '');
  }
}

export function getTypeLabel(type: QuestionType): string {
  switch (type) {
    case 'choice':
      return '单选';
    case 'multi':
      return '多选';
    case 'tf':
      return '判断';
    case 'short':
      return '简答';
    case 'analysis':
      return '分析';
  }
}

export function getOriginLabel(origin: QuestionOrigin): string {
  switch (origin) {
    case 'comprehensive_bank':
      return '综合题库';
    case 'video_popup':
      return '视频课弹题';
    case 'review_notes_synthesized':
      return '复习资料提炼';
  }
}

export function isObjectiveQuestion(type: QuestionType): boolean {
  return type === 'choice' || type === 'multi' || type === 'tf';
}

export function formatElapsed(elapsedMs: number): string {
  const safeMs = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const totalSec = Math.floor(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
