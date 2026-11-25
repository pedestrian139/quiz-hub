# HANDOFF — V2 【API 接入】模块交接文档（`feat/api-integration`）

> 所在分支：`feat/api-integration`（基于 `origin/dev`，**严格隔离，未触碰 `main` 生产分支**）
> 合并目标：`base: dev <- compare: feat/api-integration`
> 最后更新时间：2026-11-25

---

## 1. 最终完成的功能清单

### 1.1 顶部“API 设置”弹窗与连接管理（`src/components/ApiSettings/`）
- **全局入口**：顶部导航栏新增 `API 设置` 按钮（`data-testid="btn-api-settings"`），自带就绪状态绿点（`data-configured="true|false"`），并通过 `window` 自定义事件 `quiz-hub:open-api-settings` 支持从任意业务模块一键唤起。
- **8 大开箱即用预设（统一 OpenAI 兼容协议）**：DeepSeek 官方、硅基流动 SiliconFlow、智谱 GLM、阿里通义千问、Moonshot Kimi、OpenAI、Google Gemini（OpenAI 兼容端点）、自定义 / 中转站 / 本地 Ollama（`localhost` / `127.0.0.1` 免填 API Key）。
- **核心交互能力**：
  - 自动规范化 Base URL（去除尾部 `/`、`/chat/completions`、`/models` 后缀）；
  - API Key 密码框显隐切换与脱敏显示（`maskApiKey`）；
  - **从接口拉取模型列表**（`GET {baseUrl}/models`）并渲染可点击快捷模型标签；
  - **测试连接**（`testApiConnection`）：实测端到端可用性、返回毫秒级耗时及中文故障诊断（401/403/404/429/5xx/超时/CORS）；
  - **受控展开高级参数**：Temperature、Max Tokens、超时秒数、密钥存储范围切换（`localStorage` 持久化 vs `sessionStorage` 仅当前标签页有效）；
  - Portal 渲染至 `document.body`，打开时捕获并拦截底层答题快捷键，防误触。

### 1.2 答题页内嵌 AI 助教面板（`AiQuestionTutor.tsx`）
- **客观题（单选 / 多选 / 判断）**：严格在判分后出现（零剧透），提供 **AI 深度解析**（SSE 流式输出 + 停止/重新生成）与 **追问助教**（带题目和学生作答上下文的多轮对话）。
- **主观题（简答 / 综合分析）**：
  - 未揭晓参考答案前提供紧凑折叠入口 **“AI 辅助作答与批改”**，可先输入草稿由 AI 对照标准答案与 `keyPoints` 逐条批改；
  - 批改结果包含 0–100 评分、总体点评、已命中采分点、遗漏要点、高分示范改写，并支持 **一键采纳推荐自评**（同步触发 `handleSelfCheck(0|1|2)`）；
  - 揭晓参考答案后完整支持深度解析、作答批改与多轮追问。
- **安全与样式**：纯 React 节点渲染 Markdown（无 `dangerouslySetInnerHTML`）；完全复用 `index.html` 浅色/深色主题 CSS 变量，通过 `:has(.api-nav-btn)` 扩展导航网格，未改动 `index.html` 与打印样式。

### 1.3 供队友【题库导入】直接复用的服务层（`src/services/`）
- 导出 `generateQuestionsFromText(rawText, { chapter, count, types, sourceFile })`、`chatCompletionJson<T>(messages, opts)`、`chatCompletion`、`streamChatCompletion`、`isApiConfigReady`、`loadApiConfig`、`subscribeApiConfig`、`requestOpenApiSettings`。
- `generateQuestionsFromText` 输出严格遵守 V1 `src/types/quiz.ts` 的 `Question[]` 契约，自动过滤越界下标或缺失关键字段的脏数据。

---

## 2. 配置方式与存储数据结构

### 2.1 配置方式
1. 点击页面右上角 **“API 设置”** 按钮（或在答题页 AI 助教栏点击 **“未配置 API · 去设置”**）。
2. 选择服务商预设（或选 **自定义** 填入中转/Ollama 地址），粘贴 API Key。
3. 可选点击 **“从接口拉取模型列表”** 选取模型，点击 **“测试连接”** 验证通过后点击 **“保存配置”**。

