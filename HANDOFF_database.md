# 数据库与用户管理交接

## 已完成

- `feat/database` 已合入题库导入，合并提交 `ae29d55`，基线同时包含 API 接入。本次开发完成 SQL、鉴权、数据库服务和游客迁移。
- `db/supabase/migrations/202611250001_database.sql` 包含账号资料、API 配置及加密密钥、题库、进度、游客导入回执和手机号操作限流。公开表启用 RLS，题库和进度写入使用按用户校验的版本控制函数，密钥和迁移写入由 Edge Function 处理。手机号账号的首次邮箱绑定由服务端验证密码并授权，数据库在请求和确认时核对目标邮箱，确认后消耗授权。
- `src/services/authService.ts` 现采用**纯邮箱 + 密码 + 邮箱验证码（OTP）**方案，已取消手机号注册、登录与双重账号绑定：
  - 注册与游客绑定（`registerWithAccount` / `upgradeGuestToAccount`）：填写邮箱、昵称、密码提交 `signUp` 后发送激活验证码，用户在弹窗内调用 `verifyEmailOtp({ account, code })`（`verifyOtp({ email, token, type: 'email' })`）即可完成激活并同步数据；支持 `resendSignupOtp`（60 秒冷却重发）。
  - 登录（`loginWithAccount` / `sendLoginOtp` + `verifyEmailOtp`）：支持「密码登录」（日常使用不消耗邮件发送额度）与「验证码登录」（`signInWithOtp` 且 `shouldCreateUser: false`）一键切换。
  - 前端已仅使用 `user-data` Edge Function，不再调用 `phone-auth`。`profiles.phone` 与数据库兼容触发器保留以兼容历史迁移脚本。
- `src/services/db/cloudData.ts` 提供资料、题库、进度和 API 配置的云端读写。API Key 使用 AES-256-GCM 加密。恢复函数返回当前页面可使用的 `ApiConfig`，调用方应将恢复结果保留在内存中。

## 登录界面对接

- PR #3 的登录弹窗和用户菜单已接入这个服务，并升级为纯邮箱方案。应用只使用 Supabase 正式账号或本地游客身份。无 Supabase 配置时，弹窗隐藏账号表单并保留游客入口。
- `registerWithAccount({ account, password, nickname })`、`loginWithAccount({ account, password, importGuestData })`、`sendLoginOtp({ account })`、`resendSignupOtp({ account })`、`verifyEmailOtp({ account, code, importGuestData })`、`loginAsGuest()`、`upgradeGuestToAccount({ account, password, nickname })`、`getCurrentUser()` 和 `logout()` 均可从 `src/services/authService.ts` 导入。
- 游客选择已有账号时由界面传 `importGuestData: true`。服务在密码登录或验证码登录成功后为匹配的正式账号创建迁移任务。登录结果中的 `guestDataSynced` 仅在收到云端导入回执且本机快照一致时设为 `true`。界面依据回执、待迁移状态或冲突显示相应提示。
- 游客升级注册或常规注册在邮箱尚未确认时返回 `{ status: 'email_confirmation_required', user: null }`，弹窗切入验证码输入步骤并在同页完成激活。Auth 会话事件仍兼容链接回跳场景并在验证后恢复迁移。`getCurrentUser()` 读取当前身份，`resumeGuestUpgrade()` 可显式恢复待迁移批次并取得结果，`syncLocalData()` 可主动同步当前浏览器的匿名资料。
- 游客资料保存在本机原有 IndexedDB 与 `localStorage`。游客迁移按目标账号、来源和快照版本提交，读取失败保留待迁移状态，重复提交同一批次返回原结果。同一来源的新快照可更新本次迁移写入的题库、配置和进度。独立云端修改优先，跳过的题库和配置通过 `migrationConflicts` 返回给界面。旧的收藏和掌握度只能在确认属于清空后新作答时随旧版内置库快照迁入。`sessionStorage` 的 API 配置继续仅在当前标签页有效。
- 界面状态桥与实时同步协调层（`src/services/cloudSync.ts`）已打通已登录用户的实时云端读写：
  - **初始化与恢复**：登录成功、邮箱验证激活/回跳及刷新恢复会话时，`AuthPracticeRoot` 自动调用 `hydrateAccountFromCloud(userId)` 拉取自定义题库（`listCloudBanks`）、各题库刷题进度/收藏/掌握度（`listCloudProgress`）和解密后的 API 配置（`restoreCloudApiConfig`）。恢复出的明文 `ApiConfig`（含 API Key）通过 `setCloudMemoryApiConfig` 仅保存在页面内存中，禁止写入 `localStorage`；退出登录或切换账号时先刷新待传写入，再通过 `clearCloudSyncSession` 清空内存与临时存储，确保账号与游客之间零串号、零残留。
  - **API 设置云端持久化**：已登录用户在 [ApiSettingsModal.tsx](src/components/ApiSettings/ApiSettingsModal.tsx) 中默认加密同步到云端（经 `user-data` AES-256-GCM 存储于 `public.user_api_configs` 与 `private.user_api_secrets`），勾选「仅当前标签页有效」时仅写 `sessionStorage` 不上传云端；清除配置会同步清理云端密文、内存和会话缓存，界面明确展示当前存储方式。
  - **题库、进度实时同步与并发控制**：自定义题库新建、重命名、删除及进度重置即时写云端；作答、收藏与掌握度变更经防抖批处理合并写入（并在 `visibilitychange` / `pagehide` / 退出登录时主动落盘）。所有更新/删除传入本地缓存的上次 `revision`，遇到 `40001` 冲突时自动重新拉取云端最新版本执行三路合并（保留双方新增作答/收藏及显式取消的收藏）并重试；`UserMenu` 提供轻量同步状态与失败重试入口。

