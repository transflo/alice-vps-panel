# 时间修复、自动续期、Telegram bot：设计

日期：2026-10-01　状态：待用户评审

## 0. 目标与范围

| # | 内容 | 说明 |
| --- | --- | --- |
| ① | 修复创建时间错位 7 小时 | 现象与根因见 §1 |
| ② | 实例自动续期 | 按实例开关，**默认关闭**，需手动开启；由后端定时执行，不依赖浏览器 |
| ③ | Telegram bot | 功能范围：**全部功能**（用户选定），含新建、删除、重装、远程执行命令；安全措施见 §4 |

实施顺序 ① → ② → ③。②依赖①（调度器要靠到期时间判断何时续期），③复用②的存储与调度器（推送续期结果）。三者各自可单独交付、单独验证。

不做（YAGNI）：多用户 / 多账户；续期前检查余额（失败时通知即可）；累计续期上限；Telegram webhook；bot 里的 SSH 密钥管理。

## 1. ① 时间修复

### 1.1 现象与证据

同一个实例（部署时选了 24 小时）在"详细信息 → 实例数据"里的原始值：

| 字段 | 原始值 | 换算成 UTC | 在 UTC+8 显示 | 实际应为 |
| --- | --- | --- | --- | --- |
| `creation_at` | `2026-10-01T03:38:55+01:00` | `2026-10-01T02:38:55Z` | `10-01 10:38`（面板当前显示） | `10-01 03:38`（用户确认的真实创建时间） |
| `expiration_at` | `2026-10-01T20:38:55+01:00` | `2026-10-01T19:38:55Z` | `10-02 03:38`（正确） | `10-02 03:38` |

- 两个字段都带 `+01:00` 标签（Alice 用这个偏移序列化时间）。`expiration_at` 的数字和标签自洽，是正确的时刻；`creation_at` 的数字却是 UTC+8 的钟面（`03:38`），标签照搬了 `+01:00`，所以按标签换算会晚 8 − 1 = **7 小时**。
- 交叉验证：真实创建时刻 `2026-09-30T19:38:55Z` 加 24 小时 = `2026-10-01T19:38:55Z`，和 `expiration_at` 完全一致（到秒）；而按标签解析的创建时间 `02:38:55Z` 加 24 小时对不上。
- 浏览器端 `getHours()` 等取的是本地时区，服务器和 Docker 的 `TZ` 与此无关。
- 参考插件（Montia37/AliceEphemera `src/utils/time.ts`）对时间字符串直接 `new Date(str)`，没有处理这个问题。

**根因**：Alice 返回的 `creation_at` 偏移标签错误（数字是 Alice 服务器本地时间 UTC+8，标签却是 `+01:00`），面板信任了这个标签。`expiration_at` 没有这个问题。

**前置核实项 A1（已核实）**：`expiration_at` 的标签与数字自洽，按标签解析即得正确时刻（上表，且与创建时刻 + 24 小时相符）。两条原始值固化为测试夹具。

**仍未验证的假设 A2**：`creation_at` 的钟面数字在任何季节都是 UTC+8（标签随伦敦夏令时 / 冬令时在 `+01:00` / `+00:00` 间变化，数字不变）。目前只有一个样本；忽略标签、固定按 `ALICE_CLOCK_OFFSET` 解释的规则不依赖标签，所以对标签变化免疫，但如果 Alice 服务器时区不是 UTC+8，用户需要改 `ALICE_CLOCK_OFFSET`。

### 1.2 方案：后端统一规范化，保留原始字段

- 新增 `alice-time.js`，导出 `parseAliceTime(value, opts)`，返回 ISO 8601 UTC 字符串（`...Z`）或 `null`。
- `alice.js` 在 `listInstances()` 的每条记录和 `renew()` 的返回里**追加**两个字段：`creation_at_utc`、`expiration_at_utc`。**原始字段保持不动**，"详细信息 → 实例数据"仍显示 Alice 的原始值，方便以后排查。
- 前端 `normInstance` 优先读 `*_at_utc`，读不到再回退到原来的字段和 `toDate`。`RenewDialog` 同理读 `expiration_at_utc`。
- 调度器和 bot 只使用 `*_at_utc`。时区的判断集中在这一个文件。

