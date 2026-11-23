import { useState, type FormEvent } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Inbox, Pencil, Undo2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, dateInZone, dateLabel, errorText, periodLabels, timeLabel, taskTags, useApi, type Dashboard, type Task } from './api'
import { localInput, toIso } from './datetime'
import { WeekStrip, shift, monday, weekday } from './week-strip'
import { Heading } from './pages'
import { TaskDestinations } from './task-links'
import { ErrorBox, Field, IconButton, Loading, Modal, useWorkspace } from './ui'
import { PaneGrip, useContainerWidth, usePane } from './pane-layout'
import './planner.css'

const scopes = {
  today: '今天', tomorrow: '明天', week: '本周', next_week: '下周', month: '本月',
}
type Scope = keyof typeof scopes
const open = (task: Task) => !task.is_past_plan && (task.status === 'todo' || task.status === 'in_progress')
const periodOrder: Record<string, string> = { morning: '06:00', afternoon: '12:00', evening: '18:00' }
const dayLabel = (date: string) => dateLabel(date, { weekday: 'long', month: 'short', day: 'numeric' })
const dateParam = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(value + 'T12:00:00Z').toJSON()?.slice(0, 10) === value ? value : null

type Placement = {
  scheduled_date: string | null
  scheduled_period: string | null
  planned_start_at: string | null
  planned_end_at: string | null
  planning_window: 'week' | 'month' | null
  window_start: string | null
}
type Target = { date: string } | { window: 'week' | 'month'; anchor: string }

function clock(task: Task, zone: string) {
  if (task.planned_start_at) {
    const start = timeLabel(task.planned_start_at, zone)
    return task.planned_end_at ? start + '–' + timeLabel(task.planned_end_at, zone) : start
  }
  return periodLabels[task.scheduled_period ?? ''] ?? '时间待定'
}