### 2.2 存储键与字段定义（完全隔离 V1 存档）
- **存储键名**：`API_CONFIG_STORAGE_KEY = 'ai-intro-quiz-api-config-v1'`
  - 与 V1 答题记录 `ai-intro-quiz-v1` 及主题偏好 `ai-intro-quiz-theme` 完全隔离，互不干扰。
- **存储位置**：由 `storageScope` 字段决定：
  - `'local'`（默认）：写入 `window.localStorage` 并清除 `sessionStorage` 同名键；
  - `'session'`：仅写入 `window.sessionStorage`（关闭标签页自动清除）并清除 `localStorage` 同名键。
- **`ApiConfig` JSON 字段结构（`src/services/apiConfig.ts`）**：
  ```ts
  interface ApiConfig {
    provider: 'deepseek' | 'openai' | 'siliconflow' | 'zhipu' | 'dashscope' | 'moonshot' | 'gemini' | 'custom';
    baseUrl: string;       // 规范化后的 API 根地址，例如 "https://api.deepseek.com/v1"
    apiKey: string;        // 用户 API Key（本地 localhost/127.0.0.1 允许为空）
    model: string;         // 模型 ID，例如 "deepseek-chat" / "glm-4-flash"
    temperature: number;   // 采样温度 [0, 2]，默认 0.3
    maxTokens: number;     // 最大输出 token [64, 16384]，默认 1200
    timeoutMs: number;     // 请求超时毫秒数 [5000, 180000]，默认 45000
    storageScope: 'local' | 'session';
  }
  ```
- **跨组件同步事件**：
  - `quiz-hub:api-config-change`（配置保存/清除时派发，配合 `storage` 事件实现跨标签同步）
  - `quiz-hub:open-api-settings`（任意组件调用 `requestOpenApiSettings()` 即可打开设置弹窗）

---

## 3. 关键改动文件清单

- **新增模块（零冲突隔离目录）**：
  - `src/services/apiConfig.ts` — 预设、配置校验、原型污染防护与双作用域持久化
  - `src/services/llmClient.ts` — OpenAI 兼容请求、SSE 流式解析、JSON 提取、测速与 `/models` 拉取
  - `src/services/quizAiService.ts` — 深度解析、主观题批改、多轮追问与可复用 AI 出题
  - `src/services/index.ts` — 服务层统一导出
  - `src/components/ApiSettings/ApiSettings.css` — 浅/暗双主题样式与响应式布局规则
  - `src/components/ApiSettings/ApiSettingsModal.tsx` — API 配置模态弹窗
  - `src/components/ApiSettings/ApiSettingsButton.tsx` — 顶部导航入口与状态点
  - `src/components/ApiSettings/AiQuestionTutor.tsx` — 答题页内嵌 AI 助教与主观题批改组件
  - `src/components/ApiSettings/index.ts` — 组件统一导出
  - `tests/unit/apiServices.test.ts` — 7 项服务层单元测试（`API-01` ~ `API-07`）
  - `tests/e2e/api-integration.spec.ts` — 3 项端到端测试（桌面 `1440×900` + 移动 `390×844` 共 6 用例）
  - `HANDOFF_api-integration.md` — 本分支独立交接文档
- **全局公共文件最小化纯新增插入（共 +5 行，0 删除）**：
  - `src/components/TopNav.tsx`（+3 行：导入与插入 `<ApiSettingsButton />`）
  - `src/pages/QuizSession.tsx`（+2 行：导入与插入 `<AiQuestionTutor ... />`）
  - `src/App.tsx`、`index.html`、`src/types/quiz.ts`、`src/core/*`、`HANDOFF.md` **均未修改**。

---

## 4. 验收结果

- `npm run typecheck`：PASS（0 errors）
- `npm test`：4 files / **46 passed (46)**（V1 原有 39 项 + V2 API 7 项）
- `npm run build`：PASS（158ms，0 warnings，所有分包体积健康）
- Playwright E2E：
  - `tests/e2e/api-integration.spec.ts`（desktop + mobile）：**6/6 passed**（含弹窗无溢出/无控件重叠、拉取模型、测速、持久化隔离、客观题解析/追问、主观题 AI 批改与自评同步）
  - `tests/e2e/tier1-portal-home.spec.ts` & `tier2-storage-layout-boundaries.spec.ts`：**70/70 passed**
  - `tests/e2e/tier1-quiz-modes.spec.ts`：全量通过
