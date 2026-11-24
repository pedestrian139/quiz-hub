# 项目开发交接文档（HANDOFF.md）

## 1. 已完成进度
- **M1 核心引擎与契约层**：已完成题库/知识手册 TypeScript 类型契约（`src/types/quiz.ts`）、判分与题组抽样引擎（`src/core/quizEngine.ts`）、本地安全持久化与备份恢复（`src/core/storage.ts`）、工具函数（`src/core/questionUtils.ts`）及 39 项单元测试。
- **M2 知识点手册提取与题库流水线准备**：已完成 9 章 64 节 + 4 附录的 `src/data/notes.json` 结构化提取与错别字校订；综合题库提取（117 题）、视频课弹题前半部分（37 题）与复习资料精编题（158 题）已完成，等待视频弹题后半部分完成后合成 `src/data/bank.json`。
- **M3 前端全套 UI 与交互实现（Opus 5.5 架构审美 + Gemini 4 Carbon 接力完成）**：
  - **全局路由与顶部导航**：支持 `#/`（复习中心）、`#/quiz`（刷题工具）、`#/wrong`（错题本）、`#/fav`（收藏夹）、`#/notes`（知识点手册）五路由切换，`aria-current="page"` 激活态，未知 Hash 安全回退至 `#/`，桌面端（1440×900）与移动端（390×844）零横向溢出、零交互控件遮挡。
  - **复习中心门户（`#/`）**：动态题库总量/章节徽章、五题型与三来源分布统计、刷题工具与知识点手册双入口卡片、全书 9 章概览。
  - **刷题首页（`#/quiz`）**：4 卡统计面板（已练题数/总正确率/错题/收藏，0 题安全显示 `—`）、6 大题型模式卡片（实时联动筛选题量与各模式正确率，空题池安全提示）、章节多选胶囊（`全部` + 1–9 章，保底最少 1 章约束）、来源/题量/顺序筛选、JSON 备份导出/校验导入与确认清空。
  - **答题会话与结算页**：顶部进度条与实时计时器、题目标签与星标收藏、单选/判断即时判分锁定、多选切换与确认提交、主观题（简答/综合分析）参考答案展开与三级掌握度自评（完全会/有点模糊/不会）、键盘快捷键（`1-9`/`A-I`、`T/F`、`Space`、`ArrowLeft`/`ArrowRight`）及焦点安全保护、可折叠答题卡速跳、四档结算反馈与单题/全错题重练。
  - **错题本（`#/wrong`）与收藏夹（`#/fav`）**：按章节升序排列、手风琴展开参考答案与解析、一键重做全部、错题本专属确认清空（收藏夹自动隐藏清空按钮）。
  - **知识点手册（`#/notes`）**：复习总纲、安全子串关键词检索、目录速跳、9 章 64 节详情与各章“刷本章题”定向联动、全部表格包裹于 `notes-table-wrap` 横向滚动容器、4 大速查附录，以及干净的 `@media print` 打印样式表。

## 2. 关键改动文件
- `index.html`（完整学术浅色主题响应式样式与 `@media print` 打印样式）
- `src/App.tsx`（根状态编排、路由视图切换、结算页 `ResultView`、错题/收藏页 `QuestionListView`、知识点手册页 `NotesView`）
- `src/components/TopNav.tsx`（五路由全局导航栏）
- `src/data/catalog.ts`（`notes.json` 与 `import.meta.glob('./bank.json')` 同步兼容加载目录模块）
- `src/hooks/usePersistentStore.ts`（基于 `localStorage` 与同步快照引用的状态持久化 Hook）
- `src/router/useHashRoute.ts`（Hash 路由解析与未知路径安全归一化）
- `src/pages/quizTypes.ts`（刷题会话、结算与弹窗辅助类型及安全封装）
- `src/pages/HubPage.tsx`（复习中心门户页）
- `src/pages/QuizHome.tsx`（刷题工具首页与筛选备份面板）
- `src/pages/QuizSession.tsx`（全题型答题会话、键盘快捷键与答题卡组件）

## 3. 当前状态与下一步
- **当前状态**：`npm run typecheck` 零报错通过，`npm test`（39 项单元测试）全部通过；`catalog.ts` 已配置 `import.meta.glob('./bank.json', { eager: true })`，一旦 `src/data/bank.json` 落盘即可自动静态打包接入，无需再改动 UI 代码。
- **下一步计划**：
  1. 完成 `raw_video_2.json` 提取并由 `bank-builder` 运行 `scripts/build_bank.py` 与 `scripts/audit_bank.py` 生成最终 `src/data/bank.json`。
  2. 运行 `npm run build` 与全套 Playwright E2E 测试（`npm run test:e2e`，含桌面端 1440×900 与移动端 390×844），验证全量交互与布局审计通过。
