import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API_CONFIG_STORAGE_KEY, buildDefaultApiConfig, type ApiConfigSeed } from './mockLlm.ts';
import {
  STORAGE_KEY,
  makeEmptyStore,
  type BankData,
  type ChapterMeta,
  type Question,
  type QuestionOrigin,
  type QuestionType,
  type UserStore,
} from './storage.ts';

export const FIXTURE_BANK_ID = 'e2e-fixture-bank';
export const BUILTIN_AI_BANK_ID = 'builtin-ai-intro';
export const BUILTIN_GUIDE_BANK_ID = 'builtin-quizhub-guide';
export const QUIZ_DB_NAME = 'quizhub-v2';
export const QUIZ_DB_VERSION = 1;

function computeBankCounts(questions: Question[]): BankData['meta']['counts'] {
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
    byType[q.type] += 1;
    byOrigin[q.source.origin] += 1;
  }

  return {
    total: questions.length,
    byType,
    byOrigin,
  };
}

const FIXTURE_CHAPTERS: ChapterMeta[] = [
  { id: 1, short: '计算基础', title: '第一章 计算基础与逻辑体系', description: '布尔逻辑、集合与复杂度基础' },
  { id: 2, short: '数据结构', title: '第二章 线性表与树形结构', description: '栈、队列、二叉树与堆' },
  { id: 3, short: '搜索算法', title: '第三章 状态空间与启发式搜索', description: 'BFS、DFS 与 A* 算法' },
  { id: 4, short: '概率统计', title: '第四章 概率图与贝叶斯推断', description: '条件概率、独立性与参数估计' },
  { id: 5, short: '机器学习', title: '第五章 监督学习与模型评估', description: '泛化误差、正则化与交叉验证' },
  { id: 6, short: '深度学习', title: '第六章 神经网络与反向传播', description: '梯度下降、激活函数与优化器' },
  { id: 7, short: '系统架构', title: '第七章 分布式与并发系统', description: '一致性协议、锁与事务隔离' },
  { id: 8, short: '网络协议', title: '第八章 计算机网络与传输控制', description: 'TCP 拥塞控制与 HTTP 语义' },
  { id: 9, short: '工程实践', title: '第九章 软件工程与测试验证', description: '边界分析、可维护性与监控' },
];

const CHAPTER_TOPICS: Record<number, string> = {
  1: '布尔代数与渐近时间复杂度',
  2: '平衡二叉树与哈希冲突解决',
  3: '可采纳启发函数与剪枝策略',
  4: '贝叶斯后验更新与极大似然估计',
  5: '偏差方差权衡与 L2 正则化',
  6: '链式法则梯度回传与残差连接',
  7: 'Raft 领导者选举与幂等重试',
  8: 'TCP 三次握手与滑动窗口流量控制',
  9: '等价类划分与边界值回归验证',
};

const FIXTURE_QUESTIONS: Question[] = [];