### 1.3 解析规则

| 字段 | 规则 |
| --- | --- |
| `expiration_at` | 现有行为不变：带 `Z` / `±hh:mm` 的按标签；不带标签的按 UTC；纯数字按 epoch（< 1e12 视为秒） |
| `creation_at` | **忽略标签**：取钟面数字，按 `ALICE_CLOCK_OFFSET`（默认 `+08:00`）解释 |

只改 `creation_at` 是有意的：到期时间已经正确（A1），且驱动自动续期，不能冒险改动；创建时间只用于显示。不带标签的格式目前没有真实数据印证，README 里的"按 UTC"说法保留并注明"未验证"。

示例（同时是测试用例，来自 §1.1 的真实数据）：

- `parseAliceTime('2026-10-01T03:38:55+01:00', { ignoreOffset: true })` → `2026-09-30T19:38:55.000Z`，在 UTC+8 显示为 `2026-10-01 03:38`。
- `parseAliceTime('2026-10-01T20:38:55+01:00')` → `2026-10-01T19:38:55.000Z`，在 UTC+8 显示为 `2026-10-02 03:38`。
- 回归断言：规范化后的到期时间减创建时间恰好等于 24 小时。

## 2. ② 自动续期

### 2.1 持久化

- `store.js`：状态文件 `${DATA_DIR}/state.json`（默认 `./data`，Docker 里是 `/data`）。写入采用"写临时文件 → rename"，同步执行，进程异常退出也不会留下半个文件。
- 内容：
  ```json
  {
    "version": 1,
    "autoRenew": { "<id>": { "enabled": true, "hours": 24, "updatedAt": "<iso>", "lastSeen": "<iso>" } },
    "cycle": { "<id>": { "renewedFrom": "<到期时间 iso>", "failedFor": "<到期时间 iso>", "warnedFor": "<到期时间 iso>" } }
  }
  ```
  `cycle` 记录"这个到期时间点已经续过 / 已通知失败 / 已提醒过"，用于去重。到期时间变了（续期成功）就是新的周期。
- 文件损坏（JSON 解析失败）：改名为 `state.json.bak`，用空状态启动并打日志，不阻止面板启动。
- 目录不可写：`available = false`，开启自动续期时返回 503 和明确提示（见 §5 的 README 更新），面板其余功能不受影响。
- 清理：每轮把仍存在的实例 `lastSeen` 更新为当前时间；`lastSeen` 超过 7 天的条目删除。不因"列表里没有它"立即删除，防止接口返回异常结构时误清空。通过面板或 bot 删除实例时立即删除该条目。

### 2.2 调度器

`scheduler.js`，在 `server.js` 启动时运行。

- 每 60 秒一轮；**仅当存在已开启自动续期的实例，或 bot 已启用时才拉实例列表**，否则不调用 Alice。轮与轮之间不重叠（有未完成的一轮就跳过）。
- 判断逻辑是纯函数 `decide(entry, inst, now, cfg)`，返回 `renew` / `warn` / `none`，不碰网络，便于表驱动测试：
  - 实例 `status` 含 `expire`、或没有 `expiration_at_utc` → `none`。
  - 剩余时间 `remaining = 到期时间 − now`。`remaining ≤ 0`（已到期，实例可能已被回收）→ `none`。
  - 已开启自动续期且 `remaining ≤ AUTO_RENEW_BEFORE_MINUTES`（默认 **60**，即到期前 1 小时）且 `cycle.renewedFrom ≠ 当前到期时间`，并且这个到期点还没试满 3 次、距上次尝试已过 `AUTO_RENEW_RETRY_MINUTES`（默认 10）→ `renew`。尝试次数 `cycle.attempts` 属于某一个到期点（`cycle.attemptFor`），到期时间变了就重新计数。
  - 未开启自动续期、bot 已启用、`remaining ≤ EXPIRY_WARN_MINUTES`（默认 30，设 0 关闭）且 `cycle.warnedFor ≠ 当前到期时间` → `warn`。
