# 【题库导入】开发交接文档（`feat/quiz-import` 分支）

## 1. 分支与防冲突约束状态
- **当前分支**：`feat/quiz-import`（从 `dev` 拉出；严格未触碰、未提交、未推送 `main` 与 `dev`）
- **V1 共享契约零破坏**：`src/types/quiz.ts`、`src/core/*`、`src/data/*`、`src/pages/*`、`src/components/TopNav.tsx`、`src/components/Icons.tsx`、`src/router/*`、`index.html`、`HANDOFF.md` 均 100% 保持原样。
- **公共文件纯新增插入**：
  - `src/App.tsx`：仅新增 2 行（`QuizImportPortal` 导入与 `<TopNav />` 下方入口挂载）；
  - `vite.config.ts`：仅新增 2 行（`importer-xlsx`、`importer-docx` 懒加载拆包规则）。

## 2. 已完成进度（全部 3 个里程碑完成并通过全量验收）
- **多学科题库与大容量 IndexedDB 存储（`src/utils/`）**：
  - `src/utils/quizImportTypes.ts` & `src/utils/bankCatalog.ts`：定义多题库 `BankRecord`、`.quizhub.json` 分享包 `QuizHubSharePackage` 与动态视图模型 `buildBankViewModel`（全量兼容 V1 `Question` 与 `BankData` 契约）。
  - `src/utils/bankDb.ts` & `src/utils/useBankLibrary.ts`：实现 IndexedDB (`quizhub-v2`) 多题库新建、切换、重命名、清空单库进度、删除自定义题库、分库隔离持久化（按题库写队列串行化）、`localStorage['ai-intro-quiz-v1']` 首次无损自动迁移至内置《人工智能导论》题库（且 V2 清空不会复活 V1 旧数据）、`.quizhub.json` 一键导出及受限环境内存降级兜底。
- **纯前端离线 4 格式导入器（`src/utils/importers/`，按需懒加载拆包）**：
  - `excelImporter.ts` + `tabularParser.ts`：动态 `import('xlsx')` 支持多 Sheet 分章与 `.xlsx` 标准模板导出；CSV/TSV 支持 RFC-4180、UTF-8/GBK 自动解码及两列无表头闪卡；兼容考试宝/超星/雨课堂/问卷星/Quizlet/通用中英文表头及选项原文答案匹配。
  - `docxImporter.ts` + `mammoth-browser.d.ts`：动态 `import('mammoth/mammoth.browser.js')` 支持 Word 表格与正文段落双通道拆题。
  - `textImporter.ts`：TXT/Markdown 上传与直接粘贴，智能识别章节、分型标题、题号、单行/多行选项、括号内行内答案提取遮蔽、多行主观题答案/要点/解析及标准 `.txt` 模板下载。
  - `jsonImporter.ts`：无损支持 `.quizhub.json` 分享包、V1 `BankData` 及外部常见 JSON 字段结构，统一防原型污染校验。
- **独立隔离 UI 与可视化校对工作台（`src/components/QuizImport/`）**：
  - `QuizImportPortal.tsx` & `QuizImport.css`：顶栏下方紧凑入口栏与模态工作台（浅色/深色主题自适应、响应式 0 溢出、`@media print` 自动隐藏）；支持文件上传/粘贴解析、模板下载、新建自定义题库、重命名、导出分享包、清空单库进度与删除自定义题库。
  - `ImportWorkbench.tsx`：导入前可视化预览校对（统计可入库/告警/异常题数，支持 `仅看异常与告警`、`一键剔除异常项`、逐题勾选剔除及行内实时修正复验）。
  - `CustomBankPractice.tsx`：自定义题库独立刷题、结算复盘、本库错题本与本库收藏夹（与内置《人工智能导论》进度完全隔离；单来源导入库自动隐藏来源筛选）。
- **全量测试与构建验证（最后一次代码修改后全部通过）**：
  - `npm run typecheck`：PASS（0 errors）
  - `npm test`：5 files / 52 tests PASS（39 项原有 V1 单测 + 13 项导入器/IndexedDB 迁移新单测）
  - `npm run build`：PASS（0 warnings；`importer-xlsx` 423.73 kB、`importer-docx` 298.51 kB、`vendor` 218.74 kB，均 `< 600 kB`）
  - Playwright E2E（Desktop `1440×900` + Mobile `390×844`）：
    - Desktop Tier 1 + Tier 5：`95 passed`（0 failed，0 flaky）
    - Desktop Tier 2 + Tier 3 + Tier 4：`112 passed`（0 failed，0 flaky）
    - Mobile 全套（Tier 1–5）：`27 passed`（0 failed，0 flaky，0 水平溢出，0 控件遮挡，0 控制台/HTTP 报错）

## 3. 关键改动文件清单
- **微改现有文件（仅依赖与入口挂载）**：
  - `package.json`、`package-lock.json`
  - `src/App.tsx`（+2 行）
  - `vite.config.ts`（+2 行）
- **新增模块与样式**：
  - `src/utils/quizImportTypes.ts`、`src/utils/bankCatalog.ts`、`src/utils/bankDb.ts`、`src/utils/useBankLibrary.ts`
  - `src/utils/importers/{index,normalize,tabularParser,textImporter,excelImporter,docxImporter,jsonImporter}.ts`、`src/utils/importers/mammoth-browser.d.ts`
  - `src/components/QuizImport/{QuizImportPortal,ImportWorkbench,CustomBankPractice}.tsx`、`src/components/QuizImport/QuizImport.css`、`src/components/QuizImport/index.ts`
- **新增测试与独立交接文档**：
  - `tests/unit/importers.test.ts`、`tests/unit/bankDb.test.ts`
  - `tests/e2e/tier5-quiz-import.spec.ts`
  - `HANDOFF_quiz-import.md`

## 4. 下一步计划
- 待队友【API 接入】分支开发同步完成后，在收到“准备提 PR”指令时执行 `git fetch origin && git merge origin/dev` 并推送 `feat/quiz-import` 发起合并至 `dev` 的 Pull Request。
