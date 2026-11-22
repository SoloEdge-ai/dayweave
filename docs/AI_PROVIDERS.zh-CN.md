# AI 服务商接入指南

[English](AI_PROVIDERS.md) · 简体中文

DayWeave 将会话、设置、变更回执和待审操作保存在本地 SQLite 数据库中。调用服务商时会发送近期对话片段、本地日期和时间、用户明确设置的规划偏好，以及与请求相关的工具结果。切换服务商时，本地对话仍然保留。各服务商分别使用自己的凭据和额度。

## API Key

在**设置**中选择服务商、填写密钥并保存。**测试连接**会使用当前凭据查询服务商的模型目录。测试成功表示目录访问成功；实际聊天会进一步验证所选模型的推理权限、流式输出和工具能力。可以在聊天输入框附近切换模型，也可以在设置中保存默认值。账号目录可能包含无法生成文本或调用本地工具的模型，实际调用失败时界面会显示上游错误。

| 服务商 | 推理接口 | 推理配置 |
| --- | --- | --- |
| DeepSeek | 官方 Chat Completions | 已适配的 Flash 和 V4 Pro 模型提供自动、关闭、low、high 和 max。关闭时传递禁用思考的参数；明确指定档位时启用思考并传递原生强度；自动模式省略这两项参数 |
| OpenAI API | 使用 API Key 的公共 Responses API | GPT-5.4 支持 none、low、medium、high 和 xhigh。未识别的模型系列使用自动模式 |
| OpenAI 兼容接口 | 管理员配置的 base URL 加 `/chat/completions` | 使用自动模式，省略厂商专有参数。服务需要实现 `/models` 和流式 Chat Completions，任务操作还需要函数调用支持 |
| ChatGPT | 使用符合资格的 OAuth 授权调用公共 Responses API | 仅显示当前账号模型目录报告的推理档位 |

自托管的兼容 HTTP 推理服务器需要在 Compose 中通过 `DAYWEAVE_TRUSTED_HTTP_BASES` 声明准确的 base URL，多个服务以逗号分隔。跨网络连接优先使用 HTTPS。修改自定义目标地址会清除之前的凭据和模型目录。官方服务商地址固定，用户收藏的资料链接不参与推理服务地址选择或抓取。

应用在持久化数据目录生成宿主机专用的 Fernet 密钥，用于加密 API 和 OAuth 凭据。请备份并保护完整目录。单独的数据库文件不含解密密钥。普通工作区 JSON 导出不含服务商凭据。API Key 输入框仅用于写入，适合通过 HTTPS 或 SSH 隧道填写。

