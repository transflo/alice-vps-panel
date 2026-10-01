# Alice 面板

单用户的 Alice EVO 实例管理面板，基于 Alice Ephemera API 2.0（`https://app.alice.ws/cli/v1`）。
前端用 React + MUI，后端只用 Node.js 标准库。一个 Docker 容器即可运行，API 凭据只保存在服务器端，浏览器永远拿不到。

## 功能

- 实例列表：开关机状态、套餐、系统、IPv4/IPv6（一键复制）、到期时间与倒计时，每 30 秒自动刷新
- 电源操作：开机、关机、重启、强制关机
- 新建实例：选择套餐 → 系统镜像 → 时长 → SSH 密钥，可附带启动脚本；创建后显示返回信息（如 root 密码），并可查看启动脚本的执行输出
- 重装系统、续期、删除（需输入实例 ID 确认）
- 远程执行命令并查看输出（自动解码 Base64 输出）
- 查看实例实时状态（CPU、内存、流量）、账户余额与 EVO 权限
- 自动续期（默认关闭）：按实例开启，到期前 1 小时开始尝试续期，失败最多尝试 3 次，不需要保持页面打开
- Telegram bot（可选）：用手机就能开关机、续期、开关自动续期、执行命令、新建 / 重装 / 删除实例，还会推送自动续期结果和到期提醒
- 浅色 / 深色模式跟随系统，支持手机访问

## 快速开始

需要 Docker 和 Docker Compose。

```bash
cd alice-vps-panel
cp .env.example .env
nano .env            # 填写 PANEL_PASSWORD、ALICE_CLIENT_ID、ALICE_SECRET
docker compose up -d --build
```

容器只监听服务器本机的 `127.0.0.1:10086`，不会直接对外开放，请用反向代理访问（见下文「配合反向代理使用」）。
临时查看可以在自己电脑上开 SSH 隧道：`ssh -L 10086:127.0.0.1:10086 用户@服务器IP`，再打开 `http://127.0.0.1:10086`，用 `PANEL_PASSWORD` 登录。

构建镜像时会在容器里下载前端依赖并打包，第一次需要一两分钟。国内服务器下载慢的话，在 `.env` 里加上
`NPM_REGISTRY=https://registry.npmmirror.com` 再构建。

API 凭据在 Alice 控制台 → Account → API Keys 创建（Client ID 形如 `cli_xxxx`，另有一个 Secret）。

更新代码后重新执行 `docker compose up -d --build` 即可；查看日志用 `docker compose logs -f`。

从旧版本升级也是同一条命令。新版本会自动创建 `alice-data` 数据卷（保存自动续期设置）；
没有这个数据卷（比如自己改过 compose 文件）时，自动续期设置不可用，开启时会提示，其余功能照常。

## 配置项（.env）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PANEL_PASSWORD` | 是 | 面板登录密码，至少 8 位 |
| `ALICE_CLIENT_ID` | 是 | Alice API Client ID |
| `ALICE_SECRET` | 是 | Alice API Secret |
| `SESSION_HOURS` | 否 | 登录有效期，默认 24 小时 |
| `TRUST_PROXY` | 否 | 面板前面的反向代理层数：一层设 `1`，多层（如 CDN + Nginx）设成层数，`0` 表示不信任转发头。用于识别真实 IP 和 HTTPS，默认 `0`（`.env.example` 里是 `1`） |
| `ALICE_API_BASE` | 否 | Alice API 地址，默认 `https://app.alice.ws/cli/v1` |
| `PORT` | 否 | 容器内监听端口，默认 `8080` |
| `DATA_DIR` | 否 | 保存自动续期设置（`state.json`）的目录。Docker 里固定为 `/data`（挂载为 `alice-data` 数据卷），不用 Docker 时默认 `./data` |
| `AUTO_RENEW_BEFORE_MINUTES` | 否 | 自动续期：到期前多少分钟开始尝试，默认 `60`（1 ~ 120） |
| `AUTO_RENEW_RETRY_MINUTES` | 否 | 自动续期失败后两次尝试之间的间隔，默认 `10`（1 ~ 60）；每个到期点最多尝试 3 次 |
| `EXPIRY_WARN_MINUTES` | 否 | 没开自动续期的实例，到期前多少分钟通过 Telegram 提醒，默认 `30`，`0` 关闭（需要启用 bot） |
| `AUTO_RENEW_INTERVAL_SECONDS` | 否 | 调度器检查间隔，默认 `60`（1 ~ 600），一般不用改 |
| `ALICE_CLOCK_OFFSET` | 否 | 解释 Alice `creation_at` 钟面数字用的时区偏移，默认 `+08:00`（见下文「时间」） |
| `DISPLAY_TIME_ZONE` | 否 | Telegram 消息里显示时间用的时区（IANA 名称），默认 `Asia/Shanghai`；网页仍用浏览器本地时区 |
| `TELEGRAM_BOT_TOKEN` | 否 | Telegram bot 的 token，不填就不启动 bot |
| `TELEGRAM_ALLOWED_USER_IDS` | 否 | 允许使用 bot 的数字用户 ID，逗号分隔。设置了 token 却没有这一项，bot 会拒绝启动（面板照常运行） |
| `TELEGRAM_API_BASE` | 否 | Telegram API 地址，默认 `https://api.telegram.org`，一般不用改 |

