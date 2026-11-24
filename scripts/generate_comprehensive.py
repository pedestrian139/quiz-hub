import json

questions = [
    # ---------------- CHAPTER 1 ----------------
    {
        "id": "qb-c1-tf01",
        "type": "tf",
        "chapter": 1,
        "stem": "行为主义认为，人工智能应基于感知与行动，让机器在与环境的交互中学习并优化行为。",
        "answer": True,
        "explain": "行为主义学派认为人工智能应基于感知与行动，让机器在与环境的交互中学习并优化行为，主要理论基础是控制论与感知-动作映射。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.1 第1章 判断题 #1"
        }
    },
    {
        "id": "qb-c1-tf02",
        "type": "tf",
        "chapter": 1,
        "stem": "1956年，提出了 Artificial Intelligence 这一概念，被视为人工智能学科的诞生。",
        "answer": True,
        "explain": "1956年达特茅斯会议提出了 Artificial Intelligence 这一概念，被视为人工智能学科的诞生。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.1 第1章 判断题 #2"
        }
    },
    {
        "id": "qb-c1-tf03",
        "type": "tf",
        "chapter": 1,
        "stem": "行为主义主要的理论基础是控制论。",
        "answer": True,
        "explain": "行为主义学派的主要理论基础是控制论，代表性思想为感知-动作反射机制与自适应学习。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.1 第1章 判断题 #3"
        }
    },
    {
        "id": "qb-c1-tf04",
        "type": "tf",
        "chapter": 1,
        "stem": "人工智能极大推动了人类社会经济的发展和进步，对社会有百利而无一害，可以大力推动。",
        "answer": True,
        "explain": "题库原答案判定为对（√）。但在实际技术发展中，人工智能同时也伴随着数据安全、隐私泄露、算法歧视及伦理法规等挑战，需要审慎规制与治理。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.1 第1章 判断题 #4",
            "note": "题库原答案判定为对(t)；实际在技术伦理与安全上需审慎监管"
        }
    },
    {
        "id": "qb-c1-tf05",
        "type": "tf",
        "chapter": 1,
        "stem": "1965年，提出了 Artificial Intelligence 这一概念，被视为人工智能学科的诞生。",
        "answer": False,
        "explain": "人工智能诞生于 1956 年的达特茅斯会议，提出 Artificial Intelligence 概念，而非 1965 年。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.1 第1章 判断题 #5"
        }
    },
    {
        "id": "qb-c1-ch01",
        "type": "choice",
        "chapter": 1,
        "stem": "人工智能的孕育期是（ ）。",
        "options": [
            "1943年 - 1955年",
            "1943年 - 1986年",
            "1956年 - 1969年",
            "1956年 - 1986年"
        ],
        "answer": 0,
        "explain": "1943年—1955年通常被称为人工智能的孕育期（以M-P模型提出为起点），1956年为人工智能元年。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.1 第1章 选择题 #1"
        }
    },
    {
        "id": "qb-c1-mu01",
        "type": "multi",
        "chapter": 1,
        "stem": "人工智能的主要研究流派包括（ ）。",
        "options": [
            "实用主义学派",
            "行为主义学派",
            "连接主义学派",
            "符号主义学派"
        ],
        "answer": [1, 2, 3],
        "explain": "人工智能的三大主要流派通常指：符号主义（Symbolism）、连接主义（Connectionism）、行为主义（Actionism）。实用主义并非三大主流派之一。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.1 第1章 选择题 #2"
        }
    },
    {
        "id": "qb-c1-ch02",
        "type": "choice",
        "chapter": 1,
        "stem": "人工智能的元年是（ ）。",
        "options": [
            "1956年",
            "1969年",
            "1943年"
        ],
        "answer": 0,
        "explain": "1956年达特茅斯会议召开，标志着人工智能学科的正式诞生，1956年被称为人工智能元年。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.1-2 第1章 选择题 #3"
        }
    },
    {
        "id": "qb-c1-ch03",
        "type": "choice",
        "chapter": 1,
        "stem": "人工智能的第二波高潮中得到迅速发展的是（ ）。",
        "options": [
            "神经网络",
            "机器人",
            "专家系统",
            "深度学习"
        ],
        "answer": 2,
        "explain": "人工智能发展的第二波浪潮（约1980年代）主要由“专家系统”的商业化应用推动。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.2 第1章 选择题 #4"
        }
    },

    # ---------------- CHAPTER 2 ----------------
    {
        "id": "qb-c2-tf01",
        "type": "tf",
        "chapter": 2,
        "stem": "视觉系统具有非常复杂的层次结构，层次越深，感受野越大。",
        "answer": True,
        "explain": "感受野（Receptive Field）指神经元对视觉空间的响应区域。随着层级深入，神经元整合的信息更多，其对应的视野范围（感受野）也越大。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.2 第2章 判断题 #1"
        }
    },
    {
        "id": "qb-c2-tf02",
        "type": "tf",
        "chapter": 2,
        "stem": "人类视觉系统和照相机的区别是照相机的图片不包含整个视野。",
        "answer": False,
        "explain": "人类视觉系统与照相机的区别在于人类视觉具有选择性注意、动态对焦、非均匀分辨率（中央凹最高）以及复杂的认知加工重构，并非照相机图片不包含整个视野。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.2 第2章 判断题 #2"
        }
    },
    {
        "id": "qb-c2-tf03",
        "type": "tf",
        "chapter": 2,
        "stem": "视觉系统中复杂细胞比简单细胞的感受野大。",
        "answer": True,
        "explain": "简单细胞主要对特定方向的边缘敏感，感受野较小；复杂细胞整合了多个简单细胞的输入，具有更大的感受野，且对位置具有一定的不变性。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.2 第2章 判断题 #3"
        }
    },
    {
        "id": "qb-c2-tf04",
        "type": "tf",
        "chapter": 2,
        "stem": "大脑视觉信息处理通路中，what通路用于空间定位，处理视觉空间运动信息。",
        "answer": False,
        "explain": "大脑皮层视觉通路分为腹侧通路（Ventral stream，即“What”通路）和背侧通路（Dorsal stream，即“Where”通路）。What通路负责识别物体（是什么），Where通路负责空间定位和运动（在哪里）。题目描述反了。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.2 第2章 判断题 #4"
        }
    },
    {
        "id": "qb-c2-tf05",
        "type": "tf",
        "chapter": 2,
        "stem": "人类智能的产生源自我们拥有一个神奇的大脑。",
        "answer": True,
        "explain": "人类智能产生于拥有高度结构化复杂网络和高级认知能力的人类大脑。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.2 第2章 判断题 #5"
        }
    },
    {
        "id": "qb-c2-tf06",
        "type": "tf",
        "chapter": 2,
        "stem": "神经细胞的电脉冲传递遵循“全或无”的原则。",
        "answer": True,
        "explain": "神经细胞动作电位的产生遵循“全或无”（All-or-None）原则，电位幅度不随刺激强度改变，而是通过发放频率进行信息编码。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.2 第2章 判断题 #6"
        }
    },
    {
        "id": "qb-c2-mu01",
        "type": "multi",
        "chapter": 2,
        "stem": "人脑由（ ）组成。",
        "options": [
            "小脑",
            "脑干",
            "大脑"
        ],
        "answer": [0, 1, 2],
        "explain": "人脑主要由大脑（端脑）、小脑和脑干（中脑、脑桥、延髓等）组成。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.2-3 第2章 选择题 #1"
        }
    },
    {
        "id": "qb-c2-ch01",
        "type": "choice",
        "chapter": 2,
        "stem": "神经细胞的电脉冲传递遵循（ ）的原则。",
        "options": [
            "1或者0",
            "全1",
            "全0"
        ],
        "answer": 0,
        "explain": "“全或无”原则（All-or-None Law）指神经元要么发放动作电位（1），要么不发放（0），信号强度不通过电位大小来编码，而是通过发放频率编码。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.3 第2章 选择题 #2"
        }
    },
    {
        "id": "qb-c2-ch02",
        "type": "choice",
        "chapter": 2,
        "stem": "视觉通路中存在 what 通路和 where 通路，体现了视觉系统的什么机制？",
        "options": [
            "并行分布式处理机制",
            "网络化处理机制",
            "层级处理机制"
        ],
        "answer": 0,
        "explain": "What通路和Where通路同时工作，分别处理不同的信息特征，体现了大脑的“并行分布式处理”机制。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.3 第2章 选择题 #3"
        }
    },

    # ---------------- CHAPTER 3 ----------------
    {
        "id": "qb-c3-tf01",
        "type": "tf",
        "chapter": 3,
        "stem": "三元组（triple）是知识的最小单元，知识图谱是三元组的集合。",
        "answer": True,
        "explain": "三元组（实体, 关系, 实体/属性值）是知识图谱中表示事实的最小单位，知识图谱本质上是海量语义三元组的集合。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.3 第3章 判断题 #1"
        }
    },
    {
        "id": "qb-c3-tf02",
        "type": "tf",
        "chapter": 3,
        "stem": "在知识图谱中，节点表示实体，边表示关系。",
        "answer": True,
        "explain": "知识图谱采用图数据模型，节点（Node）表示实体（Entity），边（Edge）表示实体之间的关系（Relation）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.3 第3章 判断题 #2"
        }
    },
    {
        "id": "qb-c3-tf03",
        "type": "tf",
        "chapter": 3,
        "stem": "图灵测试不是通过问答系统进行的。",
        "answer": False,
        "explain": "图灵测试主要通过人与机器进行隔离的自然语言文本问答（对话），由裁判通过回答判断对方是人还是机器。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.3 第3章 判断题 #3"
        }
    },
    {
        "id": "qb-c3-tf04",
        "type": "tf",
        "chapter": 3,
        "stem": "属性图基于图结构，边表示实体，节点表示实体间的联系。属性图上的查询语言是 Cypher 语言。",
        "answer": False,
        "explain": "属性图中，节点表示“实体”，边表示“关系/联系”。题目将节点和边的定义说反了。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4 第3章 判断题 #4"
        }
    },
    {
        "id": "qb-c3-tf05",
        "type": "tf",
        "chapter": 3,
        "stem": "一个典型的专家系统由知识库和推理机两部分组成。",
        "answer": True,
        "explain": "知识库（存放领域专业知识与规则）与推理机（执行推理算法）构成了专家系统的核心架构，实现了知识与推理的分离。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4 第3章 判断题 #5"
        }
    },
    {
        "id": "qb-c3-mu01",
        "type": "multi",
        "chapter": 3,
        "stem": "下列属于知识图谱的组成部分的是（ ）。",
        "options": [
            "实体",
            "关系",
            "文本",
            "三元组"
        ],
        "answer": [0, 1, 3],
        "explain": "知识图谱的核心图模型由实体、关系以及由它们构成的三元组组成。非结构化文本不是知识图谱图模型的组成要素。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4 第3章 选择题 #1"
        }
    },
    {
        "id": "qb-c3-ch01",
        "type": "choice",
        "chapter": 3,
        "stem": "下面选项中不是描述逻辑中的公理的是（ ）。",
        "options": [
            "C(a)",
            "r(a, b)",
            "∃r. C"
        ],
        "answer": 2,
        "explain": "在描述逻辑中，C(a) 和 r(a, b) 是断言（ABox），属于公理；而 ∃r. C 是一个概念表达式（Complex Concept），用来描述“与某个C类型的个体有r关系”这一类事物，不是一个完整的命题或公理。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4 第3章 选择题 #2"
        }
    },
    {
        "id": "qb-c3-ch02",
        "type": "choice",
        "chapter": 3,
        "stem": "下面选项中不是描述逻辑中的概念表达式的是（ ）。",
        "options": [
            "parentOf(a, b)",
            "Physicist(a)",
            "Physicist ⊑ Scientist",
            "∀parent. Male"
        ],
        "answer": 3,
        "explain": "在描述逻辑中，概念包含原子概念和复合概念表达式（如用量词约束等）。依据原题库答案选 D；注意选项 A 为角色断言，C 为包含公理。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4 第3章 选择题 #3",
            "note": "依据原题库标准答案选择 D"
        }
    },
    {
        "id": "qb-c3-ch03",
        "type": "choice",
        "chapter": 3,
        "stem": "下列关于 KBQA 系统的说法不正确的是（ ）。",
        "options": [
            "KBQA 系统不需要知识库及知识图谱的支持",
            "IBM Watson 和 WolframAlpha 均是 KBQA 系统",
            "问题理解模块首先进行实体识别",
            "语义解析模块将查询问题转化为语义图结构"
        ],
        "answer": 0,
        "explain": "KBQA 全称 Knowledge Base Question Answering，即“基于知识库的问答”，必然需要知识库及知识图谱的支持。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4 第3章 选择题 #4"
        }
    },
    {
        "id": "qb-c3-mu02",
        "type": "multi",
        "chapter": 3,
        "stem": "由非结构化数据进行关系抽取的方法有（ ）。",
        "options": [
            "基于模板的方法",
            "基于弱监督学习的方法",
            "基于监督学习的方法"
        ],
        "answer": [0, 1, 2],
        "explain": "从非结构化文本中进行关系抽取的方法包括基于人工规则/模板的方法、弱监督/远程监督学习方法以及有监督深度学习方法。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4 第3章 选择题 #5"
        }
    },
    {
        "id": "qb-c3-mu03",
        "type": "multi",
        "chapter": 3,
        "stem": "下列关于大语言模型（LLM）与问答的说法正确的是（ ）。",
        "options": [
            "大语言模型主要用于处理和生成自然语言文本",
            "大语言模型的理论基础是 Transformer 架构",
            "提示工程是关于如何更好地向大语言模型进行提问的技术",
            "给大语言模型的提示词必须具备角色和上下文要素"
        ],
        "answer": [0, 1, 2],
        "explain": "给大语言模型的提示词并非“必须”具备角色和上下文要素，简单的单句提问也能工作。因此 D 错误，选 ABC。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4 第3章 选择题 #6"
        }
    },
    {
        "id": "qb-c3-mu04",
        "type": "multi",
        "chapter": 3,
        "stem": "下列关于思维链（CoT）和检索增强生成（RAG）技术的说法正确的是（ ）。",
        "options": [
            "思维链技术是一种改进的提示策略",
            "RAG 方法适合知识密集型的任务",
            "RAG 方法不需要检索外挂知识库",
            "思维链技术适用于算术推理和符号推理"
        ],
        "answer": [0, 1, 3],
        "explain": "C是错误的，RAG（检索增强生成）的核心思想就是通过检索“外挂知识库”来增强模型的生成能力，减少幻觉。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.4-5 第3章 选择题 #7"
        }
    },
    {
        "id": "qb-c3-mu05",
        "type": "multi",
        "chapter": 3,
        "stem": "下面选项中关于知识问答的说法正确的是（ ）。",
        "options": [
            "问答系统目前分为传统问答系统、基于知识库的问答系统和基于大型语言模型的问答系统",
            "问答系统的核心架构通常包括问答处理框架、知识库和数据集",
            "基于知识的问答系统只需要进行问题理解，不需要进行语义解析",
            "问答系统能够理解自然语言中的问题并提供相关、准确的答案"
        ],
        "answer": [0, 1, 3],
        "explain": "C是错误的，基于知识的问答（KBQA）通常需要语义解析（Semantic Parsing）将自然语言转化为逻辑查询语句（如 SPARQL）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.5 第3章 选择题 #8"
        }
    },

    # ---------------- CHAPTER 4 ----------------
    {
        "id": "qb-c4-tf01",
        "type": "tf",
        "chapter": 4,
        "stem": "无监督学习需要使用到数据的人工标签。",
        "answer": False,
        "explain": "无监督学习处理的是没有人工标签（Label）的数据，目的是发现数据内在结构；有标签的是监督学习。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 判断题 #1"
        }
    },
    {
        "id": "qb-c4-tf02",
        "type": "tf",
        "chapter": 4,
        "stem": "决策树中每个非叶子结点表示对分类目标的某个属性上的一个判断。",
        "answer": True,
        "explain": "决策树由节点和有向边组成，非叶子节点（内部节点）表示一个属性上的测试或判断，叶节点表示一个类别分支。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 判断题 #2"
        }
    },
    {
        "id": "qb-c4-tf03",
        "type": "tf",
        "chapter": 4,
        "stem": "决策树中每个叶子结点表示一种分类结果。",
        "answer": True,
        "explain": "决策树的叶节点对应最终的决策结果（所属类别或预测值）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 判断题 #3"
        }
    },
    {
        "id": "qb-c4-tf04",
        "type": "tf",
        "chapter": 4,
        "stem": "Adaboost 算法主要采用调整样本权重的方式来对样本分布进行调整。",
        "answer": True,
        "explain": "AdaBoost 算法提高被前一轮弱分类器错分样本的权值，降低被正确分类样本的权值，通过调整样本分布来训练后续基分类器。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 判断题 #4"
        }
    },
    {
        "id": "qb-c4-tf05",
        "type": "tf",
        "chapter": 4,
        "stem": "集成学习算法的基本思想就是将多个分类器组合，从而实现一个预测效果更好的集成分类器。",
        "answer": True,
        "explain": "集成学习通过构建并结合多个学习器来完成学习任务，通常可获得比单一学习器显著优越的泛化性能。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 判断题 #5"
        }
    },
    {
        "id": "qb-c4-tf06",
        "type": "tf",
        "chapter": 4,
        "stem": "boosting 把每个弱分类器都视为独立的是一种并行的集成方式；而 bagging 各弱分类器之间有依赖关系，是一种串行的集成方式。",
        "answer": False,
        "explain": "描述反了。Bagging（如随机森林）中分类器之间无依赖，可并行生成；Boosting（如 Adaboost）是基于前一个分类器的错误来调整权重，是串行的。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 判断题 #6"
        }
    },
    {
        "id": "qb-c4-tf07",
        "type": "tf",
        "chapter": 4,
        "stem": "K-means 聚类算法对数据的尺寸敏感。",
        "answer": True,
        "explain": "K-means 是基于距离的算法（如欧氏距离），如果数据特征的尺度（Scale/尺寸）差异很大，会严重影响聚类效果，因此通常需要归一化处理。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 判断题 #7"
        }
    },
    {
        "id": "qb-c4-tf08",
        "type": "tf",
        "chapter": 4,
        "stem": "对于 SVM 分类算法，待分样本集中的大部分样本不是支持向量，移去或者减少这些样本对分类结果没有影响。",
        "answer": True,
        "explain": "SVM（支持向量机）的决策边界仅由少数几个“支持向量”（即离超平面最近的样本点）决定，其他非支持向量样本的移除不改变决策边界。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 判断题 #8"
        }
    },
    {
        "id": "qb-c4-ch01",
        "type": "choice",
        "chapter": 4,
        "stem": "在监督学习中，测试集的作用是什么？",
        "options": [
            "用于训练模型",
            "用于评估模型性能",
            "用于选择特征",
            "用于数据增强"
        ],
        "answer": 1,
        "explain": "测试集用于评估模型在新数据上的泛化能力和预测性能，不参与模型的训练过程。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 选择题 #1"
        }
    },
    {
        "id": "qb-c4-ch02",
        "type": "choice",
        "chapter": 4,
        "stem": "在监督学习中，如果数据集的标签是连续的数值，这种任务通常被称为什么？",
        "options": [
            "分类任务",
            "回归任务",
            "聚类任务",
            "降维任务"
        ],
        "answer": 1,
        "explain": "标签离散为分类；标签为连续数值（如房价、温度、降雨量等）的任务称为回归任务。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 选择题 #2"
        }
    },
    {
        "id": "qb-c4-mu01",
        "type": "multi",
        "chapter": 4,
        "stem": "传统分类方法包括（ ）。",
        "options": [
            "贝叶斯算法",
            "支持向量机",
            "逻辑回归",
            "决策树",
            "随机森林"
        ],
        "answer": [0, 1, 2, 3, 4],
        "explain": "朴素贝叶斯、支持向量机（SVM）、逻辑回归、决策树及随机森林均为经典的机器学习分类方法。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 选择题 #3"
        }
    },
    {
        "id": "qb-c4-ch03",
        "type": "choice",
        "chapter": 4,
        "stem": "以下哪一种算法不属于监督学习算法？",
        "options": [
            "支持向量机",
            "聚类",
            "决策树"
        ],
        "answer": 1,
        "explain": "聚类（Clustering）算法在无标签数据上运行，属于典型的无监督学习算法；支持向量机与决策树属于监督学习。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6 第4章 选择题 #4"
        }
    },
    {
        "id": "qb-c4-ch04",
        "type": "choice",
        "chapter": 4,
        "stem": "在无监督学习中，以下哪个算法通常用于将数据点分组以揭示数据的内在结构和模式？",
        "options": [
            "线性回归",
            "逻辑回归",
            "K-均值聚类",
            "支持向量机"
        ],
        "answer": 2,
        "explain": "K-均值（K-means）聚类将未标记的数据点划分为K个簇，从而揭示数据的内在分组模式与结构。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.6-7 第4章 选择题 #5"
        }
    },
    {
        "id": "qb-c4-mu02",
        "type": "multi",
        "chapter": 4,
        "stem": "以下哪些场景可以采用无监督聚类的方法？",
        "options": [
            "异常检测",
            "数据压缩",
            "语音识别"
        ],
        "answer": [0, 1],
        "explain": "语音识别通常需要大量标注数据（音频-文本对），属于监督学习范畴。异常检测（寻找离群点）和数据压缩（以簇中心代替簇内点）可采用聚类方法。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.7 第4章 选择题 #6"
        }
    },
    {
        "id": "qb-c4-ch05",
        "type": "choice",
        "chapter": 4,
        "stem": "决策树建立过程中，结果具有高信息熵（high entropy）意味着？",
        "options": [
            "纯度高",
            "有用",
            "无用",
            "其他"
        ],
        "answer": 2,
        "explain": "信息熵（Entropy）衡量系统的混乱程度或不确定性。熵越高，纯度越低（混乱）。在决策树分裂中，我们希望分裂后的子节点熵越低（纯度越高）越好。因此高熵通常意味着分裂效果不好（无用）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.7 第4章 选择题 #7"
        }
    },
    {
        "id": "qb-c4-mu03",
        "type": "multi",
        "chapter": 4,
        "stem": "以下哪些算法是分类算法？",
        "options": [
            "C4.5",
            "DBSCAN",
            "K-Means",
            "SVM"
        ],
        "answer": [0, 3],
        "explain": "C4.5 是决策树分类算法，SVM 是分类算法；DBSCAN 和 K-Means 是聚类算法。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.7 第4章 选择题 #8"
        }
    },
    {
        "id": "qb-c4-ch06",
        "type": "choice",
        "chapter": 4,
        "stem": "集成学习中，哪种方法通过构建多个决策树并取其预测结果的多数投票来提高分类的准确性？",
        "options": [
            "随机森林",
            "支持向量机",
            "神经网络",
            "线性回归"
        ],
        "answer": 0,
        "explain": "随机森林（Random Forest）是 Bagging 的代表算法，通过并行构建多棵决策树并结合多数表决提升分类准确度与抗过拟合能力。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.7 第4章 选择题 #9"
        }
    },
    {
        "id": "qb-c4-mu04",
        "type": "multi",
        "chapter": 4,
        "stem": "以下哪些是 k 均值方法的缺点？",
        "options": [
            "聚类的个数（需预设）",
            "对初始值敏感",
            "对噪声点非常敏感"
        ],
        "answer": [0, 1, 2],
        "explain": "K-means 需要预先指定 K 值（A）；初始中心点选得不好可能陷入局部最优（B）；均值计算容易受离群点（噪声）拉扯（C）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.7 第4章 选择题 #10"
        }
    },
    {
        "id": "qb-c4-mu05",
        "type": "multi",
        "chapter": 4,
        "stem": "以下哪些属于无监督学习的主要任务？",
        "options": [
            "关联分析",
            "聚类",
            "降维",
            "递归分析"
        ],
        "answer": [0, 1, 2],
        "explain": "无监督学习的主要任务包括聚类（Clustering）、降维（Dimensionality Reduction）和关联规则分析（Association Analysis）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.7 第4章 选择题 #11"
        }
    },
    {
        "id": "qb-c4-mu06",
        "type": "multi",
        "chapter": 4,
        "stem": "以下属于聚类算法的是（ ）。",
        "options": [
            "K均值",
            "DBSCAN",
            "层次聚类"
        ],
        "answer": [0, 1, 2],
        "explain": "K-means（划分式）、DBSCAN（基于密度）和层次聚类（层次聚合/分裂）均属于经典的聚类算法。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.7-8 第4章 选择题 #12"
        }
    },
    {
        "id": "qb-c4-ch07",
        "type": "choice",
        "chapter": 4,
        "stem": "以下哪个任务不是无监督学习的应用？",
        "options": [
            "异常检测",
            "推荐系统",
            "图像分类",
            "关联规则挖掘"
        ],
        "answer": 2,
        "explain": "图像分类（Image Classification）通常指给定图片预测其类别，需要预先定义的标签进行训练，是典型的监督学习。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.8 第4章 选择题 #13"
        }
    },

    # ---------------- CHAPTER 5 ----------------
    {
        "id": "qb-c5-tf01",
        "type": "tf",
        "chapter": 5,
        "stem": "深度学习是人工智能技术的分支。",
        "answer": True,
        "explain": "人工智能包含机器学习，深度学习是机器学习中使用深层神经网络模型的一个重要分支。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 判断题 #1"
        }
    },
    {
        "id": "qb-c5-tf02",
        "type": "tf",
        "chapter": 5,
        "stem": "大模型在处理复杂任务时，是否能够更好地泛化到未见过的数据上？",
        "answer": True,
        "explain": "大模型通过海量参数和多领域预训练数据的表征学习，具备更强的零样本/少样本迁移与泛化能力。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 判断题 #2"
        }
    },
    {
        "id": "qb-c5-tf03",
        "type": "tf",
        "chapter": 5,
        "stem": "强化学习的效果一定优于半监督学习？",
        "answer": False,
        "explain": "没有一种算法在所有情况下都优于另一种（没有免费午餐定理）。强化学习适用于决策和控制问题，半监督学习适用于利用未标注数据的分类/回归问题，两者应用场景不同，无法直接比较优劣。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 判断题 #3"
        }
    },
    {
        "id": "qb-c5-tf04",
        "type": "tf",
        "chapter": 5,
        "stem": "强化学习能够在不确定的环境中学到最优策略。",
        "answer": True,
        "explain": "强化学习通过智能体与不确定环境的交互探索和试错（trial-and-error），通过优化长期累积奖励学习最优策略。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 判断题 #4"
        }
    },
    {
        "id": "qb-c5-tf05",
        "type": "tf",
        "chapter": 5,
        "stem": "DALL-E 大模型的主要功能是生成图像。",
        "answer": True,
        "explain": "OpenAI 的 DALL-E 系列模型是典型的文生图（Text-to-Image）多模态大模型，核心功能是根据自然语言文本生成图像。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 判断题 #5"
        }
    },
    {
        "id": "qb-c5-tf06",
        "type": "tf",
        "chapter": 5,
        "stem": "CLIP 模型的主要作用是将图像转换为文本描述。",
        "answer": False,
        "explain": "CLIP（Contrastive Language-Image Pre-training）的主要作用是学习图像和文本之间的匹配关系（对齐），它可以用于图文检索或零样本分类，但其直接功能不是生成文本描述（这是 Image Captioning 任务）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 判断题 #6"
        }
    },
    {
        "id": "qb-c5-ch01",
        "type": "choice",
        "chapter": 5,
        "stem": "深度学习模型在处理非线性关系时，相比传统线性模型有何优势？",
        "options": [
            "更好的泛化能力",
            "更高的数据压缩率",
            "更快的计算速度",
            "更高的数据压缩率"
        ],
        "answer": 0,
        "explain": "深度学习通过多层非线性激活函数，能够拟合极其复杂的非线性函数，从而在复杂模式下具有更好的泛化能力。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 选择题 #1"
        }
    },
    {
        "id": "qb-c5-mu01",
        "type": "multi",
        "chapter": 5,
        "stem": "以下哪些是深度学习模型的主要优势？",
        "options": [
            "复杂非线性关系处理能力",
            "适用于小数据量分析",
            "大规模数据挖掘能力",
            "强大的特征学习能力"
        ],
        "answer": [0, 2, 3],
        "explain": "深度学习通常需要大量数据来训练（不适合小数据量），其优势在于自动特征提取（D）、处理非线性（A）和挖掘大数据（C）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 选择题 #2"
        }
    },
    {
        "id": "qb-c5-mu02",
        "type": "multi",
        "chapter": 5,
        "stem": "以下哪些是大模型的风险与挑战？",
        "options": [
            "数据安全",
            "内容安全",
            "认知安全"
        ],
        "answer": [0, 1, 2],
        "explain": "大模型在部署与应用中面临数据安全（隐私与版权）、内容安全（虚假信息/偏见/有害内容）与认知安全（欺骗与观念误导）等重大风险挑战。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9 第5章 选择题 #3"
        }
    },
    {
        "id": "qb-c5-ch02",
        "type": "choice",
        "chapter": 5,
        "stem": "为什么大模型能够更好地泛化到未见过的数据上？",
        "options": [
            "因为它们有更多的参数",
            "因为它们只能处理特定类型的数据",
            "因为它们使用了特殊的硬件",
            "因为它们不依赖于大量数据"
        ],
        "answer": 3,
        "explain": "此题选项在原题库中较为特殊。通常认为大模型泛化能力强是因为参数量大且在海量数据上训练。若选 D，可能意指大模型具备 Few-shot/Zero-shot 能力，在测试时“不依赖大量（新任务的）标注数据”。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.9-10 第5章 选择题 #4",
            "note": "依据原题库标准答案选择 D，指推理阶段不依赖大量标注数据"
        }
    },
    {
        "id": "qb-c5-mu03",
        "type": "multi",
        "chapter": 5,
        "stem": "以下哪项是强化学习中的关键概念？",
        "options": [
            "奖励函数",
            "监督信号",
            "环境",
            "智能体"
        ],
        "answer": [0, 2, 3],
        "explain": "强化学习四要素：Agent（智能体）、Environment（环境）、Action（动作）、Reward（奖励）。监督信号（B）是监督学习的概念。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.10 第5章 选择题 #5"
        }
    },
    {
        "id": "qb-c5-ch03",
        "type": "choice",
        "chapter": 5,
        "stem": "GAN 中的判别器主要做什么？",
        "options": [
            "调整网络权重以改善性能",
            "修正生成器的错误",
            "区分真实数据和生成器生成的假数据",
            "生成新的数据样本"
        ],
        "answer": 2,
        "explain": "GAN（生成对抗网络）由生成器（Generator）和判别器（Discriminator）组成。生成器负责造假，判别器负责鉴别真伪（区分真实数据和假数据）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.10 第5章 选择题 #6"
        }
    },
    {
        "id": "qb-c5-ch04",
        "type": "choice",
        "chapter": 5,
        "stem": "以下哪一项是 Transformer 模型的主要特点？",
        "options": [
            "层次聚类",
            "树状结构",
            "自注意力机制",
            "递归结构"
        ],
        "answer": 2,
        "explain": "Transformer 架构的核心创新就是抛弃了循环和卷积，完全依赖自注意力机制（Self-Attention）来捕捉序列中的依赖关系与高效并行。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.10 第5章 选择题 #7"
        }
    },
    {
        "id": "qb-c5-ch05",
        "type": "choice",
        "chapter": 5,
        "stem": "GPT-3 是一种什么类型的模型？",
        "options": [
            "生成模型",
            "判别模型",
            "分类模型",
            "聚类模型"
        ],
        "answer": 0,
        "explain": "GPT（Generative Pre-trained Transformer）顾名思义是生成式模型，主要用于文本生成。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.10 第5章 选择题 #8"
        }
    },
    {
        "id": "qb-c5-mu04",
        "type": "multi",
        "chapter": 5,
        "stem": "微调迁移（Fine-tuning Transfer Learning）的主要优势包括以下哪些？",
        "options": [
            "提高模型性能",
            "减少计算成本",
            "加快开发周期",
            "增强泛化能力",
            "适应多样化任务"
        ],
        "answer": [0, 1, 2, 3, 4],
        "explain": "在预训练基座模型上微调迁移，可以显著提高模型在下游任务上的性能、大幅减少训练计算成本、加快开发周期、增强小样本下的泛化能力，并适应多样化任务需求。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.10 第5章 选择题 #9"
        }
    },
    {
        "id": "qb-c5-ch06",
        "type": "choice",
        "chapter": 5,
        "stem": "以下哪一项最能描述 LORA（Low-Rank Adaptation）的工作原理？",
        "options": [
            "使用更大的数据集来训练模型",
            "增加模型的层数以提高其复杂度",
            "通过插入低秩矩阵来微调预训练模型，使得参数调整更高效"
        ],
        "answer": 2,
        "explain": "LoRA 不改变预训练模型权重，而是在旁路插入可训练的低秩分解矩阵，极大地减少了微调所需的参数数量和计算资源。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.10 第5章 选择题 #10"
        }
    },

    # ---------------- CHAPTER 6 ----------------
    {
        "id": "qb-c6-tf01",
        "type": "tf",
        "chapter": 6,
        "stem": "广义的语音合成研究内容包括语音转换、歌唱合成、可视语音合成。",
        "answer": True,
        "explain": "广义的语音合成研究内容涵盖传统文本到语音转换（TTS）、声音转换、歌唱合成以及包含面部口型动画的可视语音合成等。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.11 第6章 判断题 #1"
        }
    },
    {
        "id": "qb-c6-tf02",
        "type": "tf",
        "chapter": 6,
        "stem": "语音合成的目标包括了可懂度（Intelligibility）和自然度（Naturalness）。",
        "answer": True,
        "explain": "语音合成系统的两大核心评价指标即可懂度（清晰能听懂）与自然度（富有语调情感逼真自然）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.11 第6章 判断题 #2"
        }
    },
    {
        "id": "qb-c6-tf03",
        "type": "tf",
        "chapter": 6,
        "stem": "语音大模型可以同时处理多个语音任务。",
        "answer": True,
        "explain": "现代统一架构的语音大模型具备同时处理自动语音识别（ASR）、语音合成（TTS）、语音翻译、说话人识别等多项语音任务的能力。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.11 第6章 判断题 #3"
        }
    },
    {
        "id": "qb-c6-tf04",
        "type": "tf",
        "chapter": 6,
        "stem": "自监督预训练模型的表征通常是更加通用的。",
        "answer": True,
        "explain": "自监督预训练利用海量无标注语音数据学习底层声学特征与高层语义表示，学到的特征表征具有很强的跨任务通用性与可迁移性。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 判断题 #4"
        }
    },
    {
        "id": "qb-c6-tf05",
        "type": "tf",
        "chapter": 6,
        "stem": "语音大模型既可以通过微调的方式适配到多种基于小模型的下游任务，也可以与 LLM 结合实现统一框架的语音交互。",
        "answer": True,
        "explain": "语音大模型既可微调赋能传统下游特定任务，也可以作为语音前端/后端与大语言模型（LLM）端到端融合，构建端到端全双工实时语音交互。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 判断题 #5"
        }
    },
    {
        "id": "qb-c6-tf06",
        "type": "tf",
        "chapter": 6,
        "stem": "经典统计参数语音合成的主要流程和模块包括文本分析、韵律分析、声学模型、声码器。",
        "answer": True,
        "explain": "经典统计参数语音合成（SPSS）的标准流程由文本分析、韵律预测、声学参数模型（如HMM/DNN）与声码器（Vocoder）四个模块构成。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 判断题 #6"
        }
    },
    {
        "id": "qb-c6-tf07",
        "type": "tf",
        "chapter": 6,
        "stem": "N-gram 语言模型是一种基于神经网络的语言模型。",
        "answer": False,
        "explain": "N-gram 是基于统计（概率统计）的语言模型，通过计算词序列出现的概率来工作；基于神经网络的是 RNNLM、BERT 等。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 判断题 #7"
        }
    },
    {
        "id": "qb-c6-tf08",
        "type": "tf",
        "chapter": 6,
        "stem": "相比于监督/弱监督预训练，自监督预训练能更充分地利用网络上海量的无标注数据。",
        "answer": True,
        "explain": "自监督预训练无需人工转录与标签注释，能够低成本高效利用网络上海量未经标注的原始语音音频数据。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 判断题 #8"
        }
    },
    {
        "id": "qb-c6-mu01",
        "type": "multi",
        "chapter": 6,
        "stem": "以下属于计算机听觉的研究内容的有：",
        "options": [
            "音频事件检测",
            "人脸识别",
            "语音识别",
            "音乐信息检索"
        ],
        "answer": [0, 2, 3],
        "explain": "音频事件检测、语音识别以及音乐信息检索均属于计算机听觉研究领域；人脸识别属于计算机视觉（CV）范畴。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 选择题 #1"
        }
    },
    {
        "id": "qb-c6-ch01",
        "type": "choice",
        "chapter": 6,
        "stem": "根据背景干扰的类型，语音分离通常分为三类。其中，语音与非语音分离称为（ ）。",
        "options": [
            "混响消除",
            "说话人分离",
            "语音去噪",
            "回声消除"
        ],
        "answer": 2,
        "explain": "语音与非语音（噪音）的分离即为降噪/去噪（Denoising）。语音与语音分离为说话人分离；房间反射声消除为去混响。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 选择题 #2"
        }
    },
    {
        "id": "qb-c6-mu02",
        "type": "multi",
        "chapter": 6,
        "stem": "统计参数语音合成的优点包括：",
        "options": [
            "无需大规模的精心设计的语音数据库",
            "合成语音的质量稳定",
            "可以控制韵律",
            "可扩展性好易于维护"
        ],
        "answer": [0, 1, 2, 3],
        "explain": "与波形拼接相比，统计参数语音合成无需巨型高质量录音库、语音输出质量稳定连续、可通过模型参数灵活控制韵律音调，且模型体积小易于扩展维护。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 选择题 #3"
        }
    },
    {
        "id": "qb-c6-mu03",
        "type": "multi",
        "chapter": 6,
        "stem": "语音合成的主要挑战包括：",
        "options": [
            "情感、多风格等高表现力语音合成",
            "可控的个性化语音克隆、语音合成",
            "上下文的理解"
        ],
        "answer": [0, 1, 2],
        "explain": "当前语音合成领域的主要挑战包括高表现力与多样情感风格建模、低资源下的个性化声音克隆，以及深层篇章上下文语义意图的理解与呈现。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 选择题 #4"
        }
    },
    {
        "id": "qb-c6-ch02",
        "type": "choice",
        "chapter": 6,
        "stem": "以下哪种方法不属于统计参数语音合成方法？",
        "options": [
            "基于 HMM 的语音合成方法",
            "基于 DNN 的语音合成方法",
            "波形拼接语音合成"
        ],
        "answer": 2,
        "explain": "语音合成主要分为波形拼接合成（Concatenative）和统计参数合成（Parametric）。波形拼接直接拼接录音片段，不属于统计参数方法。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12 第6章 选择题 #5"
        }
    },
    {
        "id": "qb-c6-mu04",
        "type": "multi",
        "chapter": 6,
        "stem": "语音大模型主要挑战包括（ ）。",
        "options": [
            "可控语音生成大模型",
            "深度意图理解的语音/文本多模态人机交互",
            "低能耗的通用语音交互智能"
        ],
        "answer": [0, 1, 2],
        "explain": "语音大模型在细粒度属性精确可控生成、深层意图理解的多模态人机协同，以及边缘端低功耗高效部署方面均面临关键挑战。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.12-13 第6章 选择题 #6"
        }
    },

    # ---------------- CHAPTER 7 ----------------
    {
        "id": "qb-c7-tf01",
        "type": "tf",
        "chapter": 7,
        "stem": "词表示是前馈神经网络学习的副产品。",
        "answer": False,
        "explain": "虽然在某些早期神经网络语言模型（如 Bengio 的 NNLM）中词向量是副产品，但现代词向量（如 Word2Vec）通常有专门的优化目标。此处参考答案为错，可能强调其在“神经网络语言模型”中的地位。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.13 第7章 判断题 #1"
        }
    },
    {
        "id": "qb-c7-tf02",
        "type": "tf",
        "chapter": 7,
        "stem": "语义分析试图从更灵活的上下文理解语言的衔接性、连贯性、意图性、情境性等。",
        "answer": False,
        "explain": "从上下文、意图、情境角度理解语言属于语用分析（Pragmatics）。语义分析（Semantics）更多关注字面意义的组合。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.13 第7章 判断题 #2"
        }
    },
    {
        "id": "qb-c7-tf03",
        "type": "tf",
        "chapter": 7,
        "stem": "语用分析指对输入的文本句子进行分析以得到句子的句法结构的处理过程。",
        "answer": False,
        "explain": "分析句子结构和排列顺序的是句法分析（Syntax）。语用分析研究语言在实际交际语境中的使用和意图。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.13 第7章 判断题 #3"
        }
    },
    {
        "id": "qb-c7-tf04",
        "type": "tf",
        "chapter": 7,
        "stem": "汉语分词的主要难点在于切分歧义与未登录词识别。",
        "answer": True,
        "explain": "中文词与词之间无天然空格边界，分词面临的核心难点正是组合型/交集型切分歧义以及新词、专有名词（未登录词）的准确识别。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.13 第7章 判断题 #4"
        }
    },
    {
        "id": "qb-c7-tf05",
        "type": "tf",
        "chapter": 7,
        "stem": "在自然语言理解中存在语言歧义现象，但在语言生成中并不存在。",
        "answer": False,
        "explain": "语言生成也面临歧义问题，例如生成的句子可能指代不明、主谓搭配存在二义性或产生多种解读。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.13 第7章 判断题 #5"
        }
    },
    {
        "id": "qb-c7-tf06",
        "type": "tf",
        "chapter": 7,
        "stem": "自然语言处理的难点包括语言歧义和语境灵活。",
        "answer": True,
        "explain": "自然语言的高度多义性、语法省略、隐喻修辞以及强依赖上下文语境的灵活性是 NLP 领域的核心瓶颈。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.13 第7章 判断题 #6"
        }
    },
    {
        "id": "qb-c7-tf07",
        "type": "tf",
        "chapter": 7,
        "stem": "句法分析指对输入的文本句子进行分析以得到句子的句法结构的处理过程。",
        "answer": True,
        "explain": "句法分析旨在确定句子的语法成分及其相互间的结构关系（如短语结构树或依存句法树）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.13 第7章 判断题 #7"
        }
    },
    {
        "id": "qb-c7-mu01",
        "type": "multi",
        "chapter": 7,
        "stem": "自然语言理解包括以下哪些？",
        "options": [
            "词法分析",
            "语用分析",
            "句法分析",
            "语义分析"
        ],
        "answer": [0, 1, 2, 3],
        "explain": "NLP 理解层级通常包括：词法分析（分词/词性标注）、句法分析（语法结构）、语义分析（字面意义组合）、语用分析（意图与实际语境）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.13-14 第7章 选择题 #1"
        }
    },
    {
        "id": "qb-c7-mu02",
        "type": "multi",
        "chapter": 7,
        "stem": "典型的语言生成任务有哪些？",
        "options": [
            "机器翻译",
            "信息抽取",
            "对话系统",
            "自动摘要"
        ],
        "answer": [0, 2, 3],
        "explain": "信息抽取（Information Extraction）是从非结构化文本中提取结构化信息（如实体、关系），属于理解任务而非生成任务。机器翻译、对话系统和自动摘要属于典型的自然语言生成任务。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.14 第7章 选择题 #2"
        }
    },
    {
        "id": "qb-c7-ch01",
        "type": "choice",
        "chapter": 7,
        "stem": "词表示是（ ）学习的副产品。",
        "options": [
            "高阶语言模型",
            "前馈神经网络",
            "神经网络语言模型",
            "统计语言模型"
        ],
        "answer": 2,
        "explain": "Word Embedding（词表示/词向量）通常是在训练神经网络语言模型（Neural Language Model）时作为副产品得到的权重矩阵。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.14 第7章 选择题 #3"
        }
    },

    # ---------------- CHAPTER 8 ----------------
    {
        "id": "qb-c8-tf01",
        "type": "tf",
        "chapter": 8,
        "stem": "卷积神经网络模拟了人脑视觉系统简单细胞和复杂细胞的特征提取功能。",
        "answer": True,
        "explain": "Hubel 和 Wiesel 发现视皮层简单细胞对特定方向的边缘线敏感，复杂细胞具有平移不变性，这一生理机制直接启发了 CNN 中卷积与池化的交替层次设计。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #1"
        }
    },
    {
        "id": "qb-c8-tf02",
        "type": "tf",
        "chapter": 8,
        "stem": "卷积核在卷积神经网络中的主要作用是增加计算速度。",
        "answer": False,
        "explain": "卷积核的主要作用是特征提取（如边缘、纹理）和通过参数共享减少模型参数，并非为了增加计算速度（事实上卷积计算量很大）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #2"
        }
    },
    {
        "id": "qb-c8-tf03",
        "type": "tf",
        "chapter": 8,
        "stem": "卷积计算利用了图片中像素的时序关联性，进行特征提取。",
        "answer": False,
        "explain": "图片像素之间主要是空间关联性（Spatial correlation），卷积利用的是空间局部性；时序关联性通常指时间序列或视频。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #3"
        }
    },
    {
        "id": "qb-c8-tf04",
        "type": "tf",
        "chapter": 8,
        "stem": "RNN 在训练过程中，每一步都会更新其记忆，并根据当前和之前的记忆来做出判断。",
        "answer": True,
        "explain": "RNN 通过循环隐状态（Hidden State）维护时序记忆，每一步结合当前时刻输入与上一时刻隐状态更新内部记忆并输出判断。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #4"
        }
    },
    {
        "id": "qb-c8-tf05",
        "type": "tf",
        "chapter": 8,
        "stem": "CNN 是循环神经网络的一种。",
        "answer": False,
        "explain": "CNN（卷积神经网络）和 RNN（循环神经网络）是两种不同的网络架构。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #5"
        }
    },
    {
        "id": "qb-c8-tf06",
        "type": "tf",
        "chapter": 8,
        "stem": "卷积神经网络（CNN）相较循环神经网络（RNN）更适合于处理序列数据。",
        "answer": False,
        "explain": "RNN 设计之初就是为了处理序列数据（有前后依赖关系），CNN 主要用于处理网格数据（如图像）。虽然 CNN（如 1D-CNN）也可以处理序列，但 RNN 在机制上更适合。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #6"
        }
    },
    {
        "id": "qb-c8-tf07",
        "type": "tf",
        "chapter": 8,
        "stem": "脑机接口技术采用侵入式比非侵入式更安全。",
        "answer": False,
        "explain": "侵入式需要手术植入电极，存在感染和组织损伤风险，非侵入式（如 EEG 帽）更安全。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #7"
        }
    },
    {
        "id": "qb-c8-tf08",
        "type": "tf",
        "chapter": 8,
        "stem": "混合智能最显著的特点是层次化。",
        "answer": True,
        "explain": "脑机混合智能系统通常展现出人脑认知与机器计算在感知、认知、决策等不同层次上的深度结合与协同分工。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #8"
        }
    },
    {
        "id": "qb-c8-tf09",
        "type": "tf",
        "chapter": 8,
        "stem": "生物神经元结构启发了智能领域的感知机神经网络模型。",
        "answer": True,
        "explain": "感知机模型受生物神经元的树突接受输入、细胞体求和整合以及轴突按阈值发放动作电位机制启发而建立。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 判断题 #9"
        }
    },
    {
        "id": "qb-c8-mu01",
        "type": "multi",
        "chapter": 8,
        "stem": "以下哪种方法属于卷积神经网络的基本组件？",
        "options": [
            "卷积层",
            "池化层",
            "激活函数",
            "复制层"
        ],
        "answer": [0, 1, 2],
        "explain": "卷积层、池化层和非线性激活函数均为卷积神经网络的核心标准组件；“复制层”不是 CNN 的标准组件。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 选择题 #1"
        }
    },
    {
        "id": "qb-c8-mu02",
        "type": "multi",
        "chapter": 8,
        "stem": "CNN 的实际应用有哪些？",
        "options": [
            "人脸识别",
            "目标分割",
            "骨骼识别",
            "图片分类",
            "目标定位检测"
        ],
        "answer": [0, 1, 2, 3, 4],
        "explain": "CNN 在图像识别与分类、人脸识别、语义/实例目标分割、骨骼关键点检测以及目标定位与检测等视觉任务中均有广泛应用。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 选择题 #2"
        }
    },
    {
        "id": "qb-c8-mu03",
        "type": "multi",
        "chapter": 8,
        "stem": "以下哪些是卷积神经网络的缺点？",
        "options": [
            "数据资源不足导致深层神经网络容易过拟合",
            "计算代价很大，需要很高的计算资源",
            "技术（网络结构设计和优化）仍存在收敛难的缺陷"
        ],
        "answer": [0, 1, 2],
        "explain": "深度 CNN 对标注数据规模依赖高，数据不足易过拟合；卷积浮点计算量庞大，依赖昂贵的硬件算力；网络架构复杂时存在梯度消失/爆炸与难以收敛的优化难点。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 选择题 #3"
        }
    },
    {
        "id": "qb-c8-ch01",
        "type": "choice",
        "chapter": 8,
        "stem": "下列哪个是 RNN 的一个主要优势？",
        "options": [
            "对噪声不敏感",
            "能够捕捉长距离依赖关系",
            "处理速度快",
            "易于训练"
        ],
        "answer": 1,
        "explain": "RNN 通过隐状态传递信息，理论上可以捕捉序列中前后元素的依赖关系（即长距离依赖）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.15 第8章 选择题 #4"
        }
    },
    {
        "id": "qb-c8-mu04",
        "type": "multi",
        "chapter": 8,
        "stem": "以下哪些是 RNN（循环神经网络）的优势？",
        "options": [
            "能够处理序列数据",
            "能够记忆长期依赖关系",
            "在处理时间序列数据时表现良好",
            "适用于静态数据处理"
        ],
        "answer": [0, 1, 2],
        "explain": "RNN 专门针对时序和变长序列数据设计，具备内部记忆能力；静态数据（如单张图片）通常用 CNN 处理更优，D 错误。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.16-17 第8章 选择题 #5"
        }
    },
    {
        "id": "qb-c8-mu05",
        "type": "multi",
        "chapter": 8,
        "stem": "脑机接口技术按照信号采集方式分为：",
        "options": [
            "非侵入式采集",
            "半侵入式采集",
            "侵入式采集"
        ],
        "answer": [0, 1, 2],
        "explain": "按照传感器电极与脑组织的物理相对位置，脑机接口分为非侵入式（头皮电极）、半侵入式（硬膜下/皮层表面）与侵入式（皮层内微电极）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.16-17 第8章 选择题 #6"
        }
    },
    {
        "id": "qb-c8-mu06",
        "type": "multi",
        "chapter": 8,
        "stem": "脑机混合智能进行功能增强的方式有哪些？",
        "options": [
            "行为增加",
            "认知增强",
            "感知增强"
        ],
        "answer": [0, 1, 2],
        "explain": "脑机混合智能的功能增强涵盖感知增强（视觉/听觉扩展）、认知增强（记忆/注意力/决策辅助）以及行为增强（瘫痪假肢控制/运动能力拓展）。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.16-17 第8章 选择题 #7"
        }
    },

    # ---------------- CHAPTER 9 ----------------
    {
        "id": "qb-c9-tf01",
        "type": "tf",
        "chapter": 9,
        "stem": "伺服电机旋转的角度可以被测量并反馈给伺服驱动器。",
        "answer": True,
        "explain": "这是“闭环控制”的基础，伺服电机通常带有编码器来反馈位置信息与转速，实现精密位置伺服控制。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17 第9章 判断题 #1"
        }
    },
    {
        "id": "qb-c9-tf02",
        "type": "tf",
        "chapter": 9,
        "stem": "一个机器人系统通常由大脑、机构、能源、执行器、传感器、通讯和交互界面组成。",
        "answer": True,
        "explain": "一个完整的机器人工程系统通常涵盖控制决策大脑、机械结构本体、动力电源、驱动执行器、感知传感器系统、通讯总线以及人机交互界面。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17 第9章 判断题 #2"
        }
    },
    {
        "id": "qb-c9-tf03",
        "type": "tf",
        "chapter": 9,
        "stem": "固定底盘机器人的工作半径可以无限大。",
        "answer": False,
        "explain": "固定底盘机器人被固定在某个位置（如工业机械臂），其工作半径受限于机械臂的长度，是有限的。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17 第9章 判断题 #3"
        }
    },
    {
        "id": "qb-c9-tf04",
        "type": "tf",
        "chapter": 9,
        "stem": "超声雷达的测距精度高于激光雷达。",
        "answer": False,
        "explain": "激光雷达（LiDAR）使用光波，波长短，测量精度高；超声波受空气环境影响大，精度相对较低。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17 第9章 判断题 #4"
        }
    },
    {
        "id": "qb-c9-tf05",
        "type": "tf",
        "chapter": 9,
        "stem": "机器人与人工智能没有本质区别，既可以将机器人理解为人工智能，也可以将人工智能理解为机器人。",
        "answer": False,
        "explain": "机器人是物理实体，强调执行和与物理世界的交互；人工智能是技术或算法，强调智能处理。两者有交集（智能机器人），但概念不同。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17 第9章 判断题 #5"
        }
    },
    {
        "id": "qb-c9-mu01",
        "type": "multi",
        "chapter": 9,
        "stem": "扫地机器人上安装了如下哪些传感器？",
        "options": [
            "激光雷达",
            "3D 摄像头",
            "编码器",
            "防碰撞传感器"
        ],
        "answer": [0, 1, 2, 3],
        "explain": "扫地机器人通常配置激光雷达/视觉摄像头进行环境建图与导航、轮式编码器测定移动里程，以及防跌落/防碰撞传感器进行避障保护。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17-18 第9章 选择题 #1"
        }
    },
    {
        "id": "qb-c9-mu02",
        "type": "multi",
        "chapter": 9,
        "stem": "如下有关机器人的描述正确的包括：",
        "options": [
            "机器人的外形必须长得像人那样，即机器人必须有头部、躯干、四肢等部分",
            "机器人在某些方面的感知能力是超过人类的",
            "机器人可以协助人类完成危险的、无聊的、脏的和困难的工作",
            "机器人是可以自动执行工作任务且具有一定智能的机器"
        ],
        "answer": [1, 2, 3],
        "explain": "A 错误，机器人不一定要有人形（如扫地机器人、工业机械臂）。机器人感知能力可在特定频段超越人类，并替代人类从事 3D（Dull, Dirty, Dangerous）工作。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17-18 第9章 选择题 #2"
        }
    },
    {
        "id": "qb-c9-ch01",
        "type": "choice",
        "chapter": 9,
        "stem": "如下有关机器人导航的理解正确的是：",
        "options": [
            "机器人导航是解决机器人从环境中的某个起点顺利地到达某个终点的技术，涉及机器人定位、机器人路径规划和环境建图等主要技术",
            "机器人定位与环境建图是相互独立的，两者在任何情况下都是没有关系的",
            "机器人导航结果不会影响机器人的控制效果",
            "机器人导航与传感器没有任何关系"
        ],
        "answer": 0,
        "explain": "B 错误，SLAM（同步定位与建图）技术中两者紧密耦合；C 错误，导航规划出的路径直接决定控制指令；D 错误，导航高度依赖传感器数据。故选 A。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17-18 第9章 选择题 #3"
        }
    },
    {
        "id": "qb-c9-tf06",
        "type": "tf",
        "chapter": 9,
        "stem": "机器人常用的外部传感器包括编码器、陀螺仪、加速度计和磁力计。",
        "answer": True,
        "explain": "注：严格来说编码器、陀螺仪、加速度计通常被归类为“内部传感器”（感知自身状态），而激光雷达、摄像头等是“外部传感器”（感知环境）。但依据提供的题库原答案，此题判定为对。",
        "source": {
            "origin": "comprehensive_bank",
            "file": "人工智能导论 综合题库最终版.pdf",
            "ref": "p.17-18 第9章 选择题 #4",
            "note": "原题置于选择题形式出现但无选项，原题库判定为对(√)"
        }
    }
]

scratch_path = r"C:\Users\123\.gemini\antigravity\brain\8a29c743-f197-4be0-93dd-b64046aa85b6\scratch\raw_comprehensive.json"
import os
os.makedirs(os.path.dirname(scratch_path), exist_ok=True)
with open(scratch_path, "w", encoding="utf-8") as f:
    json.dump(questions, f, ensure_ascii=False, indent=2)

print(f"Successfully generated {len(questions)} questions to {scratch_path}")
