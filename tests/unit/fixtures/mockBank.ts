import type {
  BankData,
  ChapterMeta,
  NoteChapter,
  NotesData,
  Question,
  UserStore,
} from '../../../src/types/quiz';

export const MOCK_CHAPTERS: ChapterMeta[] = [
  { id: 1, short: '人工智能概述', title: '第一章 人工智能概述' },
  { id: 2, short: '人类智能', title: '第二章 人类智能' },
  { id: 3, short: '知识工程与知识图谱', title: '第三章 知识工程与知识图谱' },
  { id: 4, short: '机器学习', title: '第四章 机器学习' },
  { id: 5, short: '计算机视觉', title: '第五章 计算机视觉' },
  { id: 6, short: '计算机听觉', title: '第六章 计算机听觉' },
  { id: 7, short: '自然语言处理', title: '第七章 自然语言处理' },
  { id: 8, short: '类脑智能与脑机混合智能', title: '第八章 类脑智能与脑机混合智能' },
  { id: 9, short: '机器人', title: '第九章 机器人' },
];

export const MOCK_QUESTIONS: Question[] = [
  {
    id: 'qb-c1-choice-01',
    type: 'choice',
    chapter: 1,
    sectionId: 'ch1.s1',
    stem: '正式提出“人工智能（Artificial Intelligence）”这一术语的达特茅斯会议召开于哪一年？',
    options: ['1950年', '1956年', '1965年', '1997年'],
    answer: 1,
    explain: '1956年夏季，麦卡锡等学者在达特茅斯学院召开研讨会，正式提出人工智能术语，标志着AI学科诞生。',
    tags: ['人工智能元年', '符号主义'],
    source: {
      origin: 'comprehensive_bank',
      file: '人工智能导论 综合题库最终版.pdf',
      ref: 'Ch1 单选题 #1',
    },
  },
  {
    id: 'qb-c1-tf-01',
    type: 'tf',
    chapter: 1,
    sectionId: 'ch1.s2',
    stem: '符号主义学派认为智能活动的基础是物理符号系统的符号操作与逻辑推理。',
    answer: true,
    explain: '符号主义（逻辑主义）基于物理符号系统假设，强调知识表示与逻辑推理。',
    source: {
      origin: 'comprehensive_bank',
      file: '人工智能导论 综合题库最终版.pdf',
      ref: 'Ch1 判断题 #1',
      duplicatesMerged: ['vid-p03'],
      note: '合并视频弹题同义表述',
    },
  },
  {
    id: 'vid-c2-tf-01',
    type: 'tf',
    chapter: 2,
    sectionId: 'ch2.s1',
    stem: '图灵测试的本质是考察计算机是否能够完全理解人类情绪并拥有生物意识。',
    answer: false,
    explain: '图灵测试考察的是机器在行为上能否表现出与人类难以区分的智能对话能力，而非主观意识。',
    tags: ['图灵测试'],
    source: {
      origin: 'video_popup',
      file: '人工智能导论视频课弹出来的题.pdf',
      ref: 'p.14',
    },
  },
  {
    id: 'qb-c3-multi-01',
    type: 'multi',
    chapter: 3,
    sectionId: 'ch3.s2',
    stem: '关于知识图谱的基本组成与特点，下列哪些描述是正确的？',
    options: [
      '以“实体—关系—实体”三元组为基本表示单元',
      '只能存储数值矩阵，无法表示语义关系',
      '支持基于图结构的语义检索与推理补全',
      '完全不需要实体对齐与消歧处理',
    ],
    answer: [0, 2],
    explain: '知识图谱使用三元组表达语义关联，并支持图谱推理、语义搜索及实体链接消歧。',
    tags: ['知识图谱'],
    source: {
      origin: 'comprehensive_bank',
      file: '人工智能导论 综合题库最终版.pdf',
      ref: 'Ch3 多选题 #2',
    },
  },
  {
    id: 'vid-c4-choice-01',
    type: 'choice',
    chapter: 4,
    sectionId: 'ch4.s1',
    stem: '在机器学习任务中，训练样本同时包含输入特征和明确标签的学习范式称为？',
    options: ['无监督学习', '自监督学习', '监督学习', '强化学习'],
    answer: 2,
    explain: '监督学习利用带有标注（标签）的训练数据学习输入到输出的映射关系。',
    tags: ['机器学习', '监督学习'],
    source: {
      origin: 'video_popup',
      file: '人工智能导论视频课弹出来的题.pdf',
      ref: 'p.31',
    },
  },
  {
    id: 'qb-c4-multi-02',
    type: 'multi',
    chapter: 4,
    sectionId: 'ch4.s3',
    stem: '在深度神经网络训练中，下列哪些方法通常用于缓解过拟合？',
    options: [
      '大幅减少训练样本数量',
      '引入 L2 正则化（权重衰减）',
      '在全连接层使用 Dropout 随机失活',
      '采用早停策略（Early Stopping）',
    ],
    answer: [1, 2, 3],
    explain: '正则化、Dropout 与早停均能限制模型复杂度或无效记忆噪声，从而缓解过拟合。',
    source: {
      origin: 'comprehensive_bank',
      file: '人工智能导论 综合题库最终版.pdf',
      ref: 'Ch4 多选题 #5',
      duplicatesMerged: ['syn-c4-s3-09'],
    },
  },
  {
    id: 'syn-c5-short-01',
    type: 'short',
    chapter: 5,
    sectionId: 'ch5.s2',
    stem: '简述卷积神经网络（CNN）相比传统全连接网络在图像识别中的核心优势。',
    answer: 'CNN 通过局部感受野提取局部空间特征、利用权值共享显著减少参数量，并结合池化降维增强平移不变性。',
    explain: '回答需涵盖局部连接、权值共享与下采样（池化）三大结构特性。',
    keyPoints: ['局部感受野', '权值共享', '池化降维'],
    tags: ['卷积神经网络', 'CV'],
    source: {
      origin: 'review_notes_synthesized',
      file: '人工智能导论复习资料.pdf',
      ref: 'ch5.s2',
    },
  },
  {
    id: 'syn-c6-tf-01',
    type: 'tf',
    chapter: 6,
    sectionId: 'ch6.s1',
    stem: '梅尔频率倒谱系数（MFCC）结合了人耳听觉的非线性梅尔刻度特性，常用于语音特征提取。',
    answer: true,
    explain: 'MFCC 模拟人耳对不同频率声波的感知特性，是传统语音识别和声纹分析中的经典特征。',
    tags: ['语音识别', 'MFCC'],
    source: {
      origin: 'review_notes_synthesized',
      file: '人工智能导论复习资料.pdf',
      ref: 'ch6.s1',
    },
  },
  {
    id: 'vid-c7-choice-01',
    type: 'choice',
    chapter: 7,
    sectionId: 'ch7.s2',
    stem: 'Transformer 架构彻底摒弃了循环结构，其核心依赖哪种机制实现序列全局建模？',
    options: ['自注意力机制（Self-Attention）', '滑动窗口均值滤波', '马尔可夫链状态转移', 'k近邻投票机制'],
    answer: 0,
    explain: 'Transformer 通过自注意力机制直接计算序列中任意两位置之间的依赖关系，支持高效并行训练。',
    tags: ['NLP', 'Attention', 'Transformer'],
    source: {
      origin: 'video_popup',
      file: '人工智能导论视频课弹出来的题.pdf',
      ref: 'p.58',
    },
  },
  {
    id: 'syn-c7-analysis-01',
    type: 'analysis',
    chapter: 7,
    sectionId: 'ch7.s4',
    stem: '结合大语言模型的发展，分析标准 Transformer 编码器-解码器结构中核心模块的作用及并行化原理。',
    answer:
      'Transformer 由编码器与解码器堆叠而成：多头自注意力机制从多个表示子空间捕获长距离语义依赖；位置编码补充序列顺序信息，使模型无需递归即可完成序列并行计算。',
    explain: '分析题需阐明多头自注意力、位置编码及编码器-解码器交互机制。',
    keyPoints: ['编码器-解码器结构', '多头自注意力机制', '位置编码'],
    tags: ['大模型', 'NLP', 'Transformer'],
    source: {
      origin: 'review_notes_synthesized',
      file: '人工智能导论复习资料.pdf',
      ref: 'ch7.s4',
    },
  },
  {
    id: 'syn-c8-short-01',
    type: 'short',
    chapter: 8,
    sectionId: 'ch8.s1',
    stem: '简述脉冲神经网络（SNN）相较于传统人工神经网络在类脑计算中的主要特征。',
    answer: 'SNN 采用生物神经元启发的脉冲编码进行信息传递，具有事件驱动、稀疏激活与超低功耗等特征。',
    explain: 'SNN 模拟生物神经元的时空脉冲动力学特性，更契合神经形态硬件。',
    keyPoints: ['脉冲神经网络', '低功耗事件驱动'],
    tags: ['类脑计算'],
    source: {
      origin: 'review_notes_synthesized',
      file: '人工智能导论复习资料.pdf',
      ref: 'ch8.s1',
    },
  },
  {
    id: 'qb-c9-choice-01',
    type: 'choice',
    chapter: 9,
    sectionId: 'ch9.s1',
    stem: '在智能机器人的体系结构中，负责将规划路径转化为各关节力矩或速度指令的模块属于？',
    options: ['环境感知模块', '自然语言交互模块', '知识图谱存储模块', '运动控制与执行模块'],
    answer: 3,
    explain: '运动控制与执行模块将决策规划结果分解为底层执行器的精确控制信号。',
    tags: ['机器人'],
    source: {
      origin: 'comprehensive_bank',
      file: '人工智能导论 综合题库最终版.pdf',
      ref: 'Ch9 单选题 #3',
    },
  },
];