非法的数值会回退到默认值并在日志里警告，不会让面板起不来。
| `NPM_REGISTRY` | 否 | 构建镜像时下载前端依赖用的 npm 源，默认官方源 |

## 自动续期

默认关闭。在实例卡片的「⋮ → 自动续期」里按实例开启并选择每次续的时长（默认 24 小时），也可以在 Telegram bot 里点「自动续期」。网页和 bot 改的是同一份设置。

- **触发时机**：实例到期前 `AUTO_RENEW_BEFORE_MINUTES` 分钟（默认 60，即到期前 1 小时）开始尝试续期。如果开启时实例已经进入这个窗口，下一轮检查就会续期。
- **失败行为**：续期失败（比如余额不足、Alice 暂时不可用）后，每隔 `AUTO_RENEW_RETRY_MINUTES` 分钟（默认 10）重试，**每个到期点最多尝试 3 次**，试满就不再自动尝试。
  启用了 bot 时，第 1 次失败和最后一次失败各推送一条通知；最后一次失败的通知会告诉你不会再自动尝试了。
  充值后在网页或 bot 里重新保存一次该实例的自动续期设置，会再试一轮。
- 续期成功后到期时间会变长，进入新的周期；同一个到期点不会重复续期。
- 每次续期都会**扣费**。余额不足时续期会失败。
- 设置保存在数据卷的 `state.json` 里，重启不丢。数据目录不可写时，开启自动续期会返回明确的错误提示，其余功能不受影响。
- 调度器按服务器的当前时间判断是否进入窗口，宿主机的时钟需要与 NTP 同步。
- 已经到期的实例（可能已被 Alice 回收）不会再处理；时间字段缺失或无法解析的实例会被跳过。

## Telegram bot

可选。用手机就能完成日常操作，能力与网页对等。

