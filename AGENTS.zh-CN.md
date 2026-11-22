# DayWeave 开发约定

[English](AGENTS.md) · 简体中文

DayWeave 是以本地数据为基础的单人计划工具。应用界面和助手支持 `zh-CN`、`ja` 和 `en`。仓库文档维护英文和简体中文两个版本。无语言后缀的 Markdown 文件是默认英文入口，同目录的 `.zh-CN.md` 文件是中文版本，两者均应提供语言切换链接。

* `backend/app/` 负责认证、持久化、计划安排和校验。`backend/app/ai/` 负责服务商协议、本地聊天历史和工具执行。
* `frontend/src/` 包含 React 应用。正式页面使用 API 返回的数据，示例记录只放在独立临时测试环境。
* `tests/browser/` 用 Playwright 测试构建后的应用并生成预览。改动导航或编辑交互时，检查 iPad 横屏与竖屏。
* `docs/` 收录产品、架构、API、服务商配置和开发计划。部署和备份步骤见[项目说明](README.zh-CN.md)。

保留本地日历日期、精确时间戳和上午、下午等时段各自的精度。手动操作与 AI 写操作使用同一业务服务。服务商凭据和加密密钥应排除在 API 响应、日志和源码管理之外。修改持久化结构时新增 Alembic 迁移。

AI 创建任务必须先在聊天中生成可编辑草稿。保存草稿版本，由用户明确确认，已创建和已取消的卡片均保留在历史中。验证提出与编辑草稿两个操作均不会创建任务。

界面文案使用共享的 i18next/React 集成，以及 `frontend/src/locales/{zh-CN,ja,en}.json` 中有类型约束的词条目录。`npm run build` 期间的 Vite/Babel 提取流程会收集界面文案并检查目录覆盖情况。用户的任务标题、服务商模型 ID 等数据应按原值显示。同步更新三种语言的可见文本、无障碍标签和校验反馈。构造助手上下文时带上当前语言，历史消息保持原文。

向公开仓库贡献修改时，请创建功能分支并向 `main` 发起拉取请求。受保护的主分支通过 squash merge 合入。[DayWeave 仓库](https://github.com/SoloEdge-ai/dayweave)

报告验证结果前，在 `backend/` 运行 `python -m pytest -q`，在 `frontend/` 运行 `npm ci && npm run build`，并按[项目说明](README.zh-CN.md)执行相关浏览器检查。
