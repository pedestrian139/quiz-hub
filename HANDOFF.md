# 项目开发交接文档（HANDOFF.md）

## 1. 当前完成进度（M1 + M2 + M3 + 视觉精修 + Ground-Truth 审计 + CI/CD 全量验收通过）
- **M1 工程骨架与核心刷题引擎**：
  - 完成 Vite 8 + React 19 + TypeScript + Vitest + Playwright 工程配置。
  - 完成类型契约（`src/types/quiz.ts`）、判分与题组抽样引擎（`src/core/quizEngine.ts`）、`localStorage` 安全持久化与防原型污染备份导入（`src/core/storage.ts`）、题型/答案格式化工具（`src/core/questionUtils.ts`），**39/39 单元测试全部通过**（`vitest.config.ts` 已补全 `.ts` 引用后缀，0 警告）。
- **M2 知识点手册与整合大题库（Ground-Truth 逐页核查通过）**：
  - `src/data/notes.json`：完整提取《人工智能导论复习资料.pdf》，包含全书复习导览、**9 章 64 个知识点小节**及 **4 大速查附录**（时间线与代表人物、高频易混概念对照、主观题答题模板、简答背诵索引）。
  - `src/data/bank.json`：由 `scripts/build_bank.py` 汇总 4 份原始数据生成，经 `scripts/audit_bank.py` **0 错误通过**，并完成源 PDF 图片逐页高精度核查（包括对视频弹题第 15、69 页无裁剪复核及全部 21 道 `<4` 选项题逐一对照原件、确认《综合题库最终版》全本仅含判断与选择且无题干残留字符）：
    - **总题量：335 题**（去重合并 14 道重复题并记录 `source.duplicatesMerged`）
    - **按来源**：综合题库 `comprehensive_bank` 117 题（18 页全覆盖） / 视频课弹题 `video_popup` 60 题（74 页全覆盖，14 题与综合题库重合已合并） / 复习资料精编 `review_notes_synthesized` 158 题（**64/64 小节 100% 覆盖**）
    - **按题型**：单选 106 / 多选 72 / 判断 118（75 对 / 43 错）/ 简答 25 / 综合分析 14
    - **按章节**：第 1–9 章均有完整分布（Ch1:23, Ch2:24, Ch3:46, Ch4:61, Ch5:41, Ch6:28, Ch7:43, Ch8:31, Ch9:38）
- **M3 自助刷题与知识点复习网站（Opus 5.5 视觉审美与交互精修 + Gemini 协同收尾）**：
  - 对齐参考站 `https://z4j5y.github.io/material-review/` 的清新学术浅色风与排版规范，并完成工艺升级：
    - 定制零依赖 24×24 线性 SVG 图标库（`src/components/Icons.tsx`）与渐变 AI Favicon；
    - 吸顶毛玻璃导航栏（`TopNav.tsx`）与浅色/深色主题切换（`useTheme.ts`，独立存储于 `ai-intro-quiz-theme`，不污染答题记录，`@media print` 自动回退纯白打印）；
    - 复习中心（`#/`, `HubPage.tsx`）新增全库覆盖率圆环与 9 章掌握进度条卡片（点击任意章节一键跳转 `#/quiz` 并预筛该章）；
    - 刷题首页（`#/quiz`, `QuizHome.tsx`）新增实时关键词检索框（`data-testid="filter-search"`，支持 `Esc` 清空与快捷键隔离，实时联动 6 大模式题量与 `opts.search`）；
    - 全题型会话与结算页（`QuizSession.tsx`、`App.tsx`）：立体键帽选项/T-F 提示、三级掌握度自评卡片、可折叠答题卡、结算页圆环进度仪表盘、JSON 备份导入导出、`notes-table-wrap` 宽表滚动容器及跨路由 `重做全部` 状态保护。
- **工程化与 GitHub Pages 自动发布**：
  - `vite.config.ts` 配置 `rolldownOptions.output.manualChunks` 分包（`vendor`、`bank-data`、`notes-data`，单包均 `< 240 kB`），构建零警告；
  - 新增 `.github/workflows/deploy.yml`（push `main` 自动执行 `npm ci` + `npm test` + `npm run build` 并部署 `./dist` 至 GitHub Pages）。
