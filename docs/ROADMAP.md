# Delivery status and roadmap

English · [简体中文](ROADMAP.zh-CN.md) · [V1 design and acceptance criteria](V1_DESIGN.md)

## Current prototype

| Area | Prototype coverage |
| --- | --- |
| Daily planning | Quick capture, focus items, scheduled work, linked reading and viewing, deadline reminders and deliberately rescheduled missed work |
| Planner | Today and Tomorrow, Monday–Sunday week views, a month calendar, backlog, undated week and month plans, exact time editing and guarded undo |
| Tasks | Inbox, today, tomorrow, this week, upcoming, all and completed views. Manual editing, project/category filters, completion, cancellation, deletion and rescheduling |
| Resources | External links, PDF and Markdown uploads, typed progress, notes, project associations and linked reading/viewing tasks |
| Projects | Project status, target dates and a detail page linking tasks and resources |
| Personal settings | Workspace language, timezone, color scheme, planning preferences and provider defaults |
| Localization | Simplified Chinese, Japanese and English interfaces, login and settings language selection, localized assistant replies and checked translation catalogs |
| Assistant | Local conversations, provider/model selection, event streaming, real domain tools, local voice transcription, editable autosaved task drafts, explicit confirmation and a receipt that opens the planner |
| Operations | Password-based administration, migrations, change history, guarded undo, credential-free business export, private volume backup and recovery |
| Devices | Desktop workspace, responsive phone view, portrait and landscape iPad layouts with touch-accessible actions |

## V1 integration still to verify

* **Chat and voice.** Exercise each workspace action from chat, including first-provider setup. Verify live microphone capture and transcript quality in Chinese, Japanese and English on supported devices.
* **Private access.** Before enabling personal-LAN HTTPS, verify an approved physical device can connect and company tailnet traffic cannot reach the service over IPv4, IPv6, subnet routes, proxies or Docker forwarding. Repeat after restart. Keep the service loopback-only while any applicable path remains unverified.

## Verification boundaries

The automated backend tests use SQLite and provider fixtures. Browser acceptance tests use the built frontend, authentication, real HTTP endpoints and a temporary database. They simulate the external chat model. Playwright exercises uploaded-audio transcription, draft edits and confirmation, exact time editing, deadline preservation and undo with WebKit touch emulation in both iPad orientations. The same checks can run against local Whisper using a supplied audio file. A physical iPad still needs checks for microphone permission and recording over trusted HTTPS, its keyboard, rotation and Apple Pencil.

The container check exercises migrations, authentication, a local model server, linked projects and resources, an uploaded file, settings and a conversation before and after restart. The backup check also restores into a fresh volume. See the [README](../README.md) for commands.

The provider adapters and ChatGPT authorization helper are implemented. An actual external provider response requires the owner's key or OAuth consent. Catalog access, inference permissions and model capabilities depend on the account. Sign in with ChatGPT also depends on application eligibility and workspace policy. [Provider integration details](AI_PROVIDERS.md)

## Deferred work

* Add multiple schedule entries per task when real usage calls for split sessions or recurring work.
* Extend free-text date handling and planning constraints with examples from actual daily use.
* Validate native keyboard, assistive technology, split view and rotation on physical iPads.
* Extend model capability coverage as providers publish new definitions.
* Add opt-in metadata retrieval with strict outbound request controls. The current library saves links and user-entered metadata.
* Evaluate calendar sync, proactive notifications, document question answering and transcript integrations after the basic workflows have been used with real data.