- `renew`：调用 `alice.renew(id, hours)`。成功后写入 `cycle.renewedFrom = 续期前的到期时间`，通知"已自动续期 N 小时，新到期时间 X"。先记下本次尝试（`attempts` / `lastAttemptAt`）再调用 Alice。失败后每隔 `AUTO_RENEW_RETRY_MINUTES` 分钟重试，**每个到期点最多尝试 3 次**，试满后不再尝试；只在**第 1 次失败**和**最后一次（第 3 次）失败**时通知（`renew_failed` 事件带 `attempt` / `maxAttempts` / `final`），通知里带错误信息。用户重新保存该实例的自动续期设置（比如充值之后）会清掉计数，再试一轮；`renewedFrom` 保留，不会重复续期。该规则对网页和 bot 开启的自动续期一视同仁（状态都在 `state.json`）；网页弹窗和 bot 菜单里的说明文字显示这几个数值（`GET /api/auto-renew` 返回 `policy`）。
- 请求超时这类结果不明的失败：下一轮以最新的到期时间为准，如果实际已续成功则不会重复续。
- 通知通过注入的 `notify(text, extra)` 发出；bot 未启用时只写日志。
- 时间依赖：判断用的是 `Date.now()`，宿主机时钟需要和 NTP 同步（README 里写明）。

### 2.3 接口与前端

- `GET /api/auto-renew` → `{ data: { available: boolean, items: { "<id>": { enabled, hours } } } }`。
- `POST /api/instances/:id/auto-renew`，body `{ enabled: boolean, hours?: int }`。`enabled` 为 true 时 `hours` 必填，校验同现有的 `hours()`（1 ~ 8760）。沿用项目现有的 POST 风格和 `X-Panel` 防 CSRF 头。
- 前端：
  - `Dashboard` 的 `load()` 同时请求 `/api/auto-renew`，把 `autoRenew` 映射传给 `InstanceCard`。
  - 卡片上已开启时在到期倒计时旁显示 `自动续期 24h` 的小标签。
  - "⋮ 更多操作"菜单新增"自动续期"，打开新的 `dialogs/AutoRenewDialog.jsx`：开关 + `DurationField`（默认 24，受 `useMaxHours` 约束）。`available=false` 时开关禁用并提示。

## 3. ③ Telegram bot

### 3.1 运行方式与配置

新增 `bot.js`，用 Node 自带 `fetch` 对接 Bot API，`getUpdates` 长轮询，不引入第三方依赖（后端保持零依赖），不需要对公网开放回调地址。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | 无 | 不设置则 bot 不启动 |
| `TELEGRAM_ALLOWED_USER_IDS` | 无 | 逗号分隔的数字用户 ID。设置了 token 却没有这一项 → bot 拒绝启动并打错误日志（面板照常运行） |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | 可选。用户的服务器可以直连 Telegram，一般不用改；保留它只是为了以后需要走反代时不用改代码 |
| `DISPLAY_TIME_ZONE` | `Asia/Shanghai` | IANA 时区名，只用于 bot 消息里的时间；网页仍用浏览器本地时区 |
| `AUTO_RENEW_BEFORE_MINUTES` | `60` | 自动续期的触发窗口（1 ~ 120）：到期前多久开始尝试 |
| `AUTO_RENEW_RETRY_MINUTES` | `10` | 自动续期失败后两次尝试之间的间隔（1 ~ 60）；每个到期点最多尝试 3 次 |
| `EXPIRY_WARN_MINUTES` | `30` | 未开自动续期时的到期提醒窗口，`0` 关闭 |
| `AUTO_RENEW_INTERVAL_SECONDS` | `60` | 调度器轮询间隔（1 ~ 600）。一般不用改，集成测试里调小以便快速验证 |
| `ALICE_CLOCK_OFFSET` | `+08:00` | 解释 `creation_at` 钟面数字用的偏移（§1.3） |
| `DATA_DIR` | `./data` | 状态文件目录，Docker 镜像里固定为 `/data` |

