# DayWeave product brief

English · [简体中文](PRODUCT.zh-CN.md) · [V1 design and acceptance criteria](V1_DESIGN.md)

DayWeave is a planner with a private workspace for each account for tasks, projects, reading and viewing. The V1 design makes chat the primary entry point. Users can type a request or dictate it, correct the transcript and press Send. A task confirmed in chat appears in the same views as a task created with the editor.

## A working day

1. Capture a task with a title, or save a link in the library. A task without a date or a planning window enters the inbox.
2. Set a date or a time window when choosing when to work. Record a deadline independently. A task due on Friday can be scheduled for Thursday afternoon.
3. Check the dashboard for focus tasks, scheduled work, reading and reminders. Previously missed work stays available for a deliberate scheduling decision.
4. Update the task and the linked resource independently. Watching twenty minutes of a video can advance several learning goals.
5. Use the assistant to query or change the same records. For each new task, review an editable draft within the conversation. Set optional details there, reload to resume an autosaved draft, and explicitly confirm or cancel. Approved cards open their saved task. Review proposed high-impact changes before applying them. Check the history to identify the source of a change.

## Navigation and input

The desktop view gives the task list the most space. The navigation connects the dashboard, task views, projects, library and settings. The assistant has a dedicated route and a collapsible view. On an iPad, the main list remains usable in both orientations and common actions can be tapped directly. On a phone, navigation and editing use the available width. All three sizes use the same records and interaction rules.

The login screen and workspace settings offer Simplified Chinese, Japanese and English. The selected language applies to navigation, forms, task drafts, user feedback and assistant replies. User-authored content retains its original language. The initial timezone is Asia/Hong_Kong. Settings support other IANA timezones. Operating and contributor documentation is available in English and Simplified Chinese.

## Proposed planner

The dedicated `/planner` page presents the backlog alongside the selected planning period. Today and Tomorrow show a day's schedule. This Week and Next Week use a full Monday–Sunday calendar. This Month shows the entire calendar month. Calendar cells display scheduled tasks or counts. Selecting a day opens the details for that date.

A task can stay in a week's or month's undated list until the user picks a date. Giving it a day or time updates the same task. Moving it back to the inbox clears its plan and preserves its deadline. Schedule changes have history receipts and support guarded undo.

## Acceptance workflows

| User intent | Observable outcome |
| --- | --- |
| Save an undated idea | A new inbox record with no invented deadline |
| Ask AI to create a task | An editable draft appears in chat. Editing or cancelling creates zero tasks. Confirming creates one task and a receipt with a link to it |
| Move a task to tomorrow | The same task ID appears in Tomorrow, with its deadline preserved |
| Reserve work for next week | The task appears in next week's undated list. After a specific date is selected, that day's calendar includes it |
| Save a video for later | A library resource with a URL, a progress unit and a linked scheduled task |
| Ask the assistant about tomorrow | The agent queries local records and returns a result tied to the current data |
| Complete a task | Its status, completion timestamp, views and history agree |
| Switch model | The selected adapter changes while conversation history stays in the workspace |
| Restart the container | Existing records, files and settings remain available |

## Delivery sequence

1. Exercise the chat workflow in all three languages, including local setup before a provider is connected, database-backed tools and editable task drafts. Verify confirmation, cancellation and retry.
2. Integrate local voice input with the composer. Check that dictated text can be edited before Send and that a spoken task request follows the same confirmation flow.
3. Connect the planner, manual controls, projects and resources to the same records. Verify calendar boundaries, deadline precision and undo.
4. Verify real provider inference and eligible ChatGPT authorization. Check voice, keyboard and rotation on a physical iPad.
5. Verify migrations, backup and restore, and personal-LAN HTTPS isolation from the company tailnet before release.