// 1. 18 choice questions (2 per chapter 1..9)
for (let ch = 1; ch <= 9; ch++) {
  const topic = CHAPTER_TOPICS[ch]!;
  const origin1: QuestionOrigin = ch % 3 === 0 ? 'review_notes_synthesized' : 'comprehensive_bank';
  FIXTURE_QUESTIONS.push({
    id: `fx-c${ch}-choice-1`,
    type: 'choice',
    chapter: ch,
    ...(ch === 3 ? {} : { sectionId: `ch${ch}.s1` }),
    stem:
      ch === 5
        ? `在监督学习系统的真实训练流水线中，当模型在训练集上损失持续下降但验证集准确率在多轮迭代后不升反降，且特征维度远大于样本规模、高阶多项式特征被全部引入并伴有噪声标签干扰时，以下哪一项措施最能系统性缓解该过拟合现象？（长题干边界测试：第${ch}章「${topic}」核心辨析，请结合交叉验证、权重衰减与模型复杂度约束综合判断）`
        : `[第${ch}章-单选1] 关于「${topic}」的核心原理，下列说法最准确的是？`,
    options: [
      `${topic}可通过结构化约束稳定控制误差`,
      `仅依赖随机猜测即可替代${topic}`,
      `${topic}在任何条件下都不受输入规模影响`,
      `${topic}必须禁用全部验证步骤才能生效`,
    ],
    answer: 0,
    explain: `第${ch}章核心考点：${topic}强调结构化约束与验证闭环，故选项 A 正确。`,
    ...(ch === 3 ? {} : { tags: [`ch${ch}`, '核心概念'] }),
    source: {
      origin: origin1,
      file: `fixture-ch${ch}.json`,
      ref: `Ch${ch} Choice #1`,
    },
  });

  const origin2: QuestionOrigin = ch <= 3 ? 'video_popup' : 'comprehensive_bank';
  FIXTURE_QUESTIONS.push({
    id: `fx-c${ch}-choice-2`,
    type: 'choice',
    chapter: ch,
    // Intentionally omit sectionId & tags on ch=3 item as well for missing-metadata boundary
    ...(ch === 3 ? {} : { sectionId: `ch${ch}.s2`, tags: [`ch${ch}`, '应用辨析'] }),
    stem: `[第${ch}章-单选2] 在应用「${topic}」解决工程问题时，最关键的判断依据是？`,
    options: [
      '忽略边界条件与异常分支',
      '明确前置假设并验证约束满足性',
      '随机调整参数而不记录基线',
      '跳过复杂度分析直接上线',
    ],
    answer: 1,
    explain: `工程落地「${topic}」必须先确认前置假设与约束条件，选项 B 正确。`,
    source: {
      origin: origin2,
      file: `fixture-ch${ch}.json`,
      ref: `Ch${ch} Choice #2`,
    },
  });
}

// 2. 12 multi questions (Ch1-3: 2 each = 6; Ch4-9: 1 each = 6 => total 12)
const multiChapters = [1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9];
multiChapters.forEach((ch, idx) => {
  const topic = CHAPTER_TOPICS[ch]!;
  const origin: QuestionOrigin =
    idx % 4 === 1 ? 'video_popup' : idx % 4 === 2 ? 'review_notes_synthesized' : 'comprehensive_bank';
  FIXTURE_QUESTIONS.push({
    id: `fx-c${ch}-multi-${idx + 1}`,
    type: 'multi',
    chapter: ch,
    sectionId: `ch${ch}.s3`,
    stem: `[第${ch}章-多选${idx + 1}] 以下关于「${topic}」的正确特征有哪些？（多选）`,
    options: [
      `具备可验证的${topic}理论边界`,
      '完全不需要任何输入前提条件',
      '在工程实践中有明确的适用场景',
      '必然导致系统产生无限死循环',
    ],
    answer: [0, 2],
    explain: `「${topic}」兼具明确的理论边界与适用场景，A 与 C 均正确。`,
    tags: [`ch${ch}`, '多选辨析'],
    source: {
      origin,
      file: `fixture-ch${ch}.json`,
      ref: `Ch${ch} Multi #${idx + 1}`,
    },
  });
});

// 3. 14 tf questions (Ch1-5: 2 each = 10; Ch6-9: 1 each = 4 => total 14, includes false answers)
const tfChapters = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9];
tfChapters.forEach((ch, idx) => {
  const topic = CHAPTER_TOPICS[ch]!;
  const isTrue = idx % 2 === 0;
  const origin: QuestionOrigin =
    idx % 3 === 1 ? 'video_popup' : idx % 3 === 2 ? 'review_notes_synthesized' : 'comprehensive_bank';
  FIXTURE_QUESTIONS.push({
    id: `fx-c${ch}-tf-${idx + 1}`,
    type: 'tf',
    chapter: ch,
    sectionId: `ch${ch}.s4`,
    stem: isTrue
      ? `[第${ch}章-判断${idx + 1}] 合理运用「${topic}」能够有效提升系统正确性与可预测性。`
      : `[第${ch}章-判断${idx + 1}] 无论问题规模如何，「${topic}」都可以在零时间开销下完成全部计算。`,
    answer: isTrue,
    explain: isTrue
      ? `该命题正确，「${topic}」的核心目标即提升正确性与可控性。`
      : `该命题错误，任何有效算法与协议都存在必要的时间或空间代价。`,
    tags: [`ch${ch}`, '判断'],
    source: {
      origin,
      file: `fixture-ch${ch}.json`,
      ref: `Ch${ch} TF #${idx + 1}`,
    },
  });
});