数值类变量非法时回退到默认值并打警告，不让面板因配置错误无法启动。

### 3.2 交互

入口是 `/list`：每台实例一条消息，带内联按钮，同一条消息原地刷新（`editMessageText`），不刷屏。最多显示 10 台，多出的提示数量。

- 卡片文字：名称、ID、状态、IPv4 / IPv6（等宽字体便于复制）、到期时间（`DISPLAY_TIME_ZONE`）和剩余时间、自动续期状态。
- 按钮：开机、关机、重启、强制关机、续期、自动续期、重装、执行命令、删除、刷新。续期点击后选时长（受账户 `max_time` 约束），自动续期点击后选"关闭"或"开启 + 时长"。
- 其他命令：`/deploy`（向导）、`/exec <实例ID> <命令>`、`/account`（余额与 EVO 权限）、`/help`、`/cancel`（取消正在进行的向导）。
- 向导（新建 / 重装）：逐步按钮选择套餐 → 系统 → 时长 → SSH 密钥 → **可选的启动脚本**（直接发送文本，或点"跳过"；Telegram 单条消息最多 4096 字符，更长的脚本请用网页）→ 确认。套餐按账户 `allow_packages` 过滤、无库存的不可选，逻辑与网页 `planOptions` 一致。向导状态按用户保存在内存里，10 分钟无操作过期。
- `callback_data` 不超过 64 字节，格式 `<动作>:<实例ID>[:<参数>]`。需要确认的操作不把参数直接放进 `callback_data`，见 §4。
- 回复用 HTML 解析模式，所有动态文本做转义。
- `exec`：提交后每 2 秒轮询结果，最长 5 分钟（完成判断沿用网页 `CommandDialogs.jsx` 的规则：`RUNNING_RE` 与输出是否为空）。输出 Base64 解码并去掉 ANSI 控制符，放进 `<pre>`；超过 3500 字符只保留**末尾** 3500 字符并说明已截断。轮询在独立任务里进行，不阻塞长轮询主循环。

### 3.3 推送

- 自动续期成功 / 第一次失败 / 3 次都失败（不会再试，需要手动处理）。
- 实例即将到期且未开自动续期（每个到期点只提醒一次，消息带 [续期] 按钮）。
- 推送给白名单里的所有用户。Telegram 要求用户先对 bot 发过 `/start` 才能收到推送，README 里说明。

### 3.4 数据整理

bot 和调度器需要在后端整理 Alice 的返回数据（实例、套餐、系统镜像、SSH 密钥、权限）。网页端的整理逻辑在 `web/src/utils.js`（ESM，经 Vite 打包），运行时镜像里没有 `web/`，两边无法直接共用。所以在后端新增 `normalize.js`，**移植**所需的最小子集（`pick`、`asList`、`normInstance`、`flattenImages`、套餐过滤、`maxHours`、`decodeOutput`），并用单元测试固定行为。代价是两份实现可能漂移，已在 README 的"文件结构"里注明。

校验函数（`ID_RE`、`hours()`、`optText` 等）从 `server.js` 抽到 `validate.js`，网页路由和 bot 共用。

## 4. bot 的安全措施

选择"全部功能"意味着 bot 账号被盗 = 拿到所有实例的控制权，`exec` 等于 root shell。因此：

1. **白名单**：只认 `TELEGRAM_ALLOWED_USER_IDS` 里的数字 ID（用户名可以改，不用）；只响应**私聊**；其他来源（群、频道、未授权用户）一律**静默忽略**，只在日志里记 `[bot] 忽略未授权 id=…`，不回复任何内容。
2. **二次确认**：删除、重装、新建、`exec`、关机 / 重启 / 强制关机（网页上同样需要确认）都要点确认按钮。确认通过服务端内存里的一次性令牌实现：令牌随机、绑定发起人的用户 ID、60 秒过期、使用一次即作废。确认消息会完整显示动作和目标；`exec` 显示完整命令原文。令牌不进持久化存储。
3. **启动时丢弃积压**：启动后先用 `getUpdates?offset=-1` 取到最新的 update ID 并从其后开始，不重放离线期间的指令，避免旧的删除类指令在重启后被执行。
4. **root 密码**：新建 / 重装返回的结果消息（含 root 密码）在发送 10 分钟后由 bot 调用 `deleteMessage` 删除，并在消息里提醒尽快改密码或改用 SSH 密钥。容器在 10 分钟内重启则不会自动删除，README 说明这一点。
5. **审计日志**：每次 bot 操作记一行（用户 ID、动作、实例 ID；`exec` 只记命令长度，不记内容）。
6. **失败默认关闭**：配置缺失、白名单为空、token 无效都让 bot 停用，而不是放宽。
7. **错误隔离**：单条 update 的处理异常只回复"操作失败：…"，不影响主循环；`getUpdates` 出错指数退避（1 秒起、最长 30 秒）。

