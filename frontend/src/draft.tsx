import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleX,
  LoaderCircle,
  PencilLine,
} from 'lucide-react'
import { api, dateInZone, dateLabel, errorText, periodLabels, priorityLabels, type Task } from './api'
import { ErrorBox, Field, useWorkspace } from './ui'
import { localInput, toIso } from './datetime'

export type DraftFields = Pick<
  Task,
  | 'title'
  | 'description'
  | 'scheduled_date'
  | 'scheduled_period'
  | 'planning_window'
  | 'window_start'
  | 'due_date'
  | 'due_at'
  | 'planned_start_at'
  | 'planned_end_at'
  | 'estimated_minutes'
  | 'priority'
  | 'project_id'
  | 'category'
>
type DraftRow = {
  index: number
  task: DraftFields
  task_id?: number
  resource?: { title: string; url: string; type: string }
}
export type DraftEvent = {
  type: 'task_draft'
  id: number
  version: number
  summary: string
  conflict: boolean
  status: 'pending' | 'approved' | 'cancelled'
  drafts: DraftRow[]
}
type Edits = Record<number, Partial<DraftFields>>
type MomentField = 'planned_start_at' | 'planned_end_at' | 'due_at'
const hasChanges = (edits: Edits) => Object.keys(edits).length > 0
function mergeEdits(older: Edits, newer: Edits) {
  const combined = { ...older }
  for (const [key, patch] of Object.entries(newer))
    combined[Number(key)] = { ...combined[Number(key)], ...patch }
  return combined
}
function applyEdits(rows: DraftRow[], edits: Edits) {
  return rows.map((row) => ({
    ...row,
    task: { ...row.task, ...edits[row.index] },
  }))
}
// Keep unsent keystrokes in this tab until SQLite acknowledges their version.
function cacheKey(id: number) {
  return 'dayweave:unsaved-draft:' + id
}
function cache(id: number, changes: Edits, version: number) {
  try {
    if (hasChanges(changes))
      sessionStorage.setItem(cacheKey(id), JSON.stringify({ changes, version }))
    else sessionStorage.removeItem(cacheKey(id))
  } catch {
    /* Draft saving still works with browser storage disabled. */
  }
}
function readCache(id: number, version: number): Edits {
  try {
    const stored = JSON.parse(sessionStorage.getItem(cacheKey(id)) ?? 'null')
    return stored?.version === version &&
      stored.changes &&
      typeof stored.changes === 'object'
      ? stored.changes
      : {}
  } catch {
    return {}
  }
}
function DraftOptions({ labels }: { labels: Record<string, string> }) {
  return (
    <>
      {Object.entries(labels).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </>
  )
}
export function TaskDraftCard({
  event,
  settled,
  closeAssistant,
}: {
  event: DraftEvent
  settled: () => void
  closeAssistant: () => void
}) {
  const navigate = useNavigate()
  const { projects, settings, edit, refresh } = useWorkspace()
  const zone = settings?.timezone ?? 'Asia/Hong_Kong'
  const [draft, setDraft] = useState(event)
  const server = useRef(event),
    dirty = useRef<Edits>({}),
    sent = useRef<Edits>({})
  const pending = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>()
  const [state, setState] = useState<'saved' | 'dirty' | 'saving' | 'error'>(
      'saved',
    ),
    [error, setError] = useState('')
  const [busy, setBusy] = useState(false),
    [override, setOverride] = useState(false)
  const [invalidTimes, setInvalidTimes] = useState<Record<string, string>>({})
  const hasInvalidTime = Object.keys(invalidTimes).length > 0
  const endpoint = '/ai/confirmations/' + event.id
  function show(record: DraftEvent) {
    if (record.version < server.current.version ||
        (server.current.status !== 'pending' && record.status === 'pending')) return
    server.current = record
    setDraft({ ...record, drafts: applyEdits(record.drafts, dirty.current) })
  }
  async function write() {
    while (hasChanges(dirty.current)) {
      const changes = dirty.current
      sent.current = changes
      dirty.current = {}
      setState('saving')
      try {
        const saved = await api<DraftEvent>(endpoint + '/draft', 'PATCH', {
          version: server.current.version,
          drafts: Object.entries(changes).map(([index, task]) => ({
            index: Number(index),
            task,
          })),
        })
        sent.current = {}
        show(saved)
        cache(event.id, dirty.current, saved.version)
      } catch (e) {
        if (server.current.status !== 'pending') {
          sent.current = {}
          return
        }
        dirty.current = mergeEdits(changes, dirty.current)
        sent.current = {}
        cache(event.id, dirty.current, server.current.version)
        setError(errorText(e))
        setState('error')
        throw e
      }
    }
    setState('saved')
  }
  async function flush() {
    clearTimeout(timer.current)
    while (pending.current || hasChanges(dirty.current)) {
      if (!pending.current)
        pending.current = write().finally(() => {
          pending.current = null
        })
      await pending.current
    }
  }
  function update(index: number, changes: Partial<DraftFields>) {
    dirty.current = mergeEdits(dirty.current, { [index]: changes })
    cache(
      event.id,
      mergeEdits(sent.current, dirty.current),
      server.current.version,
    )
    setDraft((value) => ({
      ...value,
      drafts: applyEdits(value.drafts, { [index]: changes }),
    }))
    setState('dirty')
    setError('')
    setOverride(false)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush().catch(() => {}), 420)
  }
  function clearInvalid(index: number, fields: MomentField[]) {
    setInvalidTimes((current) => {
      const next = { ...current }
      for (const field of fields) delete next[index + ':' + field]
      return next
    })
  }
  function editMoment(row: DraftRow, field: MomentField, value: string) {
    const t = row.task
    let instant
    try {
      instant = toIso(value, zone, t[field])
    } catch {
      setInvalidTimes((current) => ({
        ...current,
        [row.index + ':' + field]: value,
      }))
      return
    }
    clearInvalid(
      row.index,
      field === 'planned_start_at' && !instant
        ? [field, 'planned_end_at']
        : [field],
    )
    if (field === 'due_at') {
      update(row.index, {
        due_at: instant,
        due_date: instant
          ? null
          : localInput(t.due_at, zone).slice(0, 10) || t.due_date,
      })
    } else if (field === 'planned_start_at') {
      const end = t.planned_end_at
      update(row.index, {
        planned_start_at: instant,
        scheduled_date: instant ? value.slice(0, 10) : t.scheduled_date,
        scheduled_period: null,
        ...(instant ? { planning_window: null, window_start: null } : {}),
        planned_end_at:
          instant && end && Date.parse(end) > Date.parse(instant) ? end : null,
      })
    } else {
      update(row.index, { planned_end_at: instant })
    }
  }
  function momentInput(row: DraftRow, field: MomentField) {
    const invalid = invalidTimes[row.index + ':' + field]
    return (
      <input
        type="datetime-local"
        step="any"
        aria-invalid={invalid !== undefined}
        disabled={field === 'planned_end_at' && !row.task.planned_start_at}
        value={invalid ?? localInput(row.task[field], zone)}
        onChange={(e) => editMoment(row, field, e.target.value)}
      />
    )
  }
  useEffect(() => {
    if (event.status !== 'pending') {
      cache(event.id, {}, event.version)
      return
    }
    const recovered = readCache(event.id, event.version)
    if (hasChanges(recovered)) {
      dirty.current = recovered
      show(event)
      void flush().catch(() => {})
    }
    return () => {
      clearTimeout(timer.current)
      if (hasChanges(dirty.current)) void flush().catch(() => {})
    }
  }, [event.id])
  useEffect(() => {
    if (event.status !== 'pending' && server.current.status === 'pending' &&
        event.version >= server.current.version) {
      clearTimeout(timer.current)
      dirty.current = {}
      cache(event.id, {}, event.version)
      show(event)
      setError('')
      setState('saved')
      return
    }
    if (event.version > server.current.version && !pending.current &&
        !hasChanges(dirty.current) && !hasInvalidTime) show(event)
  }, [event, hasInvalidTime, state])
  async function retry() {
    setError('')
    setBusy(true)
    try {
      const latest = await api<DraftEvent>(endpoint)
      if (latest.status !== 'pending') {
        dirty.current = {}
        cache(event.id, {}, latest.version)
      }
      show(latest)
      await flush()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function decide(approve: boolean) {
    if (busy || (approve && hasInvalidTime)) return
    setBusy(true)
    setError('')
    clearTimeout(timer.current)
    try {
      if (approve) await flush()
      else {
        // Cancellation can discard unfinished fields, including invalid ones.
        dirty.current = {}
        await pending.current?.catch(() => {})
        dirty.current = {}
      }
      const res = await api<{ event: DraftEvent }>(endpoint, 'POST', {
        approve,
        version: server.current.version,
        allow_due_conflict: override,
      })
      cache(event.id, {}, res.event.version)
      show(res.event)
      await refresh()
      settled()
    } catch (e) {
      setError(errorText(e))
      setState('error')
    } finally {
      setBusy(false)
    }
  }
  async function openTask(id: number) {
    try {
      edit({ kind: 'task', task: await api<Task>('/tasks/' + id) })
    } catch (e) {
      setError(errorText(e))
    }
  }
  const editable = draft.status === 'pending'
  const saveState = hasInvalidTime ? 'error' : state
  return (
    <section className={'draft-card ' + draft.status} aria-label="任务草稿">
      <div className="draft-head">
        <span className="draft-icon">
          {editable ? (
            <PencilLine size={17} />
          ) : draft.status === 'approved' ? (
            <CheckCheck size={17} />
          ) : (
            <CircleX size={17} />
          )}
        </span>
        <div>
          <strong>
            {editable
              ? '新任务草稿'
              : draft.status === 'approved'
                ? '已创建'
                : '草稿已取消'}
          </strong>
          <small>
            {editable
              ? '确认后添加到任务列表'
              : draft.status === 'approved'
                ? '已保存到工作区'
                : '未创建任务'}
          </small>
        </div>
      </div>
      {draft.drafts.map((row) => {
        const t = row.task
        const change = (fields: Partial<DraftFields>) =>
          update(row.index, fields)
        const hasExact = Boolean(
          t.planned_start_at || t.planned_end_at || t.due_at,
        )
        if (!editable)
          return (
            <div className="draft-final" key={row.index}>
              <strong>{t.title}</strong>
              <small>
                {t.scheduled_date || (t.window_start
                  ? (t.planning_window === 'week' ? '待定周' : '待定月') + ' · ' + dateLabel(t.window_start)
                  : '未安排')}
                {t.scheduled_period
                  ? ' · ' + periodLabels[t.scheduled_period]
                  : ''}
              </small>
              {t.planned_start_at && (
                <small>
                  {'计划开始 · ' + zone} ·{' '}
                  {localInput(t.planned_start_at, zone).replace('T', ' ')}
                </small>
              )}
              {t.planned_end_at && (
                <small>
                  {'计划结束'} ·{' '}
                  {localInput(t.planned_end_at, zone).replace('T', ' ')}
                </small>
              )}
              {t.due_at && (
                <small>
                  {'精确截止时刻'} ·{' '}
                  {localInput(t.due_at, zone).replace('T', ' ')} · {zone}
                </small>
              )}
              {draft.status === 'approved' && row.task_id && (
                <button
                  className="text-button"
                  onClick={() => void openTask(row.task_id!)}
                >
                  打开任务
                  <ArrowRight size={14} />
                </button>
              )}
              {draft.status === 'approved' && row.task_id && (
                <button className="text-button" onClick={() => {
                  const params = new URLSearchParams()
                  if (t.scheduled_date) params.set('date', t.scheduled_date)
                  else if (t.window_start) {
                    params.set('view', t.planning_window === 'month' ? 'month' : 'week')
                    params.set('anchor', t.window_start)
                  } else params.set('panel', 'backlog')
                  params.set('task', String(row.task_id))
                  navigate('/planner?' + params)
                  closeAssistant()
                }}>在日历查看<ArrowRight size={14} /></button>
              )}
            </div>
          )
        return (
          <fieldset
            className="draft-fields"
            disabled={busy}
            key={row.index}
            onBlur={() => {
              if (hasChanges(dirty.current)) void flush().catch(() => {})
            }}
          >
            <Field label="任务标题" wide>
              <input
                required
                maxLength={500}
                value={t.title ?? ''}
                onChange={(e) => change({ title: e.target.value })}
              />
            </Field>
            {(t.planning_window || !t.scheduled_date) && <Field label="计划范围" wide>
              <select value={t.planning_window ?? ''} onChange={e => {
                const day = dateInZone(zone)
                const anchor = new Date(day + 'T12:00:00Z')
                anchor.setUTCDate(anchor.getUTCDate() - (anchor.getUTCDay() + 6) % 7)
                const window = e.target.value
                change({
                  planning_window: window === 'month' ? 'month' : window ? 'week' : null,
                  window_start: window === 'month' ? day.slice(0, 7) + '-01' : window ? anchor.toISOString().slice(0, 10) : null,
                })
              }}>
                <option value="">未安排</option>
                <option value="week">待定周</option>
                <option value="month">待定月</option>
              </select>
            </Field>}
            {t.planning_window && <Field label="计划周期起始日" wide><input
              type="date" value={t.window_start ?? ''} onChange={e => {
                if (!e.target.value) return
                const date = new Date(e.target.value + 'T12:00:00Z')
                date.setUTCDate(t.planning_window === 'month' ? 1 : date.getUTCDate() - (date.getUTCDay() + 6) % 7)
                change({ window_start: date.toISOString().slice(0, 10) })
              }} /></Field>}
            <Field label="计划日期">
              <input
                type="date"
                value={t.scheduled_date ?? ''}
                onChange={(e) => {
                  clearInvalid(row.index, [
                    'planned_start_at',
                    'planned_end_at',
                  ])
                  change({
                    scheduled_date: e.target.value || null,
                    planned_start_at: null,
                    planned_end_at: null,
                    planning_window: null,
                    window_start: null,
                    ...(!e.target.value ? { scheduled_period: null } : {}),
                  })
                }}
              />
            </Field>
            <Field label="计划时段">
              <select
                disabled={!t.scheduled_date}
                value={t.scheduled_period ?? ''}
                onChange={(e) => {
                  clearInvalid(row.index, [
                    'planned_start_at',
                    'planned_end_at',
                  ])
                  change({
                    scheduled_period: e.target.value || null,
                    planned_start_at: null,
                    planned_end_at: null,
                  })
                }}
              >
                <option value="">不限时段</option>
                <DraftOptions labels={periodLabels} />
              </select>
            </Field>
            <Field label="截止日期">
              <input
                type="date"
                value={t.due_date ?? localInput(t.due_at, zone).slice(0, 10)}
                onChange={(e) => {
                  clearInvalid(row.index, ['due_at'])
                  change({ due_date: e.target.value || null, due_at: null })
                }}
              />
            </Field>
            <Field label="预计耗时（分钟）">
              <input
                type="number"
                min={1}
                max={525600}
                value={t.estimated_minutes ?? ''}
                onChange={(e) =>
                  change({
                    estimated_minutes: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </Field>
            <Field label="优先级" wide>
              <select
                value={t.priority ?? 'medium'}
                onChange={(e) => change({ priority: e.target.value })}
              >
                <DraftOptions labels={priorityLabels} />
              </select>
            </Field>
            {row.resource && (
              <a
                className="draft-source wide"
                href={row.resource.url}
                rel="noreferrer"
                target="_blank"
              >
                {row.resource.title || row.resource.url}
                <ArrowRight size={13} />
              </a>
            )}
            <details className="wide" open={hasExact || undefined}>
              <summary>
                更多选项
                <ChevronDown size={14} />
              </summary>
              <div className="draft-extra">
                <Field label={'计划开始 · ' + zone} wide>
                  {momentInput(row, 'planned_start_at')}
                </Field>
                <Field label="计划结束" wide>
                  {momentInput(row, 'planned_end_at')}
                </Field>
                <Field label="精确截止时刻" wide>
                  {momentInput(row, 'due_at')}
                </Field>
                <Field label="所属项目">
                  <select
                    value={t.project_id ?? ''}
                    onChange={(e) =>
                      change({
                        project_id: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">无项目</option>
                    {projects.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="分类">
                  <input
                    value={t.category ?? ''}
                    maxLength={300}
                    onChange={(e) => change({ category: e.target.value })}
                  />
                </Field>
                <Field label="备注" wide>
                  <textarea
                    rows={2}
                    value={t.description ?? ''}
                    onChange={(e) => change({ description: e.target.value })}
                  />
                </Field>
              </div>
            </details>
          </fieldset>
        )
      })}
      {editable && (
        <div className="draft-footer">
          {draft.conflict && (
            <label className="draft-conflict">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              保留截止时间，仍按此计划创建
            </label>
          )}
          {error && <ErrorBox message={error} retry={() => void retry()} />}
          {hasInvalidTime && (
            <ErrorBox message="该时间在当前时区不存在，请重新选择。" />
          )}
          <div className="draft-save" aria-live="polite">
            {saveState === 'saved' ? (
              <Check size={13} />
            ) : saveState === 'saving' ? (
              <LoaderCircle size={13} className="spin" />
            ) : null}
            {saveState === 'saved'
              ? '草稿已保存'
              : saveState === 'saving'
                ? '正在保存草稿…'
                : saveState === 'error'
                  ? '草稿需要检查'
                  : '有待保存的修改'}
          </div>
          <div className="draft-actions">
            <button
              className="primary"
              disabled={
                busy ||
                hasInvalidTime ||
                draft.drafts.some((r) => !r.task.title?.trim()) ||
                (draft.conflict && !override)
              }
              onClick={() => void decide(true)}
            >
              <Check size={16} />
              确认创建
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              取消草稿
            </button>
          </div>
        </div>
      )}
      {!editable && error && <ErrorBox message={error} />}
    </section>
  )
}