// 4. 7 short questions (Ch1..7: 1 each, Ch2 intentionally omits keyPoints)
for (let ch = 1; ch <= 7; ch++) {
  const topic = CHAPTER_TOPICS[ch]!;
  FIXTURE_QUESTIONS.push({
    id: `fx-c${ch}-short-1`,
    type: 'short',
    chapter: ch,
    sectionId: `ch${ch}.s5`,
    stem: `[第${ch}章-简答] 请简述「${topic}」的核心机制及其主要适用条件。`,
    answer:
      ch === 5
        ? '核心机制在于通过训练误差与模型复杂度惩罚项的联合优化来控制泛化风险。具体实现时需结合验证集划分、正则化系数调节以及早停策略，在样本分布稳定且特征噪声可控的条件下获得稳定的泛化表现，避免过拟合或欠拟合。'
        : `「${topic}」通过明确约束条件与阶段性校验来保证结果稳定性，适用于输入特征清晰且可度量的场景。`,
    explain: `简答题作答需紧扣定义、机制与适用条件三个维度（第${ch}章）。`,
    ...(ch === 2 ? {} : { keyPoints: ['核心机制', '约束条件', '适用场景'] }),
    tags: [`ch${ch}`, '简答'],
    source: {
      origin: ch % 2 === 0 ? 'review_notes_synthesized' : 'comprehensive_bank',
      file: `fixture-ch${ch}.json`,
      ref: `Ch${ch} Short #1`,
    },
  });
}

// 5. 6 analysis questions (Ch1, 2, 4, 6, 8, 9; Ch4 omits keyPoints, Ch6 has long answer >= 240 chars)
const analysisChapters = [1, 2, 4, 6, 8, 9];
analysisChapters.forEach((ch, idx) => {
  const topic = CHAPTER_TOPICS[ch]!;
  FIXTURE_QUESTIONS.push({
    id: `fx-c${ch}-analysis-1`,
    type: 'analysis',
    chapter: ch,
    sectionId: `ch${ch}.s6`,
    stem: `[第${ch}章-综合分析] 结合真实业务场景，分析「${topic}」在异常边界下可能出现的问题及改进方案。`,
    answer:
      ch === 6
        ? '在深层神经网络训练中，若激活函数饱和或网络层数过深且缺乏归一化手段，反向传播过程中的连乘梯度会迅速衰减或指数级膨胀，导致梯度消失或梯度爆炸问题。为系统性解决该隐患，工程上通常采用以下组合方案：第一，引入残差连接（Residual Connection）构建恒等映射快捷通路，使深层梯度能够直接回传至浅层；第二，使用 ReLU 或 GELU 等非饱和激活函数配合 Kaiming/Xavier 参数初始化；第三，在隐藏层加入 BatchNorm 或 LayerNorm 稳定激活分布，并辅以梯度裁剪与学习率预热策略，从而确保深层模型收敛稳定且具备良好泛化性能。'
        : `首先定位「${topic}」在极端输入下的性能瓶颈，其次引入边界校验、限流降级与回归测试基线，最后通过监控指标持续验证改进效果。`,
    explain: `综合分析题需从问题成因、改进措施与效果验证三步展开（第${ch}章）。`,
    ...(ch === 4 ? {} : { keyPoints: ['成因定位', '工程改进措施', '效果验证'] }),
    tags: [`ch${ch}`, '综合分析'],
    source: {
      origin: idx % 2 === 0 ? 'comprehensive_bank' : 'review_notes_synthesized',
      file: `fixture-ch${ch}.json`,
      ref: `Ch${ch} Analysis #1`,
    },
  });
});

export const FIXTURE_BANK: BankData = {
  meta: {
    title: 'E2E 合成全题型测试题库',
    version: '2.0.0',
    generatedAt: '2026-11-26T00:00:00.000Z',
    counts: computeBankCounts(FIXTURE_QUESTIONS),
  },
  chapters: FIXTURE_CHAPTERS,
  questions: FIXTURE_QUESTIONS,
};

