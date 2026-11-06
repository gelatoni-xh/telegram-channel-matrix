# Telegram 内容频道矩阵

Telegram 内容频道矩阵：按频道配置复用采集、筛选、文案和发布能力。GitHub Actions 负责测试、构建和部署；生产凭据保存在部署服务器，不进入仓库。

## 本地运行

Node.js 20.19 或更新版本：

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run doctor
npm run test-send -- all
```

`doctor` 仅检查身份与发帖权限。`test-send` 会向两个真实频道各发一条测试消息；也可指定 `ai` 或 `steam`。同一轮测试记录存在时不会重发，发送状态不明时需先人工核对，不自动删除记录或重试。

macOS 从钥匙串 service `codex.telegram-channel-matrix`、account `bot-token` 读取 token，也可从部署环境变量 `TELEGRAM_BOT_TOKEN` 读取。不在参数、配置文件、日志中写入 token。

配置入口由部署环境提供；不要把 bot token 写入命令行、源码或 GitHub Actions 日志。

测试发布记录位于 `~/.local/share/telegram-channel-matrix/receipts/`，保存目标频道 ID、状态与消息 ID。网络失败保存为 `uncertain`，明确 API 拒绝保存为 `failed`，重复调用均不自动重发。该文件适配器只服务本地测试；生产采集、运行与发布记录按技术方案使用 PostgreSQL。

网络层支持环境变量中的 HTTP/HTTPS 代理。消息使用纯文本，不依赖 Markdown 渲染。

Node 不自动继承 macOS 系统代理。使用本地 HTTP 代理时，可以按本机端口设置环境变量：

```sh
HTTPS_PROXY=http://127.0.0.1:PORT npm run doctor
HTTPS_PROXY=http://127.0.0.1:PORT npm run test-send -- all
```

## 开发步骤

1. 本地发布基础：项目骨架、频道配置、钥匙串凭据、权限检查、测试发送、发送防重和异常测试。
2. 数据来源：接入三个 AI 官方 RSS 与 Steam 中国区来源，验证字段、时效和地区；先输出候选，不自动发布。
3. 处理与存储：PostgreSQL 迁移、候选标准化、筛选去重、来源状态和运行记录。
4. 文案：独立 Prompt 和 LLM 接口；已选 CC Switch 的 `gpt pro` 配置，文案已通过 Responses 接入。不得将头像生成分组当作文案模型使用。
5. 完整运行：文案校验、真实内容发布、邮件结果与异常通知，端到端验收。
6. 定时与部署：统一发布节奏、容器、资源核对与部署验证。届时再启用持续自动发布。

第 1 步为最初验收记录；当前已接入来源、文案、PostgreSQL、每日精选、邮件和实例定时，线上验收见下方部署章节。MVP 不包含阅读量采集、增长分析或 Prompt A/B。无模型预算闸门。

## 第 1 步验收（2026-11-05）

类型检查、构建与 7 项离线测试通过；bot 身份及两个频道发布权限检查通过。两个频道均已成功发送测试消息并保存回执：

- [AI产品雷达测试消息](https://t.me/ai_product_radar_cn/3)
- [Steam折扣情报局测试消息](https://t.me/steam_deals_radar_cn/3)

此处为首次连通验收的历史记录。

## LLM 配置

按用户选择，复制 CC Switch 中 Codex 的 `gpt pro` 主入口配置：`gpt-6-sol`、`medium`、Responses 协议。仅设置一个入口。此名称与模型 ID 按服务商原配置保留，不推断其底层模型身份。

```sh
npm run llm:import
npm run llm:check
```

导入只读访问 `~/.cc-switch/cc-switch.db`，不修改 CC Switch。非密钥配置保存在 `~/.config/telegram-channel-matrix/llm.json`；API key 保存在钥匙串 service `codex.telegram-channel-matrix`、account `llm-api-key`，通过标准输入写入，不进入命令参数或仓库。可重复导入覆盖；这是独立配置快照，不会自动跟随 CC Switch 切换。部署时可通过 `LLM_API_KEY` 提供密钥。

`llm:check` 仅验证配置及密钥可读取，不调用模型，不发送频道内容。API 连通及文案质量在文案步骤验收。

## 本地来源与 LLM 样稿试跑

```sh
HTTPS_PROXY=http://127.0.0.1:PORT npm run preview:collect -- output/run-preview
HTTPS_PROXY=http://127.0.0.1:PORT npm run preview:draft -- output/run-preview
```

第二条命令会实际调用配置的 LLM；重复执行会再次产生模型调用。只生成本地文件，不调用 Telegram 发布。日期目录由调用者指定，采集窗口按实际执行时间计算。`candidates.json` 保留来源状态和最小候选，`llm-results.json` 保留生成/跳过结果和证据片段，`preview.md` 供阅读。产物不进入 Git。

这些 preview 命令只做来源接入和文案试验，不经过生产数据库、价格发前复核、邮件或调度。生产入口为 `daily:run`。Prompt 使用 `prompts/local-preview-v1.txt`，仅处理 RSS/商店短摘要；缺少摘要或未经核验的 Hugging Face 社区发布者先跳过。证据原文匹配仅验证引用存在，不能证明生成句的全部含义。

2026-11-05 已实测 Responses 结构化输出可用；本轮结果和待讨论建议见本地 `output/2026-11-05-preview/run-review.md`。此处是本地试跑历史记录；生产规则见部署章节。

## 频道样稿排版验收

当前正式方向已改为每日精选：每频道每天一期，一期最多 5 条，各条独立来源链接，不凑数，无合格内容不发空稿。下述单条样稿保留作历史排版试验。每日采集一次，Steam 入选商品发送前定向复查；线上调度采用北京时间每天 09:00，执行完成后发布。

`npm run preview:digest -- output/2026-11-05-preview` 使用已有候选与 LLM 结果生成 `daily-digests.json` 及可点击的 `daily-digests.html`，不重复调用模型，也不发送。浏览器排版只作近似预览，Steam 价格为原采集快照；正式发布仍需复查。来源候选分别留存，组稿后每频道一期，超限减少完整条目，不默认拆帖。

2026-11-05 经用户授权，两个频道各发送一篇内容样稿：[AI 产品更新](https://t.me/ai_product_radar_cn/4)、[Steam 优惠](https://t.me/steam_deals_radar_cn/4)。采用 Telegram 原生 HTML 加粗、Steam 划线原价、分段及单一来源按钮，关闭自动网页预览；动态文本经过 HTML 转义。平台返回的加粗实体与按钮地址已核对，未声称已完成客户端截图验收。

`npm run sample:send -- output/2026-11-05-preview` 为本次样稿专用发送命令，需网络代理环境。先复查 Steam 中国区类型、价格、折扣、简介及活动期限，再保留待发载荷；使用固定发布标识阻止重复发送。原始本地预览仍保持未发送状态说明，实际发送载荷见 `output/2026-11-05-preview/channel-samples-ui-v1.json`，发送回执在用户本地 receipts 目录。此命令不会开启定时发布。

## 实例部署与每日发布

部署目录 `/opt/apps/telegram-channel-matrix`，独立 Compose project，不开公网端口。代码在本机编译并构建 Linux 镜像，服务器只加载镜像。worker 内存上限 256 MiB、0.5 CPU、只读根文件系统，任务完成退出。数据库复用已有 PostgreSQL 服务，但使用独立 `telegram_channel_matrix` 数据库、`matrix_owner` 迁移账号和 `matrix_app` 运行账号。配置在服务器 `.env.production` 与 `config/`，权限 600，不进入仓库。

生产入口 `node dist/src/daily-run.js` 无日期、频道、force 等覆盖参数。日常人工补跑也必须在实例上启动相同服务，共用线上数据库：

```sh
sudo systemctl start telegram-channel-matrix.service
systemctl status telegram-channel-matrix.service --no-pager
systemctl list-timers telegram-channel-matrix.timer
journalctl -u telegram-channel-matrix.service -n 100 --no-pager
```

定时器每天北京时间 09:00（固定 UTC 01:00）触发，`Persistent=true` 在停机错过后恢复时尝试补跑，运行日期取实际启动时的北京时间日期，不补发历史日期。没有常驻应用进程，也没有人工发送界面。暂不建立 Codex 定时任务。

数据库 advisory lock 防并发运行；`channel + operating_date + daily_digest` 唯一约束限制每频道每天一期。已有 `sent` 在取数及 LLM 前拦截；`sending/uncertain` 阻止重发，须先核对频道。明确被 Telegram 拒绝的 `failed` 可通过相同入口补跑。发送前提交 sending 和完整待发稿，收到匹配频道、正整数 message_id 的 Telegram 成功回执才写 sent、消息 ID 与时间。数据库写回失败也保留 sending 锁，不自动重发。删除频道消息不会清除数据库发送历史。

跨日去重：AI 按原文链接；Steam 按 App ID、价格和活动截止时间识别同一优惠。Steam 最多取 5 条候选，精选优惠列表按折扣排序，最多检查 20 个商品，降价至少 30%、剩余至少 12 小时，必须是中国区 CNY 付费游戏，发送前再次核对类型、价格、折扣、截止时间。覆盖仅限 Steam featured specials，不代表全站优惠或史低。AI 使用三个官方 RSS 的前一北京时间自然日零点到采集时刻窗口，每来源最多 8 条；重叠窗口通过持久化发布记录去重。Prompt 为 `prompts/daily-v1.txt`。当前仍仅使用短摘要和逐字证据匹配，不能自动证明生成句全部语义。

每次运行保存 sources/candidates/LLM 结果/发前复核/最终报告到 `data/runs/`；数据库保存运行报告、每期完整待发稿、入选条目、消息 ID 和状态。零合格内容、来源失败、生成失败和真实发送分别记录。运行报告经原有 SMTP 发给运营者；邮件失败不改写 Telegram 发送结果。进程启动失败、超时或异常退出，由 systemd 退出钩子尝试补发故障邮件。SMTP 提交成功不等于收件箱已收到。

`deploy/backup.sh` 在服务退出时保存本项目自定义格式数据库备份及 SHA256，服务器保留 14 天，不操作其他项目的备份或卷。恢复前应先停用定时器、核对 Telegram 真实发送，再恢复到独立数据库检查；旧备份可能不包含最新发送回执，不得恢复后直接重跑。

GitHub Actions 在 PR 上运行 PostgreSQL 集成测试、类型检查、单元测试和构建；合并或推送到 `main` 后构建镜像并部署。仓库 Secrets 仅保存 SSH 部署连接信息（`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`）。Telegram、LLM、数据库和 SMTP 的运行凭据只保存在 Ubuntu-4 的受保护配置中。部署脚本先检查新镜像的运行配置，再更新源码和 systemd 单元；定时器状态由实例配置管理，部署不会发送频道文章或主动启停定时器。不要用 `test-send` 或 `sample:send` 补发每日精选，这两个历史排版测试工具不使用生产每日锁。

### 首轮生产验收（2026-11-05）

首轮运行 `064279cb-aa18-4955-aabe-e8a8bf12c38d` 已真实发布 [AI 每日精选](https://t.me/ai_product_radar_cn/5)（4 条）和 [Steam 每日精选](https://t.me/steam_deals_radar_cn/5)（5 条），数据库均为 sent，消息 ID 均为 5。运行邮件已提交 SMTP，不代表收件箱送达。

该轮有一条 LLM skip 输出不符合结构校验，因此整体状态为 completed_with_errors；两篇已发送稿不受此状态影响。AI 稿还混入安全研究和客户案例，说明仅靠 Prompt 不能保证栏目范围。后续版本保留 RSS categories，并在调用 LLM 前仅允许 OpenAI 官方 Product 分类；Company、Startup、Research、Security 及缺失分类先跳过。Google/Hugging Face 仍按摘要、发布者与 Prompt 筛选，未来需继续观察范围偏差。这次不删除或重发已发送稿，不清除当日发送记录。

修正版镜像 `telegram-channel-matrix:20261105-v2` 已上线；类型检查、构建和 25 项离线测试通过（另 1 项数据库集成测试本次跳过，首次部署前已使用临时 PostgreSQL 实测通过）。线上再次运行 `d0b43260-565d-4b6a-9118-7f739454455c` 返回 already_sent，两个频道均 blocked_sent，sources 为空，在调用数据源和 LLM 前结束，原消息 ID 保持 5。systemd Result=success，邮件再次提交 SMTP。

频道服务已迁移至 Ubuntu-4。2026-11-06 09:00 的 systemd 定时执行返回 completed：AI 频道发布 2 条、Steam 频道发布 1 条，两个频道的 Telegram 消息回执均已保存，运行报告邮件已提交 SMTP。该次验证证明实例定时和运行配置可以完成一轮发布。部署由 GitHub Actions 管理；首次公开仓库 Actions 部署验收随后记录在本节。

公开仓库首次部署：commit `2a5ed528de1e78251904c946c1eeab8f3b2cf754`，Actions run `42267777122` 成功（测试、镜像构建、SSH 上传和服务器部署均通过）。Ubuntu-4 当前镜像标记与该 commit 一致；systemd 每日定时器仍为 enabled，未因部署而重启或发送内容。GitHub 仓库只包含部署 SSH Secrets；没有加入服务器运行配置、Telegram/LLM/SMTP 密钥、数据库备份或本机凭据路径。


### Host migration (2026-11-06)

Channel publishing now runs on dedicated Telegram host Ubuntu-4, accessed through ssh-telegram. Its database is telegram_channel_matrix inside telegram-postgres on telegram-services. Deployment, provisioning, backup and execution tools target the new host. All Compose commands load --env-file .env before --env-file release.env. Credentials remain in protected local provisioning state and server environment files.

All tables, sequences and four sent publication receipts were preserved and verified after the final restore. A fresh backup was copied offhost and checksum verified. The existing timer stamp was retained: next run 2026-11-07 09:00 Asia/Shanghai, with no migration catch-up or manual publication. Old-host timers are disabled and old Telegram database roles are NOLOGIN. Rollback requires reverse migration of current data before restoring role login and starting old services. Verification of the next scheduled publication and long-term automatic offhost backup remain pending.