export const MOCK_BANK: BankData = {
  meta: {
    title: '人工智能导论测试题库（Mock）',
    version: '1.0.0-mock',
    generatedAt: '2026-11-23T08:00:00Z',
    counts: {
      total: 12,
      byType: {
        choice: 4,
        multi: 2,
        tf: 3,
        short: 2,
        analysis: 1,
      },
      byOrigin: {
        comprehensive_bank: 5,
        video_popup: 3,
        review_notes_synthesized: 4,
      },
    },
  },
  chapters: MOCK_CHAPTERS,
  questions: MOCK_QUESTIONS,
};

export const EMPTY_STORE: UserStore = {
  records: {},
  fav: {},
  mastery: {},
};

export const MOCK_STORE: UserStore = {
  records: {
    'qb-c1-choice-01': { ok: 1, choice: 1, ts: 1732340000000 },
    'qb-c1-tf-01': { ok: 0, choice: false, ts: 1732340010000 },
    'qb-c3-multi-01': { ok: 1, choice: [0, 2], ts: 1732340020000 },
    'syn-c5-short-01': { ok: 0, ts: 1732340030000 },
  },
  fav: {
    'qb-c1-tf-01': true,
    'syn-c5-short-01': true,
    'vid-c7-choice-01': false,
  },
  mastery: {
    'syn-c5-short-01': 1,
    'syn-c7-analysis-01': 2,
    'syn-c8-short-01': 0,
  },
};