const LEGACY_QUESTIONS: Question[] = [
  {
    id: 'legacy-q1',
    type: 'choice',
    chapter: 1,
    stem: 'Phase 1 兼容测试题 1：在二分查找中，每次迭代后搜索区间长度如何变化？',
    options: ['减半', '不变', '翻倍', '随机波动'],
    answer: 0,
    explain: '',
    source: { origin: 'comprehensive_bank', file: 'legacy-v1.json', ref: 'legacy-1' },
  },
  {
    id: 'legacy-q2',
    type: 'multi',
    chapter: 1,
    stem: 'Phase 1 兼容测试题 2：以下属于线性时间复杂度或更优的操作有哪些？',
    options: ['哈希表平均查找 O(1)', '有序数组二分查找 O(log n)', '嵌套双重全遍历 O(n^2)', '冒泡排序最坏情况 O(n^2)'],
    answer: [0, 1],
    explain: '',
    source: { origin: 'comprehensive_bank', file: 'legacy-v1.json', ref: 'legacy-2' },
  },
  {
    id: 'legacy-q3',
    type: 'tf',
    chapter: 2,
    stem: 'Phase 1 兼容测试题 3：队列遵循先进先出（FIFO）原则。',
    answer: true,
    explain: '',
    source: { origin: 'video_popup', file: 'legacy-v1.json', ref: 'legacy-3' },
  },
  {
    id: 'legacy-q4',
    type: 'short',
    chapter: 2,
    stem: 'Phase 1 兼容测试题 4：简述栈与队列在访问顺序上的核心区别。',
    answer: '栈是后进先出（LIFO），仅在栈顶进行压入与弹出；队列是先进先出（FIFO），从队尾入队、队头出队。',
    explain: '',
    source: { origin: 'review_notes_synthesized', file: 'legacy-v1.json', ref: 'legacy-4' },
  },
];

export const LEGACY_PHASE1_BANK: BankData = {
  meta: {
    title: 'Phase 1 旧版兼容题库',
    version: '1.0.0',
    generatedAt: '2025-12-01T00:00:00.000Z',
    counts: computeBankCounts(LEGACY_QUESTIONS),
  },
  chapters: [
    { id: 1, short: '算法基础', title: '第一章 算法复杂度与查找' },
    { id: 2, short: '线性结构', title: '第二章 栈与队列' },
  ],
  questions: LEGACY_QUESTIONS,
};

/**
 * Runtime JSON string simulating real Phase 1 exported banks:
 * - Item 1 has `explain: ""`
 * - Item 2 omits `explain` entirely in JSON
 * - None contain `explanation`, `aiAnalysis`, or `aiInferredAnswer`
 */
export const LEGACY_PHASE1_BANK_JSON: string = JSON.stringify(
  {
    ...LEGACY_PHASE1_BANK,
    questions: LEGACY_QUESTIONS.map((q, idx) => {
      if (idx === 1) {
        const { explain: _omitted, ...rest } = q;
        return rest;
      }
      return { ...q };
    }),
  },
  null,
  2,
);

