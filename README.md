# DayWeave

English · [简体中文](README.zh-CN.md) · [V1 design and acceptance criteria](docs/V1_DESIGN.md)

DayWeave is a private planner for work, daily life and study. Manage tasks, projects, reference material and deadlines in a browser. An optional assistant queries and edits the same SQLite database. The workspace and assistant support Simplified Chinese, Japanese and English.

## First start

Use a Linux host with Docker Engine and Docker Compose. From the project directory:

```sh
cp .env.example .env
vi .env  # Configure SMTP and the sender address
docker compose up -d --build
docker compose ps
```

On the server, open [DayWeave on localhost](http://127.0.0.1:8787) and choose **Create account**. Registration creates a personal workspace. Use **Manage workspaces** to create more or add an existing account by username. Provider credentials and model settings follow the signed-in account. Set `DAYWEAVE_ENABLE_SIGNUP=0` to close registration after adding the intended accounts.

Set `DAYWEAVE_SMTP_HOST`, `DAYWEAVE_SMTP_PORT`, `DAYWEAVE_SMTP_SECURITY` (`starttls` or `tls`), `DAYWEAVE_MAIL_FROM` and your relay's `DAYWEAVE_SMTP_USER` and `DAYWEAVE_SMTP_PASSWORD` in the private server environment. Use the provider's SMTP app password when required. Register with a username, password, email and the eight-digit code sent to that address. Sign in using the username or email. **Forgot password?** verifies the registered address and ends every existing session after the password changes.

This development release starts with a fresh data volume when upgrading an installation with pre-email accounts. Point Compose at a new storage volume before the first start. An existing nonempty account registry is detected before its schema changes.

Compose publishes the backend on loopback, including upgrades from earlier configurations. For phone or iPad access, first verify that the company tailnet cannot reach the personal service over IPv4 or IPv6, through subnet routes, Docker forwarding or a proxy such as Tailscale Serve or Funnel. Keep the deployment loopback-only while any path remains unverified. This setup requires no changes to company Tailscale configuration. [Network isolation and acceptance](docs/V1_DESIGN.md#6-personal-lan-access-and-company-tailnet-exclusion)

The [host Caddy configuration](scripts/Caddyfile.lan) listens on a single IPv4 address, permits explicit client addresses and forwards to the loopback backend. Set `DAYWEAVE_LAN_IP` to the address of the personal interface and `DAYWEAVE_LAN_CLIENTS` to the approved IP addresses or CIDRs separated by spaces. Set `DAYWEAVE_COOKIE_SECURE=1` on the backend. With Docker forwarding, set `DAYWEAVE_PROXY_IP` to the exact gateway of the dedicated application bridge from `docker network inspect`, so the backend recognizes the original HTTPS scheme on authenticated requests. Before starting the proxy, restrict its TCP port to that interface and those clients in the host firewall and restrict forwarding to the Docker application bridge. Verify the isolated ingress before use. Open `https://<LAN-IP>:8443` on an approved device after trusting the proxy's local root certificate. [Caddy bind](https://caddyserver.com/docs/caddyfile/directives/bind) · [Caddy local TLS](https://caddyserver.com/docs/caddyfile/directives/tls)

## Everyday use

Use quick capture to put an unscheduled task in the inbox. Open it to set a project, priority, planned time or deadline. Add a video or document in the library, then use its schedule action to create a linked task. The dashboard combines today's work, focus tasks, resources and deadline reminders. Choose a language at login or in workspace settings. Timezone, theme and model defaults are independent preferences.

**Planner** pairs the backlog with Today, Tomorrow, This Week, Next Week or This Month. Weeks run Monday through Sunday. A task can stay in a week or month until a day is chosen. Select a scheduled task to edit its time, move it to the inbox or undo the change. [Interactive planner design](docs/design/planner.html?lang=en)

AI is optional. Add credentials in provider settings, test the connection and select a model. ChatGPT plan authorization uses a separate operator workflow and depends on official eligibility. See the [provider guide](docs/AI_PROVIDERS.md).

Ask the assistant to create a task. An editable draft appears in the conversation. Review the title, date, part of day, deadline and estimate, or expand the project, category and notes. Edits automatically save to the draft. **Confirm creation** writes the task to the workspace, where it can be opened from the receipt. Cancelling the draft leaves the task list intact.

Open **Voice input** in the composer to record in a supported browser over trusted HTTPS or choose an audio file. **Transcribe to composer** sends the clip to the local Whisper model and inserts editable text. Send it when ready, then confirm the resulting task draft and choose **View in planner**. The Docker build provisions the model. For local development, run `python scripts/prepare-speech.py data/speech` from the repository root.

Application previews use disposable sample records. [Desktop dashboard](docs/previews/desktop.png) · [iPad dashboard](docs/previews/ipad-portrait.png) · [Desktop task draft](docs/previews/desktop-draft.png) · [iPad task draft](docs/previews/ipad-draft.png)

Planner design mockups show the proposed desktop and tablet layouts. [Desktop planner](docs/design/planner-desktop.png) · [iPad planner](docs/design/planner-ipad.png)

## Persistence, export and backup

Compose creates a project-scoped named volume mounted at `/data`. Normal restart, rebuild and `docker compose down` retain it. The `-v` option to `down` removes named volumes and their contents.

Use the JSON export in Settings for portable records. Local file bytes and provider credentials are part of the volume backup. Create a consistent recovery archive with:

```sh
sh scripts/backup.sh
```

The script briefly stops the application, archives the complete volume in `backups/`, verifies the archive and restarts the service if it had been running. Store the archive privately. It includes uploaded files, session records, password material and the key needed to decrypt provider credentials.

To test recovery with a **fresh** Compose project and volume, choose an unused project name and port. These commands restore a trusted archive without changing the original volume:

```sh
export COMPOSE_FILE=docker-compose.yml COMPOSE_PROJECT_NAME=dayweave-recovery
export DAYWEAVE_PORT=18788 DAYWEAVE_COOKIE_SECURE=0
docker compose build
docker compose run --rm --no-deps -T dayweave sh -c 'test -z "$(ls -A /data)" && tar -xzf - -C /data' < backups/YOUR-ARCHIVE.tar.gz
docker compose up -d
curl --fail http://127.0.0.1:18788/api/health
```

Open the recovered application and check a known task and upload before using a recovered volume. Keep the Compose project name stable for subsequent starts.

## Local development and verification

Use Python 3.12 and a current Node 22 or 24 release. The following commands start the built frontend and the backend together:

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

For end-to-end tests, keep the virtual environment active and run the following from the repository root. A disposable app starts automatically with a separate database, a random password and a simulated remote provider. Preview records are created only inside that fixture:

The Python suite covers the HTTP behavior the browser relies on, including workspaces, confirmation, uploads and schedule writes. The browser suite covers the visible workflows against the built app.

```sh
cd tests/browser
npm ci
npx playwright install chromium webkit
npm run check
npm run preview
```

Set `DAYWEAVE_TEST_PYTHON` to an absolute interpreter path if the activated environment is unavailable. The preview command writes desktop, phone and portrait/landscape iPad screenshots to `docs/previews/`. Frontend assets are served locally.

The browser checks exercise the audio-file workflow in both iPad orientations. Set `DAYWEAVE_TEST_VOICE_WAV` to an absolute path to a WAV recording of “请为机器人跟踪创建一个任务” to use the installed Whisper model instead of the speech fixture. Set `DAYWEAVE_VOICE_SCREENSHOTS=1` to save the draft and planner screenshots from that run.

Run `npm run demo` from the same browser-test directory to open an interactive browser with the sample projects, tasks and reading progress used for the previews. Closing its window ends the disposable session.

Run `sh scripts/test-container.sh` on a Docker host to exercise database migrations, authenticated operations, a local streaming provider, uploaded file bytes and persisted state across a container restart. This creates and removes a uniquely named test volume.

## More documentation

* [Product behavior and acceptance workflows](docs/PRODUCT.md)
* [Architecture, storage and time semantics](docs/ARCHITECTURE.md)
* [REST API and chat events](docs/API.md)
* [AI provider setup and official authorization](docs/AI_PROVIDERS.md)
* [Delivery status and roadmap](docs/ROADMAP.md)

* [Tablet interface research and Playwright previews](docs/INTERFACE_RESEARCH.md)