export const MOCK_STORE_WITH_STALE_IDS: UserStore = {
  records: {
    ...MOCK_STORE.records,
    'stale-removed-q1': { ok: 1, choice: 0, ts: 1732340099000 },
  },
  fav: {
    ...MOCK_STORE.fav,
    'stale-removed-q1': true,
  },
  mastery: {
    ...MOCK_STORE.mastery,
    'stale-removed-q1': 2,
  },
};

export const MOCK_NOTE_CHAPTER: NoteChapter = {
  id: 1,
  short: '人工智能概述',
  title: '第一章 人工智能概述',
  overview: '梳理人工智能的诞生背景、三大学派及核心发展历程。',
  sections: [
    {
      id: 'ch1.s1',
      chapterId: 1,
      title: '1.1 人工智能的诞生与发展',
      summary: '1956年达特茅斯会议标志着人工智能作为独立学科正式确立。',
      keyPoints: [
        '1950年图灵发表《计算机器与智能》，提出图灵测试。',
        '1956年达特茅斯会议首次正式提出 Artificial Intelligence。',
      ],
      terms: [
        {
          term: '图灵测试',
          definition: '通过文本对话判别机器是否具备与人类相当智能表现的行为测试。',
        },
      ],
      tables: [
        {
          caption: 'AI 三大学派对比',
          headers: ['学派', '核心思想', '代表方法'],
          rows: [
            ['符号主义', '物理符号系统与逻辑推理', '专家系统、知识图谱'],
            ['连接主义', '仿生神经网络与分布表示', '深度学习、反向传播'],
            ['行为主义', '感知-动作控制与环境交互', '强化学习、控制论'],
          ],
        },
      ],
      callout: '高频考点：区分1950年图灵测试与1956年达特茅斯会议的时间节点。',
    },
  ],
};

export const MOCK_NOTES_DATA: NotesData = {
  meta: {
    title: '人工智能导论知识点手册（Mock）',
    version: '1.0.0-mock',
    generatedAt: '2026-11-23T08:00:00Z',
  },
  overview: {
    title: '课程知识框架总览',
    bullets: ['涵盖9章核心理论与典型应用'],
    examTips: ['结合客观题概念辨析与主观题要点作答'],
  },
  chapters: [MOCK_NOTE_CHAPTER],
  appendices: [
    {
      id: 'app-timeline',
      title: '时间线与代表人物速记',
      type: 'timeline_figures',
      tables: [
        {
          headers: ['年份', '事件', '人物'],
          rows: [['1956', '达特茅斯会议', '麦卡锡、明斯基等']],
        },
      ],
    },
    {
      id: 'app-confusing',
      title: '易混概念对照',
      type: 'confusing_pairs',
      items: [{ title: '强AI vs 弱AI', content: '通用自主意识与专用任务智能的区别。' }],
    },
    {
      id: 'app-templates',
      title: '答题模板',
      type: 'answer_templates',
      items: [{ title: '机制比较类', content: '定义 -> 核心原理 -> 优缺点 -> 应用场景。' }],
    },
    {
      id: 'app-short-index',
      title: '简答背诵索引',
      type: 'short_index',
      items: [
        {
          title: 'CNN 三大特性',
          content: '局部感受野、权值共享、池化降维。',
          questionId: 'syn-c5-short-01',
        },
      ],
    },
  ],
};
