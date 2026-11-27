import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIELD_WEIGHTS,
  createQuestionSearchIndex,
  mergeHighlightRanges,
  normalizeSearchText,
  searchQuestions,
  tokenizeQuery,
  type HighlightRange,
  type SearchableQuestion,
} from '../../src/core/fuzzySearch';
import type { ChapterMeta, Question } from '../../src/types/quiz';

function makeQuestion(
  id: string,
  overrides: Partial<Question> & { chapterName?: string } = {},
): Question & { chapterName?: string } {
  return {
    id,
    type: 'choice',
    chapter: 1,
    stem: '默认测试题干',
    options: ['选项A', '选项B', '选项C', '选项D'],
    answer: 0,
    explain: '默认解析说明',
    source: {
      origin: 'comprehensive_bank',
      file: 'test-bank.json',
      ref: `test-${id}`,
    },
    ...overrides,
  };
}

function assertValidHighlights(stem: string, ranges: readonly HighlightRange[]) {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    expect(Number.isInteger(r.start)).toBe(true);
    expect(Number.isInteger(r.end)).toBe(true);
    expect(r.start).toBeGreaterThanOrEqual(0);
    expect(r.end).toBeGreaterThan(r.start);
    expect(r.end).toBeLessThanOrEqual(stem.length);
    if (i > 0) {
      // Strictly merged & non-overlapping
      expect(r.start).toBeGreaterThan(ranges[i - 1]!.end);
    }
  }
}

