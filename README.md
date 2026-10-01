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
| `NPM_REGISTRY` | 否 | 构建镜像时下载前端依赖用的 npm 源，默认官方源 |

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
- 容器以非 root 用户运行，文件系统只读、去掉全部 Linux capability、禁止进程提权，端口只绑定在 `127.0.0.1`

运行 `npm test` 可以跑登录限流的回归测试（Node 内置测试框架，不需要安装依赖）。

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
server.js              HTTP 服务：登录、会话、接口路由、静态文件
alice.js               Alice API 客户端（所有 Alice 接口都在这里）
web/                   前端源码（Vite + React + MUI）
  src/Dashboard.jsx    实例列表页和各种操作
  src/InstanceCard.jsx 实例卡片
  src/dialogs/         新建、重装、续期、删除、执行命令等弹窗
  src/utils.js         Alice 返回数据的整理和格式化
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
- 不带时区的时间（如 `2025-11-23 14:25:25`）按 UTC 处理，页面上显示为浏览器本地时间。
- 重装按参数说明发送 `os_id / ssh_key_id / boot_script`（文档的请求示例写成了 `os / sshKey / bootScript`，VSCode 插件用的是前者）；
  不选 SSH 密钥时不发送 `ssh_key_id`。
- 新建实例时会按账户的 EVO 权限过滤套餐（`allow_packages`）并限制最长时长（`max_time`），无库存的套餐不可选。
