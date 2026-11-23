# DayWeave（织日）

[English](README.md) · 简体中文 · [第一版设计与验收标准](docs/V1_DESIGN.zh-CN.md)

织日用于管理工作、生活和学习计划。用户可在浏览器管理任务、项目、资料和截止日期，也可以让 AI 助手操作选定工作区。工作区与助手支持简体中文、日语和英语。

## 首次启动

在装有 Docker Engine 和 Docker Compose 的 Linux 服务器上，进入项目目录并运行以下命令。

```sh
cp .env.example .env
vi .env  # 配置 SMTP 和发件地址
docker compose up -d --build
docker compose ps
```

在服务器私有配置中填写 `DAYWEAVE_SMTP_HOST`、`DAYWEAVE_SMTP_PORT`、`DAYWEAVE_SMTP_SECURITY`（`starttls` 或 `tls`）、`DAYWEAVE_MAIL_FROM`。需要认证的服务还需填写 `DAYWEAVE_SMTP_USER` 和 `DAYWEAVE_SMTP_PASSWORD`，部分邮箱要求使用客户端授权码。注册时填写用户名、密码、邮箱及发到该邮箱的八位验证码。登录支持用户名或邮箱。在“忘记密码？”中验证注册邮箱后即可重设密码，所有现有登录会话同时失效。

本次开发版本从带有早期账号的安装升级时使用新的数据卷。请在启动前让 Compose 指向新卷。升级过程会在变更账号表前检测已有的非空账号库。

