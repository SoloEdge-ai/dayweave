# AI providers

English · [简体中文](AI_PROVIDERS.zh-CN.md)

DayWeave keeps conversations, settings, change receipts and reviewable actions in the local SQLite database. A provider receives the recent conversation excerpt, local date/time, explicit planning preferences, and relevant tool results. Changing provider keeps the local conversation. Each provider uses its own credentials and limits.

The saved interface language selects Simplified Chinese, Japanese, or English for new AI replies, draft prompts, provider status messages, and change receipts. Switching languages preserves original task titles, notes, and historical conversations. Relative dates in all three languages resolve against the workspace time zone. A draft retains its original local date when reopened on a later day.

## API keys

Open **Settings**, select a provider, enter its key and save. **Test connection** calls the provider's model catalog using this credential. A successful check means catalog access succeeded. A chat exercises inference permissions, streaming, and tool support for the selected model. Pick a model in the chat composer or save defaults in settings. An account may list models that do not support text generation or local tools. Such a selection surfaces its upstream error when used.

| Provider | Inference endpoint | Reasoning controls |
| --- | --- | --- |
| DeepSeek | Official Chat Completions | Known current Flash and V4 Pro models expose Auto, off, low, high and max. Off sends disabled thinking. Explicit levels enable thinking and set its native effort. Auto omits both fields. |
| OpenAI API | Public Responses API with an API key | GPT-5.4 supports none, low, medium, high and xhigh. Unknown model families use Auto. |
| OpenAI-compatible | The administrator's base URL plus /chat/completions | Auto, leaving vendor-specific fields absent. Requires a Chat Completions implementation with /models, streaming, and function calling for task actions. |
| ChatGPT | Public Responses API using an eligible OAuth grant | Only levels reported by the selected account's model catalog are exposed. |

For an on-premises compatible HTTP server, set `DAYWEAVE_TRUSTED_HTTP_BASES` to the exact base URL (comma-separated for multiple services) in Compose. Prefer HTTPS for network links. Changing the custom destination clears the previous credential and catalog. Official destinations are fixed. User-saved resource links do not participate in provider selection or fetching.

The application encrypts API/OAuth secrets with a generated host-local Fernet key in the persistent data directory. Back up that directory and protect the backup. A database copy alone does not contain the decryption key. Ordinary workspace JSON exports omit provider credentials. The password-style API key input is write-only. Keys should be entered over HTTPS or an SSH tunnel.

DeepSeek reasoning content is held only in memory during the current tool exchange and is forwarded to the same provider when required. It is excluded from browser events and the workspace history. See the [first API call](https://api-docs.deepseek.com/), [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/) and [tool calling](https://api-docs.deepseek.com/guides/tool_calls/). OpenAI model parameters are documented in the [GPT-5.4 catalog](https://developers.openai.com/api/docs/models/gpt-5.4).

## Sign in with ChatGPT on a self-hosted server

**Eligibility.** OpenAI's November 2026 documentation describes an open-source local-app flow and selected private clients. Eligible Plus/Pro users must authorize the appropriate workspace. A personal LAN server or an existing subscription alone does not establish the application's eligibility. This repository does not confer open-source or private-client approval. Use the flow below only when your installation qualifies or OpenAI has approved it. The application never registers silently. The operator starts authorization and confirms eligibility explicitly. [Official quickstart](https://developers.openai.com/siwc/quickstart) · [OSS registration overview](https://developers.openai.com/siwc/token-sharing-open-source)

**Browser and VM.** OpenAI's loopback callback reaches the computer running the browser. Run the authorization helper on that computer. The VM independently generates its stable host ID and transfer key. Only the VM can decrypt the resulting short-lived credential envelope. The helper validates the returned state, dynamic client ID, PKCE exchange, granted scopes and signed identity, including issuer, audience, expiry and nonce. Returning sign-ins reuse the same verified client/account identity on that browser computer. This single-user version keeps one active provider account on the VM. [Official registration guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) · [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)

On the computer that will open the browser, use a DayWeave source checkout with Python 3.11+ and the backend dependencies. Replace the SSH host and path if necessary. The following PowerShell commands use SSH to reach the existing Compose deployment. The first file is public. The second is encrypted for that particular VM. Import it within ten minutes.

```powershell
ssh dayweave-server 'cd /srv/dayweave && docker compose exec -T dayweave python -m app.ai.oauth prepare' | Set-Content -Encoding utf8 recipient.json
python -m venv .venv-siwc
.\.venv-siwc\Scripts\python -m pip install -r backend/requirements.txt
Push-Location backend
..\.venv-siwc\Scripts\python -m app.ai.oauth login --eligible --recipient ../recipient.json --out ../dayweave-registration.json
Pop-Location
Get-Content -Raw dayweave-registration.json | ssh dayweave-server 'cd /srv/dayweave && docker compose exec -T dayweave python -m app.ai.oauth import'
```

For a Linux browser workstation, run the same helper from `backend/` with the virtual environment's Python. Transfer the envelope with input redirection, for example `ssh SERVER 'cd PROJECT && docker compose exec -T dayweave python -m app.ai.oauth import' < dayweave-registration.json`. Keep generated descriptor and envelope files outside Git. After import, choose **ChatGPT → Test connection** to load the current account's visible model slugs and display names. The grant must include `chatgpt.tokens.use.direct` to enable inference. A valid basic sign-in with a missing scope shows a permission requirement. A failed model lookup leaves the provider disconnected.

The inference adapter sends stateless streaming Responses requests with explicit input history, uses namespaces for local functions and requires a terminal completion event. Catalog access and successful inference are tracked separately. The credential store serializes refreshes against SQLite, replaces rotating credentials together, and exposes no tokens through the web API. Use **Disconnect** to revoke the refresh token and remove local access. If the remote endpoint is unavailable, the interface reports that remote revocation is unconfirmed. Manage remaining access in ChatGPT settings. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) · [Refresh and revocation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) · [ChatGPT usage](https://chatgpt.com/settings/usage)

## Tool workflow and verification

1. An authenticated client submits a stable request ID. The server reserves a local turn and stores the user message before inference. A completed replay returns the existing receipt. An abandoned running request can be retried with the original ID after its three-minute lease expires. A superseded worker cannot commit a later mutation.
2. Context includes a bounded recent conversation, the workspace language and the configured timezone. New replies use the selected language. Tool schemas expose domain-specific operations without unrestricted SQL, URL retrieval, file access, or shell access. The assistant queries structured task/project/resource state on demand.
3. Tool inputs are validated against Pydantic schemas and the same domain services used by manual actions. Names with multiple matches request clarification. Dates retain their precision. Search results are data; their contents cannot grant access to new tools.
4. Task creation, including scheduled reading or viewing, first produces an editable `task_draft`. The browser autosaves edits with their version, and the user confirms or cancels in the message. Confirmation creates the task, records the change and updates the receipt. Other high-impact operations, including deletes, groups of writes and deadline conflicts, also enter a persisted confirmation queue. Existing target state is checked before approval; replaying an approval returns its saved outcome. [Draft API](API.md#editable-task-drafts)
5. Read-only answers stream provider text through SSE. Task updates emit committed structured tool receipts and locally generated descriptions. Network or provider failures preserve completed work and expose a recoverable error; the system does not silently switch billing providers.

Run from `backend/`:

```bash
python -m pytest -q tests/test_ai.py tests/test_ai_oauth.py
```

These tests use a simulated provider, real SQLAlchemy transactions, and HTTP transport fixtures for wire compatibility. Live-model behavior, third-party account approval, billing and consent depend on operator-provided credentials. A successful fixture test does not certify a particular real account.