- **全量验证状态**：
  - `python scripts/audit_bank.py`：PASS（0 errors）
  - `npm run typecheck`：PASS（0 errors）
  - `npm test`：3 files / 39 tests PASS（0 warnings）
  - `npm run build`：PASS（`dist/` 分包构建 128ms，0 warnings）
  - Playwright 4 层端到端测试：桌面端 `1440×900`（`202 passed`）+ 移动端 `390×844`（`26 passed`），全部零报错、零 404、零水平溢出、零控件遮挡。

## 2. 关键文件清单
- **数据与构建脚本**：
  - `src/data/bank.json`（335 题整合大题库）
  - `src/data/notes.json`（9 章 64 节 + 4 附录结构化知识点手册）
  - `scripts/raw_comprehensive.json`、`scripts/raw_video_1.json`、`scripts/raw_video_2.json`、`scripts/raw_synthesized.json`
  - `scripts/build_bank.py`、`scripts/audit_bank.py`、`scripts/extract_notes.py`、`scripts/export_pdf_pages.py`
- **前端源码与构建配置**：
  - `index.html`（自定义 SVG Favicon、学术浅色 + 暗色 `[data-theme="dark"]` 全量变量、响应式与 `@media print` 样式）
  - `src/App.tsx`、`src/pages/HubPage.tsx`、`src/pages/QuizHome.tsx`、`src/pages/QuizSession.tsx`、`src/pages/quizTypes.ts`
  - `src/components/TopNav.tsx`、`src/components/Icons.tsx`、`src/components/useTheme.ts`
  - `src/data/catalog.ts`、`src/hooks/usePersistentStore.ts`、`src/router/useHashRoute.ts`
  - `src/types/quiz.ts`、`src/core/quizEngine.ts`、`src/core/questionUtils.ts`、`src/core/storage.ts`
  - `vite.config.ts`、`vitest.config.ts`、`.github/workflows/deploy.yml`
- **测试套件与规范**：
  - `tests/unit/*`（39 项单元测试）
  - `tests/e2e/*` & `playwright.config.ts`（4 层桌面端 + 移动端 E2E 测试与布局审计）
  - `AGENTS.md` & `.agents/rules/10-github-handoff.md`

## 3. 当前遗留问题 / 报错状态
- **无阻断性报错**：代码、题库、单元与 E2E 测试、生产分包构建全部零报错、零警告通过。
- GitHub Pages 首次上线前，需仓库管理员在 GitHub 仓库 `Settings -> Pages -> Build and deployment -> Source` 中选择 **GitHub Actions**，随后推送 `main` 或手动触发工作流即可生成在线站点链接。

## 4. 下一步可选接力任务（To-Do）
1. **开启 GitHub Pages 发布**：在 GitHub 仓库开启 Pages（Source: GitHub Actions），核验 `https://zzm13920690395.github.io/quiz-hub/` 在线访问正常后即可分享给同学使用。
2. **可选功能扩展**：如需支持同目录下 `材料导论/` 课程，可复用当前架构接入新题库模块。

## 5. 架构约定与避坑提示
- **核心契约勿随意破坏**：`src/types/quiz.ts`、`src/core/*`、`STORAGE_KEY = 'ai-intro-quiz-v1'` 以及 `tests/e2e/helpers/selectors.ts` 中的全部 `data-testid` / `aria-*` / `data-status` 属性受 4 层 E2E 测试严格校验；主题偏好必须独立保存在 `ai-intro-quiz-theme`。
- **数据更新流程**：修改题库请编辑 `scripts/raw_*.json` 后重新运行 `python scripts/build_bank.py && python scripts/audit_bank.py`，勿手改 `src/data/bank.json`。
- **敏感与临时文件**：`.env`、密钥、`.tmp_pdf_pages/`、`node_modules/`、`dist/`、`playwright-report/`、`test-results/` 均已在 `.gitignore` 忽略。
