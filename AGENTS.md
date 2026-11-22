# Working on DayWeave

English · [简体中文](AGENTS.zh-CN.md)

DayWeave is a local-first, single-user planner. The app and assistant support `zh-CN`, `ja` and `en`. Keep repository documentation in parallel English and Simplified Chinese editions. The unsuffixed Markdown file is the English entry point. Use a sibling `.zh-CN.md` file for its translation, with language links on both pages.

* `backend/app/` owns authentication, persistence, schedules and validation. `backend/app/ai/` owns provider protocols, local conversation history and tool execution.
* `frontend/src/` contains the React application. Use API data for production screens. Keep sample records confined to disposable fixtures.
* `tests/browser/` exercises the built app and produces Playwright previews. Include both iPad orientations when changing navigation or edit interactions.
* `docs/` describes the product, architecture, API, provider setup and roadmap. Deployment and backup instructions are in the root README.

Preserve local calendar dates, exact timestamps and day-part precision. Apply manual and AI writes through the same service. Keep provider credentials and the encryption key out of API responses, logs and source control. Add an Alembic revision when changing persisted schema.

AI task creation must emit an editable conversation draft. Preserve draft revisions, accept a deliberate confirmation, and keep approved or cancelled cards in history. Verify that neither proposing nor editing a draft creates a task.

Use the shared i18next/React integration and the typed catalogs in `frontend/src/locales/{zh-CN,ja,en}.json`. The Vite/Babel extraction step collects interface messages during `npm run build` and checks catalog coverage. Keep task titles, provider model IDs and other user data outside translation lookup. Update all three catalogs together, including accessible labels and validation messages. Include the selected language in the assistant context and preserve stored messages as written.

For contributions to the public repository, use a feature branch and a pull request into `main`. The protected branch accepts squash merges. [DayWeave repository](https://github.com/SoloEdge-ai/dayweave)

Run `python -m pytest -q` from `backend/`, `npm ci && npm run build` from `frontend/`, and the browser checks in the README before reporting the associated functionality as verified.
