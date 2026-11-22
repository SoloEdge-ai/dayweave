import { useState, type FormEvent } from 'react'
import { CalendarDays, Inbox, Pencil, Undo2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { api, dateInZone, dateLabel, errorText, periodLabels, timeLabel, useApi, type Dashboard, type Task } from './api'
import { localInput, toIso } from './datetime'
import { Heading } from './pages'
import { ErrorBox, Field, IconButton, Loading, Modal, useWorkspace } from './ui'
import './planner.css'

const scopes = {
  today: '今天', tomorrow: '明天', week: '本周', next_week: '下周', month: '本月',
}
type Scope = keyof typeof scopes
const open = (task: Task) => task.status === 'todo' || task.status === 'in_progress'
const periodOrder: Record<string, string> = { morning: '06:00', afternoon: '12:00', evening: '18:00' }
const weekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay()
const shift = (date: string, days: number) =>
  new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10)
const monday = (date: string) => shift(date, -((weekday(date) + 6) % 7))
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
  const [date, setDate] = useState(target && 'date' in target ? target.date : task.scheduled_date ?? dateInZone(zone))
  const [kind, setKind] = useState('day')
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
  const preserveWindow = target && 'window' in target ? target : undefined

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
          {kind === 'day' && <>
            <Field label="计划日期"><input type="date" required value={date} onChange={e => {
              if (endDay === date) setEndDay(e.target.value)
              setDate(e.target.value)
            }} /></Field>
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
  const { settings, refresh, notify } = useWorkspace()
  const zone = settings?.timezone ?? 'Asia/Hong_Kong'
  const [search, setSearch] = useSearchParams()
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
  const visible = (plan.data ?? []).filter(task => {
    if (task.status === 'cancelled') return false
    if (!anchored) return true
    if (task.scheduled_date) return task.scheduled_date >= first && task.scheduled_date <= last
    if (!task.window_start) return false
    if (task.planning_window === 'month') return byMonth && task.window_start === first
    return task.window_start <= last && shift(task.window_start, 6) >= first
  })
  const order = (task: Task) => localInput(task.planned_start_at, zone).slice(11, 16) ||
    periodOrder[task.scheduled_period ?? ''] || ''
  const agenda = visible.filter(task => task.scheduled_date === day)
    .sort((a, b) => order(a).localeCompare(order(b)))
  const floating = visible.filter(task => task.planning_window)
  const queue = missed ? todayData.data?.missed ?? [] : backlog.data ?? []
  const target: Target = day ? {date: day} : {window: byMonth ? 'month' : 'week', anchor: first}
  const highlighted = Number(search.get('task'))

  function selectDay(date: string) {
    const params = new URLSearchParams(search)
    params.set('date', date)
    setSearch(params, { replace: true })
    if (armed) setEditor({ task: armed, target: { date } })
  }
  async function place(task: Task, data: Partial<Placement>) {
    setBusy(true)
    setError('')
    try {
      const result = await api<{task: Task; change_id: number | null}>('/tasks/' + task.id + '/schedule', 'PATCH', {
        ...data, expected_updated_at: task.updated_at,
      })
      setUndo(result.change_id)
      setArmed(null)
      setMobileBacklog(false)
      await refresh()
      notify('安排已保存')
    } catch (e) {
      setError(errorText(e))
      await refresh()
      setArmed(null)
    } finally {
      setBusy(false)
    }
  }
  const row = (task: Task) => <li key={task.id} className={'planner-agenda-row ' + (highlighted === task.id ? 'highlighted' : '')}>
    <span>{clock(task, zone)}</span><strong>{task.title}</strong>
    {open(task) && <IconButton icon={Pencil} label={'编辑安排' + ' · ' + task.title} onClick={() => setEditor({task})} />}
  </li>

  return <div className="planner-workspace">
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
    <div className="planner-columns">
      <aside className={'planner-backlog ' + (mobileBacklog ? 'expanded' : '')} aria-label="待安排">
        <header><Inbox size={18} /><h2>待安排</h2></header>
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
                aria-pressed={armed?.id === task.id} onClick={() => setArmed(armed?.id === task.id ? null : task)}>
                <strong>{task.title}</strong>
                {task.due_date && <small>{dateLabel(task.due_date)}</small>}
              </button>
            </li>)}</ul> : <p>没有待安排的任务</p>}
        </div>
      </aside>
      <div className="planner-plan">
        {armed && <div className="planner-place">
          <strong>{armed.title}</strong>
          <button className="primary" disabled={busy} onClick={() => {
            if ('date' in target) setEditor({task: armed, target})
            else void place(armed, {planning_window: target.window, window_start: target.anchor})
          }}>{day ? '排入' + ' · ' + dayLabel(day) : '排入待定日期'}</button>
          <button className="secondary" onClick={() => setArmed(null)}>取消</button>
        </div>}
        {plan.isError ? <ErrorBox message={errorText(plan.error)} retry={() => void plan.refetch()} /> :
          plan.isPending ? <Loading /> : <>
          {calendar && <section className="planner-panel">
            <header><CalendarDays size={18} /><h2>{byMonth ? dateLabel(first, {month: 'long', year: 'numeric'}) :
              dateLabel(first) + ' – ' + dateLabel(shift(first, 6))}</h2></header>
            <div className={'planner-calendar ' + (byMonth ? 'planner-month' : 'planner-week')}>
              {calendarDays.slice(0, 7).map(date => <span className="planner-weekday" key={date}>{dateLabel(date, {weekday: 'short'})}</span>)}
              {calendarDays.map(date => {
                const inMonth = !byMonth || date.startsWith(first.slice(0, 7))
                const items = visible.filter(task => task.scheduled_date === date)
                return <div className="planner-cell" key={date}>
                  <button type="button" aria-label={dayLabel(date)} aria-pressed={date === day}
                    aria-current={date === today ? 'date' : undefined} disabled={!inMonth} onClick={() => selectDay(date)}>
                    <b>{Number(date.slice(-2))}</b>
                    {items.slice(0, 2).map(task => <span className={'planner-chip ' + task.status} key={task.id}>{task.title}</span>)}
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
            <header><CalendarDays size={18} /><h2>{dayLabel(day)}</h2></header>
            {agenda.length ? <ul>{agenda.map(row)}</ul> : <p>当天没有安排</p>}
          </section>}
        </>}
      </div>
    </div>
    {editor && <PlannerEditor {...editor} close={() => setEditor(null)} saved={(task, change) => {
      setEditor(null)
      setArmed(null)
      setMobileBacklog(false)
      setUndo(change)
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