## Supabase 接入

前端的 `.env.local` 使用以下名称，示例值需替换为目标项目的公开配置。

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-public-key
VITE_SUPABASE_AUTH_REDIRECT_URL=https://your-frontend.example/quiz-hub/
```

`VITE_SUPABASE_ANON_KEY` 可替代公开 Publishable Key。正式发布时需要把同名公开变量传入 Vite 构建环境。确认回跳地址列入 Supabase Auth Redirect URLs。

在目标 Supabase 项目应用迁移后，启用 Email Provider 与邮箱确认（Confirm email）：
1. 在 Supabase Dashboard -> **Authentication → Emails (Templates)** 中，确保 **Confirm signup** 与 **Magic Link** 邮件模板正文均包含 **`{{ .Token }}`**（例如：`<h2>您的验证码</h2><p>验证码：<strong>{{ .Token }}</strong></p>`），以便前端用户在弹窗内直接输入 6–8 位数字验证码完成注册激活或免密登录。
2. 确认启用 `Email OTP`，将 `public.quizhub_before_user_created` 配置为 Before User Created Hook（禁止未授权保留域写入），并通过项目 SMTP 发送真实邮件。`db/supabase/config.toml` 包含对应的本地 Auth（含 `otp_length = 6`、`otp_expiry = 3600`）与 Functions 配置。

前端已仅依赖 `db/supabase/functions/user-data`（无需部署或调用 `phone-auth`）。可从 `db` 运行 Supabase CLI 部署 `user-data`，并设置函数环境变量 `QUIZHUB_ALLOWED_ORIGINS` 为允许的前端 origin 列表（逗号分隔）以及 `QUIZHUB_API_KEY_ENCRYPTION_KEY_V1` 为安全生成的 32 字节 Base64 密钥。项目 URL 和 Supabase 网关密钥由函数运行环境注入。Service Key 与加密密钥仅由服务端读取。轮换加密密钥时需保留旧版本，直到已有密文完成迁移。

## 验证与当前状态

- 已完成 `typecheck`、E2E 类型检查、生产构建（`npm run build`）及 10 个文件共 88 项单元测试（其中新增 [tests/unit/cloudSync.test.ts](tests/unit/cloudSync.test.ts) 7 项测试覆盖初始化拉取、纯内存 API Key 隔离、防抖/重置、退出清理、`40001` 三路合并与失败重试）。
- Playwright E2E（[tests/e2e/tier6-auth-ui.spec.ts](tests/e2e/tier6-auth-ui.spec.ts)、[tests/e2e/api-integration.spec.ts](tests/e2e/api-integration.spec.ts)）已扩展有状态的本地 Supabase 测试网关，覆盖纯邮箱注册与 OTP 激活/登录、云端 API 配置仅存内存与标签页模式覆盖、退出登录清空内存、清缓存刷新自动从云端恢复题库/进度、`40001` 并发冲突合并，以及 `PW_AUTH_DISABLED=1` 下的纯本地游客模式。
- `db/tests/auth-and-guest-upgrade.sql` 是可回滚的数据库回归脚本，验证较新迁移快照、云端独立修改和显式清空保护。对已应用迁移的开发库，可使用 `psql -v ON_ERROR_STOP=1 -f db/tests/auth-and-guest-upgrade.sql` 执行。
- **线上部署前最终验证清单**：
  1. 确认已将 [db/supabase/migrations/202611250001_database.sql](db/supabase/migrations/202611250001_database.sql) 与 Edge Function `user-data` 部署至目标 Supabase 项目，并配置好 `QUIZHUB_ALLOWED_ORIGINS`、`QUIZHUB_API_KEY_ENCRYPTION_KEY_V1`、`quizhub_before_user_created` Hook 以及邮件模板中的 `{{ .Token }}`。
  2. 在真实线上站/预览站依次完成：邮箱注册 + OTP 激活 -> 保存 API 配置并检查 `localStorage` 无明文 Key -> 刷题/收藏/新建自定义题库 -> 强刷或无痕窗口登录同一账号验证跨设备恢复 -> 勾选「仅当前标签页有效」确认跨设备不受影响 -> 清除云端 API 配置并退出登录确认状态彻底清零。
