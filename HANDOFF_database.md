# 数据库与用户管理交接

## 已完成

- `feat/database` 已合入题库导入，合并提交 `ae29d55`，基线同时包含 API 接入。本次开发完成 SQL、鉴权、数据库服务和游客迁移。
- `db/supabase/migrations/202611250001_database.sql` 包含账号资料、API 配置及加密密钥、题库、进度、游客导入回执和手机号操作限流。公开表启用 RLS，题库和进度写入使用按用户校验的版本控制函数，密钥和迁移写入由 Edge Function 处理。手机号账号的首次邮箱绑定由服务端验证密码并授权，数据库在请求和确认时核对目标邮箱，确认后消耗授权。
- `src/services/authService.ts` 支持邮箱、手机号和本地游客。两个登录标识共享同一个 Supabase 用户 ID 和密码。手机号作为登录标识，归属未验证，短信找回不可用。
- `src/services/db/cloudData.ts` 提供资料、题库、进度和 API 配置的云端读写。API Key 使用 AES-256-GCM 加密。恢复函数返回当前页面可使用的 `ApiConfig`，调用方应将恢复结果保留在内存中。

## 登录界面对接

- PR #3 的登录弹窗和用户菜单已接入这个服务。应用只使用 Supabase 正式账号或本地游客身份。无 Supabase 配置时，弹窗隐藏账号表单并保留游客入口。PR #3 中的 Mock 接口和文档仅供历史参考。
- `registerWithAccount({ account, password, nickname })`、`loginWithAccount({ account, password })`、`loginAsGuest()`、`upgradeGuestToAccount({ account, password })`、`getCurrentUser()` 和 `logout()` 均可从 `src/services/authService.ts` 导入。
- 游客选择已有账号时由界面传 `importGuestData: true`。服务在密码登录成功后为匹配的正式账号创建迁移任务。登录结果中的 `guestDataSynced` 仅在收到云端导入回执且本机快照一致时设为 `true`。界面依据回执、待迁移状态或冲突显示相应提示。
- 注册和游客升级可以传 `secondaryAccount`，用于一次提交一个邮箱和一个手机号。新账号先启用手机号，验证邮件发出后，成功结果附带 `pendingEmail`。邮箱确认后，两种标识均可登录同一账号。
- 已有账号可用 `linkAccount({ account, password })` 增加第二种登录标识。手机号绑定成功后可立即使用，邮箱绑定须完成邮件确认。
- 注册、登录和升级返回 `authenticated`、`email_confirmation_required` 或 `migration_pending`。单独注册邮箱等待验证时 `user` 为 `null`。第二种标识绑定失败时，登录结果附带 `failedSecondaryAccount`，可用 `linkAccount()` 单独重试。Auth 会话事件会在验证回跳后恢复迁移。`getCurrentUser()` 读取当前身份，`resumeGuestUpgrade()` 可显式恢复待迁移批次并取得结果，`syncLocalData()` 可主动同步当前浏览器的匿名资料。
- 游客资料保存在本机原有 IndexedDB 与 `localStorage`。游客迁移按目标账号、来源和快照版本提交，读取失败保留待迁移状态，重复提交同一批次返回原结果。同一来源的新快照可更新本次迁移写入的题库、配置和进度。独立云端修改优先，跳过的题库和配置通过 `migrationConflicts` 返回给界面。旧的收藏和掌握度只能在确认属于清空后新作答时随旧版内置库快照迁入。`sessionStorage` 的 API 配置继续仅在当前标签页有效。
- 界面状态桥统一订阅鉴权事件，关闭弹窗时恢复键盘焦点。既有刷题页面仍走原存储入口，持续跨设备读写接入时应按当前用户使用 `cloudData.ts`。更新已有云端题库和进度请传入上次读取到的 `revision`，遇到 `40001` 时重新读取再处理冲突。

## Supabase 接入

前端的 `.env.local` 使用以下名称，示例值需替换为目标项目的公开配置。

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-public-key
VITE_SUPABASE_AUTH_REDIRECT_URL=https://your-frontend.example/quiz-hub/
```

`VITE_SUPABASE_ANON_KEY` 可替代公开 Publishable Key。正式发布时需要把同名公开变量传入 Vite 构建环境。确认回跳地址列入 Supabase Auth Redirect URLs。

在目标 Supabase 项目应用迁移后，启用 Email 账号和邮箱确认，将 `public.quizhub_before_user_created` 配置为 Before User Created Hook。在应用了数据库绑定校验的项目上关闭 Secure Email Change 的双地址确认，使首次绑定只验证真实邮箱。当前模块支持首次绑定，已验证邮箱的后续换绑需要专门流程。真实邮箱确认通过项目的 SMTP 发送。`db/supabase/config.toml` 包含对应的本地 Auth 与 Functions 配置。

部署 `db/supabase/functions/phone-auth` 与 `db/supabase/functions/user-data`。可以从 `db` 运行 Supabase CLI。两者的请求由函数内部校验身份，`phone-auth` 的手机号注册和登录可以在正式会话建立前调用。设置函数环境变量 `QUIZHUB_ALLOWED_ORIGINS` 为允许的前端 origin 列表，以逗号分隔，`QUIZHUB_API_KEY_ENCRYPTION_KEY_V1` 为安全生成的 32 字节 Base64 密钥。项目 URL 和 Supabase 网关密钥由函数运行环境注入。Service Key 与加密密钥仅由服务端读取。轮换加密密钥时需保留旧版本，直到已有密文完成迁移。

## 验证与当前状态

- 审查修复后的单测覆盖双标识同账号和部分成功、认证回跳、账号隔离、快照版本与冲突、读取异常和清空后的本地旧记录。
- `db/tests/auth-and-guest-upgrade.sql` 是可回滚的数据库回归脚本，验证首次邮箱绑定授权、较新迁移快照、云端独立修改和显式清空保护。对已应用迁移的开发库，可使用 `psql -v ON_ERROR_STOP=1 -f db/tests/auth-and-guest-upgrade.sql` 执行。
- 在本地 PostgreSQL 兼容运行时执行了 SQL，验证了 RLS、注册保留域、两种登录标识关联、私有密钥权限、限流、迁移事务回滚及重试和清空保护。用模拟 Supabase 网关跑通了 Edge Function 的 AES-GCM 加解密和越权拒绝。
- 登录集成的端到端测试使用 Playwright 仅在测试构建中配置的 HTTP 网关。运行 `npm run test:e2e -- tests/e2e/tier6-auth-ui.spec.ts` 可验证鉴权流程。设置 `PW_AUTH_DISABLED=1` 后运行同一命令，可验证无环境配置时只开放本地游客。
- 尚未在目标 Supabase 项目执行迁移或验证 SMTP 邮件回跳。部署环境仍需验证真实邮箱注册、手机号绑定及登录、游客升级和跨设备读取。