const MD_LATEX_QUESTIONS: Question[] = [
  {
    id: 'md-q1',
    type: 'choice',
    chapter: 1,
    stem: [
      '### 能量与求和公式推导',
      '',
      '已知质能方程 $E = mc^2$ 与二次损失函数：',
      '',
      '$$\\sum_{i=1}^{n} x_i^2$$',
      '',
      '下列选项中哪一项对应梯度的矩阵表达 \\(\\alpha + \\beta\\) 与 \\([\\nabla f(x)]\\) 正确形式？',
      '',
      '| 优化器 | 阶数 | 特点 |',
      '| --- | --- | --- |',
      '| SGD | 一阶 | 迭代轻量 |',
      '| Newton | 二阶 | 收敛快 |',
    ].join('\n'),
    options: [
      '梯度表达式为 \\[\\nabla f(x)\\] 且满足凸函数单调下降',
      '常数项恒为零且不需要 \\(\\alpha + \\beta\\)',
      '仅适用于离散无导数问题',
      '与 $E = mc^2$ 完全矛盾',
    ],
    answer: 0,
    explain: [
      '#### 解析要点',
      '- 使用 `grad(x)` 计算一阶导数：',
      '',
      '```python',
      'def grad(x):',
      '    return 2 * x',
      '```',
      '',
      '- 结合 $$\\sum_{i=1}^{n} x_i^2$$ 可知梯度为 $2x$。',
    ].join('\n'),
    tags: ['LaTeX', 'Markdown'],
    source: { origin: 'comprehensive_bank', file: 'md-latex.json', ref: 'md-1' },
  },
  {
    id: 'md-q2',
    type: 'choice',
    chapter: 1,
    stem:
      '容错与 XSS 安全测试题：包含畸形公式 $\\broken{ 以及脚本载荷 <img src=x onerror="window.__xssFired=true"><script>window.__xssFired=true</script> ，页面仍应安全渲染。',
    options: [
      '正常转义并渲染安全文本',
      '执行未转义脚本',
      '抛出未捕获异常',
      '清空整页 DOM',
    ],
    answer: 0,
    explain: '畸形公式 $\\broken{ 与危险 HTML 标签均应被安全过滤，不得触发脚本执行。',
    tags: ['XSS', 'KaTeX容错'],
    source: { origin: 'comprehensive_bank', file: 'md-latex.json', ref: 'md-2' },
  },
  {
    id: 'md-q3',
    type: 'tf',
    chapter: 1,
    stem: '向量算子 \\(\\alpha + \\beta\\) 与块级公式 \\[\\nabla f(x)\\] 均可在工作台中正确排版。',
    answer: true,
    explain: '支持行内与块级四种常见 LaTeX 定界符。',
    tags: ['LaTeX'],
    source: { origin: 'review_notes_synthesized', file: 'md-latex.json', ref: 'md-3' },
  },
];

export const MARKDOWN_LATEX_BANK: BankData = {
  meta: {
    title: 'Markdown 与 LaTeX 渲染验证题库',
    version: '2.0.0',
    generatedAt: '2026-11-26T00:00:00.000Z',
    counts: computeBankCounts(MD_LATEX_QUESTIONS),
  },
  chapters: [{ id: 1, short: '公式与富文本', title: '第一章 Markdown 与 KaTeX 公式验证' }],
  questions: MD_LATEX_QUESTIONS,
};

export const SMART_WASH_RAW_TEXT = [
  '1. HTTP 协议默认使用的传输层端口号是多少？',
  'A. 21',
  'B. 80',
  'C. 443',
  'D. 3306',
  '答案：B',
  '',
  '2. 以下关于梯度下降算法的描述中，哪一项属于无答案待推断题目？',
  'A. 沿着负梯度方向更新参数以减小目标函数值',
  'B. 学习率越大越保证单调收敛',
  'C. 与目标函数导数无关',
  'D. 仅能用于线性回归且不可迭代',
  '',
  '3. 以下哪些属于面向对象程序设计的基本特征？（多选）',
  'A. 封装',
  'B. 轮询',
  'C. 继承',
  'D. 多态',
  '答案：A、C、D',
  '',
  '4. 判断题：在关系数据库中，主键允许包含 NULL 值。',
  '答案：错误',
].join('\n');

export const SMART_WASH_CHUNKS: string[] = [
  [
    '1. 计算机网络中 TCP 协议提供面向连接、可靠的字节流服务。',
    'A. 正确',
    'B. 错误',
    '答案：A',
  ].join('\n'),
  [
    '[CHUNK_RETRY_MARKER]',
    '2. 在二叉树遍历中，哪一种遍历方式先访问根节点再依次访问左子树与右子树？',
    'A. 前序遍历',
    'B. 中序遍历',
    'C. 后序遍历',
    'D. 层序遍历',
  ].join('\n'),
  [
    '3. 以下哪些属于对称加密算法？（多选）',
    'A. AES',
    'B. RSA',
    'C. ChaCha20',
    'D. ECDSA',
    '答案：A、C',
  ].join('\n'),
];

export function makeTxtUploadFile(
  name = 'smart-wash-notes.txt',
  content = SMART_WASH_RAW_TEXT,
): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(content, 'utf-8'),
  };
}

export function makeMdUploadFile(
  name = 'smart-wash-lecture.md',
  content = `# 课堂洗题笔记\n\n${SMART_WASH_RAW_TEXT}`,
): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name,
    mimeType: 'text/markdown',
    buffer: Buffer.from(content, 'utf-8'),
  };
}

