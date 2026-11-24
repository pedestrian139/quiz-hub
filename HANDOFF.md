# 项目开发交接文档（HANDOFF.md）

## 1. 当前完成进度（M1 + M2 + M3 + E2E 全量验收通过）
- **M1 工程骨架与核心刷题引擎**：
  - 完成 Vite 8 + React 19 + TypeScript + Vitest + Playwright 工程配置。
  - 完成类型契约（`src/types/quiz.ts`）、判分与题组抽样引擎（`src/core/quizEngine.ts`）、`localStorage` 安全持久化与防原型污染备份导入（`src/core/storage.ts`）、题型/答案格式化工具（`src/core/questionUtils.ts`），**39/39 单元测试全部通过**。
- **M2 知识点手册与整合大题库构建**：
  - `src/data/notes.json`：完整提取《人工智能导论复习资料.pdf》，包含全书复习导览、**9 章 64 个知识点小节**及 **4 大速查附录**（时间线与代表人物、高频易混概念对照、主观题答题模板、简答背诵索引）。
  - `src/data/bank.json`：由 `scripts/build_bank.py` 汇总 4 份原始数据生成，并经 `scripts/audit_bank.py` **0 报错通过**，且经独立抽样对照源 PDF 核验一致：
    - **总题量：335 题**（去重合并 14 道重复题并记录 `source.duplicatesMerged`）
    - **按来源**：综合题库 `comprehensive_bank` 117 题（18 页全覆盖） / 视频课弹题 `video_popup` 60 题（74 页全覆盖，14 题与综合题库重合已合并） / 复习资料精编 `review_notes_synthesized` 158 题（**64/64 小节 100% 覆盖**）
    - **按题型**：单选 106 / 多选 72 / 判断 118（75 对 / 43 错）/ 简答 25 / 综合分析 14
    - **按章节**：第 1–9 章均有完整分布（Ch1:23, Ch2:24, Ch3:46, Ch4:61, Ch5:41, Ch6:28, Ch7:43, Ch8:31, Ch9:38）
- **M3 自助刷题与知识点复习网站 UI（Opus 5.5 架构与审美把关 + Gemini 4 Carbon 接力实现）**：
  - 对齐参考站 `https://z4j5y.github.io/material-review/` 的清新学术浅色风、卡片层级、语义反馈色板与排版规范。
  - 完整实现 5 大路由（`#/` 复习中心、`#/quiz` 刷题工具、`#/wrong` 错题本、`#/fav` 收藏夹、`#/notes` 知识点手册）、多维筛选（章节多选/来源/题量/顺序）、单选/多选/判断即时判分、简答/分析三级掌握度自评、可折叠答题卡、键盘快捷键及焦点安全保护、JSON 备份导入导出、宽表横向滚动容器与 `@media print` 打印样式。
- **全量验证状态**：
  - `python scripts/audit_bank.py`：PASS（0 errors）
  - `npm run typecheck`：PASS（0 errors）
  - `npm test`：3 files / 39 tests PASS
  - `npm run build`：PASS（`dist/` 静态产物可直接部署 GitHub Pages）
  - Playwright 4 层端到端测试（桌面端 1440×900 203 项 + 移动端 390×844 26 项）：**全量通过**（零控制台错误、零 404、零水平溢出、零控件遮挡）

## 2. 关键文件清单
- **数据与构建脚本**：
  - `src/data/bank.json`（335 题整合大题库）
  - `src/data/notes.json`（9 章 64 节 + 4 附录结构化知识点手册）
  - `scripts/raw_comprehensive.json`、`scripts/raw_video_1.json`、`scripts/raw_video_2.json`、`scripts/raw_synthesized.json`（4 份可复现原始题库 JSON）
  - `scripts/build_bank.py`、`scripts/audit_bank.py`、`scripts/extract_notes.py`、`scripts/export_pdf_pages.py`
- **前端源码**：
  - `index.html`（全局学术浅色样式、响应式断点与 `@media print` 规则）
  - `src/App.tsx`（根状态、五路由、`ResultView`、`QuestionListView`、`NotesView`）
  - `src/pages/HubPage.tsx`、`src/pages/QuizHome.tsx`、`src/pages/QuizSession.tsx`、`src/pages/quizTypes.ts`
  - `src/components/TopNav.tsx`、`src/data/catalog.ts`、`src/hooks/usePersistentStore.ts`、`src/router/useHashRoute.ts`
  - `src/types/quiz.ts`、`src/core/quizEngine.ts`、`src/core/questionUtils.ts`、`src/core/storage.ts`
- **测试套件与规范**：
  - `tests/unit/*`（39 项单元测试）
  - `tests/e2e/*` & `playwright.config.ts`（4 层桌面端 + 移动端 E2E 测试与布局审计）
  - `AGENTS.md` & `.agents/rules/10-github-handoff.md`（两人接力开发与自动交接规则）

## 3. 当前遗留问题 / 报错状态
- **无阻断性报错**。本地 `npm run dev`、`npm run build`、`npm test`、`npm run test:e2e` 与 `audit_bank.py` 均已验证正常。
- 轻微非阻断提示：Vite 打包因内联 `bank.json` + `notes.json` 产生单 chunk > 500 kB 提示（gzip 后约 201 kB，不影响纯静态加载与 GitHub Pages 部署）；`audit_bank.py` 有 21 条原题仅有 2–3 个选项的常规提示（忠实保留源 PDF 选项数量）。

## 4. 下一步可选接力任务（To-Do）
1. **部署上线（GitHub Pages）**：将本项目配置 GitHub Actions 或推送 `dist/` 至 `gh-pages` 分支，生成可直接分享给同学的在线链接（`vite.config.ts` 已设 `base: './'`）。
2. **可选视觉精修**：待 Claude Opus 5.5 配额恢复后，可对桌面端/移动端页面做一轮精细视觉打磨或补充暗黑模式、题干关键词全局搜索等增强体验。
3. **可选代码分包**：若希望消除 Vite 500 kB chunk 提示，可在 `vite.config.ts` 为 `src/data/` 增加 `manualChunks` 拆分。

## 5. 架构约定与避坑提示
- **核心契约勿随意破坏**：`src/types/quiz.ts`、`src/core/*`、`STORAGE_KEY = 'ai-intro-quiz-v1'` 以及 `tests/e2e/helpers/selectors.ts` 中的全部 `data-testid` / `aria-*` / `data-status` 属性受 4 层 E2E 测试严格校验。
- **数据更新流程**：修改题库请编辑 `scripts/raw_*.json` 后重新运行 `python scripts/build_bank.py && python scripts/audit_bank.py`，勿手改 `src/data/bank.json`。
- **敏感与临时文件**：`.env`、密钥、`.tmp_pdf_pages/`、`node_modules/`、`dist/`、`playwright-report/`、`test-results/` 均已在 `.gitignore` 忽略。
