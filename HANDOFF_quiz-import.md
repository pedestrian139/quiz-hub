# 【题库导入】模块交接文档（`feat/quiz-import` 分支）

## 1. 分支隔离与防冲突说明
- **当前分支**：`feat/quiz-import`（基于 `dev` 切出；严禁触碰、合并或推送 `main` 与 `dev`）
- **V1 公共契约零修改**：`src/types/quiz.ts`、`src/core/*`、`src/data/*`、`src/pages/*`、`src/components/TopNav.tsx`、`src/components/Icons.tsx`、`src/router/*`、`index.html`、`HANDOFF.md` 均未改动。
- **既有公共文件最小化增量插入**：
  - `src/App.tsx`：仅新增 2 行（导入 `QuizImportPortal` 并在 `<TopNav />` 下方挂载 `<QuizImportPortal />`）
  - `vite.config.ts`：仅新增 2 行（`importer-xlsx`、`importer-docx` 按需拆包规则）

## 2. 支持格式（纯前端离线解析 + 按需懒加载）
1. **Excel（`.xlsx` / `.xls`）**：按需动态加载 `xlsx`（独立 chunk `importer-xlsx`），支持多 Sheet 自动映射章节、自动跳过纯填写说明 Sheet，支持导出标准 2-Sheet `.xlsx` 模板（`quizhub-template.xlsx`）。
2. **CSV / TSV（`.csv` / `.tsv`）**：支持 UTF-8 BOM 与 GBK 中文编码自动解码、RFC-4180 引号跨行转义、自动识别 `,`/`\t`/`;` 分隔符及无表头两列 Quizlet 闪卡导入。
3. **Word（`.docx`）**：按需动态加载 `mammoth/mammoth.browser.js`（独立 chunk `importer-docx`），同时解析文档内的表格题库与正文段落题目。
4. **TXT / Markdown（`.txt` / `.md` / `.markdown` 及文本框直接粘贴）**：支持章节标题、题型大类标题、多种题号前缀、Markdown 粗体/引用格式及标准 `.txt` 模板下载（`quizhub-template.txt`）。
5. **JSON（`.json` / `.quizhub.json`）**：无损导入导出 `.quizhub.json` 分享包（`schema: "quizhub-bank-v2"`），原生兼容 V1 `BankData`，并兼容外部数组或 `{ questions | data | items | list | records | rows | bank }` 常见结构。

## 3. 解析逻辑与导入前校对
- **规范化引擎（`src/utils/importers/normalize.ts`）**：全角 ASCII/空格归一化、BOM 剥离、题型关键词推断（`单选/多选/判断/简答/综合分析` 及选项与答案形态反推）、选项标签前缀清洗（`A.`/`A、`）。
- **表头与选项智能映射（`src/utils/importers/tabularParser.ts`）**：扫描前 6 行非空数据定位表头（自动去除 `(必填)`/`（必填）`/`*` 等标记），覆盖考试宝、超星、雨课堂、问卷星、Quizlet（`Term/Definition`、`Front/Back`）与通用中英文列别名；支持拆列 `选项A..H` / `选项1..8`、合并选项列（换行/`|`/`##`/行内 `A. ... B. ...`）以及按选项全文反查答案索引。
- **文本拆题（`src/utils/importers/textImporter.ts`）**：识别 `# 第X章`、`一、单选题`、`【单选题】`、单行多选项与多行选项；自动提取并遮蔽题干括号内的行内答案（如 `（ B ）` -> `（  ）`）；支持主观题多行编号参考答案、解析、`要点` 与 `标签`。
- **安全与预览校对（`jsonImporter.ts` + `ImportWorkbench.tsx`）**：拒绝含 `__proto__` / `constructor` / `prototype` 的危险 JSON；入库前在预览面板统计可入库/告警/异常题量并标注重复题干告警，支持筛选异常项、一键剔除异常项、单题勾选剔除及行内修改后实时重新校验。

## 4. 题库存储数据结构（IndexedDB `quizhub-v2` + V1 无损兼容）
- **V1 核心契约严格沿用**：每道入库题目均通过 `finalizeDraftsToBank()` 输出为标准 V1 `Question` 与 `BankData`（`source.origin` 保持 V1 `QuestionOrigin`，`byOrigin` 统计完整包含 V1 三字段，通过 `source.file`/`source.ref`/`source.note` 记录导入来源格式）。
- **新增扩展类型（`src/utils/quizImportTypes.ts`）**：
  - `BankRecord`：`{ id, name, description?, builtin, createdAt, updatedAt, sourceFormat?, data: BankData }`
  - `QuizHubSharePackage`：`{ schema: 'quizhub-bank-v2', exportedAt, bank: { name, description?, data: BankData } }`
- **IndexedDB 数据库（`src/utils/bankDb.ts`：`quizhub-v2`，version 1）**：
  - `banks`（`keyPath: 'id'`）：存储自定义题库记录（内置示例库 `builtin-ai-intro` 由 `src/utils/bankCatalog.ts` 直接绑定 V1 `BANK`，不重复持久化）。
  - `progress`（`keyPath: 'bankId'`）：按 `bankId` 严格隔离存储 `{ bankId, store: UserStore, updatedAt }`，写操作按库串行排队防竞态；单来源自定义题库在刷题区自动隐藏来源筛选。
  - `meta`（`keyPath: 'key'`）：记录 `activeBankId`、`v1Migrated` 与 `v1MigratedAt`。首次加载检测 `v1Migrated !== true` 且 `localStorage['ai-intro-quiz-v1']` 非空时，自动无损迁移至 `progress['builtin-ai-intro']` 并保留 V1 原始键值不变；在 V2 清空内置库进度后标记 `v1Migrated = true` 防止重启复活旧记录；当 IndexedDB 不可用或抛 `SecurityError` 时自动降级至内存 Map。

## 5. 关键改动文件清单
- **微改既有文件**：
  - `package.json`、`package-lock.json`
  - `src/App.tsx`（+2 行入口挂载）
  - `vite.config.ts`（+2 行懒加载分包）
- **新增工具与解析器（`src/utils/`）**：
  - `src/utils/quizImportTypes.ts`、`src/utils/bankCatalog.ts`、`src/utils/bankDb.ts`、`src/utils/useBankLibrary.ts`
  - `src/utils/importers/index.ts`、`normalize.ts`、`tabularParser.ts`、`textImporter.ts`、`excelImporter.ts`、`docxImporter.ts`、`jsonImporter.ts`、`mammoth-browser.d.ts`
- **新增界面组件（`src/components/QuizImport/`）**：
  - `src/components/QuizImport/QuizImportPortal.tsx`、`ImportWorkbench.tsx`、`CustomBankPractice.tsx`、`QuizImport.css`、`index.ts`
- **新增测试与独立交接文档**：
  - `tests/unit/importers.test.ts`、`tests/unit/bankDb.test.ts`
  - `tests/e2e/tier5-quiz-import.spec.ts`
  - `HANDOFF_quiz-import.md`

## 6. 验证结论
- `npm run typecheck`：PASS（0 errors）
- `npm test`：5 files / 52 tests PASS（39 项原有单测 + 13 项新单测）
- `npm run build`：PASS（0 warnings，`importer-xlsx` 423.73 kB、`importer-docx` 298.51 kB 按需分包）
- Playwright E2E（Desktop `1440×900` & Mobile `390×844`）：Desktop Tier 1+5 `95 passed`、Desktop Tier 2–4 `112 passed`、Mobile 全套 `27 passed`（0 failed / 0 flaky / 0 布局溢出与遮挡 / 0 运行时报错）