在服务器上打开 [DayWeave 本机入口](http://127.0.0.1:8787)，选择**创建账号**。注册时会生成一个个人工作区。在**管理工作区**可以新建工作区，或按用户名添加已注册账号。服务商凭据和模型配置随登录账号使用。所需账号注册后，可设 `DAYWEAVE_ENABLE_SIGNUP=0` 关闭注册。

Compose 将应用后端发布到回环地址，升级旧配置时也适用。开放手机或 iPad 访问前，先验证公司 tailnet 无法通过 IPv4、IPv6、子网路由、Docker 转发，以及 Tailscale Serve 或 Funnel 等代理访问这个个人服务。只要仍有路径未经验证，就继续仅监听回环地址。部署过程无需改动公司的 Tailscale 配置。[网络隔离与验收](docs/V1_DESIGN.zh-CN.md#6-个人局域网与公司-tailscale-的边界)

[宿主机 Caddy 配置](scripts/Caddyfile.lan) 仅监听指定的 IPv4 地址，允许明确列出的客户端访问，并转发到回环地址上的后端。将 `DAYWEAVE_LAN_IP` 设为个人网卡的地址，将 `DAYWEAVE_LAN_CLIENTS` 设为允许的 IP 或网段，以空格分隔。后端设置 `DAYWEAVE_COOKIE_SECURE=1`。经 Docker 转发时，从 `docker network inspect` 取得应用专用网桥的网关地址，填入 `DAYWEAVE_PROXY_IP`，让后端正确识别原始 HTTPS 协议。启动代理前，用主机防火墙将 HTTPS 端口限制在指定网卡和客户端，并限制转发到 Docker 应用网桥的流量。隔离验收后，获准设备信任代理的本地根证书，即可打开 `https://<局域网IP>:8443`。[Caddy 地址绑定](https://caddyserver.com/docs/caddyfile/directives/bind) · [Caddy 本地 TLS](https://caddyserver.com/docs/caddyfile/directives/tls)

## 日常使用

通过快捷录入将尚无计划的任务放入收件箱，再按需要设置项目、优先级、计划时间和截止日期。在资料库添加视频或文档后，点击安排按钮即可创建关联任务。首页集中显示今日重点、任务、阅读与观看以及截止提醒。登录页和工作区设置均可切换语言，时区、主题和默认模型可以分别设置。

将任务卡片拖到另一列即可更改状态。在 iPad 上，先短暂按住卡片再拖动，直接滑动可以滚动看板。使用键盘时，聚焦卡片后按 Alt 加左右方向键可移至相邻列。移入「已完成」会记录完成时间，移回「待办」或「进行中」会重新打开任务。

拖动导航栏、助手侧栏、待安排列表或任务看板各列边缘的分隔线即可调宽。用键盘时，聚焦分隔线后按左右方向键调整，按回车恢复自适应。也可以对助手说「把助手侧栏宽度调到 520 像素」，再点「应用宽度」。浏览器按账号记住宽度，旋转设备时会根据可用空间调整。

在任务编辑器或助手草稿中选「今天」「明天」可以确定执行日期，选「本周」「下周」「本月」则保留待编排的范围。截止日期和截止时段可单独设置。每轮助手回复下方显示服务商报告的 Token 用量，包含本轮查询项目、准备草稿等模型调用。

按工作区时区，执行日过后，未完成的任务自动回到待安排。跨夜的时间块保留到结束日过后。原日期在日历里显示「安排过」。继续做时重新安排同一项任务，全部完成时点「完成任务」。任务状态、项目和截止要求会保留。尚未选定执行日的周计划和月计划保留原范围。

独立编排页把待安排列表和今天、明天、本周、下周或本月的计划放在一起。每周固定从周一至周日。任务可以先放在某周或某月，日后指定日期。选中已安排的任务可以修改时刻、移回收件箱或撤销本次变更。[可交互的日程编排设计稿](docs/design/planner.html?lang=zh-CN)

在「设置 → AI 服务商 → Codex」中连接账号后，可以从该账号的模型目录选择默认模型和支持的推理强度，然后保存配置。对话里也可以打开相同的设置。

需要助手时，在设置中选择服务商、填写凭据，测试连接后选择模型。使用 ChatGPT 订阅授权需要单独的操作流程，并取决于官方接入资格。详见 [AI 服务商接入指南](docs/AI_PROVIDERS.zh-CN.md)。

要求助手创建任务时，对话里会出现可编辑的草稿卡。可以调整标题、计划日期、时段、截止日期和预计耗时，也可以展开项目、分类和备注。修改会自动保存到草稿。点击**确认创建**后，任务才会写入工作区，并可从回执直接打开。取消草稿会保留原任务列表。

打开输入框旁的**语音输入**，在支持录音的浏览器上通过受信任的 HTTPS 录音，也可以选择已有音频。点击**转写到输入框**使用本地 Whisper 模型。校对文字后发送，确认任务草稿，再从回执点**在日历查看**。Docker 镜像构建时会准备模型。在本地开发时，进入仓库根目录运行 `python scripts/prepare-speech.py data/speech`。

以下截图来自应用预览，示例数据来自独立临时工作区。[桌面首页](docs/previews/desktop.png) · [iPad 首页](docs/previews/ipad-portrait.png) · [桌面任务草稿](docs/previews/desktop-draft.png) · [iPad 任务草稿](docs/previews/ipad-draft.png)

日程编排设计稿展示拟议中的桌面和平板布局。[桌面计划页](docs/design/planner-desktop.png) · [iPad 计划页](docs/design/planner-ipad.png)

## 持久化、导出与备份

Compose 会为当前项目创建命名卷并挂载到 `/data`。常规重启、重新构建及 `docker compose down` 都会保留数据。为 `down` 加上 `-v` 会删除命名卷及其中的数据。

在设置中导出 JSON，可以获得便于迁移的业务记录。恢复本地上传文件和服务商凭据需要备份整个数据卷。使用以下命令创建一致的恢复归档。

```sh
sh scripts/backup.sh
```

脚本会短暂停止应用，将完整数据卷归档到 `backups/` 并校验归档。如果应用此前正在运行，脚本随后会将其重新启动。请妥善保管归档，其中包含上传文件、会话记录、密码验证信息和解密服务商凭据所需的密钥。

验证恢复时请选择未使用的项目名和端口，并使用**全新的** Compose 项目与空数据卷。下面的命令从可信归档恢复，不会修改原卷。

```sh
export COMPOSE_FILE=docker-compose.yml COMPOSE_PROJECT_NAME=dayweave-recovery
export DAYWEAVE_PORT=18788 DAYWEAVE_COOKIE_SECURE=0
docker compose build
docker compose run --rm --no-deps -T dayweave sh -c 'test -z "$(ls -A /data)" && tar -xzf - -C /data' < backups/YOUR-ARCHIVE.tar.gz
docker compose up -d
curl --fail http://127.0.0.1:18788/api/health
```

打开恢复后的工作区，核对一条已知任务和一份上传文件后再投入使用。后续启动请沿用相同的 Compose 项目名。

## 本地开发与验证

使用 Python 3.12 和受支持的 Node 22 或 24 版本。以下命令会构建前端、安装后端依赖、迁移数据库并运行测试，然后通过同一服务提供前端和 API。

```sh
(cd frontend && npm ci && npm run build)
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements-dev.txt
cd backend
alembic upgrade head
python -m pytest -q
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

做端到端验证时，保持虚拟环境激活，在仓库根目录执行以下命令。测试会自动启动临时工作区，使用独立数据库、随机密码和模拟的外部模型服务。预览示例只写入该临时环境。

Python 测试验证浏览器依赖的 HTTP 行为，包括工作区权限、任务确认、上传和日程写入。浏览器测试通过构建后的应用验证用户操作流程。

```sh
cd tests/browser
npm ci
npx playwright install chromium webkit
npm run check
npm run preview
```

若无法直接使用已激活的环境，可将 `DAYWEAVE_TEST_PYTHON` 设为 Python 解释器的绝对路径。预览命令会把桌面、手机以及 iPad 横竖屏截图写入 `docs/previews/`。前端资源均由本地服务提供。

浏览器测试在 iPad 横屏和竖屏验证音频文件流程。将 `DAYWEAVE_TEST_VOICE_WAV` 设为“请为机器人跟踪创建一个任务”的 WAV 录音绝对路径，可让该测试使用本地 Whisper 模型。设置 `DAYWEAVE_VOICE_SCREENSHOTS=1` 可导出本次测试的草稿和编排页截图。

在同一个浏览器测试目录运行 `npm run demo`，可打开带示例项目、任务和阅读进度的交互式浏览器。关闭窗口即可结束临时会话。

在 Docker 主机上运行 `sh scripts/test-container.sh`，可检验迁移、登录后的业务操作、本地流式模型、上传文件内容以及容器重启后的数据持久性。脚本会创建并清理名称唯一的测试卷。

## 更多文档

* [产品行为与验收流程](docs/PRODUCT.zh-CN.md)
* [架构、数据存储与时间语义](docs/ARCHITECTURE.zh-CN.md)
* [REST API 与聊天事件](docs/API.zh-CN.md)
* [AI 服务商配置与官方授权](docs/AI_PROVIDERS.zh-CN.md)
* [交付状态与后续计划](docs/ROADMAP.zh-CN.md)

* [iPad 界面调研与Playwright 截图](docs/INTERFACE_RESEARCH.zh-CN.md)