describe('fuzzySearch engine', () => {
  it('FS-01: returns empty array for empty, whitespace, or punctuation-only queries and empty banks', () => {
    const bank = [makeQuestion('q1', { stem: '图灵测试提出于1950年。' })];

    expect(searchQuestions([], '图灵')).toEqual([]);
    expect(searchQuestions(bank, '')).toEqual([]);
    expect(searchQuestions(bank, '   \t\u3000\n  ')).toEqual([]);
    expect(searchQuestions(bank, '，。？！（）[]{}—…')).toEqual([]);
    expect(tokenizeQuery('  ＡＩ，　Neural   ａｉ  ')).toEqual(['ai', 'neural']);
  });

  it('FS-02: matches multi-token queries regardless of word order', () => {
    const target = makeQuestion('q-wave2', {
      stem: '人工智能的第二波高潮主要由知识工程与专家系统推动发展。',
    });
    const partialOnly = makeQuestion('q-partial', {
      stem: '人工智能的第二波高潮曾受限于知识获取瓶颈。',
    });
    const unrelated = makeQuestion('q-other', {
      stem: '深度神经网络在图像识别任务中表现优异。',
    });

    const resForward = searchQuestions([unrelated, partialOnly, target], '第二波 专家');
    const resReverse = searchQuestions([unrelated, partialOnly, target], '专家 第二波');

    expect(resForward.map((m) => m.question.id)).toEqual(['q-wave2']);
    expect(resReverse.map((m) => m.question.id)).toEqual(['q-wave2']);
    expect(resForward[0]!.matchedFields).toEqual(['stem']);
    expect(resForward[0]!.matchedNonStemOnly).toBe(false);

    const highlightedText = resForward[0]!.stemHighlights
      .map((r) => target.stem.slice(r.start, r.end))
      .join('|');
    expect(highlightedText).toBe('第二波|专家');
    assertValidHighlights(target.stem, resForward[0]!.stemHighlights);
  });

  it('FS-03: supports skip-character subsequence matching and ranks compact hits above dispersed hits', () => {
    const exactMatch = makeQuestion('q-exact', {
      stem: '符号学派在早期人工智能研究中占据主导地位。',
    });
    const compactHit = makeQuestion('q-compact', {
      stem: '符号主义、连接主义与行为主义三大学派各自具有鲜明特征。',
    });
    const dispersedHit = makeQuestion('q-dispersed', {
      stem: '符号表示方法经历了早期专家系统、规则推理引擎、混合架构等多个阶段才形成学派体系。',
    });
    const unrelated = makeQuestion('q-noise', {
      stem: '强化学习通过奖励信号驱动智能体优化策略。',
    });

    const matches = searchQuestions(
      [unrelated, dispersedHit, compactHit, exactMatch],
      '符号学派',
    );

    expect(matches.map((m) => m.question.id)).toEqual([
      'q-exact',
      'q-compact',
      'q-dispersed',
    ]);
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score);
    expect(matches[1]!.score).toBeGreaterThan(matches[2]!.score);
    for (const m of matches) {
      assertValidHighlights(m.question.stem, m.stemHighlights);
      const chars = m.stemHighlights.map((r) => m.question.stem.slice(r.start, r.end)).join('');
      expect(chars).toContain('符号');
      expect(chars).toContain('学派');
    }
  });

  it('FS-04: tolerates 1-2 character Chinese typos via Bi-gram Dice + bounded edit distance', () => {
    const turing = makeQuestion('q-turing', {
      stem: '阿兰·图灵在1950年提出了著名的“图灵测试”以评估机器智能。',
    });
    const middleTypo = makeQuestion('q-mid-typo', {
      stem: '知识图谱通常采用三元组来表达实体间的语义关系。',
    });
    const noise = makeQuestion('q-noise', {
      stem: '反向传播算法利用链式法则计算梯度。',
    });

    const res = searchQuestions([noise, turing], '图灵测验');
    expect(res.map((m) => m.question.id)).toEqual(['q-turing']);
    expect(res[0]!.score).toBeGreaterThan(0.5);
    assertValidHighlights(turing.stem, res[0]!.stemHighlights);

    // Also tolerate middle-character substitution on 3-char CJK term ("知识图" vs "知错图" / "三元祖")
    const res3 = searchQuestions([noise, middleTypo], '三元祖');
    expect(res3.map((m) => m.question.id)).toEqual(['q-mid-typo']);
    assertValidHighlights(middleTypo.stem, res3[0]!.stemHighlights);
  });

  it('FS-05: tolerates English typos, omissions, and adjacent transpositions via Damerau-Levenshtein', () => {
    const neuralQ = makeQuestion('q-neural', {
      stem: 'Convolutional neural networks excel at computer vision tasks.',
    });
    const otherQ = makeQuestion('q-svm', {
      stem: 'Support vector machines maximize the classification margin.',
    });

    // Substitution typo: "neurel" -> "neural" (distance 1)
    const subRes = searchQuestions([otherQ, neuralQ], 'neurel');
    expect(subRes.map((m) => m.question.id)).toEqual(['q-neural']);
    expect(subRes[0]!.stemHighlights.map((r) => neuralQ.stem.slice(r.start, r.end))).toEqual([
      'neural',
    ]);

    // Transposition typos: "nuerla" -> "neural" (2 adjacent swaps -> Damerau-Levenshtein distance 2)
    const transRes = searchQuestions([otherQ, neuralQ], 'nuerla');
    expect(transRes.map((m) => m.question.id)).toEqual(['q-neural']);
    expect(transRes[0]!.stemHighlights.map((r) => neuralQ.stem.slice(r.start, r.end))).toEqual([
      'neural',
    ]);
  });

  it('FS-06: normalizes case, full-width/half-width ASCII, and punctuation seamlessly', () => {
    const q = makeQuestion('q-norm', {
      stem: '【第１章】什么是 ＡＩ（人工智能）中的 Neural-Network？',
    });

    const r1 = searchQuestions([q], 'ＡＩ（人工智能）！');
    expect(r1).toHaveLength(1);
    assertValidHighlights(q.stem, r1[0]!.stemHighlights);
    expect(r1[0]!.stemHighlights.map((r) => q.stem.slice(r.start, r.end))).toEqual([
      'ＡＩ（人工智能',
    ]);

    const r2 = searchQuestions([q], 'NEURAL network');
    expect(r2).toHaveLength(1);
    assertValidHighlights(q.stem, r2[0]!.stemHighlights);
    expect(r2[0]!.stemHighlights.map((r) => q.stem.slice(r.start, r.end))).toEqual([
      'Neural',
      'Network',
    ]);

    const r2b = searchQuestions([q], 'NEURAL-Network');
    expect(r2b).toHaveLength(1);
    assertValidHighlights(q.stem, r2b[0]!.stemHighlights);
    expect(r2b[0]!.stemHighlights.map((r) => q.stem.slice(r.start, r.end))).toEqual([
      'Neural-Network',
    ]);

    const r3 = searchQuestions([q], '第1章，AI。');
    expect(r3).toHaveLength(1);
    assertValidHighlights(q.stem, r3[0]!.stemHighlights);
  });

  it('FS-07: enforces field priority weighting (stem > options > chapter/tags > explanation) and spoiler-free metadata', () => {
    expect(DEFAULT_FIELD_WEIGHTS.stem).toBeGreaterThan(DEFAULT_FIELD_WEIGHTS.options);
    expect(DEFAULT_FIELD_WEIGHTS.options).toBeGreaterThan(DEFAULT_FIELD_WEIGHTS.chapter);
    expect(DEFAULT_FIELD_WEIGHTS.chapter).toBeGreaterThan(DEFAULT_FIELD_WEIGHTS.explanation);
    expect(DEFAULT_FIELD_WEIGHTS.tags).toBeGreaterThan(DEFAULT_FIELD_WEIGHTS.explanation);

    const chapters: ChapterMeta[] = [
      { id: 1, short: '人工智能概述', title: '第一章 人工智能概述' },
      { id: 5, short: '注意力机制与大模型', title: '第五章 注意力机制与大模型' },
    ];

    const hitExplainOnly = makeQuestion('q-explain', {
      chapter: 1,
      stem: '以下哪项技术常用于序列建模任务？',
      options: ['决策树', 'K-Means', '朴素贝叶斯', '随机森林'],
      explain: '近年来注意力机制在序列建模中取代了传统循环网络。',
      aiAnalysis: '补充解析说明。',
    });

    const hitChapterAndTag = makeQuestion('q-chapter-tag', {
      chapter: 5,
      stem: 'Transformer 架构中的缩放点积公式分母为何包含维度平方根？',
      options: ['防止内积方差过大', '减少参数量', '加速分词', '替代位置编码'],
      tags: ['注意力机制', '核心考点'],
      explain: '控制点积数值尺度稳定梯度。',
    });

    const hitOptionOnly = makeQuestion('q-option', {
      chapter: 1,
      stem: '下列哪一种结构最早在机器翻译领域带来突破？',
      options: ['多头注意力机制', '支持向量机', '线性回归', '主成分分析'],
      explain: '该模型基于编码器-解码器框架。',
    });

    const hitStem = makeQuestion('q-stem', {
      chapter: 1,
      stem: '简述自注意力机制（Self-Attention）的基本计算流程。',
      options: ['选项一', '选项二'],
      explain: '计算 Q、K、V 相关性权重。',
    });

    const matches = searchQuestions(
      [hitExplainOnly, hitChapterAndTag, hitOptionOnly, hitStem],
      '注意力机制',
      { chapters },
    );

    expect(matches.map((m) => m.question.id)).toEqual([
      'q-stem',
      'q-option',
      'q-chapter-tag',
      'q-explain',
    ]);

    // Spoiler-free guarantees for non-stem matches
    const optMatch = matches[1]!;
    expect(optMatch.matchedFields).toEqual(['options']);
    expect(optMatch.matchedNonStemOnly).toBe(true);
    expect(optMatch.stemHighlights).toEqual([]);

    const chTagMatch = matches[2]!;
    expect(chTagMatch.matchedFields).toContain('chapter');
    expect(chTagMatch.matchedFields).toContain('tags');
    expect(chTagMatch.matchedFields).not.toContain('stem');
    expect(chTagMatch.matchedNonStemOnly).toBe(true);
    expect(chTagMatch.stemHighlights).toEqual([]);

    const expMatch = matches[3]!;
    expect(expMatch.matchedFields).toEqual(['explanation']);
    expect(expMatch.matchedNonStemOnly).toBe(true);
    expect(expMatch.stemHighlights).toEqual([]);
  });

  it('FS-08: maps highlight offsets precisely onto raw unnormalized stems containing punctuation, full-width text, and LaTeX', () => {
    const rawStem = '若损失函数 $L(\\theta) = \\frac{1}{2}\\|y - \\hat{y}\\|^2$，则「梯度—下降」（Ｇｒａｄｉｅｎｔ　Ｄｅｓｃｅｎｔ）沿负梯度方向迭代。';
    const norm = normalizeSearchText(rawStem);
    expect(norm.text).toContain('梯度下降gradientdescent');

    const matches = searchQuestions(
      [makeQuestion('q-latex', { stem: rawStem })],
      '梯度下降 gradient',
    );
    expect(matches).toHaveLength(1);
    const highlights = matches[0]!.stemHighlights;
    assertValidHighlights(rawStem, highlights);
    expect(highlights.map((r) => rawStem.slice(r.start, r.end))).toEqual([
      '梯度—下降',
      'Ｇｒａｄｉｅｎｔ',
    ]);

    // Adjacent/overlapping range merging sanity check
    expect(
      mergeHighlightRanges(
        [
          { start: 5, end: 8 },
          { start: 2, end: 5 },
          { start: 10, end: 14 },
          { start: 12, end: 18 },
          { start: -3, end: 1 },
          { start: 40, end: 30 },
        ],
        16,
      ),
    ).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 8 },
      { start: 10, end: 16 },
    ]);
  });

  it('FS-09: searches 1,000 questions well under 20ms per query without regex backtracking stalls', () => {
    const topics = [
      '机器学习与监督学习',
      '深度学习与反向传播',
      '知识图谱与语义推理',
      '计算机视觉与卷积网络',
      '自然语言处理与大模型',
      '强化学习与马尔可夫决策',
    ];
    const englishTerms = ['neural', 'transformer', 'attention', 'gradient', 'backpropagation', 'bayesian'];

    const bigBank: SearchableQuestion[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `perf-${i}`,
      chapter: (i % 9) + 1,
      stem: `【第${i + 1}题】关于${topics[i % topics.length]}中的 ${englishTerms[i % englishTerms.length]} 方法（版本${i}）的核心特性是什么？`,
      options: [
        `选项A：支持${topics[(i + 1) % topics.length]}`,
        `选项B：包含 ${englishTerms[(i + 2) % englishTerms.length]} 优化`,
        '选项C：仅适用于线性可分数据',
        '选项D：无需任何超参数调节',
      ],
      explain: `第${i + 1}题解析：详细阐述了${topics[i % topics.length]}在实际工程中的边界条件与复杂度分析。`,
      tags: [`标签${i % 12}`, englishTerms[i % englishTerms.length]!],
    }));

    const index = createQuestionSearchIndex(bigBank);
    expect(index.size).toBe(1000);

    // Warm up JIT cleanly before timing
    index.search('反向传播 gradient');

    const queries = ['监督 特性', '图灵测试', 'neurel', '自然大模型'];
    const durations: number[] = [];

    for (const q of queries) {
      const t0 = performance.now();
      const hits = index.search(q, { limit: 30 });
      const elapsed = performance.now() - t0;
      durations.push(elapsed);
      expect(elapsed).toBeLessThan(20);
      if (q !== '图灵测试') {
        expect(hits.length).toBeGreaterThan(0);
      }
    }

    // Also verify cached searchQuestions() path on repeated query meets < 20ms
    searchQuestions(bigBank, 'warmup');
    const tStart = performance.now();
    const directHits = searchQuestions(bigBank, 'nuerla 监督');
    const directElapsed = performance.now() - tStart;
    expect(directElapsed).toBeLessThan(20);
    expect(directHits.length).toBeGreaterThan(0);
  });
});
