import { useState, type ReactNode } from 'react'
import { TaskBoard } from './task-board'
import { WeekStrip, monday } from './week-strip'
import { i18n } from './i18n'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarClock,
  Columns3,
  List,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Flag,
  Folder,
  FolderOpen,
  Inbox,
  ListChecks,
  Paperclip,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Mic,
} from 'lucide-react'
import {
  api,
  dateInZone,
  dateLabel,
  errorText,
  periodLabels,
  priorityLabels,
  progressLabels,
  projectLabels,
  readablePosition,
  safeUrl,
  workspaceLink,
  statusLabels,
  timeLabel,
  typeLabels,
  useApi,
  viewLabels,
  type Dashboard,
  type Tag,
  taskTags,
  type Project,
  type Resource,
  type Task,
} from './api'
import {
  Empty,
  ErrorBox,
  IconButton,
  Loading,
  QuickCapture,
  ResourceIcon,
  useWorkspace,
} from './ui'

export function Heading({
  title,
  sub,
  action,
}: {
  title: string
  sub?: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {action}
    </div>
  )
}
function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="primary" onClick={onClick}>
      <Plus size={16} />
      {label}
    </button>
  )
}
function Section({
  icon: Icon,
  title,
  count,
  link,
  to,
  children,
}: {
  icon: typeof CalendarDays
  title: string
  count?: number
  link?: string
  to?: string
  children: ReactNode
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <Icon size={19} />
          <h2>{title}</h2>
          {count !== undefined && <span className="count">{count}</span>}
        </div>
        {link && to && (
          <Link to={to}>
            {link}
            <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
function plannedDateLabel(t: Task) {
  if (t.scheduled_date) return dateLabel(t.scheduled_date)
  if (!t.window_start || !t.planning_window) return ''
  const start = new Date(t.window_start + 'T12:00:00Z')
  if (t.planning_window === 'month') {
    return dateLabel(t.window_start, { year: 'numeric', month: 'long' })
  }
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatRange(start, end)
}
export function TaskRow({
  t,
  showDate = false,
}: {
  t: Task
  showDate?: boolean
}) {
  const { edit, settings, projects, refresh, notify } = useWorkspace(),
    [busy, setBusy] = useState(false),
    zone = settings?.timezone ?? 'Asia/Hong_Kong'
  const project = projects.find((p) => p.id === t.project_id)
  const scheduled = showDate ? plannedDateLabel(t) : ''
  const time = t.planned_start_at
    ? [timeLabel(t.planned_start_at, zone),t.planned_end_at && timeLabel(t.planned_end_at, zone)].filter(Boolean).join('–')
    : t.scheduled_period
      ? periodLabels[t.scheduled_period]
      : null
  const due =
    t.due_date ??
    (t.due_at
      ? new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(
          new Date(t.due_at),
        )
      : null)
  async function toggle() {
    setBusy(true)
    try {
      await api('/tasks/' + t.id, 'PATCH', {
        status: t.status === 'done' ? 'todo' : 'done',
      })
      await refresh()
      notify(t.status === 'done' ? '任务已重新打开' : '任务已完成')
    } catch (e) {
      notify(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={'task-row ' + (t.status === 'done' ? 'done' : '')}>
      <button
        className="check-hit"
        type="button"
        role="checkbox"
        aria-checked={t.status === 'done'}
        aria-label={
          (t.status === 'done' ? '重新打开' : '完成') + '“' + t.title + '”'
        }
        onClick={toggle}
        disabled={busy}
      >
        <span>{t.status === 'done' && <Check size={13} />}</span>
      </button>
      <button
        className="row-main"
        onClick={() => edit({ kind: 'task', task: t })}
      >
        <strong>{t.title}</strong>
        <span className="task-meta">
          {project && (
            <span>
              <Folder size={12} />
              {project.name}
            </span>
          )}
          {taskTags(t).map(tag => (
            <span key={tag}><i className="category-dot" />{tag}</span>
          ))}
          {time && (
            <span>
              <Clock3 size={12} />
              {time}
            </span>
          )}
          {t.estimated_minutes && <span>{t.estimated_minutes} 分钟</span>}
          {scheduled && (
            <span>
              <CalendarDays size={12} />
              {scheduled}
            </span>
          )}
          {due && (
            <span>
              <Flag size={12} />
              {dateLabel(due)}{t.due_at ? ' '+timeLabel(t.due_at,zone) : t.due_period ? ' '+periodLabels[t.due_period] : ''}截止
            </span>
          )}
          {t.resource_ids?.length > 0 && (
            <span>
              <Paperclip size={12} />
              {t.resource_ids.length}
            </span>
          )}
          {t.status !== 'todo' && <span>{statusLabels[t.status]}</span>}
        </span>
      </button>
      <span className={'priority ' + t.priority}>
        <i />
        {priorityLabels[t.priority] ?? t.priority}
      </span>
      <IconButton
        icon={Pencil}
        label={'编辑“' + t.title + '”'}
        onClick={() => edit({ kind: 'task', task: t })}
      />
    </div>
  )
}
function dayOrder(tasks: Task[], zone: string) {
  const periodTimes: Record<string, string> = {
    morning: '09:00',
    afternoon: '14:00',
    evening: '19:00',
  }
  const getTime = (t: Task) =>
    t.planned_start_at
      ? timeLabel(t.planned_start_at, zone)
      : (periodTimes[t.scheduled_period ?? ''] ?? '24:00')
  const closed = (t: Task) =>
    Number(t.status === 'done' || t.status === 'cancelled')
  return [...tasks].sort(
    (a, b) => closed(a) - closed(b) || getTime(a).localeCompare(getTime(b)),
  )
}
export function HomePage() {
  const data = useApi<Dashboard>('/dashboard/today'),
    { edit, settings } = useWorkspace(),
    nav = useNavigate()
  const week = useApi<Task[]>('/tasks?view=week')
  const overview = data.data,
    zone = settings?.timezone ?? 'Asia/Hong_Kong',
    date = overview?.date ?? dateInZone(zone),
    tasks = dayOrder(overview?.tasks ?? [], zone),
    focus = overview?.focus ?? [],
    resources = overview?.resources ?? []
  const reminders = [
    ['overdue', '已逾期'],
    ['due_today', '今天到期'],
    ['due_soon', '即将到期'],
    ['missed', '此前计划未完成'],
  ] as const
  return (
    <>
      <div className="date-line">
        <span className="date-rule" />
        {dateLabel(date, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        })}
      </div>
      <Heading
        title="今日总览"
        sub={overview ? '已完成' + ' ' + tasks.filter(t => t.status === 'done').length + ' / ' + tasks.length +
          '　' + '预计投入' + ' ' + tasks.reduce((sum, task) => sum + (task.estimated_minutes || 0), 0) + ' ' + '分钟' : undefined}
        action={
          <Link to="/chat?input=voice" className="primary dashboard-chat"><Mic size={17} />用语音创建任务</Link>
        }
      />
      <WeekStrip selected={date} today={date} tasks={week.data} />
      <QuickCapture />
      {data.isPending ? (
        <Loading />
      ) : data.error ? (
        <ErrorBox
          message={errorText(data.error)}
          retry={() => void data.refetch()}
        />
      ) : (
        <>
          <Section
            icon={ListChecks}
            title="今日任务"
            count={tasks.length}
            to="/tasks/today"
            link="查看今天"
          >
            {tasks.length ? (
              <div className="rows">
                {tasks.map((t) => (
                  <TaskRow t={t} key={t.id} />
                ))}
              </div>
            ) : (
              <Empty
                title="今天还没有安排任务"
                icon={CalendarDays}
                onAction={() =>
                  edit({ kind: 'task', initial: { scheduled_date: date } })
                }
                action="安排任务"
              >
                给今天安排一件想完成的事。
              </Empty>
            )}
          </Section>
          {focus.length > 0 && <section className="daily-focus">
            <h2><Flag size={16} />今日重点</h2>
            <div>{focus.slice(0, 3).map(task =>
              <button key={task.id} onClick={() => edit({ kind: 'task', task })}>{task.title}<ArrowUpRight size={14} /></button>
            )}</div>
          </section>}
          <Section
            icon={BookOpen}
            title="今日阅读与观看"
            count={resources.length}
            to="/library"
            link="资料库"
          >
            {resources.length ? (
              <div className="resource-list">
                {resources.map((r) => (
                  <ResourceRow key={r.id} r={r} compact />
                ))}
              </div>
            ) : (
              <Empty
                title="今天没有待阅读或观看的资料"
                icon={BookOpen}
                action="打开资料库"
                onAction={() => nav('/library')}
              />
            )}
          </Section>
          <Section icon={Bell} title="待处理提醒">
            <div className="reminders">
              {reminders.map(([key, title]) => (
                <details key={key}>
                  <summary>
                    <i className={key} />
                    <span>{title}</span>
                    <b>{overview?.[key].length ?? 0}</b>
                    <ChevronDown size={14} />
                  </summary>
                  {overview?.[key].length ? (
                    overview[key].map((t) => (
                      <TaskRow t={t} showDate key={t.id} />
                    ))
                  ) : (
                    <p>暂无此类提醒</p>
                  )}
                </details>
              ))}
            </div>
          </Section>
        </>
      )}
    </>
  )
}
export function TasksPage({ boardDefault = false }: { boardDefault?: boolean }) {
  const { view = 'all' } = useParams(),
    { edit, projects, settings } = useWorkspace(),
    [params, setParams] = useSearchParams(),
    [filters, setFilters] = useState(false)
  const tagCatalog = useApi<Tag[]>('/tags', filters)
  const apiParams = new URLSearchParams(params)
  const board = params.has('layout') ? params.get('layout') === 'board' : boardDefault
  apiParams.delete('layout')
  const hasFilters = apiParams.size > 0
  const scopeParams = new URLSearchParams(apiParams)
  if (board) scopeParams.set('layout', 'board')
  apiParams.set('view', view in viewLabels ? view : 'all')
  const query = useApi<Task[]>('/tasks?' + apiParams),
    items = ['today', 'tomorrow'].includes(view)
      ? dayOrder(query.data ?? [], settings?.timezone ?? 'Asia/Hong_Kong')
      : (query.data ?? [])
  function set(k: string, v: string) {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }
  const date =
    view === 'today' || view === 'tomorrow'
      ? dateInZone(settings?.timezone, view === 'tomorrow' ? 1 : 0)
      : null
  return (
    <>
      <Heading
        title={boardDefault && board ? '任务看板' : viewLabels[view] ?? '全部任务'}
        sub={
          date
            ? dateLabel(date, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              })
            : undefined
        }
        action={
          <NewButton
            label="新建任务"
            onClick={() =>
              edit({ kind: 'task', initial: { scheduled_date: date } })
            }
          />
        }
      />
      <nav className="view-tabs" aria-label="任务视图">
        {Object.entries(viewLabels).map(([v, label]) => (
          <Link
            key={v}
            className={v === view ? 'active' : ''}
            to={{ pathname: '/tasks/' + v, search: scopeParams.toString() }}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            type="search"
            placeholder="搜索任务"
            aria-label="搜索任务"
            value={params.get('q') ?? ''}
            onChange={(e) => set('q', e.target.value)}
          />
        </label>
        <button
          className={'secondary ' + (filters ? 'selected' : '')}
          onClick={() => setFilters(!filters)}
          aria-expanded={filters}
        >
          <SlidersHorizontal size={15} />
          筛选
        </button>
        <div className="layout-toggle" role="group" aria-label="任务布局">
          <button type="button" aria-pressed={!board} onClick={() => set('layout', 'list')}><List size={16} />列表</button>
          <button type="button" aria-pressed={board} onClick={() => set('layout', 'board')}><Columns3 size={16} />看板</button>
        </div>
      </div>
      {filters && (
        <div className="filters">
          {(
            [
              ['priority', '优先级', priorityLabels],
              ['status', '状态', statusLabels],
              ['category', '标签', Object.fromEntries((tagCatalog.data ?? []).map(tag => [tag.name, tag.name]))],
              [
                'project_id',
                '项目',
                Object.fromEntries(projects.map((p) => [p.id, p.name])),
              ],
            ] as const
          ).map(([key, label, values]) => (
            <label key={key}>
              {label}
              <select
                value={params.get(key) ?? ''}
                onChange={(e) => set(key, e.target.value)}
              >
                <option value="">全部</option>
                {Object.entries(values).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {(
            [
              ['scheduled_date', '计划日期', 'date'],
              ['due_date', '截止日期', 'date'],
            ] as const
          ).map(([k, label, type]) => (
            <label key={k}>
              {label}
              <input
                type={type}
                value={params.get(k) ?? ''}
                onChange={(e) => set(k, e.target.value)}
              />
            </label>
          ))}
          <button className="text-button" onClick={() => setParams(board ? {layout:'board'} : {layout:'list'})}>
            清除筛选
          </button>
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox
          message={errorText(query.error)}
          retry={() => void query.refetch()}
        />
      ) : board ? <TaskBoard key={apiParams.toString()} items={items} view={view} status={params.get('status')} defaults={{
        scheduled_date: params.get('scheduled_date') || date || (view === 'upcoming' ? dateInZone(settings?.timezone, 1) : null),
        ...(view === 'week' && !params.get('scheduled_date') ? {planning_window: 'week', window_start: monday(dateInZone(settings?.timezone))} : {}),
        due_date: params.get('due_date'),
        project_id: Number(params.get('project_id')) || null, category: params.get('category') ?? '',
        ...(params.get('priority') ? { priority: params.get('priority')! } : {}),
      }} /> : items.length ? (
        <div className="rows">
          {items.map((t) => (
            <TaskRow key={t.id} t={t} showDate />
          ))}
        </div>
      ) : (
        <Empty
          icon={Inbox}
          title={hasFilters ? '没有匹配的任务' : '这里还没有任务'}
          action="新建任务"
          onAction={() =>
            edit({ kind: 'task', initial: { scheduled_date: date } })
          }
        />
      )}
    </>
  )
}
export function ResourceRow({
  r,
  compact = false,
}: {
  r: Resource
  compact?: boolean
}) {
  const { edit, refresh, notify } = useWorkspace(),
    href = r.file_url ? workspaceLink(r.file_url) : safeUrl(r.url)
  const schedule = () =>
    edit({
      kind: 'task',
      initial: {
        title: (r.type === 'video' ? '观看' : '阅读') + '《' + r.title + '》',
        resource_ids: [r.id],
        project_id: r.project_ids?.[0] ?? null,
      },
    })
  return (
    <article className="resource-row">
      <ResourceIcon type={r.type} />
      <div className="resource-main">
        <button
          className="title-button"
          onClick={() => edit({ kind: 'resource', resource: r })}
        >
          {r.title}
        </button>
        <div className="task-meta">
          <span>{typeLabels[r.type]}</span>
          {r.source && <span>{r.source}</span>}
          <span>
            {progressLabels[r.progress_status]}
            {r.current_position > 0 ? ' · ' + readablePosition(r) : ''}
          </span>
        </div>
      </div>
      <div className="resource-actions">
        {href && (
          <a
            className="icon-btn"
            href={href}
            target="_blank"
            rel="noreferrer"
            title="打开资料"
            aria-label={'打开资料“' + r.title + '”'}
          >
            <ExternalLink size={16} />
          </a>
        )}
        {compact ? (
          <IconButton
            icon={Check}
            label="标记资料已完成"
            disabled={r.progress_status === 'completed'}
            onClick={async () => {
              try {
                await api('/resources/' + r.id, 'PATCH', {
                  progress_status: 'completed',
                })
                await refresh()
                notify('资料已标记完成')
              } catch (e) {
                notify(errorText(e))
              }
            }}
          />
        ) : (
          <IconButton
            icon={CalendarClock}
            label="安排阅读或观看"
            onClick={schedule}
          />
        )}
        <IconButton
          icon={Pencil}
          label="编辑资料和进度"
          onClick={() => edit({ kind: 'resource', resource: r })}
        />
      </div>
    </article>
  )
}
export function LibraryPage() {
  const { edit } = useWorkspace(),
    query = useApi<Resource[]>('/resources'),
    [filter, setFilter] = useState(''),
    [search, setSearch] = useState('')
  const list =
    query.data?.filter(
      (r) =>
        (!filter || r.type === filter) &&
        [r.title, r.source, r.notes]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? []
  return (
    <>
      <Heading
        title="资料库"
        action={
          <NewButton
            label="添加资料"
            onClick={() => edit({ kind: 'resource' })}
          />
        }
      />
      <div className="toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            placeholder="搜索标题、来源或笔记"
            aria-label="搜索资料"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="资料类型"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">全部类型</option>
          {Object.entries(typeLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox
          message={errorText(query.error)}
          retry={() => void query.refetch()}
        />
      ) : list.length ? (
        <div className="resource-list">
          {list.map((r) => (
            <ResourceRow r={r} key={r.id} />
          ))}
        </div>
      ) : (
        <Empty
          icon={BookOpen}
          title={search || filter ? '没有匹配的资料' : '保存第一份资料'}
          onAction={() => edit({ kind: 'resource' })}
          action="添加资料"
        >
          支持视频、网页、PDF 和 Markdown。
        </Empty>
      )}
    </>
  )
}
export function ProjectsPage() {
  const { id } = useParams(),
    { edit } = useWorkspace(),
    projects = useApi<Project[]>('/projects'),
    project = useApi<Project>('/projects/' + id, !!id)
  if (id) {
    const p = project.data
    if (project.isPending) return <Loading />
    if (project.error || !p)
      return <ErrorBox message={errorText(project.error)} />
    return (
      <>
        <Link className="back" to="/projects">
          ← 返回项目
        </Link>
        <Heading
          title={p.name}
          sub={p.description ?? undefined}
          action={
            <button
              className="secondary"
              onClick={() => edit({ kind: 'project', project: p })}
            >
              <Pencil size={15} />
              编辑项目
            </button>
          }
        />
        <div className="project-meta">
          {projectLabels[p.status]}
          {p.target_date ? ' · 目标日期 ' + p.target_date : ''}
        </div>
        <Section
          title="项目任务"
          icon={ListChecks}
          count={p.tasks?.length ?? 0}
        >
          {p.tasks?.map((t) => <TaskRow key={t.id} t={t} showDate />)}
          <button
            className="text-button add-related"
            onClick={() =>
              edit({ kind: 'task', initial: { project_id: p.id } })
            }
          >
            <Plus size={15} />
            添加项目任务
          </button>
        </Section>
        <Section title="项目资料" icon={BookOpen}>
          {p.resources?.map((r) => <ResourceRow r={r} key={r.id} />)}
          <button
            className="text-button add-related"
            onClick={() =>
              edit({ kind: 'resource', initial: { project_ids: [p.id] } })
            }
          >
            <Plus size={15} />
            添加项目资料
          </button>
        </Section>
      </>
    )
  }
  return (
    <>
      <Heading
        title="项目"
        action={
          <NewButton
            label="新建项目"
            onClick={() => edit({ kind: 'project' })}
          />
        }
      />
      {projects.isPending ? (
        <Loading />
      ) : projects.error ? (
        <ErrorBox message={errorText(projects.error)} />
      ) : projects.data?.length ? (
        <div className="project-grid">
          {projects.data.map((p) => (
            <Link key={p.id} className="project-tile" to={'/projects/' + p.id}>
              <FolderOpen size={23} />
              <span className="project-status">{projectLabels[p.status]}</span>
              <h2>{p.name}</h2>
              {p.description && <p>{p.description}</p>}
              <div>
                {p.target_date ? '目标日期 ' + p.target_date : '查看项目'}
                <ArrowUpRight size={15} />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          icon={FolderOpen}
          title="创建第一个项目"
          action="新建项目"
          onAction={() => edit({ kind: 'project' })}
        >
          把相关任务和资料放在一起。
        </Empty>
      )}
    </>
  )
}
