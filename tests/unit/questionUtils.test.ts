import { describe, expect, it } from 'vitest';
import {
  formatAnswerText,
  formatElapsed,
  getOptionLabel,
  getOriginLabel,
  getQuestionAiExplanation,
  getTypeLabel,
  isObjectiveQuestion,
} from '../../src/core/questionUtils';
import type { Question, UserStore } from '../../src/types/quiz';
import { MOCK_QUESTIONS } from './fixtures/mockBank';

describe('questionUtils', () => {
  it('QU-01: formatAnswerText handles all 5 question types and out-of-bounds options safely', () => {
    // choice normal
    expect(formatAnswerText(MOCK_QUESTIONS[0])).toBe('B. 1956年');

    // choice out-of-bounds option index
    const oobChoice: Question = {
      ...MOCK_QUESTIONS[0],
      options: ['仅一个选项'],
      answer: 3,
    };
    expect(formatAnswerText(oobChoice)).toBe('D');
    expect(formatAnswerText(oobChoice)).not.toContain('undefined');

    // multi unsorted & duplicate normalization
    const multiDup: Question = {
      ...MOCK_QUESTIONS[3],
      answer: [2, 0, 2],
    };
    expect(formatAnswerText(multiDup)).toBe('A、C');

    // tf true & false
    expect(formatAnswerText(MOCK_QUESTIONS[1])).toBe('正确');
    expect(formatAnswerText(MOCK_QUESTIONS[2])).toBe('错误');

    // short & analysis
    expect(formatAnswerText(MOCK_QUESTIONS[6])).toBe(MOCK_QUESTIONS[6].answer);
    expect(formatAnswerText(MOCK_QUESTIONS[9])).toBe(MOCK_QUESTIONS[9].answer);
  });

  it('QU-02: getTypeLabel maps all 5 QuestionType values', () => {
    expect(getTypeLabel('choice')).toBe('单选');
    expect(getTypeLabel('multi')).toBe('多选');
    expect(getTypeLabel('tf')).toBe('判断');
    expect(getTypeLabel('short')).toBe('简答');
    expect(getTypeLabel('analysis')).toBe('分析');
  });

  it('QU-03: getOriginLabel maps all 3 QuestionOrigin values', () => {
    expect(getOriginLabel('comprehensive_bank')).toBe('标准题库');
    expect(getOriginLabel('video_popup')).toBe('AI 洗题 / 精选');
    expect(getOriginLabel('review_notes_synthesized')).toBe('引导与提炼');
  });

  it('QU-04: getOptionLabel maps 0..25 to A..Z and safely handles >=26 and invalid indices', () => {
    expect(getOptionLabel(0)).toBe('A');
    expect(getOptionLabel(1)).toBe('B');
    expect(getOptionLabel(25)).toBe('Z');
    expect(getOptionLabel(26)).toBe('27');
    expect(getOptionLabel(-1)).toBe('?');
    expect(getOptionLabel(1.5)).toBe('?');
    expect(getOptionLabel(Number.NaN)).toBe('?');
  });

  it('QU-05: formatElapsed formats milliseconds to m:ss and clamps negative/NaN to 0:00', () => {
    expect(formatElapsed(-100)).toBe('0:00');
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59999)).toBe('0:59');
    expect(formatElapsed(65000)).toBe('1:05');
    expect(formatElapsed(3661000)).toBe('61:01');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  it('QU-06: isObjectiveQuestion distinguishes objective vs subjective types', () => {
    expect(isObjectiveQuestion('choice')).toBe(true);
    expect(isObjectiveQuestion('multi')).toBe(true);
    expect(isObjectiveQuestion('tf')).toBe(true);
    expect(isObjectiveQuestion('short')).toBe(false);
    expect(isObjectiveQuestion('analysis')).toBe(false);
  });

  it('QU-07: getQuestionAiExplanation resolves store cache -> aiAnalysis -> explanation -> explain', () => {
    const baseQ: Question = {
      ...MOCK_QUESTIONS[0],
      explain: '原始解析',
      explanation: '规范解析',
      aiAnalysis: 'AI 深度解析',
    };
    const store: UserStore = {
      records: {},
      fav: {},
      mastery: {},
      aiExplanations: {
        [baseQ.id]: { content: '缓存 AI 解析', updatedAt: 1000 },
      },
    };

    expect(getQuestionAiExplanation(baseQ, store)).toBe('缓存 AI 解析');
    expect(getQuestionAiExplanation(baseQ)).toBe('AI 深度解析');
    expect(getQuestionAiExplanation({ ...baseQ, aiAnalysis: '   ' })).toBe('规范解析');
    expect(
      getQuestionAiExplanation({ ...baseQ, aiAnalysis: undefined, explanation: '' }),
    ).toBe('原始解析');
    expect(
      getQuestionAiExplanation({
        ...baseQ,
        aiAnalysis: undefined,
        explanation: undefined,
        explain: undefined as unknown as string,
      }),
    ).toBe('');
  });
});
