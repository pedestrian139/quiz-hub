# HANDOFF — V2 【登录、注册与游客入口】模块交接文档（`feat/auth-ui` 历史归档）

> ⚠️ **状态说明（2026-11-26）**：本文档记录的是早期 PR #3（前端 Mock + 手机号/邮箱双输入阶段）的交接历史。当前 `dev` 分支已全面切换为 **「邮箱 + 6 位验证码（Supabase Auth + Resend SMTP，有效期 300 秒）」** 并完成 `phone-auth` 残留清理，最新鉴权契约、云端同步与部署说明请以 `HANDOFF_database.md`、`HANDOFF.md` 与 `src/services/authService.ts` 为准。

> 所在分支：`feat/auth-ui`（基于 `origin/dev` `07c7bc1`，**严格隔离，未触碰 `main` 与 `dev` 分支**）
> 合并目标：`base: dev <- compare: feat/auth-ui`
> 最后更新时间：2026-11-25

---

## 1. 最终完成的功能清单

### 1.1 顶部用户状态栏（`src/components/Auth/UserMenu.tsx`）
- **未登录状态**：展示本地刷题提示与 **`登录 / 注册`** 按钮（`data-testid="auth-open-btn"`），点击打开登录弹窗。
- **游客状态**：展示 **`游客模式`** 状态胶囊按钮（`data-testid="auth-guest-mode-btn"`，提示 `"点击绑定账号保存云端进度"`），点击直接弹出 **`绑定账号保存云端进度`** 绑定升级窗口。
- **已登录状态**：展示头像与昵称触发按钮（`data-testid="user-menu-trigger"`，`aria-expanded` / `aria-haspopup="menu"`）；点击展开个人中心菜单（`data-testid="user-menu-popover"`），展示：
  - 当前绑定的手机号或邮箱（`data-testid="user-menu-bound-account"`）；
  - **`切换账号`**（`data-testid="auth-switch-account-btn"`，打开登录弹窗且取消时保留原会话）；
  - **`退出登录`**（`data-testid="auth-logout-btn"`，调用 `logout()` 清空会话）。

### 1.2 登录 / 注册 / 游客升级弹窗（`src/components/Auth/AuthModal.tsx`）
- **Portal + 快捷键隔离**：通过 `createPortal(..., document.body)` 渲染（`role="dialog" aria-modal="true"`），捕获阶段拦截 `Escape` 关闭与底层 `QuizSession` 单键答题快捷键，输入框独立调用 `stopPropagation()`。
- **双模式切换**：`role="tablist"` 支持 **【登录】** 与 **【注册】** Tab 切换。
- **统一账号输入与智能识别**：
  - 单个账号输入框（`data-testid="auth-account-input"`）实时识别 11 位数字手机号（`/^\d{11}$/`）或邮箱格式（实时更新类型标签 `data-testid="auth-account-type-badge"`），在失焦或提交时给出清晰中文错误提示（如 `手机号需为 11 位数字`、`邮箱格式不正确，请输入有效邮箱（如 name@example.com）`、`请输入有效的 11 位手机号或邮箱地址`）。
- **密码输入与显隐切换**：
  - 密码输入框（`data-testid="auth-password-input"`）右侧独立配置显隐切换按钮（`data-testid="auth-toggle-password"`，`aria-pressed`），注册与游客绑定升级模式强制校验密码长度不少于 6 位（`密码长度不能少于 6 位`）。
- **游客入口与绑定升级**：
  - 登录 / 注册弹窗底部提供醒目的 **【游客免注册体验】** 按钮（`data-testid="auth-guest-login-btn"`）；
  - 游客点击顶部 `"游客模式"` 进入 `'upgrade'` 模式弹窗（标题：`绑定账号保存云端进度`），绑定后保留原 `guestId` 与 `upgradedFromGuestId`，供后续 `feat/database` 迁移游客刷题进度至云端。

### 1.3 响应式与双主题兼容（`src/components/Auth/Auth.css`）
- 完全复用 `index.html` 全局 `:root` 与 `html[data-theme='dark']` CSS 变量（零修改 `index.html`、`TopNav.tsx`、`Icons.tsx`）。
- `@media print` 自动隐藏 `.auth-bar` 与 `.auth-modal-backdrop`。
- 桌面端 `1440×900` 与移动端 `390×844` 均通过水平零溢出与控件零重叠审计。

---

## 2. 公共入口最小化改动验证（`src/App.tsx`）

`git diff origin/dev -- src/App.tsx` 严格保持 **+3 / -0** 纯新增插入，原有代码行零修改、零格式化：
```diff
+import { AuthModal, UserMenu } from './components/Auth';
...
+      <UserMenu />
+      <AuthModal />
```

---

## 3. `src/services/authService.ts` 接口签名与对接契约（供 `feat/database` 替换实现）

> 严格 TypeScript 约束：`verbatimModuleSyntax: true`、`erasableSyntaxOnly: true`（禁用 `enum` 与构造函数参数属性）、`noUnusedLocals`、`noUnusedParameters`。

### 3.1 导出的类型定义