本轮调用工具期间，DeepSeek 的推理内容只在内存中保留，并在协议要求时转发给同一个服务商。浏览器事件和工作区历史均不包含该内容。有关 DeepSeek 与 OpenAI 参数的定义，见 [DeepSeek 首次调用](https://api-docs.deepseek.com/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[工具调用](https://api-docs.deepseek.com/guides/tool_calls/)和 [OpenAI GPT-5.4 模型目录](https://developers.openai.com/api/docs/models/gpt-5.4)。

## 自托管服务器上的 ChatGPT 官方登录

**接入资格。** OpenAI 在 2026 年 11 月的文档中介绍了面向开源本地应用和部分获批私有客户端的接入流程。具备资格的 Plus/Pro 用户需要授权相应工作区。个人使用局域网服务器或已购买订阅，不会自动取得应用接入资格。请检查实际部署是否符合官方开源条件，或是否已获得 OpenAI 私有客户端批准。本仓库本身不等于官方批准。运营者需主动启动授权并明确确认资格，应用不会静默注册。参阅[官方快速入门](https://developers.openai.com/siwc/quickstart)与[开源应用注册说明](https://developers.openai.com/siwc/token-sharing-open-source)。

**浏览器与 VM。** 官方回环回调到达运行浏览器的电脑，授权助手应在这台电脑执行。服务器独立生成稳定的主机 ID 和传输密钥，随后生成的短期凭据封装只能由该服务器解密。助手检验返回的 state、动态客户端 ID、PKCE 交换、获批作用域和签名身份信息，其中包括签发者、受众、有效期及 nonce。再次登录时，浏览器所在电脑会复用同一已验证的客户端和账号身份。该单用户版本在服务器保留一个有效服务商账号。参阅[官方注册与登录流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)和[自托管 VM 指南](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)。

在打开浏览器的电脑准备一份 DayWeave 源码，并安装 Python 3.11 以上版本及后端依赖。将示例中的 SSH 主机别名 `dayweave-server` 和项目路径 `/srv/dayweave` 替换为实际部署值。以下 PowerShell 命令通过 SSH 连接已有 Compose 部署。生成的第一个文件是公开的接收端描述；第二个文件仅能在指定的服务器上解密，请在十分钟内导入。

```powershell
ssh dayweave-server 'cd /srv/dayweave && docker compose exec -T dayweave python -m app.ai.oauth prepare' | Set-Content -Encoding utf8 recipient.json
python -m venv .venv-siwc
.\.venv-siwc\Scripts\python -m pip install -r backend/requirements.txt
Push-Location backend
..\.venv-siwc\Scripts\python -m app.ai.oauth login --eligible --recipient ../recipient.json --out ../dayweave-registration.json
Pop-Location
Get-Content -Raw dayweave-registration.json | ssh dayweave-server 'cd /srv/dayweave && docker compose exec -T dayweave python -m app.ai.oauth import'
```

Linux 浏览器电脑可在 `backend/` 中使用虚拟环境的 Python 运行同一助手。可通过输入重定向传输加密封装，例如 `ssh SERVER 'cd PROJECT && docker compose exec -T dayweave python -m app.ai.oauth import' < dayweave-registration.json`。生成的接收端描述和注册封装均应保存在 Git 之外。导入后在设置使用 **ChatGPT → 测试连接**，加载当前账号可见的模型标识和显示名称。模型推理要求授权包含 `chatgpt.tokens.use.direct` 作用域。基础登录成功但缺少该权限时，应用会提示权限要求。模型目录读取失败时，服务商保持未连接状态。

推理适配器发送包含显式历史消息的无状态 Responses 流式请求，通过命名空间组织本地函数，并验证流的终止事件。模型目录访问和实际推理分别验证。凭据存储层通过 SQLite 串行刷新，并将轮换后的凭据一起替换；Web API 不返回令牌。点击**断开授权**会请求撤销刷新令牌并清理本地访问。如果无法连接远端撤销端点，界面会注明远端撤销状态未确认；剩余访问可在 ChatGPT 设置中管理。参阅[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[刷新与撤销](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)和 [ChatGPT 用量](https://chatgpt.com/settings/usage)。

## 工具执行与验证

1. 已认证客户端提交稳定的请求 ID。服务端先在本地预留本轮操作并保存用户消息，再开始推理。重放已完成的请求会返回原回执。被中断的运行中请求可在三分钟租约到期后通过同一 ID 重试；被新执行者替代的旧进程无法提交后续写操作。
2. 上下文包含有限的近期对话、工作区语言和已配置的时区。新回复使用当前语言。工具只提供领域操作，不开放任意 SQL、URL 抓取、文件或 Shell 访问。助手按需查询结构化任务、项目和资料。
3. 工具输入经 Pydantic 及手动操作共用的业务服务校验。如果同名结果有多个，助手会请求澄清。日期保留原精度。搜索结果作为数据处理，不能授予新的工具权限。
4. 创建任务（包括安排阅读和观看）首先生成可编辑的 `task_draft`。浏览器带版本号自动保存修改，由用户在消息内确认或取消。确认会创建任务、写入变更记录并更新回执。删除、批量写入和计划与截止冲突等操作也进入持久化确认队列。确认前校验目标对象的当前状态，再次提交已审批的提案会返回原结果。详见[草稿 API](API.zh-CN.md#可编辑的任务草稿)。
5. 只读回答通过 SSE 增量输出服务商文本。更新任务会返回已提交的结构化工具回执和本地生成的说明。网络或服务商失败时保留已完成的操作，并给出可恢复的错误。计费服务商只会按用户的选择切换。

在 `backend/` 中运行以下命令。

```bash
python -m pytest -q tests/test_ai.py tests/test_ai_oauth.py
```

这些测试使用模拟服务商、真实 SQLAlchemy 事务和 HTTP 传输测试夹具检查协议兼容性。真实模型行为、第三方账号批准、计费和授权同意取决于运营者提供的凭据。测试夹具验证通过只代表本地流程通过，真实账号仍须单独验证。
