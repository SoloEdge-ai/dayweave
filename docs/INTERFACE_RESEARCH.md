# Designing the daily planning view

English · [简体中文](INTERFACE_RESEARCH.zh-CN.md)

A person planning on an iPad needs to answer three questions quickly. What is already on this day? What still needs a place? Can I speak a task and check its details before it reaches the calendar? The observations below come from product documentation. The last column describes DayWeave design decisions.

| Product | Observed interaction | Decision for DayWeave |
| --- | --- | --- |
| [Structured](https://help.structured.app/en/articles/338178) | Its iPad inbox opens next to the timeline. A tap opens the task editor. | Keep a backlog next to the calendar in landscape. In portrait, collapse the backlog after selection to reveal the destination. |
| [Things](https://culturedcode.com/things/support/articles/4001304/) | Today shows actionable work. Later items can sit in an evening section. | Put today's actionable tasks ahead of reading material and reminders. Keep part-of-day plans distinct from exact times. |
| [Fantastical](https://flexibits.com/fantastical-ios/help/calendar-views) | The iPad calendar supports jumping to a date and switching views. Its date navigator and agenda stay in sync. | Use one Monday–Sunday date strip to enter a day from the overview. Give week and month pages explicit paging controls. |
| [Sunsama](https://help.sunsama.com/docs/usage-guides/timeboxing/) | Its working sessions place tasks on a calendar and keep planned duration visible. Touch users can open a session to adjust it. | Keep time and duration next to the title. Make the full agenda row an edit target. |
| [Akiflow](https://product.akiflow.com/articles/9441910-meet-aki-your-personal-assistant) | Aki accepts voice and text, including voice capture from a mobile calendar. | Give voice a labeled entry on the assistant's first screen. Keep transcription, draft edits and the final confirmation separate user actions. |

## Tablet walkthrough

| Landscape | Portrait |
| --- | --- |
| [Today](previews/ipad-landscape.png) · [Week planner](previews/ipad-landscape-planner.png) | [Today](previews/ipad-portrait.png) · [Week planner](previews/ipad-portrait-planner.png) |
| [Voice and editable draft](previews/voice-draft-1180.png) | [Email registration](previews/ipad-register.png) · [Voice and editable draft](previews/voice-draft-820.png) |

The weekly strip uses up to three dots per date to show visible task density. The accessible label contains the exact count. On the week grid, tap a date to read its full agenda, including additional tasks beyond the two shown in the cell. The agenda lists open work first and keeps undated week or month commitments in their own list.

## Frontend skills

Anthropic's **frontend-design** is a good fit when revising hierarchy, type and the shape of the page around real planner content. Vercel's **web-design-guidelines** fits the subsequent review of forms, focus, touch controls and navigation. Both can be used as development tools independently of the React application. [Frontend design](https://skills.sh/anthropics/skills/frontend-design) · [Web design guidelines](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines)

```sh
npx skills add https://github.com/anthropics/skills --skill frontend-design
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines
```