export function makeJsonUploadFile(
  name = 'legacy-phase1-bank.json',
  payload: string | unknown = LEGACY_PHASE1_BANK_JSON,
): { name: string; mimeType: string; buffer: Buffer } {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(raw, 'utf-8'),
  };
}

function normalizeHashTarget(hashRoute: string): string {
  if (!hashRoute || hashRoute === '/') return './#/';
  if (hashRoute.startsWith('./#')) return hashRoute;
  if (hashRoute.startsWith('#')) return `./${hashRoute}`;
  if (hashRoute.startsWith('/')) return `./#${hashRoute}`;
  return `./#/${hashRoute}`;
}

export interface SeedFixtureBankOptions {
  bankId?: string;
  activate?: boolean;
  targetHashRoute?: string;
  apiConfig?: ApiConfigSeed;
}

export async function seedFixtureBank(
  page: Page,
  bank: BankData = FIXTURE_BANK,
  store: UserStore = makeEmptyStore(),
  opts: SeedFixtureBankOptions = {},
): Promise<void> {
  const bankId = opts.bankId ?? FIXTURE_BANK_ID;
  const activate = opts.activate ?? true;
  const target = normalizeHashTarget(opts.targetHashRoute ?? '#/');
  const now = Date.now();

  const bankRecord = {
    id: bankId,
    name: bank.meta.title,
    builtin: false,
    createdAt: now,
    updatedAt: now,
    sourceFormat: 'json',
    data: bank,
  };

  const apiConfigPayload = opts.apiConfig
    ? JSON.stringify(buildDefaultApiConfig(opts.apiConfig))
    : null;

  await page.goto(target, { waitUntil: 'domcontentloaded' });
  const app = page.locator('main.app-main');
  await expect(app).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(
    async ({
      dbName,
      dbVersion,
      targetBankId,
      isBuiltin,
      isLegacyBank,
      shouldActivate,
      bankRec,
      userStore,
      storageKey,
      apiConfigKey,
      apiConfigJson,
      timestamp,
    }) => {
      if (isLegacyBank) {
        window.localStorage.setItem(storageKey, JSON.stringify(userStore));
      }
      if (apiConfigJson) {
        const parsed = JSON.parse(apiConfigJson) as { storageScope?: string };
        const storage =
          parsed.storageScope === 'session' ? window.sessionStorage : window.localStorage;
        storage.setItem(apiConfigKey, apiConfigJson);
      }

      await new Promise<void>((resolve, reject) => {
        const req = window.indexedDB.open(dbName, dbVersion);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('banks')) {
            db.createObjectStore('banks', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('progress')) {
            db.createObjectStore('progress', { keyPath: 'bankId' });
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta', { keyPath: 'key' });
          }
        };
        req.onerror = () => reject(req.error ?? new Error('Failed to open quizhub-v2 IDB'));
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['banks', 'progress', 'meta'], 'readwrite');
          if (!isBuiltin) {
            tx.objectStore('banks').put(bankRec);
          }
          tx.objectStore('progress').put({
            bankId: targetBankId,
            store: userStore,
            updatedAt: timestamp,
          });
          tx.objectStore('meta').put({ key: 'v1Migrated', value: true });
          tx.objectStore('meta').put({ key: 'v1MigratedAt', value: timestamp });
          if (shouldActivate) {
            tx.objectStore('meta').put({ key: 'activeBankId', value: targetBankId });
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error ?? new Error('Failed to seed quizhub-v2 IDB'));
          tx.onabort = () => reject(tx.error ?? new Error('Seed transaction aborted'));
        };
      });
    },
    {
      dbName: QUIZ_DB_NAME,
      dbVersion: QUIZ_DB_VERSION,
      targetBankId: bankId,
      isBuiltin: bankId === BUILTIN_AI_BANK_ID || bankId === BUILTIN_GUIDE_BANK_ID,
      isLegacyBank: bankId === BUILTIN_AI_BANK_ID,
      shouldActivate: activate,
      bankRec: bankRecord,
      userStore: store,
      storageKey: STORAGE_KEY,
      apiConfigKey: API_CONFIG_STORAGE_KEY,
      apiConfigJson: apiConfigPayload,
      timestamp: now,
    },
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(app).toHaveAttribute('aria-busy', 'false');
}