## 5. 部署与文档改动

- `Dockerfile`：`COPY` 增加新增的后端模块；`RUN mkdir -p /data && chown node:node /data`（必须在 `USER node` 之前）；`ENV DATA_DIR=/data`。
- `docker-compose.yml`：新增命名卷 `alice-data` 挂载到 `/data`。容器其余部分保持只读，`cap_drop`、`no-new-privileges` 不变。命名卷首次创建时会继承镜像里 `/data` 的属主，所以 `node` 用户可写。
- `.env.example`：加入 §3.1 的变量。
- `README.md`：功能列表、配置项、文件结构、升级说明（旧部署需要 `docker compose up -d --build` 才会创建数据卷）、时间处理的修正（原第 157 行关于"按 UTC"的说法）、Telegram 使用说明、重启会丢失待确认操作与未删除的密码消息等限制。

## 6. 测试

沿用项目现有的 `node --test`，不新增依赖。

- `test/alice-time.test.js`：真实样本（`+01:00` 的 `creation_at`、A1 核实后的 `expiration_at`）、各种格式、非法输入。
- `test/store.test.js`：原子写入、损坏文件恢复、目录不可写、7 天清理。
- `test/scheduler.test.js`：`decide()` 表驱动（窗口边界、已续过去重、已到期、已提醒、未开启）；`tick()` 用假的 alice、假时钟、假 `notify`，覆盖成功、首次失败只通知一次、重试、超时后以新到期时间为准。
- `test/bot.test.js`：注入假的 `fetch` 模拟 Telegram。覆盖：未授权 / 非私聊被忽略且无回复；启动丢弃积压；令牌绑定用户、过期、一次性；删除 / exec / 关机必须确认；向导流程；exec 输出解码与截断；密码消息的删除调用。
- `test/helpers/mock-alice.js`：本地假 Alice API，供集成测试和手动验收用（`ALICE_API_BASE` 指向它）。集成测试启动真实 `server.js` + 假 Alice，验证 `/api/auto-renew` 接口和续期落库。
- 前端没有测试框架：用 `npm run build` 保证能打包，并用假 Alice 跑起面板后在浏览器里手动检查卡片、自动续期弹窗、创建时间显示。
- 真实 Telegram 和真实 Alice 的验收需要用户提供 token 与账户，留给用户做最后验证。

## 7. 考虑过但没有采用的方案

- **只改前端 `toDate`**：自动续期要在后端判断到期时间，前端修了后端仍会错。
- **信任所有时间字段的标签 / 忽略所有标签**：前者保留现有错误，后者可能破坏目前显示正确的 `expiration_at`。只改已被证据证明有问题的 `creation_at`。
- **用 telegraf 等框架**：多一个依赖，而面板的特点之一是后端零依赖；需要的 Bot API 调用只有 `getUpdates`、`sendMessage`、`editMessageText`、`answerCallbackQuery`、`deleteMessage`，用 `fetch` 足够。
- **webhook**：需要公网 HTTPS 回调并校验来源，面板默认只监听 127.0.0.1。
- **状态存环境变量或 Alice 侧**：环境变量无法运行时切换；Alice 没有对应字段。
- **前端和后端共用同一份整理代码**：运行镜像里没有 `web/`，要共用得改构建流程，收益不抵成本。
