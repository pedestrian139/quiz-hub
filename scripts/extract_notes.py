#!/usr/bin/env python3
"""Extract and normalize knowledge handbook notes from 人工智能导论复习资料.pdf into notes.json.

Uses PyMuPDF (fitz) `get_text("dict")` to deterministically parse document title,
9 chapters, and 64 sections (handling downgraded headings and numbering jumps),
reconstruct wrapped paragraphs without truncation, apply full typo/homoglyph/symbol
normalization, and emit NotesData-conformant JSON.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Any

import pymupdf

DEFAULT_PDF_PATH = Path(r"c:\Users\123\Desktop\antigravity\人工智能导论\人工智能导论复习资料.pdf")
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parent.parent / "src" / "data" / "notes.json"

CH_RE = re.compile(r"^第([一二三四五六七八九十]+)章[—\-–]+(.+)$")
SEC_RE = re.compile(r"^([一二三四五六七八九十]+)、\s*(.+)$")
ITEM_RE = re.compile(r"^\s*(?:\d+\.(?!\d)|（\d+）|\(\d+\))\s*")
SOFT_BREAK_CUE_RE = re.compile(r"^(?:核心要点：|分类：|缺点：|优点：|任务分类：|结构主义：)")
TERM_DEF_RE = re.compile(r"^(?:↳\s*)?(?:（\d+）\s*|\(\d+\)\s*|\d+\.(?!\d)\s*)?([^。；！？]{2,42}?)[：:]\s*(.+)$")

GENERIC_TERM_LABELS = {
    "优点", "缺点", "优点与不足", "不足", "优势", "含义", "用途", "分类", "方法",
    "核心要点", "核心步骤", "核心技术与挑战", "情况1", "情况2", "解决方法",
    "第一阶段", "第二阶段", "第一步", "第二步", "第三步", "第四步", "第n 步", "第n步",
    "在线部分", "离线部分", "任务分类", "根据领域分类", "根据应用场景",
    "根据技术方案", "按发音方式分", "按说话人分", "层次", "特点", "整体架构",
    "载体", "相关指标", "训练样本集", "预测函数的权重", "并行计算",
    "主要应用", "主要挑战", "当前目标", "终极目标", "能力上", "研究和使用形式上",
    "内部", "外部", "理论基础", "属性选择方法", "提示工程的关键作用",
    "传统方法", "深度学习方法", "任务建模", "研究热点", "当前研究热点",
    "核心技术层面存在的问题", "典型聚类应用", "典型的语言生成任务",
    "三种任务", "三种查询方式", "出发点不同", "主要的理论基础", "主要科学方法",
    "目的", "目标", "应用", "为什么要数据归约呢", "传统语音交互",
    "语音增强的目的", "语音增强主要评价指标", "语音识别主要评价指标",
    "语言模型的评价指标", "语音合成的主要评价指标", "语音合成挑战",
    "经典神经语言模型", "常见脑图谱", "常见的脑图谱", "脑的研究手段",
    "语音数字信号的经典频域分析方法", "其他", "案例", "说明",
    "概念表达式", "分类问题", "回归问题", "分类任务", "回归任务", "多任务",
    "训练集", "数据集", "应用场景", "网络化机制", "角色", "指示", "上下文",
    "例子", "输入", "输出", "节点", "边", "叶子节点", "结构主义", "功能主义",
    "分组", "更新簇中心", "迭代重复", "选择K 值", "初始化簇中心",
    "大模型起源(结构)", "大模型起源(预训练)", "基于规则", "基于统计模型", "基于深度学习",
    "按信号传输方向分", "按信号采集方式分", "实现端到端的关键", "为什么需要计算机视觉大模型",
    "21 世纪--深度学习", "N-gram 语言模型的问题",
    "计算机中的图像", "大模型的基本组成", "语音交互", "机器翻译",
}

# Ordered deterministic normalization rules: (pattern, replacement, is_regex)
TYPO_RULES: list[tuple[str, str, bool]] = [
    # 1. Homoglyphs & degraded logical/math symbols (must run first)
    ("\u0421", "C", False),  # Cyrillic U+0421 'С' -> ASCII 'C' (Ch3 S3 （存在）r.С)
    ("（存在）r.C", "∃r.C", False),
    ("（任意）r.C", "∀r.C", False),
    ("A（方角子集符号）B", "A ⊑ B", False),
    ("p（rou）", "ρ", False),
    ("（sigma）", "σ", False),
    ("（lunda）", "λ", False),
    ("＋", "+", False),
    ("2200cm2", "2200cm²", False),

    # 2. Ch1–Ch4 cataloged & newly discovered fixes
    ("1915 年", "1945 年", False),
    ("1915年", "1945年", False),
    ("阿兰纽厄尔", "阿兰·纽厄尔", False),
    ("DENDRAL3", "DENDRAL", False),
    ("约翰霍普菲尔德", "约翰·霍普菲尔德", False),
    ("优化计算、和光学设备", "优化计算和光学设备", False),
    ("Deepmind", "DeepMind", False),
    ("规则与系统方法融合", "规则与统计方法融合", False),
    ("德国普所", "德国马普所", False),
    ("人类人脑包括、右人脑半球", "人类大脑包括左、右大脑半球", False),
    ("左右半脑", "左右大脑半球", False),
    ("胼瓜体", "胼胝体", False),
    ("Atlas,HBA", "Atlas, HBA", False),
    ("Atlas,MMA360", "Atlas, MMA360", False),
    ("腹侧hat 通路", "腹侧what 通路", False),
    ("腹侧hat通路", "腹侧what 通路", False),
    ("背侧here 通路", "背侧where 通路", False),
    ("背侧here通路", "背侧where 通路", False),
    ("视觉日标", "视觉目标", False),
    ("7. 网络化机制层内和层间交互", "7. 网络化机制：层内和层间交互", False),
    ("Linked Datal", "Linked Data", False),
    ("木体是概念模型", "本体是概念模型", False),
    ("C（a）", "C(a)", False),
    ("r (a,b)", "r(a, b)", False),
    ("节点边的类型", "节点/边的类型", False),
    ("Neo4ij", "Neo4j", False),
    ("于1950 年Mind 杂志上的发表文章", "于 1950 年 Mind 杂志上发表的文章", False),
    ("Chain-of Thought", "Chain-of-Thought", False),
    ("Rosen Blatt", "Rosenblatt", False),
    ("导致了人工神经网络研究的陷人了低潮", "导致人工神经网络研究陷入了低潮", False),
    ("陷人了", "陷入了", False),
    ("MLPBP", "MLP 与 BP", False),
    ("Yann 和LeCun", "Yann LeCun", False),
    ("1D3(", "ID3(", False),
    ("共决策边界", "其决策边界", False),
    ("主成分分/", "主成分分析/", False),
    ("每一个子集是一个簇在同一个簇中", "每一个子集是一个簇，在同一个簇中", False),
    ("关键健样本", "关键样本", False),
    ("对前一层分类错误的样本基于更高的权重", "对前一层分类错误的样本赋予更高的权重", False),
    ("基于更高的权重", "赋予更高的权重", False),
    ("对T 个模型的值求平均得到最后分类结果", "对T 个模型的值求平均得到最后回归结果", False),
    ("Adaboost", "AdaBoost", False),
    ("随机选择个数据点", "随机选择 K 个数据点", False),
    ("每个族的中心", "每个簇的中心", False),
    ("族中所有", "簇中所有", False),
    ("迭代币复", "迭代重复", False),
    ("K-均伯聚类", "K-均值聚类", False),
    ("缺点：聚类的个数、", "缺点：需预先确定聚类的个数 K、", False),
    ("白然语言", "自然语言", False),
    ("共泛化能力", "其泛化能力", False),

    # 3. Ch5–Ch9 cataloged & newly discovered fixes
    ("早期研究种", "早期研究中", False),
    ("多层神经络", "多层神经网络", False),
    ("决了一个神经元", "决定了一个神经元", False),
    ("输人数据", "输入数据", False),
    ("现端到端的关键", "实现端到端的关键", False),
    ("当前和之的记忆", "当前和之前的记忆", False),
    ("实休", "实体", False),
    ("将共拓展", "将其拓展", False),
    ("输人提示", "输入提示", False),
    ("输人连续", "输入连续", False),
    ("(word Error Rate)", "(Word Error Rate)", False),
    ("基于人语言模型", "基于大语言模型", False),
    ("长距离依懒", "长距离依赖", False),
    ("神经语言模型在能够识别", "神经语言模型能够识别", False),
    ("对输入的语进行", "对输入的语音进行", False),
    ("基于输人信息", "基于输入信息", False),
    ("共概率分布", "其概率分布", False),
    ("在语音识中产生", "在语音识别中产生", False),
    ("很多种可的翻译", "很多种可能的翻译", False),
    ("输人为关键字", "输入为关键字", False),
    ("输人为问题", "输入为问题", False),
    ("特征提取Vs 表示学习", "特征提取 vs. 表示学习", False),
    ("基于任务或先验对去除", "基于任务或先验去除", False),
    ("学术届", "学术界", False),
    ("触觉嗅觉", "触觉、嗅觉", False),
    ("加速度、陀螺仪", "加速度计、陀螺仪", False),
    ("加速度、磁力计", "加速度计、磁力计", False),
    ("人工智开始与机器人融合", "人工智能开始与机器人融合", False),
]


def normalize_text(text: str) -> str:
    """Apply deterministic typo, homoglyph, symbol, and punctuation hygiene."""
    out = text
    for pattern, replacement, is_regex in TYPO_RULES:
        if is_regex:
            out = re.sub(pattern, replacement, out)
        else:
            out = out.replace(pattern, replacement)

    # Whitespace and punctuation hygiene
    out = re.sub(r" {2,}", " ", out)
    out = re.sub(r"(?<!\d)\s*:\s*(?![/\d])", "：", out)
    out = re.sub(r"\s+([，。；：、！？）》”])", r"\1", out)
    out = re.sub(r"([（《“\(])\s+", r"\1", out)
    out = re.sub(r"\s+\)", ")", out)
    out = re.sub(r"([，；：、])\s+([\u4e00-\u9fffA-Za-z0-9])", r"\1\2", out)
    # Restore clean space after English comma or closing paren before ASCII letters
    out = re.sub(r",([A-Za-z])", r", \1", out)
    out = re.sub(r"\)(?=[A-Za-z])", ") ", out)
    return out.strip()


def join_line_pair(prev_text: str, prev_raw: str, curr_raw: str) -> str:
    """Join two wrapped PDF lines cleanly without spurious spaces inside CJK words."""
    a = prev_text.rstrip()
    b = curr_raw.lstrip()
    if not a:
        return b
    if not b:
        return a
    if a.endswith("-") and b[0].isascii() and b[0].isalnum():
        return a + b
    if ((a[-1].isascii() and a[-1].isalnum()) or a[-1] == ")") and b[0].isascii() and (b[0].isalnum() or b[0] == "("):
        return a + " " + b
    if a[-1].isascii() and a[-1].isalnum() and not b[0].isascii() and prev_raw.endswith(" "):
        return a + " " + b
    return a + b


def parse_pdf_sections(pdf_path: Path) -> tuple[str, list[dict[str, Any]]]:
    """Parse PDF via PyMuPDF get_text('dict') into title + raw chapters/sections/paragraphs."""
    doc = pymupdf.open(str(pdf_path))
    doc_title = "人工智能导论期末复习资料"
    chapters: list[dict[str, Any]] = []
    cur_ch: dict[str, Any] | None = None
    cur_sec: dict[str, Any] | None = None
    cur_para: dict[str, Any] | None = None
    prev_line: dict[str, Any] | None = None

    for pno in range(len(doc)):
        page_dict = doc[pno].get_text("dict")
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                raw = "".join(sp.get("text", "") for sp in spans)
                s = raw.strip()
                if not s:
                    continue

                x0 = round(float(line["bbox"][0]), 1)
                x1 = round(float(line["bbox"][2]), 1)
                max_sz = max(float(sp.get("size", 0.0)) for sp in spans)
                all_bold = all((int(sp.get("flags", 0)) & 16) or not sp.get("text", "").strip() for sp in spans)
                bold_spans = [
                    sp.get("text", "").strip()
                    for sp in spans
                    if (int(sp.get("flags", 0)) & 16) and sp.get("text", "").strip()
                ]
                info = {"pno": pno + 1, "x0": x0, "x1": x1, "raw": raw, "s": s}

                if max_sz >= 20.0:
                    doc_title = s
                    prev_line = None
                    continue

                ch_match = CH_RE.match(s)
                if ch_match and (max_sz >= 15.5 or x0 == 90.0):
                    ch_cn, ch_short = ch_match.group(1), ch_match.group(2).strip()
                    cur_ch = {
                        "id": len(chapters) + 1,
                        "cn": ch_cn,
                        "short": ch_short,
                        "title": f"第{ch_cn}章 {ch_short}",
                        "raw_title": s,
                        "sections": [],
                    }
                    chapters.append(cur_ch)
                    cur_sec = None
                    cur_para = None
                    prev_line = None
                    continue

                sec_match = SEC_RE.match(s)
                if sec_match and x0 == 90.0 and (max_sz >= 14.5 or all_bold):
                    assert cur_ch is not None, f"Section {s} found before any chapter"
                    sec_idx = len(cur_ch["sections"]) + 1
                    cur_sec = {
                        "id": f"ch{cur_ch['id']}.s{sec_idx}",
                        "chapterId": cur_ch["id"],
                        "raw_numeral": sec_match.group(1),
                        "raw_heading": s,
                        "heading_body": sec_match.group(2).strip(),
                        "paras": [],
                        "bold_spans": [],
                        "page_start": pno + 1,
                    }
                    cur_ch["sections"].append(cur_sec)
                    cur_para = None
                    prev_line = None
                    continue

                if cur_sec is None:
                    continue

                if bold_spans:
                    cur_sec["bold_spans"].extend(bold_spans)

                unclosed_paren = cur_para is not None and (
                    cur_para["text"].count("（") > cur_para["text"].count("）")
                    or cur_para["text"].count("(") > cur_para["text"].count(")")
                )

                is_new = False
                if cur_para is None:
                    is_new = True
                elif unclosed_paren:
                    is_new = False
                elif x0 > 95.0:
                    is_new = True
                elif ITEM_RE.match(raw):
                    is_new = True
                elif raw.startswith("  "):
                    is_new = True
                elif SOFT_BREAK_CUE_RE.match(s):
                    is_new = True
                elif prev_line is not None and prev_line["pno"] == pno + 1 and prev_line["x1"] < 475.0:
                    is_new = True

                # Handle wrapped attribute-graph line in ch3.s7 where λ belongs to
                # the 5-tuple bullet and Neo4j is a separate sub-bullet
                if (
                    cur_sec["id"] == "ch3.s7"
                    and s.startswith("节点边的类型")
                    and "流行的属性图数据库" in s
                    and cur_para is not None
                    and "节点的有限集合" in cur_para["text"]
                ):
                    idx = s.index("流行的属性图数据库")
                    part1 = s[:idx].strip()
                    part2 = s[idx:].strip()
                    cur_para["text"] = cur_para["text"].rstrip() + " " + part1
                    cur_para = {"x0": cur_para["x0"], "text": part2, "raw_last": raw, "pno": pno + 1}
                    cur_sec["paras"].append(cur_para)
                    prev_line = info
                    continue

                if is_new:
                    cur_para = {"x0": x0, "text": raw.strip(), "raw_last": raw, "pno": pno + 1}
                    cur_sec["paras"].append(cur_para)
                else:
                    if unclosed_paren and x0 > 95.0:
                        cur_para["text"] = cur_para["text"].rstrip() + "；" + raw.strip()
                    else:
                        cur_para["text"] = join_line_pair(cur_para["text"], cur_para["raw_last"], raw)
                    cur_para["raw_last"] = raw
                prev_line = info

    doc.close()
    return doc_title, chapters


def build_key_points(paras: list[dict[str, Any]]) -> list[str]:
    """Convert normalized section paragraphs into complete, hierarchical keyPoints without truncation."""
    norm_paras = [{"x0": p["x0"], "text": normalize_text(p["text"])} for p in paras if normalize_text(p["text"])]
    if not norm_paras:
        return []

    # Group top-level items (x0 < 110) with following indented children (x0 >= 110)
    # when the parent is a short label with a single child, merge cleanly;
    # when multiple children exist, preserve parent and prefix children with '↳ '.
    groups: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
    for p in norm_paras:
        if p["x0"] < 110.0 or not groups:
            groups.append((p, []))
        else:
            groups[-1][1].append(p)

    key_points: list[str] = []
    for parent, children in groups:
        ptxt = parent["text"]
        if not children:
            key_points.append(ptxt)
        elif (
            len(children) == 1
            and len(ptxt) <= 28
            and not ptxt.endswith("。")
            and not (("：" in ptxt or ":" in ptxt) and not ptxt.endswith(("：", ":")))
            and not children[0]["text"].startswith(("优点：", "缺点："))
        ):
            sep = "" if ptxt.endswith(("：", ":", "？", "?", "！", "!")) else "："
            key_points.append(f"{ptxt}{sep}{children[0]['text']}")
        else:
            key_points.append(ptxt)
            for ch in children:
                key_points.append(f"↳ {ch['text']}")
    return key_points


def extract_terms(key_points: list[str]) -> list[dict[str, str]]:
    """Extract clean term-definition pairs from normalized keyPoints."""
    terms: list[dict[str, str]] = []
    seen: set[str] = set()
    ch2_region_notes: dict[str, str] = {}
    has_individual_v2_v4 = any(kp.lstrip("↳ ").startswith(("V2：", "V3：", "V4：")) for kp in key_points)

    for idx, kp in enumerate(key_points):
        m = TERM_DEF_RE.match(kp)
        if not m:
            continue
        term = m.group(1).strip()
        definition = m.group(2).strip()
        if not term or not definition:
            continue

        # Normalize inverted Neo4j bullet into domain term -> description
        if term == "流行的属性图数据库" and definition == "Neo4j":
            term, definition = "Neo4j", "流行的属性图数据库"

        # Pair "专家系统" with its real definition on the following bullet instead of era tag
        if re.fullmatch(r"[A-Za-z\s]+\d{4}s?(?:[-–]\d{4}s?)?", definition):
            if idx + 1 < len(key_points):
                nxt = key_points[idx + 1].lstrip("↳ ").strip()
                if nxt.startswith(f"{term}=") or nxt.startswith(f"{term} =") or nxt.startswith(f"{term}是"):
                    definition = nxt
                else:
                    continue
            else:
                continue

        # Pair single ASCII-name definitions (e.g. "Cypher") with explanatory child bullet
        if (
            re.fullmatch(r"[A-Za-z][A-Za-z0-9\-]{1,20}", definition)
            and idx + 1 < len(key_points)
            and key_points[idx + 1].startswith("↳ ")
            and not TERM_DEF_RE.match(key_points[idx + 1])
        ):
            term = f"{definition}（{term}）"
            definition = key_points[idx + 1][2:].strip()

        # Reject bare acronyms (<= 4 chars, e.g. "SMT") and subheadings ("从小模型到大模型")
        if re.fullmatch(r"[A-Z0-9\-]{1,4}", definition):
            continue
        if re.fullmatch(r"从.+到.+", definition):
            continue

        # Reject commas outside parentheses in term
        term_outside_parens = re.sub(r"\([^()]*\)|（[^（）]*）", "", term)
        if "，" in term_outside_parens or "," in term_outside_parens:
            continue

        # Clean prefix like "深度学习存在问题--"
        if term.startswith("深度学习存在问题--"):
            term = term.split("--", 1)[1].strip()

        if term in GENERIC_TERM_LABELS:
            continue
        # Reject unmatched brackets (e.g. colons inside parenthetical enumerations)
        if (
            term.count("（") != term.count("）")
            or term.count("(") != term.count(")")
        ):
            continue
        # Reject chronological/step/clause headers rather than actual domain concepts
        if re.match(
            r"^(?:\d{4}\s*年|上世纪|第[一二三四五六七八九十百]+[步阶段层类次]|情况\s*\d+|"
            r"按|根据|针对|基于(?!于)|和|与|当前|如何|为什么|用户|系统|选定)",
            term,
        ):
            continue
        if re.search(
            r"(?:主要包括|可以分为|可分为|包括\s*2\s*大类|的区别|的发展|的过程|举例|案例|"
            r"的主要优势|的优势|的不足|的局限性|适用场景共性特点|社会风险)",
            term,
        ):
            continue
        if re.search(
            r"(?:应用|优点|缺点|任务|过程|方式|方法|包括|架构|作用|形式|组成|理论基础)$",
            term,
        ):
            continue
        # Reject non-definition narrative sentences
        if definition.startswith(("研究者陆续", "学者们")):
            continue
        if len(term) > 26 and "(" not in term and "（" not in term:
            continue
        if len(definition) < 3:
            continue

        # Deduplicate overlapping ch2.s3 visual cortex regions
        if has_individual_v2_v4:
            if term == "V1 区":
                ch2_region_notes["V1"] = definition
                continue
            if term == "V2-V4 区":
                continue
            if term == "IT 区":
                ch2_region_notes["IT(颞下皮层)"] = definition
                continue
            if term in ch2_region_notes and ch2_region_notes[term] not in definition:
                definition = f"{ch2_region_notes[term]}；{definition}"

        if term not in seen:
            seen.add(term)
            terms.append({"term": term, "definition": definition})
    return terms


# Grounded 1-2 sentence summaries per section (all derived strictly from PDF content)
SECTION_SUMMARIES: dict[str, str] = {
    "ch1.s1": "梳理 AI 孕育期（1943–1955）至 1956 年人工智能元年的关键里程碑，对比符号主义、连接主义与行为主义三大学派的核心思想及各自模拟出发点（软件/大脑硬件/身体）。",
    "ch1.s2": "概述 AI 四次发展浪潮（1956–1974、1980–1987、2011–、2022 生成式 AI）的代表人物与成果，并总结当前脆弱性、可解释性、因果推理等技术瓶颈与研究热点。",
    "ch1.s3": "归纳人工智能发展带来的六大社会与伦理风险：数据泄露、法律风险、隐私与安全问题、就业压力、社会文化冲击及国家安全挑战。",
    "ch2.s1": "阐述人类智能的生物与进化基础，包括脑化指数 EQ、“三重脑”理论、人类特有基因 ARHGAP11B 以及群体合作与共情对智能跃升的作用。",
    "ch2.s2": "从宏观（脑区、五叶、胼胝体与脑图谱）、介观（6 层约 2.5mm 灰质皮层与白质）和微观（神经元、突触、动作电位“1 或 0”）解析大脑结构，并说明功能分离/整合与大脑三大优势（含海马 LTP 长时程增强）。",
    "ch2.s3": "解析人类视觉信息从视网膜→LGN→V1–V4→IT/MT 的处理链路，总结 Hubel & Wiesel 感受野发现、腹侧 what/背侧 where 双通路，以及分布式并行、串行层级与网络化三大机制。",
    "ch3.s1": "说明知识工程的核心三环节（知识表示、知识获取、知识使用）及 1960s–1980s 专家系统的基本公式（专家系统 = 知识库 + 推理机）。",
    "ch3.s2": "介绍知识图谱作为三元组（triple）集合与关联数据（Linked Data）的结构，区分描述个体的实例层与描述概念的本体层。",
    "ch3.s3": "给出本体的定义（概念模型的明确规范），并系统列出基于集合论的描述逻辑概念表达式（∃r.C、∀r.C）与公理（C(a)、r(a, b)、A ⊑ B）。",
    "ch3.s4": "明确知识获取旨在提取实体、属性、关系、事件等要素以构建知识图谱，并说明结构化（如出演表）和半结构化数据（如 JSON）可通过映射规则转化。",
    "ch3.s5": "详解从非结构化文本构建知识图谱的四步流程（实体抽取、关系抽取、事件抽取、知识融合），对比规则、统计（HMM/CMM/MEM/CRF）、深度学习（CNN/RNN）及模板/监督/远程监督方法。",
    "ch3.s6": "概括基于大模型实现“非结构化数据→大模型→知识图谱”的跨模态知识获取范式，包括直接由图像获取三元组。",
    "ch3.s7": "定义知识管理与数据模型，重点介绍基于图论的属性图数据模型 G=(V, E) 及其五要素（V、E、ρ、σ、λ）与主流图数据库 Neo4j。",
    "ch3.s8": "介绍工业标准声明式属性图查询语言 Cypher（源自 Neo4j、借鉴 ASCII 艺术、基于子图匹配），以及三元组、链式基本图和图模式三种查询方式。",
    "ch3.s9": "回顾从 1950 年图灵测试到现代问答系统的演进，对比关键词搜索与语义搜索的差异，以及开放领域与封闭领域问答系统的覆盖面与准确率权衡。",
    "ch3.s10": "拆解基于知识的问答系统（KBQA）的在线问答流水线（问题理解→语义解析→查询生成执行→回复生成）与离线知识/模型构建流程，列举 IBM Watson 与 WolframAlpha。",
    "ch3.s11": "介绍大语言模型（LLM）概念及提示工程六要素（角色/指示/上下文/例子/输入/输出），重点解析思维链（CoT）推理策略与检索增强生成（RAG）外挂知识库机制。",
    "ch4.s1": "给出机器学习的定义（从有限观测数据学习一般规律以预测未知数据），并归纳其特征表示、模型学习、性能评估和模型优化四大核心步骤。",
    "ch4.s2": "按年代梳理机器学习发展史：50 年代简单算法（KNN、朴素贝叶斯、感知机）、80 年代神经网络（MLP、BP、CNN）、90 年代统计学习（SVM、决策树、Boosting/随机森林）至 21 世纪大模型。",
    "ch4.s3": "讲解监督学习的核心原理、训练集与测试集划分、数据集质量与模型选择原则，并区分预测离散值的分类任务（6 种传统方法）与预测连续值的回归任务（6 种方法）。",
    "ch4.s4": "阐述无监督学习与监督学习的根本区别（数据是否被标注），并详细对比聚类（K-Means/谱/层次/密度）、数据降维（解决维数灾难与可视化）与关联规则挖掘（Apriori 购物车分析）。",
    "ch4.s5": "剖析支持向量机（SVM）最大边距超平面、分类间隔与支持向量的几何概念，区分两类线性不可分情况的解法（噪声用软间隔、本质非线性用核函数）及算法优缺点。",
    "ch4.s6": "说明决策树的结构组成（属性节点、属性值边、类别叶节点）与构建流程，对比 ID3（信息增益）、C4.5（信息增益比）与 CART（基尼指数二叉树）及决策树优缺点。",
    "ch4.s7": "介绍集成学习思想，系统对比并行抽样聚合的 Bagging（Bootstrapping、等权重、投票/平均）与串行样本加权的 Boosting / AdaBoost（调整错分样本权重、加权表决）。",
    "ch4.s8": "详解 K-Means 划分聚类的核心思想、相似性度量与 5 步迭代算法流程，总结其对球状密集簇的高效性及对 K 值、初始值、噪声点和非凸簇的局限性。",
    "ch4.s9": "说明推荐算法通过分析用户行为与偏好提升留存率的目标，对比基于关联规则（共同购买物品集）与基于协同过滤（基于用户/基于物品）两类核心方法。",
    "ch4.s10": "概述深度学习作为表征学习神经网络分支的定位，总结其四大核心优势：特征学习能力、处理非线性关系能力、挖掘大规模数据能力及强泛化能力。",
    "ch4.s11": "归纳当前深度学习在固定任务与充分数据下的适用共性，重点分析模型过拟合（记住噪声导致泛化差）与内部机制可解释性差两大挑战。",
    "ch4.s12": "阐释人工智能大模型凭借海量参数与深层架构捕捉复杂细微模式的机制，指出其诞生是数据量、计算能力和算法共同演进的结果。",
    "ch5.s1": "定义计算机视觉使计算机“看见”并理解图像视频的目标（涵盖三维、动态与多模态），列出分类、检测、分割、生成、跟踪五大典型任务。",
    "ch5.s2": "解释基于 RGB 图像提取特征的任务建模输出形式（标签/坐标/深度/边框序列），并对比早期人工特征两阶段方法与深度学习自动特征学习的差异。",
    "ch5.s3": "剖析模仿视觉皮层感受野的卷积神经网络（CNN），拆解 LeNet-5 架构与卷积核、激活函数、池化、全连接层功能，以及端到端误差传递训练与优缺点。",
    "ch5.s4": "介绍面向序列数据的循环神经网络（RNN）及其记忆/遗忘更新训练机制，总结其捕捉长距离依赖的优势与需要监督标签、长序列易累积噪声的不足。",
    "ch5.s5": "讲解生成对抗网络（GAN）中生成器与判别器两阶段交替对抗博弈的机制，指出其无需标签生成多样化数据的优势及模式缺失（Mode Collapse）瓶颈。",
    "ch5.s6": "阐述强化学习（RL）智能体与环境交互最大化累积奖励的试错机制，界定五大要素（Agent/Environment/State/Action/Reward）及探索-利用困境与奖励工程挑战。",
    "ch5.s7": "解释传统视觉模型受限引发大模型需求的原因，汇总 SAM、DALL-E、Stable Diffusion 3、GPT-4o、盘古 CV、Midjourney v5 与 Sora 七大代表模型的核心能力。",
    "ch5.s8": "解析视觉大模型的底层原理：Transformer 并行自注意力编码器-解码器、ViT 图像分块（patch）序列化、CLIP 图文对比嵌入空间以及扩散模型加噪去噪生成。",
    "ch5.s9": "系统梳理视觉大模型低成本适配下游任务的微调迁移技术，涵盖 Prompt Tuning、参数冻结与逐层解冻、Adapters、LoRA 低秩适配、任务特定头与多任务微调。",
    "ch6.s1": "说明计算机听觉以语音信息处理为核心、区分元音/辅音音素，并解释语音为何采用频域分析（人耳频谱分析特性与时域卷积转频域乘积）及 DFT/IDFT 工具。",
    "ch6.s2": "区分语音分离三大任务（去噪/狭义增强、去混响、说话人分离/狭义分离）与广义语音增强公式，对比传统（VAD+噪声估计消除）与深度学习增强流程及 SNR、PESQ 指标。",
    "ch6.s3": "全面覆盖自动语音识别（ASR）分类体系、WER 指标、噪音通道/GMM-HMM/DNN-HMM 与端到端优缺点，并梳理文法/统计 N-gram/神经语言模型（NLM）及困惑度指标。",
    "ch6.s4": "介绍语音合成（TTS）的可懂度与自然度目标及 MOS 主观指标，详解统计参数语音合成（SPSS）四步流程（文本/韵律/声学/声码器）及其优点与高拟人化挑战。",
    "ch6.s5": "概括语音预训练大模型“能听、会言、善理解”及统一感知/认知/生成交互的范式跃迁，指出可控生成、多模态深度意图理解与低能耗三大挑战。",
    "ch7.s1": "定义自然语言处理（NLP）通过形式化计算模型分析、理解和生成语言的学科定位，区分终极目标（强 NLP）与当前可行目标（弱 NLP）。",
    "ch7.s2": "点明自然语言理解与处理面临的两大根本难点：语言歧义与语境灵活。",
    "ch7.s3": "明确自然语言处理领域的 CCF-A 类顶级国际学术会议为 ACL。",
    "ch7.s4": "列出自然语言理解的四层机理（语用、语义、句法、词法），并定义词法分析将字符序列转为词的三大任务：分词、词性标注与命名实体识别。",
    "ch7.s5": "阐释句法分析（短语结构、依存句法、深层文法）揭示句子排列结构的原理，以及在词汇、句子和篇章层级实现真实语义理解的语义分析任务。",
    "ch7.s6": "说明语用分析从上下文理解语言功能与结构的双视角（功能主义→可接受性；结构主义→信息性），并界定共指消解中的表述（mention）与实体（entity）。",
    "ch7.s7": "阐述统计语言模型的句子概率建模本质、统计机器翻译（SMT）的对齐与解码步骤、对话系统与自然语言生成（text-to-text/data-to-text）的典型任务。",
    "ch7.s8": "辨析信息检索（IR）、数据库与情报检索的区别，对比查询驱动的 IR 与答案驱动的问答系统（QA），并按应用场景与技术方案分类问答系统。",
    "ch7.s9": "概括深度学习 NLP 技术路线，对比手工特征提取与深度表示学习、符号表示与分布式表示，介绍 Bengio et al. (2003) 最早神经语言模型及其词表示副产品。",
    "ch7.s10": "追溯大语言模型的结构起源（Transformer）与预训练起源（BERT），从“涌现能力”及 Prompt 交互、在线 API、学界工业界趋同等方面对比大模型与小模型。",
    "ch8.s1": "定义类脑智能“机制类脑、行为类人”的目标，归纳人脑相较于机器的三大核心优势：高容错鲁棒性、高效率与低能耗。",
    "ch8.s2": "总结类脑智能四大典型进展（感知机、CNN、HMAX 模型、类脑强化学习与胶囊网络），并指出结构、功能、行为与机制四种大脑启发模拟方法。",
    "ch8.s3": "介绍融合生物与机器智能的脑机混合智能及脑机接口（BCI）双向通道，梳理传输方向、采集方式（非/半/侵入）、混合层次、混合方式与功能增强方式五大分类。",
    "ch8.s4": "指出脑机混合智能当前面临的三大局限：认知神经原理认识有限、脑机互适应学习可塑性差异，以及电子器件的生物相容性与排异问题。",
    "ch9.s1": "列举机器人的七大组成部件（大脑 CPU、机构、能源转换单元、执行器、传感器、通讯、人机界面），并对比固定底盘与移动底盘的适用场景及优缺点。",
    "ch9.s2": "解析液压机（帕斯卡原理与四大组件）、气压机（三类与优缺点）及四类常用电机（有刷直流、无刷直流、步进电机、伺服电机）的工作原理、精度与优缺点。",
    "ch9.s3": "系统划分机器人外部传感器（视觉 CCD/CMOS、红外、激光雷达四类、声音拾音与超声雷达）与内部传感器（编码器、陀螺仪四类、加速度计三类、磁力计）。",
    "ch9.s4": "回顾机器人发展五阶段简史：1956 Unimate、1978 PUMA、1980 工业机器人繁荣、上世纪末移动机器人兴盛及 2020 年 AI 与机器人融合。",
    "ch9.s5": "划分机器人的两大主要类型：工业机器人/机械臂（串联、并联）与服务机器人（个人/家庭服务机器人、专业服务机器人）。",
    "ch9.s6": "列出机器人七大核心技术与挑战：运动机理、材料与设计、能源与推进、感知导航与控制、极端环境操作、人机交互及学习技术。",
    "ch9.s7": "阐述机器人前沿两大方向：具备感知-交互-运动三层架构且以人形机器人为载体的具身智能，以及协调语言认知、行为与视觉三大计算空间的机器人大模型。",
}

SECTION_CALLOUTS: dict[str, str] = {
    "ch1.s1": "高频考点：1943 M-P 模型是连接主义起源；1945 年图灵提出 ACE（原讲义误印为“1915 年”，已校订）；1956 年为人工智能元年；三大学派模拟出发点分别是：符号主义=智能软件，连接主义=大脑硬件，行为主义=身体。",
    "ch1.s2": "易混提示：原讲义第四次浪潮提及“DeepMind 推出了 AlphaCode 设计全新蛋白质”——实际用于蛋白质结构预测/设计的是 AlphaFold（AlphaCode 用于代码生成），阅读与答题时注意辨析；研究热点“规则与统计方法融合”在原讲义中曾笔误作“系统方法”。",
    "ch2.s1": "重点记忆：人类约 200 万年前出现，并非靠基因进化解释聪明，而与脑化指数 EQ 最高、基因 ARHGAP11B 促进基底脑干细胞繁殖及群体合作共情密切相关。",
    "ch2.s2": "高频考点：大脑分五叶，左右大脑半球通过胼胝体传信；大脑皮层灰质约 2.5mm 厚、分 6 层；动作电位遵循“1 或 0”原则；海马的长时程增强作用（LTP）与长时记忆形成有关。",
    "ch2.s3": "必背对照：视觉双通路——腹侧 what 通路（物体识别，至 IT 颞下皮层） vs. 背侧 where 通路（空间视觉/运动，经 MT/V5）；三大机制为分布式并行、串行层级、网络化交互。",
    "ch3.s1": "核心公式：专家系统 = 知识库 + 推理机（1960s–1980s）；知识工程三大问题：知识表示、知识获取、知识使用。",
    "ch3.s2": "概念辨析：知识图谱的最小单元是三元组（triple）；Linked Data 属于关于个体的实例层，本体层则描述关于概念的规范。",
    "ch3.s3": "符号速记：描述逻辑概念表达式 ∃r.C（存在量词约束）与 ∀r.C（全称量词约束），公理 C(a)、r(a, b)、A ⊑ B（概念包含，子集关系）。",
    "ch3.s5": "流程与方法对照：非结构化文本构建知识图谱四步为实体抽取→关系抽取→事件抽取→知识融合；关系抽取分模板（成本高）、监督学习（6步、标注贵）和远程监督（免重度标注但易引入噪声）。",
    "ch3.s7": "属性图模型 G=(V, E) 五大符号必背：V=节点集合，E=边集合，ρ=边到节点的映射，σ=节点/边属性，λ=节点/边类型；流行图数据库为 Neo4j。",
    "ch3.s9": "对比要点：开放领域问答覆盖面广但准确率低；封闭领域问答覆盖面小但准确率高。语义搜索可直接给出实体关系与较准确答案。",
    "ch3.s10": "架构记忆：KBQA 在线部分链路为“用户问题→问题理解（实体识别、关系预测）→语义解析→查询语句生成和执行→回复生成→回复”。",
    "ch3.s11": "高频考点：提示词 6 要素（角色、指示、上下文、例子、输入、输出）；CoT（思维链）提升算术/常识/符号复杂推理；RAG（检索增强生成）外挂知识库，无需重训大模型，适合知识密集型任务。",
    "ch4.s2": "时间线易错点：感知机（1957 Rosenblatt）无法解决异或；MLP（1981 Werbos）解决异或；MLP+BP（1986）；CNN（1989 Yann LeCun）；SVM（1995）；ID3（1979/1986）、CART（1984）、C4.5（1993）；RF（2001）。",
    "ch4.s3": "核心区分：预测离散值是分类任务，预测连续值是回归任务；Galton 研究亲子身高关系提出了“回归”概念。",
    "ch4.s4": "本质区别：监督学习与无监督学习的根本区别在于“数据是否被标注”。降维主要解决维数灾难（存储量、计算量、准确率）并用于可视化。",
    "ch4.s5": "高频辨析：SVM 线性不可分的两种处理——本质线性但由噪声导致不可分时用“软间隔”；样本本质非线性可分时用“核函数”。增删非支持向量样本对模型无影响。",
    "ch4.s6": "必背指标对照：ID3 用信息增益（Quinlan 1979/1986）；C4.5 用信息增益比（Quinlan 1993）；CART 用基尼指数且每个节点严格只有两个分支（二叉树）。",
    "ch4.s7": "重难点对照：Bagging 可并行、有放回独立抽样、权重均等 1/K；Boosting（如 AdaBoost）只能串行、训练集不变仅调错分样本权重、按误差率加权表决。注：原讲义 Bagging 回归一条笔误作“最后分类结果”，已校订为“回归结果”。",
    "ch4.s8": "K-Means 考点：对密集且簇间区分明显的球状簇效果好、效率高；缺点是需预先确定 K 值、对初始值和噪声点敏感、非凸形簇效果差。",
    "ch5.s3": "结构要点：LeNet-5 含 2 个卷积层、2 个池化层、3 个全连接层；CNN 模拟了人脑视觉系统简单细胞和复杂细胞的特征提取功能；端到端训练关键在于误差信号的传递。",
    "ch5.s5": "必考缺陷：GAN 两阶段交替固定一方训练另一方，主要不足是模式缺失（Mode Collapse），即生成器退化导致总是生成相同或低质样本。",
    "ch5.s6": "五要素与难点：RL 五要素为智能体、环境、状态、动作、奖励；两大不足为“探索与利用的困境”和“奖励工程问题”。",
    "ch5.s8": "原理速记：Transformer 核心是自注意力机制；ViT 把图像切分为 patch 序列；CLIP 把图像与文本映射到同一嵌入空间；扩散模型通过逐步加噪与去噪生成数据。",
    "ch5.s9": "微调方法辨析：Prompt Tuning 不改模型参数只调输入提示；Adapters 在每层加小型适应层；LoRA 引入低秩矩阵微调且保留原模型参数。",
    "ch6.s2": "概念区分：语音去噪=狭义语音增强；移除加性噪声+移除混响（乘性噪声）=广义语音增强；多说话人分离=狭义语音分离。评价指标为 SNR 和 PESQ。",
    "ch6.s3": "评价指标全汇总：语音识别（ASR）用单词错误率 WER；语言模型用困惑度（Perplexity）。N-gram 存在长距离依赖问题，神经语言模型（NLM）可识别相似词并建模长距离依赖。",
    "ch6.s4": "TTS 要点：统计参数语音合成（SPSS）四模块为文本分析、韵律分析、声学模型、声码器；主要评价指标为 MOS 主观指标；挑战是高拟人化。",
    "ch7.s4": "层次与任务：语言理解四层为词法、句法、语义、语用；词法分析包括分词、词性标注、命名实体识别三项任务。",
    "ch7.s6": "流派对比与术语：功能主义（意图性、情景性→可接受性） vs. 结构主义（衔接性、连贯性→信息性）；共指和回指统称指代消解。",
    "ch7.s8": "对比记忆：信息检索（IR）是查询驱动、输入关键字、返回文档列表；问答系统（QA）是答案驱动、输入自然语言问题、直接返回精确答案。",
    "ch7.s10": "大模型特征：结构起源于 Transformer，预训练起源于 BERT；参数与数据过阈值后产生小模型不具备的“涌现”能力，且以 Prompt 和在线 API 为主要交互形式。",
    "ch8.s3": "五大分类维度：信号方向（脑→机/机→脑/双向）、采集方式（非/半/侵入）、混合层次（感知/认知/行为）、混合方式（增强/替代/补偿）、功能增强（感知/认知/行为）。",
    "ch9.s1": "考题口径提示：本节括号中曾将 GPS 与编码器/加速度计/陀螺仪并列写入“内部”，但 ch9.s3 与《综合题库》第 9 章单选题明确将内部传感器归为“编码器、陀螺仪、加速度计、磁力计”（不含 GPS，GPS 属外部定位传感器），答题请以 ch9.s3 分类为准。",
    "ch9.s2": "电机优缺点记忆：有刷控制简单但噪声大寿命短；无刷高效寿命长但成本高；步进精度高易控制但低速性能差易发热；伺服响应快功率广但成本高易发热噪声偏大。",
    "ch9.s3": "高频考点：外部传感器=视觉(CCD/CMOS)、红外、激光雷达、声音(麦克风/超声雷达)；内部传感器=编码器、陀螺仪、加速度计、磁力计。",
    "ch9.s4": "编号说明：原复习资料在“三、机器人传感器”之后跳过“四、”，后续四节依次写作“五、”至“八、”；本手册按连续顺序重新编号为“四、”至“七、”（ch9.s4–ch9.s7）。",
}


def build_section_tables() -> dict[str, list[dict[str, Any]]]:
    """Return strictly PDF-grounded structured comparison tables mapped by section ID."""
    return {
        "ch1.s1": [
            {
                "caption": "人工智能三大学派对比",
                "headers": ["学派", "别名", "代表人物 / 里程碑", "核心思想", "模拟出发点"],
                "rows": [
                    ["符号主义", "逻辑主义、心理学派、计算机学派", "纽厄尔与西蒙（司马贺）、1955 逻辑理论机、1957 GPS、物理符号系统假说", "以符号表示知识并进行逻辑推理，重要成果为专家系统", "模拟智能软件"],
                    ["连接主义", "—", "1943 年麦卡洛克-皮茨（M-P）神经元模型", "认为人的智能源于人的神经网络", "模拟大脑硬件"],
                    ["行为主义", "进化主义、控制论学派", "控制论基础与智能控制系统", "基于感知与行动，在与环境交互中学习并优化行为", "模拟身体"],
                ],
            }
        ],
        "ch1.s2": [
            {
                "caption": "人工智能四次发展浪潮",
                "headers": ["浪潮阶段", "时间", "代表人物 / 机构", "标志性成果与特点"],
                "rows": [
                    ["第一次浪潮", "1956–1974", "马文·明斯基、约翰·麦卡锡", "推动计算机视觉和自然语言理解研究"],
                    ["第二次浪潮", "1980–1987", "爱德华·费根鲍姆；约翰·霍普菲尔德", "知识工程与第一个专家系统 DENDRAL；1982 年 Hopfield 神经网络（循环递归、模拟记忆）"],
                    ["第三次浪潮", "2011–", "谷歌（Google）DeepMind", "深度学习驱动；2016 年 AlphaGo 战胜围棋世界冠军李世石"],
                    ["第四次浪潮", "2022", "OpenAI、DeepMind 等", "生成式 AI 入选《科学》十大突破（《太空歌剧院》）、DALL-E2、ChatGPT、蛋白设计应用"],
                ],
            }
        ],
        "ch2.s2": [
            {
                "caption": "常见脑图谱汇总",
                "headers": ["脑图谱名称", "英文全称 / 缩写"],
                "rows": [
                    ["布罗德曼脑图谱", "Brodmann"],
                    ["自动解剖标记", "Automated Anatomical Labeling, AAL"],
                    ["脑网络组图谱", "Human Brainnetome Atlas, HBA"],
                    ["多模态脑图谱", "Multi-Modal Atlas, MMA360"],
                ],
            },
            {
                "caption": "大脑多尺度结构与组织特性",
                "headers": ["尺度 / 维度", "核心组成与特征"],
                "rows": [
                    ["宏观层面", "由大脑、间脑、小脑、脑干组成；大脑分五叶，左右大脑半球占重 60%、体积占中枢神经系统 1/3，通过胼胝体传信；皮层约 1410 亿神经细胞、面积约 2200cm²"],
                    ["介观层面", "大脑皮层为深色灰质（厚约 2.5mm），灵长类分 6 层结构（各层神经元类型与功能不同），皮层下为白质"],
                    ["微观层面", "上千亿神经细胞（胞体、树突接收、轴突发送、髓鞘包裹）和神经胶质细胞；动作电位遵循“1 或 0”原则"],
                    ["组织特性与优势", "功能分离 + 功能整合；低能耗高效率、自我学习能力（神经可塑性 / 海马长时程增强作用）、大规模并行处理能力"],
                ],
            },
        ],
        "ch2.s3": [
            {
                "caption": "视皮层功能特异性区域",
                "headers": ["皮层区域", "主要功能"],
                "rows": [
                    ["V1（初级视皮层）", "朝向、纹理（简单/复杂/超复杂细胞检测线条与轮廓）"],
                    ["V2", "组合特征"],
                    ["V3", "视觉信息传递"],
                    ["V4", "复杂图案"],
                    ["IT（颞下皮层）", "面孔、物体识别"],
                    ["MT（中颞区，V5）", "运动知觉"],
                ],
            },
            {
                "caption": "视觉信息处理双通路对比",
                "headers": ["通路", "功能定位", "处理信息内容"],
                "rows": [
                    ["腹侧 what 通路", "物体识别", "处理视觉目标识别信息"],
                    ["背侧 where 通路", "空间视觉", "处理视觉空间运动信息"],
                ],
            },
        ],
        "ch3.s2": [
            {
                "caption": "知识图谱两层结构对比",
                "headers": ["层次", "描述对象", "典型概念与特征"],
                "rows": [
                    ["实例层", "关于个体", "三元组集合形成关联数据（Linked Data），是关于实例的知识图谱"],
                    ["本体层", "关于概念", "概念模型的明确规范，定义类、属性与概念间约束"],
                ],
            }
        ],
        "ch3.s3": [
            {
                "caption": "描述逻辑（DL）概念表达式与公理速查",
                "headers": ["表达式 / 公理", "类别", "名称", "语义说明"],
                "rows": [
                    ["∃r.C", "概念表达式", "存在关系约束", "至少与某个实例存在 r 关系，且该实例属于概念 C"],
                    ["∀r.C", "概念表达式", "全称关系约束", "只要与某个实例有 r 关系，则该实例一定属于概念 C"],
                    ["C(a)", "公理", "概念的成员", "表示实例 a 属于概念 C"],
                    ["r(a, b)", "公理", "关系的成员", "表示实例对 (a, b) 具有 r 关系"],
                    ["A ⊑ B", "公理", "概念包含", "表示概念 A 为概念 B 的子集"],
                ],
            }
        ],
        "ch3.s5": [
            {
                "caption": "非结构化数据实体抽取方法对比",
                "headers": ["方法类别", "核心原理 / 代表模型", "主要缺点 / 特点"],
                "rows": [
                    ["基于规则", "人工编写规则与文本字符串匹配", "规则集构造费时费力、可移植性差"],
                    ["基于统计模型", "利用标注语料做序列标注：HMM、CMM、MEM、CRF", "依赖标注语料与特征工程"],
                    ["基于深度学习", "以词向量为输入，CNN、RNN 等实现端到端抽取", "不再依赖人工定义特征"],
                ],
            },
            {
                "caption": "非结构化数据关系抽取方法对比",
                "headers": ["方法类别", "实现方式", "优点", "缺点"],
                "rows": [
                    ["基于模板", "人工构造关系匹配模板", "构建过程简单", "人工成本高、可维护性差、灵活性差"],
                    ["基于监督学习", "预定义关系→标注数据→设计特征→选分类模型→训练→评估", "比模板方法灵活", "标注成本高"],
                    ["基于弱监督学习（远程监督）", "将外部知识图谱与非结构化文本对齐自动构建训练数据", "减少对人工标注数据的依赖", "会引入噪声训练数据"],
                ],
            },
        ],
        "ch3.s7": [
            {
                "caption": "属性图数据模型 G=(V, E) 要素",
                "headers": ["符号", "含义"],
                "rows": [
                    ["V", "节点的有限集合（节点表示实体）"],
                    ["E", "边的有限集合（边表示实体间的联系）"],
                    ["ρ", "边关联到节点的映射"],
                    ["σ", "节点 / 边的属性"],
                    ["λ", "节点 / 边的类型"],
                ],
            }
        ],
        "ch3.s9": [
            {
                "caption": "搜索引擎与问答系统分类对比",
                "headers": ["类型", "机制 / 依据", "特点（覆盖面与准确率）"],
                "rows": [
                    ["关键词搜索", "匹配用户输入的关键词", "返回匹配的文档列表"],
                    ["语义搜索", "基于实体及关系进行搜索", "直接提供较为准确的答案"],
                    ["开放领域问答系统", "基于开放知识库回答任意问题", "覆盖面广，准确率低"],
                    ["封闭领域问答系统", "回答与选定领域相关的问题", "覆盖面小，准确率高"],
                ],
            }
        ],
        "ch3.s11": [
            {
                "caption": "大模型提示词六要素",
                "headers": ["要素", "作用说明"],
                "rows": [
                    ["角色", "设定模型扮演的专业角色"],
                    ["指示", "明确具体任务描述"],
                    ["上下文", "提供任务所需的背景信息"],
                    ["例子", "给出示范学习的输入输出样例"],
                    ["输入", "待处理的实际数据输入"],
                    ["输出", "约束期望返回的结果格式"],
                ],
            },
            {
                "caption": "思维链（CoT）与检索增强生成（RAG）对比",
                "headers": ["技术", "核心机制", "适用场景与优势"],
                "rows": [
                    ["思维链（CoT）", "改进提示策略，引导模型逐步展示推理过程", "提升算术推理、常识推理和符号推理等复杂推理性能"],
                    ["检索增强生成（RAG）", "先从大量文档检索相关信息，再基于检索信息生成回答", "无需为特定任务重训大模型，只需外挂知识库，尤其适合知识密集型任务"],
                ],
            },
        ],
        "ch4.s2": [
            {
                "caption": "机器学习发展史四阶段代表模型",
                "headers": ["时期 / 阶段", "代表算法 / 模型", "年份与提出者", "核心特点与历史意义"],
                "rows": [
                    ["20 世纪 50 年代（简单算法）", "K 近邻（KNN）", "1967，Cover & Hart", "依据相邻 k 个样本类别决定测试样本类别"],
                    ["20 世纪 50 年代（简单算法）", "朴素贝叶斯", "1958，Lewis", "基于贝叶斯定理与特征条件独立，广泛用于文本分类等"],
                    ["20 世纪 50 年代（简单算法）", "感知机", "1957，Rosenblatt", "线性分类器，无法解决异或等非线性问题导致神经网络陷入低潮"],
                    ["20 世纪 80 年代（神经网络）", "多层感知机（MLP）", "1981，Werbos", "解决了异或问题"],
                    ["20 世纪 80 年代（神经网络）", "MLP + BP 训练", "1986，Rumelhart, McClelland, Hinton 等", "提出多层感知机与反向传播结合的理念"],
                    ["20 世纪 80 年代（神经网络）", "卷积神经网络（CNN）", "1989，Yann LeCun", "提出卷积神经网络计算模型"],
                    ["20 世纪 90 年代（统计学习）", "支持向量机（SVM）", "1995，Cortes & Vapnik", "决策边界为最大边距超平面"],
                    ["20 世纪 90 年代（统计学习）", "决策树（ID3 / CART / C4.5）", "1979/1986 Quinlan; 1984 Breiman; 1993 Quinlan", "通过树形结构表示决策并归纳分类规则"],
                    ["20 世纪 90 年代（统计学习）", "Boosting / 随机森林（RF）", "1990 Schapire; 2001 Breiman & Cutler", "弱学习器提升为强学习器；RF 在理论上证明抗过拟合"],
                    ["21 世纪（深度学习）", "大模型", "21 世纪", "大规模参数与复杂计算结构，成为 AI 重要突破"],
                ],
            }
        ],
        "ch4.s3": [
            {
                "caption": "监督学习分类任务与回归任务对比",
                "headers": ["任务类型", "预测输出类型", "典型方法 / 子类"],
                "rows": [
                    ["分类任务", "离散值（二分类 / 多分类）", "贝叶斯算法、支持向量机、K-近邻算法、逻辑回归、决策树、随机森林"],
                    ["回归任务", "连续值（源于 Galton 身高关系研究）", "一元线性回归、岭回归、多元线性回归、lasso 回归、多项式回归、深度回归"],
                ],
            }
        ],
        "ch4.s4": [
            {
                "caption": "无监督学习三大典型任务对比",
                "headers": ["任务类型", "核心目标", "代表算法 / 应用"],
                "rows": [
                    ["聚类（Clustering）", "将相似数据点分组为簇，追求簇内高相似、簇间低相似", "k-Means、谱聚类、层次聚类、密度聚类；图像压缩、客户分组、异常检测"],
                    ["数据降维", "在尽量保持原始数据完整性下减少属性维数，缓解维数灾难", "主成分分析（PCA）；数据可视化、降低存储与计算量"],
                    ["关联规则挖掘", "发现交易数据中不同项目之间的关联关系与内在规律", "Apriori 算法；购物车分析、推荐算法"],
                ],
            }
        ],
        "ch4.s5": [
            {
                "caption": "SVM 线性不可分场景处理策略",
                "headers": ["线性不可分原因", "解决方法", "说明"],
                "rows": [
                    ["情况 1：本质线性，非线性由噪声导致", "软间隔", "允许少量样本违背间隔约束以抵抗噪声"],
                    ["情况 2：样本本质上非线性可分", "核函数", "将样本映射到高维特征空间使其线性可分（合适核函数选择较困难）"],
                ],
            }
        ],
        "ch4.s6": [
            {
                "caption": "三大经典决策树算法对比",
                "headers": ["算法", "提出时间与作者", "属性选择度量", "树结构与特点"],
                "rows": [
                    ["ID3", "1979 / 1986，Quinlan", "信息增益", "多叉树，归纳分类规则"],
                    ["C4.5", "1993，Quinlan", "信息增益比", "在 ID3 基础上进一步发展改进"],
                    ["CART", "1984，Breiman", "基尼指数", "每个树节点只有两个分支（正例与反例，二叉树）"],
                ],
            }
        ],
        "ch4.s7": [
            {
                "caption": "集成学习 Bagging 与 Boosting 对比",
                "headers": ["对比维度", "Bagging（如随机森林）", "Boosting（如 AdaBoost）"],
                "rows": [
                    ["训练样本集", "从原始集可放回随机抽样（Bootstrapping），K 组训练集相互独立", "每一次迭代的训练集不变，仅调整样本权重（提高错分样本权重）"],
                    ["预测函数权重", "K 组学习器的权重相等，均为 1/K", "按性能分配权重：分类误差率小权重大，误差率大权重小"],
                    ["并行计算与依赖", "基学习器相互独立，可并行生成", "基学习器之间有依赖关系，只能串行顺序生成"],
                    ["结果组合方式", "分类任务对 T 个模型投票；回归任务对 T 个模型求平均", "AdaBoost 采用加权多数表决"],
                ],
            }
        ],
        "ch4.s9": [
            {
                "caption": "推荐算法两类主流方法对比",
                "headers": ["方法类别", "核心依据", "主要机制与分支"],
                "rows": [
                    ["基于关联规则", "同时被很多用户购买的物品集合", "挖掘关联规则，集合内物品相互推荐"],
                    ["基于协同过滤", "用户行为数据（浏览记录、购买记录、评分等）", "分为基于用户的协同过滤和基于物品的协同过滤"],
                ],
            }
        ],
        "ch5.s2": [
            {
                "caption": "计算机视觉任务建模输出与方法对比",
                "headers": ["维度", "类别 / 任务", "输出或方法特征"],
                "rows": [
                    ["任务建模", "分类、识别", "输出是标签"],
                    ["任务建模", "检测和定位", "输出是物体位置坐标"],
                    ["任务建模", "深度信息计算", "输出是像素到摄像头距离"],
                    ["任务建模", "跟踪", "输出是边框序列"],
                    ["技术路线", "传统方法", "人工设计特征提取 + 分类两阶段"],
                    ["技术路线", "深度学习方法", "通过多层神经网络自动学习特征和分类器，学习与泛化能力更强"],
                ],
            }
        ],
        "ch5.s7": [
            {
                "caption": "典型计算机视觉大模型能力对照",
                "headers": ["模型名称", "主要定位与核心能力"],
                "rows": [
                    ["Segment Anything Model (SAM)", "对多样化图像中的任意物体进行精准分割"],
                    ["DALL-E", "理解自然语言描述并生成相应图片"],
                    ["Stable Diffusion 3", "采用扩散 Transformer 架构，支持多主题提示生成、强文字渲染、图像修复与局部编辑"],
                    ["GPT-4o", "支持文本、音频、图像任意组合输入输出的多模态大模型"],
                    ["盘古 CV 大模型", "基于海量图像/视频构建的视觉基础模型，少量数据微调即可适配特定场景"],
                    ["Midjourney v5", "基于 CLIP 的创意艺术 AI 绘图工具，支持多种滤镜自定义"],
                    ["Sora", "根据简单文本描述生成高达 60 秒的高质量视频"],
                ],
            }
        ],
        "ch5.s8": [
            {
                "caption": "视觉大模型四大核心架构与原理",
                "headers": ["架构 / 模型", "核心机制", "主要作用与应用"],
                "rows": [
                    ["Transformer", "编码器-解码器结构 + 自注意力机制，无循环/卷积", "并行处理序列数据并捕捉远距离依赖，提升速度与性能"],
                    ["Vision Transformer (ViT)", "将图像切分为固定大小 patch 序列输入标准 Transformer", "通过位置相关性权重捕捉图像远距离依赖"],
                    ["CLIP", "同时训练图像编码器与文本编码器", "将图像与文本描述映射到相同嵌入空间实现多模态对齐"],
                    ["扩散模型（Diffusion Model）", "模拟逐步噪声注入和去噪过程", "生成高质量数据，为 DALL-E、Sora 等模型基础"],
                ],
            }
        ],
        "ch5.s9": [
            {
                "caption": "视觉大模型微调迁移方法对比",
                "headers": ["微调方法", "参数调整机制", "核心特点"],
                "rows": [
                    ["Prompt Tuning", "不直接调整模型参数，仅调整输入提示（Prompt）", "通过提示语引导预训练模型输出"],
                    ["冻结大部分参数", "只微调模型少数层或特定子模块", "大幅降低训练开销"],
                    ["逐层解冻", "逐步解冻模型网络层，逐层进行微调", "渐进式适配下游任务"],
                    ["Adapters", "在每层添加小型适应层，仅训练新增模块参数", "保持原模型参数不变"],
                    ["LoRA", "引入低秩矩阵来调整模型参数", "保留原始模型同时高效微调"],
                    ["Task-Specific Heads", "添加分类/回归等特定输出层并只微调新增层", "直接复用预训练特征提取能力"],
                    ["Multi-Task Fine-Tuning", "在多个相关任务上同时联合微调", "共享任务间知识，提升整体性能"],
                ],
            }
        ],
        "ch6.s2": [
            {
                "caption": "语音分离分类与语音增强方法对比",
                "headers": ["维度 / 方法", "分类 / 流程步骤", "特点与评价指标"],
                "rows": [
                    ["语音分离三类", "语音去噪（狭义语音增强）、语音去混响、说话人分离（狭义语音分离）", "广义语音增强 = 移除加性噪声 + 移除混响（乘性噪声）"],
                    ["传统信号处理增强", "静音检测（VAD）→ 噪声估计模块 → 噪声消除", "算法简单、计算量小，但效果不佳"],
                    ["深度学习语音增强", "训练阶段（大数据训练参数）+ 增强阶段（模型增强）", "性能佳，但计算量大、容易过拟合"],
                    ["主要评价指标", "信噪比（SNR）、感知语音质量评估（PESQ）", "衡量语音清晰度与机器识别前处理效果"],
                ],
            }
        ],
        "ch6.s3": [
            {
                "caption": "语音识别分类与模型对比",
                "headers": ["模块 / 维度", "具体分类或模型", "核心特点与评价指标"],
                "rows": [
                    ["ASR 按发音方式", "孤立词识别 vs. 连续语音识别", "单个词语 vs. 连续句子/段落"],
                    ["ASR 按说话人", "特定说话人 vs. 非特定说话人", "固定某人 vs. 任意人"],
                    ["传统与统计声学模型", "噪音通道模型、GMM-HMM、DNN-HMM", "结合词典与语言模型；评价指标为 WER（单词错误率）"],
                    ["端到端语音识别", "Encoder-Decoder 等直接映射架构", "不需词典和 HMM、可联合优化，但长序列对编码器压力大且难充分利用文本"],
                    ["语言模型三类", "基于文法 / 基于统计（N-gram） / 神经语言模型（NLM：RNN、Transformer）", "评价指标为困惑度（Perplexity）；NLM 克服 N-gram 长距离依赖缺陷"],
                ],
            }
        ],
        "ch7.s4": [
            {
                "caption": "自然语言理解四层机理",
                "headers": ["层次", "核心对象与任务"],
                "rows": [
                    ["词法分析", "将字符序列转化为词，包括分词、词性标注、命名实体识别"],
                    ["句法分析", "分析句子成分与排列结构，包括短语结构、依存句法、深层文法句法分析"],
                    ["语义分析", "理解语言单位真实语义，分句子级语义分析与篇章级语义分析"],
                    ["语用分析", "从上下文理解衔接性、连贯性、意图性、情境性，以及指代/共指消解"],
                ],
            }
        ],
        "ch7.s8": [
            {
                "caption": "信息检索（IR）与问答系统（QA）对比",
                "headers": ["对比维度", "信息检索（IR）", "问答系统（QA）"],
                "rows": [
                    ["驱动方式", "查询驱动", "答案驱动"],
                    ["用户输入", "关键字", "自然语言问题"],
                    ["系统输出", "一系列相关文档（需用户自行从中查找答案）", "直接返回精确答案（如珠穆朗玛峰 8848 米）"],
                    ["与数据库对比", "面向非结构化文档集，结果往往不精确（数据库查结构化数据 100% 精确）", "满足更复杂信息需求，支持事实验证与推理"],
                ],
            }
        ],
        "ch8.s3": [
            {
                "caption": "脑机接口与脑机混合智能分类维度",
                "headers": ["分类维度", "具体类型"],
                "rows": [
                    ["按信号传输方向", "脑→机、机→脑、脑↔机"],
                    ["按信号采集方式", "非侵入、半侵入、侵入"],
                    ["混合形态层次", "感知层、认知层、行为层"],
                    ["智能混合方式", "增强型、替代型、补偿型"],
                    ["功能增强方式", "感知增强、认知增强、行为增强"],
                ],
            }
        ],
        "ch9.s2": [
            {
                "caption": "机器人常用执行器对比",
                "headers": ["执行器", "原理 / 分类", "优点", "缺点"],
                "rows": [
                    ["液压机", "帕斯卡原理（液压泵、控制阀、执行元件、辅件）", "输出力大（液压传动）", "需成套液压辅助管路元件"],
                    ["气压机", "离心式、轴流式、螺杆式（压缩空气动力）", "成本低、反应快、装置简单", "稳定性稍差、总输出压力小"],
                    ["有刷直流电机", "直流电机", "控制和结构简单", "噪声大、寿命短、不适用于高速场合"],
                    ["无刷直流电机", "直流电机", "效率高、寿命长、噪声低", "成本高、尺寸偏大、控制复杂"],
                    ["步进电机", "电脉冲信号变换成角位移控制转子", "精度高、噪音低、易于控制、可靠性好", "低速性能差、价格偏高、控制较复杂、易发热"],
                    ["伺服电机", "直流和交流两大类（伺服系统补助马达间接变速）", "精度高、响应快、控制灵活、可靠性好、功率范围广", "成本高、易发热、低速性能较差、噪声偏大"],
                ],
            }
        ],
        "ch9.s3": [
            {
                "caption": "机器人外部传感器与内部传感器对比",
                "headers": ["大类", "传感器类型", "原理 / 子类与用途"],
                "rows": [
                    ["外部传感器", "视觉传感器", "CCD（电荷逐行传送底端边缘放大） vs. CMOS（每像素邻接放大器及 ADC 内存式输出）"],
                    ["外部传感器", "红外传感器", "热释电红外传感器、反射式红外传感器、红外测距系统"],
                    ["外部传感器", "激光雷达", "机械旋转型、相控阵型、Flash 型、MEMS 型"],
                    ["外部传感器", "声音传感器", "麦克风拾音（人机交互）与超声测距传感器/超声雷达（避障）"],
                    ["内部传感器", "编码器", "基于两对光电收发元件输出相对信号"],
                    ["内部传感器", "陀螺仪", "测量旋转角速度（惯性传感器）：机械、光学、半球谐振、MEMS 陀螺"],
                    ["内部传感器", "加速度计", "基于牛顿第二定律测量加速力：电容式、压电式、压阻式"],
                    ["内部传感器", "磁力计", "内部姿态/航向传感"],
                ],
            }
        ],
    }


CHAPTER_OVERVIEWS: dict[int, str] = {
    1: "介绍人工智能的孕育与诞生历程（1943–1956）、符号主义/连接主义/行为主义三大学派、四次发展浪潮、核心技术瓶颈与社会伦理风险。",
    2: "从进化论、脑化指数与基因揭示人类智能起源，解析大脑宏观/介观/微观结构与神经可塑性，并深入视皮层感受野与视觉双通路信息处理机制。",
    3: "涵盖知识工程与专家系统、知识图谱三元组与本体（描述逻辑）、非结构化/大模型知识获取、属性图模型与 Cypher 查询，以及 KBQA 与 LLM（提示工程/CoT/RAG）问答。",
    4: "系统梳理机器学习概念与四阶段发展史，覆盖监督学习（分类/回归）、无监督学习（聚类/降维/关联规则）、SVM、决策树、集成学习、K-Means、推荐算法与深度学习大模型挑战。",
    5: "讲解计算机视觉基础与任务建模，剖析 CNN、RNN、GAN、强化学习经典模型原理与不足，以及 SAM/DALL-E/SD3/GPT-4o/Sora、Transformer/ViT/CLIP/Diffusion 和 PEFT/LoRA 微调技术。",
    6: "围绕语音信息处理，阐述音素与频域分析（DFT/IDFT）、语音分离与增强（SNR/PESQ）、语音识别与语言模型（WER/Perplexity/NLM）、语音合成（SPSS/MOS）及语音大模型。",
    7: "探讨自然语言处理的强/弱目标与难点（歧义、语境），深入词法、句法、语义、语用四层理解机制与共指消解，以及语言生成、IR vs. QA、文本表示和大语言模型涌现特性。",
    8: "介绍机制类脑、行为类人的类脑智能优势与四种模拟启发方法，以及融合生物与机器智能的脑机接口（BCI）分类体系与三大局限性。",
    9: "全面介绍机器人七大组成与底盘类型、液压/气压/电机执行器对比、内外传感器分类（CCD/CMOS、激光雷达、陀螺仪等）、发展简史、主要类型、核心技术与具身智能趋势。",
}


def build_overview() -> dict[str, Any]:
    """Return grounded top-level review overview matching NotesData.overview."""
    return {
        "title": "全书复习导览与考前速览",
        "bullets": [
            "覆盖全部 9 章、64 个核心知识点小节：第1章 人工智能概述（3节）、第2章 人类智能（3节）、第3章 知识工程与知识图谱（11节）、第4章 机器学习（12节）、第5章 计算机视觉（9节）、第6章 计算机听觉（5节）、第7章 自然语言处理（10节）、第8章 类脑智能与脑机混合智能（4节）、第9章 机器人（7节）。",
            "主线脉络：AI 发展史与三大学派 → 脑科学与视觉双通路机理 → 符号与知识图谱（本体/描述逻辑/KBQA/RAG）→ 传统机器学习与集成/聚类 → 深度学习与视觉/语音/NLP 大模型 → 类脑与脑机融合 → 机器人硬件、传感与具身智能。",
            "已对原复习资料中的 Word 导出错别字与退化符号进行系统校订（如 1945 年图灵 ACE、胼胝体、腹侧 what/背侧 where 通路、描述逻辑 ∃r.C / ∀r.C / A ⊑ B、属性图 ρ/σ/λ、ID3/C4.5/CART 等），并在重点小节补充考题口径辨析。",
        ],
        "examTips": [
            "学派与里程碑辨析：熟记 1943 M-P 模型（连接主义起源）、1945 图灵 ACE、1950《计算机器与智能》（图灵测试）、1955 逻辑理论机（符号主义）、1956 人工智能元年、1957 感知机（无法解决异或）及三大学派模拟出发点（软件/硬件/身体）。",
            "易混指标与算法度量：决策树（ID3 信息增益 / C4.5 信息增益比 / CART 基尼指数二叉）、语音增强（SNR / PESQ）、语音识别（WER）、语言模型（Perplexity 困惑度）、语音合成（MOS 主观指标）。",
            "传感器内外分类（高频考点）：内部传感器感知自身状态（编码器、陀螺仪、加速度计、磁力计）；外部传感器感知环境（视觉 CCD/CMOS、红外、激光雷达、声音传感器/超声雷达）。注意第9章第1节曾把 GPS 误列于括号内，答题以第3节标准为准。",
            "简答/分析题作答技巧：分点作答（“定义 + 原理/流程 + 优缺点 + 代表模型/应用”），优先写出加粗核心关键词（如“功能分离与功能整合”“自注意力机制”“模式缺失”“探索与利用困境”）。",
        ],
    }


def build_appendices() -> list[dict[str, Any]]:
    """Return all 4 structured appendices strictly grounded in the 48-page PDF."""
    return [
        {
            "id": "app-timeline",
            "title": "时间线与代表人物速记表",
            "type": "timeline_figures",
            "tables": [
                {
                    "caption": "关键历史时间线速记",
                    "headers": ["时间", "事件 / 里程碑", "人物 / 机构", "所属章节"],
                    "rows": [
                        ["约 200 万年前", "人类出现（脑化指数 EQ 在所有动物中比例最高）", "—", "第 2 章"],
                        ["1943 年", "提出麦卡洛克-皮茨（M-P）神经元模型，连接主义起源（1943–1955 为 AI 孕育期）", "McCulloch & Pitts", "第 1 章"],
                        ["1945 年", "提出自动计算引擎（ACE），模拟大脑工作", "艾伦·图灵 (Alan Turing)", "第 1 章"],
                        ["1950 年 10 月", "在《Mind》发表《计算机器与智能》（机器能思考吗），提出图灵测试", "艾伦·图灵", "第 1、3 章"],
                        ["1955 年", "设计出逻辑理论机（Logic Theorist），开创符号主义学派（物理符号系统假说）", "阿兰·纽厄尔 & 西蒙（司马贺）", "第 1 章"],
                        ["1956 年", "人工智能元年；同年第一台工业机器人 Unimate 诞生", "—", "第 1、9 章"],
                        ["1956–1974 年", "第一次 AI 浪潮（推动计算机视觉与自然语言理解研究）", "马文·明斯基、约翰·麦卡锡", "第 1 章"],
                        ["1957 年", "通用问题求解器（GPS）；设计感知机（Perceptron，无法解决异或）", "纽厄尔/西蒙；Rosenblatt", "第 1、4 章"],
                        ["1958 年", "提出朴素贝叶斯算法；研究初级视皮层 V1 简单/复杂/超复杂细胞感受野", "Lewis；Hubel & Wiesel", "第 2、4 章"],
                        ["1967 年", "提出 k 近邻算法（KNN）", "Cover & Hart", "第 4 章"],
                        ["1978 年", "面向汽车生产线的工业机器人 PUMA 出现", "—", "第 9 章"],
                        ["1979 / 1986 年", "提出 ID3 决策树算法（信息增益）", "Quinlan", "第 4 章"],
                        ["1980–1987 年", "第二次 AI 浪潮（知识工程、第一个专家系统 DENDRAL；工业机器人进入繁荣期）", "爱德华·费根鲍姆", "第 1、9 章"],
                        ["1981 年", "设计多层感知机（MLP），解决异或问题", "Werbos", "第 4 章"],
                        ["1982 年", "提出 Hopfield 神经网络（循环递归特性，模拟人类记忆）", "约翰·霍普菲尔德", "第 1 章"],
                        ["1984 年", "提出 CART 决策树（基尼指数、二叉树）", "Breiman", "第 4 章"],
                        ["1986 年", "提出 MLP 与 BP 反向传播训练结合的理念", "Rumelhart, McClelland, Hinton 等", "第 4 章"],
                        ["1989 年", "提出卷积神经网络（CNN）计算模型", "Yann LeCun", "第 4 章"],
                        ["1990 年", "提出 Boosting（多个弱学习器提升为强学习器）", "Schapire", "第 4 章"],
                        ["1993 年", "将 ID3 改进为 C4.5（信息增益比）", "Quinlan", "第 4 章"],
                        ["1995 年", "提出支持向量机（SVM，最大边距超平面）", "Cortes & Vapnik", "第 4 章"],
                        ["2001 年", "提出随机森林（Random Forest, RF），理论上证明抗过拟合", "Breiman & Cutler", "第 4 章"],
                        ["2003 年", "最早神经语言模型《A Neural Probabilistic Language Model》", "Bengio et al.", "第 7 章"],
                        ["2011 年– / 2016", "第三次 AI 浪潮；2016 年 AlphaGo 战胜李世石", "Google DeepMind", "第 1 章"],
                        ["2020 年", "人工智能开始与机器人融合", "—", "第 9 章"],
                        ["2022 年", "第四次 AI 浪潮（生成式 AI 入选《科学》十大突破、DALL-E2、ChatGPT、蛋白设计等）", "OpenAI、DeepMind", "第 1 章"],
                    ],
                },
                {
                    "caption": "核心代表人物与学科贡献速查",
                    "headers": ["人物", "核心理论 / 算法 / 系统", "所属章节"],
                    "rows": [
                        ["艾伦·图灵 (Alan Turing)", "1945 自动计算引擎（ACE）、1950《计算机器与智能》及图灵测试", "第 1、3 章"],
                        ["阿兰·纽厄尔 & 西蒙（司马贺）", "逻辑理论机、通用问题求解器（GPS）、物理符号系统假说（符号主义代表）", "第 1 章"],
                        ["马文·明斯基 & 约翰·麦卡锡", "第一次 AI 浪潮推动计算机视觉与自然语言理解研究", "第 1 章"],
                        ["爱德华·费根鲍姆", "知识工程倡导者与实践者，开发第一个专家系统 DENDRAL", "第 1 章"],
                        ["约翰·霍普菲尔德", "1982 年提出 Hopfield 神经网络（联想记忆、优化计算）", "第 1 章"],
                        ["Hubel & Wiesel", "1958 年研究初级视皮层 V1 简单/复杂/超复杂细胞感受野", "第 2 章"],
                        ["Galton（英国生物学家）", "研究子女与父母身高线性关系，统称多数值变量关系任务为“回归”", "第 4 章"],
                        ["Lewis / Cover & Hart", "朴素贝叶斯（1958）/ k 近邻 KNN（1967）", "第 4 章"],
                        ["Rosenblatt / Werbos / Hinton 等", "感知机（1957）/ 多层感知机 MLP（1981）/ MLP+BP 训练（1986）", "第 4 章"],
                        ["Yann LeCun", "1989 年提出卷积神经网络（CNN）计算模型", "第 4 章"],
                        ["Cortes & Vapnik", "1995 年提出支持向量机（SVM）", "第 4 章"],
                        ["Quinlan", "提出 ID3（1979/1986）并改进为 C4.5（1993）决策树", "第 4 章"],
                        ["Breiman & Cutler / Schapire", "CART（1984）与随机森林 RF（2001）/ Boosting（1990）", "第 4 章"],
                        ["Bengio et al.", "2003 年发表最早神经语言模型（NLM），同时得到词表示", "第 7 章"],
                    ],
                },
            ],
        },
        {
            "id": "app-confusing",
            "title": "高频易混概念对照表",
            "type": "confusing_pairs",
            "tables": [
                {
                    "caption": "高频易混概念对照（14 组核心考点）",
                    "headers": ["易混概念 A vs. B", "核心区别与记忆要点", "所属章节"],
                    "rows": [
                        ["符号主义 vs. 连接主义 vs. 行为主义", "符号主义模拟智能软件（逻辑与物理符号系统假说）；连接主义模拟大脑硬件（神经网络/M-P 模型）；行为主义模拟身体（感知-行动与环境交互/控制论）", "第 1 章"],
                        ["简单细胞 vs. 复杂细胞 vs. 超复杂细胞", "V1 区简单细胞具条状感受野检测线条/轮廓；复杂细胞感受野更大更复杂；超复杂细胞识别感受野中所有的线条/轮廓", "第 2 章"],
                        ["腹侧 what 通路 vs. 背侧 where 通路", "腹侧 what 通路负责物体识别（至 IT 颞下皮层）；背侧 where 通路负责空间视觉与运动信息（经 MT/V5）", "第 2 章"],
                        ["灰质 vs. 白质 / 功能分离 vs. 功能整合", "灰质是深色大脑皮层（约 2.5mm、6 层），白质在皮层下；功能分离指功能区空间分离，功能整合指分离结构相互联系协作", "第 2 章"],
                        ["实例层 vs. 本体层 / ∃r.C vs. ∀r.C", "实例层（Linked Data）描述个体，本体层描述概念规范；∃r.C 为存在关系约束（至少一个），∀r.C 为全称关系约束（只要有 r 关系必属 C）", "第 3 章"],
                        ["开放领域 QA vs. 封闭领域 QA / 关键词搜索 vs. 语义搜索", "开放领域覆盖广、准确率低；封闭领域覆盖小、准确率高。关键词搜索返回文档列表；语义搜索直接返回实体关系及较准确答案", "第 3 章"],
                        ["信息检索（IR） vs. 数据库 vs. 问答系统（QA）", "数据库查结构化数据且正确率 100%；IR 查非结构化文档、查询驱动、需用户自行查找；QA 答案驱动、自然语言提问直接返回精确答案", "第 7 章"],
                        ["监督学习 vs. 无监督学习 / 分类 vs. 回归", "根本区别在于数据是否被标注；监督学习中预测离散值为分类，预测连续值为回归", "第 4 章"],
                        ["ID3 vs. C4.5 vs. CART", "ID3 用信息增益（1979/1986）；C4.5 用信息增益比（1993）；CART 用基尼指数且每个节点只有两个分支（二叉树，1984）", "第 4 章"],
                        ["Bagging vs. Boosting", "Bagging 有放回抽样各训练集独立、等权重 1/K、可并行；Boosting 训练集不变仅调样本权重、按误差率加权表决、只能串行", "第 4 章"],
                        ["线性不可分 SVM：软间隔 vs. 核函数", "本质线性、非线性由噪声导致 → 软间隔；样本本质上非线性可分 → 核函数", "第 4 章"],
                        ["狭义语音增强 vs. 广义语音增强 vs. 狭义语音分离", "语音去噪（语音&非语音分离）=狭义语音增强；移除加性噪声+移除混响（乘性噪声）=广义语音增强；多说话人分离=狭义语音分离", "第 6 章"],
                        ["内部传感器 vs. 外部传感器", "内部感知自身状态（编码器、陀螺仪、加速度计、磁力计）；外部感知环境（视觉、红外、激光雷达、声音/超声雷达）", "第 9 章"],
                        ["CCD vs. CMOS / 步进电机 vs. 伺服电机", "CCD 电荷逐像素串行底端边缘放大；CMOS 每像素邻接放大器及 ADC 内存式输出。步进电脉冲转角位移（低速差）；伺服高精度快响应功率广（成本高噪音偏大）", "第 9 章"],
                    ],
                }
            ],
        },
        {
            "id": "app-templates",
            "title": "主观题与简答/分析题答题模板",
            "type": "answer_templates",
            "items": [
                {
                    "title": "模板一：概念定义与核心要素类（本体、感受野、共指消解、具身智能等）",
                    "content": "① 一句话核心定义（写出英文缩写或本质属性） → ② 核心组成/要素列举（如提示词 6 要素、强化学习 5 要素、具身智能 3 层架构、属性图 5 要素） → ③ 典型应用或学科意义（如专家系统、人脸/目标识别、人形机器人载体）。",
                },
                {
                    "title": "模板二：技术对比类（Bagging vs. Boosting、IR vs. QA、传统方法 vs. 深度学习、大模型 vs. 小模型）",
                    "content": "① 点明共同目标（如均用于提升预测精度或获取信息） → ② 分维度对比（数据是否标注、驱动/输入输出、样本与模型权重、串行 vs. 并行） → ③ 归纳各自适用场景与局限。",
                },
                {
                    "title": "模板三：系统流程与架构类（KBQA、非结构化知识获取、语音增强、K-Means 算法）",
                    "content": "① 总体数据流向链路（输入 → 中间处理 → 输出） → ② 分阶段/分步拆解（如 KBQA 在线与离线部分、SPSS 四模块、K-Means 5 步迭代） → ③ 关键评价指标或性能瓶颈（如 WER、MOS、SNR/PESQ、初始值敏感）。",
                },
                {
                    "title": "模板四：模型优缺点与挑战分析类（CNN、RNN、GAN、RL、决策树、K-Means）",
                    "content": "① 核心优势（2–3 点，紧扣加粗关键词如局部特征组合、长距离依赖、无需标注、并行化） → ② 主要不足（过拟合、长序列噪声累积、模式缺失 Mode Collapse、探索与利用困境、非凸簇效果差） → ③ 对应改进思路。",
                },
                {
                    "title": "模板五：生物神经与视觉信息处理机理类（视觉双通路、皮层分层、大脑优势）",
                    "content": "① 解剖/结构基础（视网膜 → 外侧膝状体 → V1–V4 → IT/MT；神经元胞体/树突/轴突/髓鞘） → ② 信息处理机制（分布式并行、串行层级 what/where、网络化前馈与反馈） → ③ 对 AI 模型的启发（如 CNN 模拟简单/复杂细胞）。",
                },
                {
                    "title": "模板六：大模型增强与微调迁移类（Prompt / CoT / RAG / PEFT / LoRA）",
                    "content": "① 提出背景（通用大模型参数庞大、难直接适配特定任务或缺乏领域实时知识） → ② 核心机制（不改参数调提示、逐步推理、外挂知识库检索、冻结主干仅训 Adapters 或低秩矩阵 LoRA） → ③ 优势总结（降低算力成本、保留原模型能力、易扩展）。",
                },
                {
                    "title": "模板七：机器人硬件选型与传感器分类类",
                    "content": "① 分类维度（固定 vs. 移动底盘；液压/气压/电机执行器；内部 vs. 外部传感器） → ② 核心原理与性能对比（精度、响应速度、噪声、成本、输出方式如 CCD vs. CMOS） → ③ 典型应用场景（机械臂固定作业 vs. 未知环境探索）。",
                },
            ],
        },
        {
            "id": "app-short-index",
            "title": "简答与核心知识点背诵索引",
            "type": "short_index",
            "items": [
                {
                    "title": "[ch1.s1] 简述人工智能三大学派的别名、核心思想及模拟出发点对比",
                    "content": "符号主义（逻辑/心理/计算机学派，物理符号系统假说，逻辑理论机/GPS/专家系统，模拟智能软件）；连接主义（1943 M-P 神经元模型，模拟大脑硬件）；行为主义（进化主义/控制论学派，感知与行动环境交互，模拟身体）。",
                },
                {
                    "title": "[ch1.s2–s3] 简述 AI 四次浪潮的时间与代表性成果，及当前技术瓶颈与伦理风险",
                    "content": "四次浪潮：1956–1974（明斯基/麦卡锡）、1980–1987（费根鲍姆 DENDRAL / 1982 Hopfield）、2011–（2016 AlphaGo）、2022（生成式 AI、DALL-E2、ChatGPT）。技术瓶颈：脆弱性、可解释性不足、常识不足、依赖大数据、领域自适应弱、规则统计难融合、缺因果推理。伦理：数据泄露、法律、隐私安全、就业、文化冲击、国家安全。",
                },
                {
                    "title": "[ch2.s2] 简述大脑的宏观/介观/微观组成及大脑相比机器的三大优势",
                    "content": "宏观：大脑/间脑/小脑/脑干、五叶、胼胝体；介观：灰质皮层约 2.5mm 分 6 层 + 白质；微观：神经细胞（胞体/树突/轴突/髓鞘）+ 胶质细胞、“1 或 0”动作电位。组织特性：功能分离与功能整合。三大优势：低能耗高效率、自我学习能力（神经可塑性/海马长时程增强 LTP）、大规模并行处理能力。",
                },
                {
                    "title": "[ch2.s3] 简述视觉信息处理的三大机制及视觉双通路分工",
                    "content": "链路：视网膜→视神经→外侧膝状体→V1–V4→IT/MT。三大机制：(1) 分布式并行处理（朝向/纹理/颜色特异区并行）；(2) 串行层级处理（腹侧 what 通路处理物体识别，背侧 where 通路处理空间视觉与运动）；(3) 网络化处理（垂直前馈反馈+水平横向交互）。",
                },
                {
                    "title": "[ch3.s1–s3] 简述专家系统组成、知识图谱最小单元及描述逻辑概念表达式与公理",
                    "content": "专家系统 = 知识库 + 推理机（知识表示、获取、使用）。知识图谱是三元组（triple）的集合，分实例层（Linked Data）与本体层（概念模型的明确规范）。表达式：∃r.C、∀r.C；公理：C(a)、r(a, b)、A ⊑ B。",
                },
                {
                    "title": "[ch3.s5] 简述非结构化文本构建知识图谱的四步流程及关系抽取三类方法",
                    "content": "四步：实体抽取（规则 / 统计 HMM-CMM-MEM-CRF / 深度学习 CNN-RNN）→ 关系抽取（模板 / 监督学习 6 步 / 弱监督远程监督）→ 事件抽取 → 知识融合（对齐合并）。",
                },
                {
                    "title": "[ch3.s7–s11] 简述属性图 G=(V,E) 要素、KBQA 架构及 CoT 与 RAG 原理",
                    "content": "属性图：V（节点）、E（边）、ρ（映射）、σ（属性）、λ（类型），查询语言 Cypher（Neo4j）。KBQA 在线：问题→问题理解（实体识别、关系预测）→语义解析→查询生成执行→回复生成。提示词 6 要素（角色/指示/上下文/例子/输入/输出）；CoT 提升复杂推理；RAG 外挂知识库检索免重训，适合知识密集型任务。",
                },
                {
                    "title": "[ch4.s3–s4] 监督学习与无监督学习的本质区别及各自典型任务与算法",
                    "content": "本质区别：数据是否被标注。监督学习含分类（离散值：贝叶斯/SVM/KNN/逻辑回归/决策树/随机森林）与回归（连续值：一元/岭/多元/lasso/多项式/深度回归）。无监督学习含聚类（K-Means/谱/层次/密度）、降维（主成分分析，解决维数灾难）、关联规则挖掘（Apriori）。",
                },
                {
                    "title": "[ch4.s5–s6] 简述 SVM 线性不可分解法及 ID3 / C4.5 / CART 决策树区别",
                    "content": "SVM 决策边界为最大边距超平面，离分类线最近样本为支持向量；噪声导致不可分用软间隔，本质非线性可分用核函数。决策树：ID3（信息增益，1979/1986）、C4.5（信息增益比，1993）、CART（基尼指数、每个节点严格二分支）。",
                },
                {
                    "title": "[ch4.s7–s8] 简述 Bagging 与 Boosting 区别及 K-Means 五步流程与优缺点",
                    "content": "Bagging（有放回独立抽样、等权重 1/K、可并行、投票/求平均） vs. Boosting / AdaBoost（训练集不变调错分样本权重、按误差率加权表决、只能串行）。K-Means 5 步：选 K→随机初始化中心→分组到最近簇→更新簇中心均值→迭代重复至收敛；缺点：需预设 K、对初始值和噪声敏感、非凸簇差。",
                },
                {
                    "title": "[ch5.s3–s6] 简述 CNN、RNN、GAN、RL 的核心机制、优势与不足",
                    "content": "CNN（模拟简单/复杂细胞，LeNet-5 含 2 卷积+2 池化+3 全连接，局部特征组合；不足：算力大、易过拟合、收敛难）；RNN（序列记忆与遗忘，长距离依赖；不足：需标签、长序列累积噪声）；GAN（生成器 vs. 判别器两阶段对抗，无监督生成；不足：Mode Collapse 模式缺失）；RL（Agent/Env/State/Action/Reward 试错；不足：探索与利用困境、奖励工程）。",
                },
                {
                    "title": "[ch5.s8–s9] 简述 Transformer / ViT / CLIP / 扩散模型原理及 PEFT / LoRA 微调",
                    "content": "Transformer（自注意力并行捕捉远距离依赖）；ViT（图像分 patch 序列输入）；CLIP（图文双编码器映射同一嵌入空间）；扩散模型（逐步加噪去噪）。微调：Prompt Tuning（调提示不改参数）、冻结/逐层解冻、Adapters（每层加适应层）、LoRA（低秩矩阵调整，保留原模型）。",
                },
                {
                    "title": "[ch6.s1–s4] 简述语音为何需要频域分析、语音分离三类及 ASR / SPSS 评价指标",
                    "content": "频域原因：人耳具频谱分析功能，且时域卷积等于频谱乘积（DFT/IDFT）。分离三类：去噪（狭义增强）、去混响、说话人分离（狭义分离）；指标 SNR、PESQ。ASR 指标 WER；语言模型指标 Perplexity（NLM 解决 N-gram 长距离依赖）。TTS/SPSS 流程：文本分析→韵律分析→声学模型→声码器，指标 MOS。",
                },
                {
                    "title": "[ch7.s4–s8] 简述自然语言理解四层面、语用两大学派及 IR 与 QA 的区别",
                    "content": "四层：词法（分词/词性标注/NER）、句法（短语结构/依存/深层文法）、语义（句子级/篇章级）、语用（功能主义：意图情景→可接受性；结构主义：衔接连贯→信息性；共指消解：mention→entity）。IR（查询驱动、关键字、返回文档列表） vs. QA（答案驱动、自然语言提问、返回精确答案）。",
                },
                {
                    "title": "[ch7.s9–s10] 简述大语言模型与小模型在能力及研究使用形式上的区别",
                    "content": "结构起源 Transformer，预训练起源 BERT。能力上达到参数与数据阈值后产生“涌现”能力；使用形式上：(1) 构建合理 Prompt 取代进一步微调；(2) 提供在线 API 调用取代本地部署；(3) 学术界与工业界研究思路与方式趋同。",
                },
                {
                    "title": "[ch8.s1–s4] 简述类脑智能四种模拟方法、脑机接口分类与脑机混合智能三大局限",
                    "content": "人脑优势：鲁棒容错、高效、低能耗；四种模拟方法：结构、功能、行为、机制模拟。BCI 分类：传输方向（脑→机/机→脑/双向）、采集方式（非/半/侵入）；混合层次（感知/认知/行为）；混合方式（增强/替代/补偿）。三大局限：认知原理了解有限、脑机互适应学习可塑性差异、电子器件生物相容性与排异。",
                },
                {
                    "title": "[ch9.s1–s3, s7] 简述机器人七大组成、执行器、传感器分类及具身智能",
                    "content": "七大组成：大脑 CPU、机构（底盘/躯体/肢体）、能源转换单元、执行器（液压/气压/电机）、传感器、通讯、人机界面。外部传感器：视觉（CCD/CMOS）、红外、激光雷达、声音（麦克风/超声雷达）；内部传感器：编码器、陀螺仪、加速度计、磁力计。具身智能三层架构：感知层、交互层、运动层，典型载体为人形机器人。",
                },
            ],
        },
    ]


def build_notes_data(pdf_path: Path) -> dict[str, Any]:
    """Build complete NotesData dictionary from the PDF."""
    raw_doc_title, raw_chapters = parse_pdf_sections(pdf_path)
    if not raw_chapters or sum(len(c["sections"]) for c in raw_chapters) == 0:
        raise ValueError(
            f"Failed to extract any chapters or sections from PDF: {pdf_path}"
        )
    doc_title = normalize_text(raw_doc_title)
    section_tables = build_section_tables()

    ch9_renumber = {
        ("ch9.s4", "五"): "四",
        ("ch9.s5", "六"): "五",
        ("ch9.s6", "七"): "六",
        ("ch9.s7", "八"): "七",
    }

    chapters_out: list[dict[str, Any]] = []
    for ch in raw_chapters:
        ch_id = ch["id"]
        sections_out: list[dict[str, Any]] = []
        for sec in ch["sections"]:
            sec_id = sec["id"]
            key_points = build_key_points(sec["paras"])
            terms = extract_terms(key_points)

            # Renumber Ch9 sections sequentially (PDF jumps 三、 -> 五、, i.e. 五..八)
            raw_numeral = sec["raw_numeral"]
            heading_body = normalize_text(sec["heading_body"])
            numeral = ch9_renumber.get((sec_id, raw_numeral), raw_numeral)
            sec_title = f"{numeral}、{heading_body}"

            summary = SECTION_SUMMARIES.get(sec_id)
            if not summary:
                # Deterministic fallback grounded in extracted keyPoints
                summary = "；".join(kp.lstrip("↳ ") for kp in key_points[:2])
                if len(summary) > 160:
                    summary = summary[:157].rstrip("，；： ") + "。"

            sec_obj: dict[str, Any] = {
                "id": sec_id,
                "chapterId": ch_id,
                "title": sec_title,
                "summary": summary,
                "keyPoints": key_points,
            }
            if terms:
                sec_obj["terms"] = terms
            if sec_id in section_tables:
                sec_obj["tables"] = section_tables[sec_id]
            if sec_id in SECTION_CALLOUTS:
                sec_obj["callout"] = SECTION_CALLOUTS[sec_id]

            sections_out.append(sec_obj)

        chapters_out.append(
            {
                "id": ch_id,
                "short": normalize_text(ch["short"]),
                "title": normalize_text(ch["title"]),
                "overview": CHAPTER_OVERVIEWS.get(ch_id, ""),
                "sections": sections_out,
            }
        )

    return {
        "meta": {
            "title": doc_title or "人工智能导论期末复习资料",
            "version": "1.0.0",
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "overview": build_overview(),
        "chapters": chapters_out,
        "appendices": build_appendices(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract 人工智能导论复习资料.pdf into NotesData JSON.")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF_PATH, help="Path to 人工智能导论复习资料.pdf")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH, help="Output path for notes.json")
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise FileNotFoundError(f"Source PDF not found: {args.pdf}")

    notes = build_notes_data(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(notes, ensure_ascii=False, indent=2) + "\n")

    total_sections = sum(len(c["sections"]) for c in notes["chapters"])
    total_keypoints = sum(len(s["keyPoints"]) for c in notes["chapters"] for s in c["sections"])
    print(
        f"Wrote {args.output} | chapters={len(notes['chapters'])} | "
        f"sections={total_sections} | keyPoints={total_keypoints} | "
        f"appendices={len(notes['appendices'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