```ts
export type AuthAccountType = 'phone' | 'email';
export type AuthUserMode = 'guest' | 'account';

export type AuthErrorCode =
  | 'INVALID_ACCOUNT'
  | 'INVALID_PASSWORD'
  | 'ACCOUNT_EXISTS'
  | 'ACCOUNT_NOT_FOUND'
  | 'WRONG_PASSWORD'
  | 'NOT_A_GUEST'
  | 'STORAGE_ERROR';

export interface AuthUser {
  id: string;
  mode: AuthUserMode;
  isGuest: boolean;
  accountType?: AuthAccountType;
  /** 绑定手机登录时为 11 位数字字符串 */
  phone?: string;
  /** 绑定邮箱登录时为小写规范化邮箱 */
  email?: string;
  nickname: string;
  createdAt: number;
  updatedAt: number;
  /** 游客升级为正式账号时保留原游客 ID，便于云端合并本地进度 */
  upgradedFromGuestId?: string;
}

export interface RegisterAccountInput {
  account: string;
  password: string;
  nickname?: string;
}

export interface LoginAccountInput {
  account: string;
  password: string;
}

export interface UpgradeGuestInput {
  account: string;
  password: string;
  nickname?: string;
}

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; code: AuthErrorCode; message: string };

export interface AccountDetectionResult {
  kind: AuthAccountType | 'unknown';
  valid: boolean;
  normalized: string;
  message?: string;
}

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}
```

### 3.2 必须保持的 6 个异步核心方法

| 方法签名 | 当前 Mock 行为（`localStorage`） | `feat/database` 对接说明 |
|---|---|---|
| `registerWithAccount(input: RegisterAccountInput): Promise<AuthResult>` | 校验手机号/邮箱与 `>=6` 位密码；查重 `AUTH_USERS_STORAGE_KEY`；写入加盐模拟摘要（不落明文密码）与当前会话，派发 `AUTH_CHANGE_EVENT` | 替换为后端注册接口，返回相同 `AuthResult` 结构并派发 `AUTH_CHANGE_EVENT` |
| `loginWithAccount(input: LoginAccountInput): Promise<AuthResult>` | 校验账号与非空密码；核对用户目录与摘要；写入当前会话并派发 `AUTH_CHANGE_EVENT` | 替换为后端登录接口（写入 token/session 后同步 `AuthUser`） |
| `loginAsGuest(): Promise<AuthResult>` | 若当前已是游客则复用原游客记录，否则生成 `guest_*` 会话并派发 `AUTH_CHANGE_EVENT` | 可在后端生成匿名游客会话或继续本地生成游客 ID |
| `upgradeGuestToAccount(input: UpgradeGuestInput): Promise<AuthResult>` | 校验当前为游客状态；校验账号与 `>=6` 位密码及查重；原地升级保留 `id` 与 `upgradedFromGuestId`，更新用户目录与会话并派发 `AUTH_CHANGE_EVENT` | 替换为游客绑定升级接口，可利用 `upgradedFromGuestId` 关联云端答题记录 |
| `getCurrentUser(): Promise<AuthUser | null>` | 从 `AUTH_SESSION_STORAGE_KEY`（或受限环境内存回退）读取并清洗当前 `AuthUser` | 替换为从本地 token / `/auth/me` 获取当前登录态 |
| `logout(): Promise<void>` | 清除 `AUTH_SESSION_STORAGE_KEY` 与内存会话，保留已注册用户目录与 V1 刷题数据 `ai-intro-quiz-v1`，派发 `AUTH_CHANGE_EVENT` | 调用后端登出接口并清理本地登录态 |

### 3.3 辅助函数与隔离存储键

- **辅助函数**：
  - `getCachedCurrentUser(): AuthUser | null`（同步读取缓存会话，避免首屏闪烁）
  - `subscribeAuthChange(listener: (user: AuthUser | null) => void): () => void`（监听 `quiz-hub:auth-change` 与跨标签页 `storage` 事件）
  - `detectAccountInput(raw: string): AccountDetectionResult`
  - `validatePassword(password: string, requireMinLength: boolean): PasswordValidationResult`
- **隔离存储键（不与 `ai-intro-quiz-v1` / `ai-intro-quiz-theme` / `ai-intro-quiz-api-config-v1` 冲突）**：
  - `AUTH_SESSION_STORAGE_KEY = 'ai-intro-quiz-auth-session-v1'`
  - `AUTH_USERS_STORAGE_KEY = 'ai-intro-quiz-auth-users-v1'`
  - `AUTH_CHANGE_EVENT = 'quiz-hub:auth-change'`
  - `OPEN_AUTH_MODAL_EVENT = 'quiz-hub:open-auth-modal'`

---

## 4. 改动文件清单

- **新增**：
  - `src/services/authService.ts`
  - `src/components/Auth/authState.ts`
  - `src/components/Auth/AuthIcons.tsx`
  - `src/components/Auth/Auth.css`
  - `src/components/Auth/AuthModal.tsx`
  - `src/components/Auth/UserMenu.tsx`
  - `src/components/Auth/index.ts`
  - `tests/unit/authService.test.ts`
  - `tests/e2e/tier6-auth-ui.spec.ts`
  - `HANDOFF_auth-ui.md`
- **最小化修改**：
  - `src/App.tsx`（+3 / -0 行）

---

## 5. 验收结果

- `git diff --stat -- src/App.tsx`：`1 file changed, 3 insertions(+)`
- `npm run typecheck`：PASS（0 errors）
- `npx tsc -p tests/e2e/tsconfig.json --noEmit`：PASS（0 errors）
- `npm test`：PASS — 5 files / **52 passed (52)**（含新增 `tests/unit/authService.test.ts` 6 项）
- `npm run build`：PASS（164ms，0 warnings）
- `npm run test:e2e`：PASS — **243 passed**, 227 project-designated skips, **0 failed**（含新增 `tests/e2e/tier6-auth-ui.spec.ts` 桌面 `1440×900` + 移动 `390×844` 共 8 项全量通过）