function PlannerEditor({ task, target, close, saved }: {
  task: Task; target?: Target; close: () => void; saved: (task: Task, change: number | null) => void
}) {
  const { settings, refresh } = useWorkspace()
  const zone = settings?.timezone ?? 'Asia/Hong_Kong'
  const existingWindow = task.planning_window && task.window_start
    ? {window: task.planning_window, anchor: task.window_start} : undefined
  const preserveWindow = target ? ('window' in target ? target : undefined) : existingWindow
  const [date, setDate] = useState(target && 'date' in target ? target.date :
    task.scheduled_date ?? preserveWindow?.anchor ?? dateInZone(zone))
  const [kind, setKind] = useState(preserveWindow ? 'window' : 'day')
  const [period, setPeriod] = useState(task.planned_start_at ? 'exact' : task.scheduled_period ?? '')
  const [start, setStart] = useState(localInput(task.planned_start_at, zone).slice(11))
  const [end, setEnd] = useState(localInput(task.planned_end_at, zone))
  const daySpan = task.scheduled_date && end ? Math.round(
    (Date.parse(end.slice(0, 10) + 'T12:00Z') - Date.parse(task.scheduled_date + 'T12:00Z')) / 86400000,
  ) : 0
  const [endDay, setEndDay] = useState(daySpan ? shift(date, daySpan) : date)
  const [allowConflict, setAllowConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endTime = end.slice(11)

  function changeDay(next: string) {
    if (next && date && endDay) {
      const span = Math.round((Date.parse(endDay + 'T12:00Z') - Date.parse(date + 'T12:00Z')) / 86400000)
      setEndDay(shift(next, span))
    } else if (next) setEndDay(next)
    setDate(next)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const exact = kind === 'day' && period === 'exact'
      const placement: Placement = {
        scheduled_date: kind === 'day' ? date : null,
        scheduled_period: kind === 'day' && !exact ? period || null : null,
        planned_start_at: exact ? toIso(date + 'T' + start, zone, task.planned_start_at) : null,
        planned_end_at: exact && endTime ? toIso(endDay + 'T' + endTime, zone, task.planned_end_at) : null,
        planning_window: kind === 'window' ? preserveWindow?.window ?? null : null,
        window_start: kind === 'window' ? preserveWindow?.anchor ?? null : null,
      }
      if (placement.planned_start_at && placement.planned_end_at &&
          Date.parse(placement.planned_end_at) <= Date.parse(placement.planned_start_at)) {
        throw new Error('结束时间必须晚于开始时间。')
      }
      const result = await api<{task: Task; change_id: number | null}>('/tasks/' + task.id + '/schedule', 'PATCH', {
        ...placement, expected_updated_at: task.updated_at, allow_due_conflict: allowConflict,
      })
      saved(result.task, result.change_id)
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="编辑安排" close={close}>
    <form className="planner-editor" onSubmit={save}>
      <div className="modal-body">
        <strong>{task.title}</strong>
        <div className="form-grid">
          <Field label="计划精度" wide><select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="day">具体日期</option>
            {preserveWindow && <option value="window">日期待定</option>}
            <option value="inbox">移回收件箱</option>
          </select></Field>
          {kind === 'window' && preserveWindow && <p className="wide">
            {preserveWindow.window === 'month' ? dateLabel(preserveWindow.anchor, {month: 'long', year: 'numeric'}) :
              dateLabel(preserveWindow.anchor) + ' – ' + dateLabel(shift(preserveWindow.anchor, 6))}
          </p>}
          {kind === 'day' && <>
            <div className="wide date-shortcuts" role="group" aria-label="选择计划日期">
              <button type="button" aria-pressed={date === dateInZone(zone)} onClick={() => changeDay(dateInZone(zone))}>今天</button>
              <button type="button" aria-pressed={date === dateInZone(zone, 1)} onClick={() => changeDay(dateInZone(zone, 1))}>明天</button>
            </div>
            <Field label="计划日期"><input type="date" required value={date} onChange={e => changeDay(e.target.value)} /></Field>
            <Field label="计划时段"><select value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="">时间待定</option>
              {Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="exact">具体时刻</option>
            </select></Field>
            {period === 'exact' && <>
              <Field label="计划开始"><input type="time" step="any" required value={start} onChange={e => setStart(e.target.value)} /></Field>
              <Field label="计划结束"><input type="time" step="any" value={endTime} onChange={e => setEnd(e.target.value ? endDay + 'T' + e.target.value : '')} /></Field>
              {endTime && <Field label="结束日期"><input type="date" required min={date} value={endDay} onChange={e => setEndDay(e.target.value)} /></Field>}
              <p className="wide">{zone}</p>
            </>}
          </>}
        </div>
        {(task.due_date || task.due_at) && <p className="planner-due">
          <span>截止</span> · {task.due_at ? dayLabel(localInput(task.due_at, zone).slice(0, 10)) + ' ' + timeLabel(task.due_at, zone) : dayLabel(task.due_date!)}
        </p>}
        {error && <ErrorBox message={error} />}
        {error && (task.due_date || task.due_at) && <label className="check-line"><input type="checkbox" checked={allowConflict} onChange={e => setAllowConflict(e.target.checked)} />允许安排超过截止时间</label>}
      </div>
      <footer className="modal-actions">
        <button type="button" className="secondary" onClick={close}>取消</button>
        <button type="submit" className="primary" disabled={busy}>保存安排</button>
      </footer>
    </form>
  </Modal>
}

export function PlannerPage() {
  const { settings, refresh, notify, edit } = useWorkspace()
  const zone = settings?.timezone ?? 'Asia/Hong_Kong'
  const [search, setSearch] = useSearchParams()
  const container = useContainerWidth()
  const backlogPane = usePane('backlog', Math.min(250, container.width * .24), container.width - 495)
  const stacked = container.width < 800
  const view = search.get('view')
  const scope = view && Object.hasOwn(scopes, view) ? view as Scope : 'today'
  const focus = dateParam(search.get('date'))
  const anchor = dateParam(search.get('anchor'))
  const custom = scope === 'today' && !!focus
  const todayData = useApi<Dashboard>('/dashboard/today')
  const anchored = !!anchor && (scope === 'week' || scope === 'month')
  const plan = useApi<Task[]>(custom ? '/tasks?scheduled_date=' + focus : '/tasks?view=' + (anchored ? 'all' : scope))
  const backlog = useApi<Task[]>('/tasks?view=inbox')
  const mobileBacklog = search.get('panel') === 'backlog'
  function setMobileBacklog(open: boolean) {
    if (open === mobileBacklog) return
    const params = new URLSearchParams(search)
    if (open) params.set('panel', 'backlog')
    else params.delete('panel')
    setSearch(params, {replace: true})
  }
  const [missed, setMissed] = useState(false)
  const [armed, setArmed] = useState<Task | null>(null)
  const [editor, setEditor] = useState<{task: Task; target?: Target} | null>(null)
  const [undo, setUndo] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const today = todayData.data?.date ?? dateInZone(zone)
  const byMonth = scope === 'month'
  const calendar = byMonth || scope === 'week' || scope === 'next_week'
  const reference = anchored ? anchor : today
  const first = byMonth ? reference.slice(0, 7) + '-01' : shift(monday(reference), scope === 'next_week' ? 7 : 0)
  const firstCell = byMonth ? monday(first) : first
  const monthDays = new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 0)).getUTCDate()
  const cellCount = byMonth ? Math.ceil((monthDays + (weekday(first) + 6) % 7) / 7) * 7 : 7
  const calendarDays = Array.from({length: cellCount}, (_, i) => shift(firstCell, i))
  const day = calendar ? (focus && calendarDays.includes(focus) ? focus : null) :
    custom ? focus : scope === 'tomorrow' ? shift(today, 1) : today
  const last = shift(first, byMonth ? monthDays - 1 : 6)
  const historyStart = calendar ? first : day ?? today
  const historyEnd = calendar ? last : historyStart
  const past = useApi<Task[]>('/planner/history?start=' + historyStart + '&end=' + historyEnd, historyStart <= today)
  const visible = [...(plan.data ?? []), ...(past.data ?? [])].filter(task => {
    if (task.status === 'cancelled') return false
    if (!anchored) return true
    if (task.scheduled_date) return task.scheduled_date >= first && task.scheduled_date <= last
    if (!task.window_start) return false
    if (task.planning_window === 'month') return byMonth && task.window_start === first
    return task.window_start <= last && shift(task.window_start, 6) >= first
  })
  const order = (task: Task) => localInput(task.planned_start_at, zone).slice(11, 16) ||
    periodOrder[task.scheduled_period ?? ''] || '24:00'
  function agendaOrder(a: Task, b: Task) {
    return Number(!open(a)) - Number(!open(b)) || order(a).localeCompare(order(b)) || a.id - b.id
  }
  const agenda = visible.filter(task => task.scheduled_date === day).sort(agendaOrder)
  const floating = visible.filter(task => task.planning_window)
  const queue = missed ? todayData.data?.missed ?? [] : backlog.data ?? []
  const target: Target = day ? {date: day} : {window: byMonth ? 'month' : 'week', anchor: first}
  const highlighted = Number(search.get('task'))

  function movePeriod(direction: number) {
    const next = byMonth ? new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1 + direction, 1)).toISOString().slice(0, 10) :
      shift(first, direction * 7)
    const params = new URLSearchParams(search)
    params.set('view', byMonth ? 'month' : 'week')
    if (byMonth ? next === today.slice(0, 7) + '-01' : next === monday(today)) {
      params.delete('anchor')
    } else if (!byMonth && next === shift(monday(today), 7)) {
      params.set('view', 'next_week')
      params.delete('anchor')
    } else params.set('anchor', next)
    params.delete('task')
    if (day) {
      const lastDay = byMonth ? new Date(Date.UTC(+next.slice(0, 4), +next.slice(5, 7), 0)).getUTCDate() : 7
      const index = byMonth ? Math.min(lastDay, +day.slice(-2)) - 1 : (weekday(day) + 6) % 7
      params.set('date', shift(next, index))
    }
    setSearch(params)
  }

  function selectDay(date: string) {
    const params = new URLSearchParams(search)
    params.set('date', date)
    setSearch(params, { replace: true })
    if (armed) setEditor({ task: armed, target: { date } })
  }
  function row(task: Task) {
    const tags = taskTags(task)
    const details = <><strong>{task.title}</strong>
      {(tags.length > 0 || !!task.estimated_minutes) && <small>{[...tags,
        task.estimated_minutes ? task.estimated_minutes + ' ' + '分钟' : null].filter(Boolean).join(' · ')}</small>}
    </>
    return <li key={task.id} className={['planner-agenda-row', task.is_past_plan ? 'past-plan' : task.status, highlighted === task.id ? 'highlighted' : ''].join(' ')}>
      <span>{clock(task, zone)}</span>
      <div className="agenda-task-content">
      {open(task) ? <button className="agenda-task" onClick={() => setEditor({task})} aria-label={'编辑安排' + ' · ' + task.title}>
        <span>{details}</span><Pencil size={16} aria-hidden="true" />
      </button> : <div className="agenda-task"><span>{details}</span>{task.is_past_plan && <small>安排过</small>}</div>}
      <TaskDestinations ids={task.resource_ids} primary={task} />
      </div>
      {open(task) && <IconButton icon={Check} label={'完成任务' + ' · ' + task.title} disabled={busy} onClick={async () => {
        setBusy(true)
        try { await api('/tasks/' + task.id, 'PATCH', {status:'done'}); await refresh(); notify('任务已完成') }
        catch (e) { setError(errorText(e)) } finally { setBusy(false) }
      }} /> }
    </li>
  }

  return <div ref={container.ref} className={'planner-workspace' + (stacked ? ' stacked' : '')}>
    <Heading title="日程编排" />
    <div className="planner-toolbar">
      <nav aria-label="计划范围">
        {Object.entries(scopes).map(([key, label]) => <button key={key} type="button" aria-pressed={scope === key && !custom && !anchored}
          onClick={() => setSearch({ view: key })}>{label}</button>)}
      </nav>
      <button className="secondary planner-backlog-toggle" aria-expanded={mobileBacklog} onClick={() => setMobileBacklog(!mobileBacklog)}>
        <Inbox size={16} />待安排
      </button>
    </div>
    {error && <ErrorBox message={error} />}
    {undo !== null && <button className="secondary planner-undo" disabled={busy} onClick={async () => {
      setBusy(true)
      setError('')
      try {
        await api('/changes/' + undo + '/undo', 'POST')
        setUndo(null)
        await refresh()
        notify('安排已撤销')
      } catch (e) {
        setError(errorText(e))
      } finally {
        setBusy(false)
      }
    }}><Undo2 size={16} />撤销安排</button>}
    <div className="planner-columns" style={{ gridTemplateColumns: stacked ? 'minmax(0,1fr)' : backlogPane.size + 'px minmax(0,1fr)' }}>
      <div className={'backlog-pane' + (stacked && !mobileBacklog ? ' hidden' : '')} id={backlogPane.id}>
      <aside className={'planner-backlog ' + (mobileBacklog ? 'expanded' : '')} aria-label="待安排">
        <header><Inbox size={18} /><h2>待安排</h2><span className="planner-total">{queue.length}</span></header>
        <div className="planner-queue">
          <nav aria-label="待办来源">
            <button className="secondary" aria-pressed={!missed} onClick={() => setMissed(false)}>收件箱</button>
            <button className="secondary" aria-pressed={missed} onClick={() => setMissed(true)}>此前未完成</button>
          </nav>
          {backlog.isError || todayData.isError ? <ErrorBox message={errorText(backlog.error ?? todayData.error)}
            retry={() => { void backlog.refetch(); void todayData.refetch() }} /> :
            backlog.isPending ? <Loading /> :
            queue.length ? <ul>{queue.map(task => <li key={task.id}>
              <button type="button" className={highlighted === task.id ? 'highlighted' : ''}
                aria-pressed={armed?.id === task.id} onClick={() => {
                  setArmed(armed?.id === task.id ? null : task)
                  if (mobileBacklog) setMobileBacklog(false)
                }}>
                <strong>{task.title}</strong>
                {task.estimated_minutes && <small>{task.estimated_minutes} 分钟</small>}
                {task.due_date && <small>{dateLabel(task.due_date)}</small>}
              </button>
            </li>)}</ul> : <p>没有待安排的任务</p>}
        </div>
      </aside>
      {!stacked && <PaneGrip pane={backlogPane} />}</div>
      <div className="planner-plan">
        {past.isError && <ErrorBox message={errorText(past.error)} retry={() => void past.refetch()} />}
        {!calendar && day && <WeekStrip selected={day} today={today} />}
        {armed && <div className="planner-place">
          <strong>{armed.title}</strong>
          <button className="primary" onClick={() => setEditor({task: armed, target})}>
            {day ? '排入' + ' · ' + dayLabel(day) : '排入待定日期'}
          </button>
          <button className="secondary" onClick={() => setArmed(null)}>取消</button>
        </div>}
        {plan.isError ? <ErrorBox message={errorText(plan.error)} retry={() => void plan.refetch()} /> :
          plan.isPending ? <Loading /> : <>
          {calendar && <section className="planner-panel">
            <header><CalendarDays size={18} /><h2>{byMonth ? dateLabel(first, {month: 'long', year: 'numeric'}) :
              dateLabel(first) + ' – ' + dateLabel(shift(first, 6))}</h2>
              <div className="calendar-paging">
                <IconButton icon={ChevronLeft} label={byMonth ? '上个月' : '前一周'} onClick={() => movePeriod(-1)} />
                <IconButton icon={ChevronRight} label={byMonth ? '下个月' : '后一周'} onClick={() => movePeriod(1)} />
              </div>
            </header>
            <div className={'planner-calendar ' + (byMonth ? 'planner-month' : 'planner-week')}>
              {calendarDays.slice(0, 7).map(date => <span className="planner-weekday" key={date}>{dateLabel(date, {weekday: 'short'})}</span>)}
              {calendarDays.map(date => {
                const inMonth = !byMonth || date.startsWith(first.slice(0, 7))
                const items = visible.filter(task => task.scheduled_date === date).sort(agendaOrder)
                return <div className="planner-cell" key={date}>
                  <button type="button" aria-label={dayLabel(date)} aria-pressed={date === day}
                    aria-current={date === today ? 'date' : undefined} disabled={!inMonth} onClick={() => selectDay(date)}>
                    <b>{Number(date.slice(-2))}</b>
                    {items.slice(0, 2).map(task => <span className={'planner-chip ' + (task.is_past_plan ? 'past-plan' : task.status)} key={task.id}>
                      {!byMonth && (task.planned_start_at || task.scheduled_period) && <small>{task.planned_start_at ? timeLabel(task.planned_start_at, zone) : periodLabels[task.scheduled_period!]}</small>}
                      <span>{task.title}</span>{task.is_past_plan && <small>安排过</small>}
                    </span>)}
                    {items.length > 2 && <small>+{items.length - 2}</small>}
                  </button>
                </div>
              })}
            </div>
            <div className="planner-floating"><h3>日期待定</h3>
              {floating.length ? <ul>{floating.map(row)}</ul> : <p>没有待定日期的任务</p>}
            </div>
          </section>}
          {day && <section className="planner-panel planner-day">
            <header><CalendarDays size={18} /><h2>{dayLabel(day)}</h2><span className="planner-total">{agenda.length}</span></header>
            {agenda.length ? <ul>{agenda.map(row)}</ul> : <div className="planner-day-empty"><CalendarDays size={27} aria-hidden="true" /><p>当天没有安排</p>
              <button className="secondary" onClick={() => edit({ kind: 'task', initial: { scheduled_date: day } })}>安排任务</button>
            </div>}
          </section>}
        </>}
      </div>
    </div>
    {editor && <PlannerEditor {...editor} close={() => setEditor(null)} saved={(task, change) => {
      setEditor(null)
      setArmed(null)
      setMobileBacklog(false)
      if (change !== null) setUndo(change)
      if (task.scheduled_date) {
        if (calendar && task.scheduled_date >= first && task.scheduled_date <= last) {
          const params = new URLSearchParams(search)
          params.set('date', task.scheduled_date)
          params.delete('panel')
          setSearch(params, {replace: true})
        }
        else if (day !== task.scheduled_date) setSearch({view: 'today', date: task.scheduled_date})
      }
      notify('安排已保存')
    }} />}
  </div>
}