1. 在 Telegram 里找 [@BotFather](https://t.me/BotFather) 创建一个 bot，拿到 token。
2. 查自己的**数字用户 ID**（比如用 @userinfobot 之类的机器人）。
3. 在 `.env` 里填 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_ALLOWED_USER_IDS`，然后 `docker compose up -d --build`。
4. 先对 bot 发一次 `/start`（Telegram 不允许 bot 主动给没联系过它的用户发消息，不发就收不到推送）。

启动时连不上 Telegram（比如服务器刚开机、网络还没就绪）不会让 bot 停用，它会按 1 秒起、最长 30 秒的间隔一直重试；只有 token 无效才会停用，并在日志里说明。

| 命令 / 按钮 | 说明 |
| --- | --- |
| `/list` | 每台实例一张卡片（最多 10 台），按钮：开机、关机、重启、强制关机、续期、自动续期、重装、执行命令、删除、刷新 |
| `/account` | 账户余额与权限 |
| `/deploy` | 新建实例向导：套餐 → 系统 → 时长 → SSH 密钥 → 启动脚本，最后确认 |
| `/exec <实例ID> <命令>` | 以 root 在实例上执行命令，确认后执行，输出会发回来（最多显示末尾 3500 字符） |
| `/cancel` | 取消正在进行的向导或等待输入 |

推送：自动续期成功、自动续期失败（第 1 次和最后一次）、没开自动续期的实例即将到期（带「续期」按钮）。

安全说明：

- **白名单**：只响应 `TELEGRAM_ALLOWED_USER_IDS` 里的用户，且只响应私聊；陌生人、群聊里的消息一律不回复。没有有效白名单时 bot 不会启动。
- **二次确认**：关机、强制关机、重启、删除、重装、新建、执行命令都要点「确认」。确认令牌只能用一次、60 秒过期、只有发起人能用，保存在内存里。
- 新建 / 重装后返回的 root 密码会发到聊天里，**10 分钟后自动删除**，请尽快保存，并建议登录后修改密码或改用 SSH 密钥。
- 启动时会丢弃 bot 离线期间积压的消息，避免重启后把旧指令（尤其是删除）重新执行。
- 重启面板会丢失尚未确认的操作和还没来得及删除的密码消息（那条消息需要手动删除）。
- **`exec` 等于给了 Telegram 账号一个 root shell**。请只把自己的账号加入白名单，并开启 Telegram 的两步验证。
- 所有操作都会写日志（`[bot] user=… action=… instance=…`），执行命令只记录命令长度，不记录内容。

## 配合反向代理使用

面板本身只提供 HTTP，`docker-compose.yml` 默认只把它绑定在 `127.0.0.1:10086`，HTTPS 由宿主机上的反向代理负责。
`.env` 里要设置 `TRUST_PROXY=1`（`.env.example` 默认就是 1），这样面板才能识别 HTTPS（登录 Cookie 才会带 `Secure`）和真实客户端 IP。

Caddy（自动申请证书）：

```
panel.example.com {
    reverse_proxy 127.0.0.1:10086
}
```

Nginx 需要传递 `X-Forwarded-Proto` 和 `X-Forwarded-For`：

```
location / {
    proxy_pass http://127.0.0.1:10086;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

面板的登录限流按 `X-Forwarded-For` 里的客户端 IP 计数。每层代理都会把它看到的地址追加在右边，左边的值是客户端自己写的，不可信，
所以面板只取从右数的第 `TRUST_PROXY` 个：前面只有一层代理就设 `1`；如果前面还有 CDN（如 Cloudflare → Nginx → 面板），设成代理层数 `2`。
层数设小会把 CDN 的地址当成客户端，限流变成「所有人共用一个名额」；设大则会取到客户端伪造的值。

`TRUST_PROXY` 不为 0 时面板会信任这两个请求头，所以不要把 10086 端口直接暴露到公网。如果要改成对外监听，先把 `TRUST_PROXY` 设回 0。

## 安全设计

- Alice 凭据只在服务器端使用，前端所有操作都经过后端代理
- 登录会话为随机令牌，Cookie 设置 `HttpOnly`、`SameSite=Strict`（HTTPS 下自动加 `Secure`）；容器重启后需要重新登录
- 同一 IP 连续 5 次密码错误后锁定 15 分钟
- 修改类请求需携带自定义请求头，防止跨站请求伪造
- CSP 等安全响应头（脚本只允许加载面板自身的文件）
- 容器以非 root 用户运行，除 `/data` 数据卷外文件系统只读、去掉全部 Linux capability、禁止进程提权，端口只绑定在 `127.0.0.1`

运行 `npm test` 可以跑全部测试：时间规范化、状态存储、自动续期调度、Telegram bot、HTTP 集成（Node 内置测试框架，不需要安装依赖）。

## 不用 Docker 运行

需要 Node.js 20.19+ 或 22.12+（前端打包工具 Vite 的要求）。先打包一次前端，再启动后端（后端没有需要安装的依赖）：

```bash
npm run build        # 安装 web/ 的依赖并打包到 public/
PANEL_PASSWORD=你的密码 ALICE_CLIENT_ID=cli_xxx ALICE_SECRET=xxx node server.js
```

## 修改前端

前端源码在 `web/`（Vite + React + MUI）。先按上面的方式在 8080 端口启动后端，然后：

```bash
cd web
npm install
npm run dev          # 打开 http://localhost:5173，接口请求会转发给 8080 端口的后端
```

改完后运行 `npm run build`，或者直接 `docker compose up -d --build` 重新构建镜像。

## 文件结构

```
server.js              HTTP 服务：登录、会话、接口路由、静态文件，并启动调度器和 bot
alice.js               Alice API 客户端（所有 Alice 接口都在这里）
alice-time.js          Alice 时间的规范化（修正 creation_at 的偏移标签）
validate.js            参数校验（网页接口和 bot 共用）
normalize.js           后端用的 Alice 数据整理（移植自 web/src/utils.js，见下）
store.js               状态存储：自动续期设置与去重记录（DATA_DIR/state.json，原子写入）
config.js              环境变量解析与校验
scheduler.js           自动续期与到期提醒的调度器
telegram.js            Telegram Bot API 的最小客户端
bot.js / bot-views.js  Telegram bot：路由、确认令牌、向导、长轮询、推送 / 消息渲染
test/                  测试（含假 Alice、假 Telegram）
web/                   前端源码（Vite + React + MUI）
  src/Dashboard.jsx    实例列表页和各种操作
  src/InstanceCard.jsx 实例卡片
  src/dialogs/         新建、重装、续期、删除、执行命令等弹窗
  src/utils.js         Alice 返回数据的整理和格式化（后端的 normalize.js 是它的另一份实现，改行为时两边要同步）
public/                前端打包结果（构建时生成，不用手动修改）
Dockerfile             两阶段构建：先打包前端，再生成只含后端和静态文件的运行镜像
docker-compose.yml
.env.example
```

## 对接的 Alice 接口

| 面板功能 | Alice 接口 |
| --- | --- |
| 账户信息 | `GET /account/profile` |
| SSH 密钥 | `GET /account/ssh-keys` |
| EVO 权限 | `GET /evo/permissions` |
| 套餐列表 | `GET /evo/plans` |
| 套餐可用系统 | `GET /evo/plans/:id/os-images` |
| 实例列表 | `GET /evo/instances` |
| 新建实例 | `POST /evo/instances/deploy` |
| 删除实例 | `DELETE /evo/instances/:id` |
| 实时状态 | `GET /evo/instances/:id/state` |
| 电源操作 | `POST /evo/instances/:id/power` |
| 重装系统 | `POST /evo/instances/:id/rebuild` |
| 续期 | `POST /evo/instances/:id/renewals` |
| 执行命令 | `POST /evo/instances/:id/exec` |
| 命令结果 | `GET /evo/instances/:id/exec/:uid` |

说明：

- 账户、SSH 密钥、EVO 权限、套餐、系统镜像、实例列表这些只读接口已经用真实账户测试过（2026-09-30）。
  实例的字段按 Alice 控制台和它推荐的 VSCode 插件（Montia37.aliceephemera，调用的是同一套接口）的用法整理，
  取不到的字段不会显示，完整原始数据可以在实例卡片的「⋮ → 详细信息」里查看。
- 余额 `credit` 的单位是百万分之一美元（Alice 控制台显示为 credit ÷ 1,000,000），面板按美元显示。
- 实例列表里的 `status`（active / expired / pending）只表示实例是否有效。卡片上的开关机状态（running / stopped）
  来自实时状态接口，查不到时显示列表里的状态。
- SSH 密钥接口读取失败时（测试账户上它返回 400 `Failed`，推测是账户里还没有密钥），面板只做提示，可以继续用密码登录。
- 命令还没执行完时，查询结果的接口返回 202，面板会继续轮询，最长 5 分钟。
- **时间**：后端把 Alice 返回的 `creation_at` / `expiration_at` 规范化成 UTC，追加 `creation_at_utc` / `expiration_at_utc`，网页、调度器、bot 都读这两个字段，
  页面上显示为浏览器本地时间（bot 用 `DISPLAY_TIME_ZONE`）。实测 `creation_at` 的偏移标签是错的（钟面是 UTC+8，标签却写成 `+01:00`，导致创建时间错位 7 小时），
  所以忽略它的标签，按 `ALICE_CLOCK_OFFSET`（默认 `+08:00`）解释钟面数字；`expiration_at` 的数字和标签自洽，按标签解析。
  不带时区标签的时间按 UTC 处理（目前没有真实数据印证，未验证）。原始字段保持不变，仍可在「⋮ → 详细信息」里看到。
- 重装按参数说明发送 `os_id / ssh_key_id / boot_script`（文档的请求示例写成了 `os / sshKey / bootScript`，VSCode 插件用的是前者）；
  不选 SSH 密钥时不发送 `ssh_key_id`。
- 新建实例时会按账户的 EVO 权限过滤套餐（`allow_packages`）并限制最长时长（`max_time`），无库存的套餐不可选。
