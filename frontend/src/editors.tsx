import { PlanDatePicker, type PlanDate } from './plan-date'
import { useState, type FormEvent } from 'react'
import { ExternalLink, Trash2 } from 'lucide-react'
import {
  api,
  dateInZone,
  errorText,
  periodLabels,
  priorityLabels,
  progressLabels,
  projectLabels,
  safeUrl,
  workspaceLink,
  statusLabels,
  typeLabels,
  type Project,
  type Resource,
} from './api'
import { ErrorBox, Field, Modal, useWorkspace, type EditorState } from './ui'
import { localInput, toIso } from './datetime'

const opts = (labels: Record<string, string>) =>
  Object.entries(labels).map(([key, label]) => (
    <option key={key} value={key}>
      {label}
    </option>
  ))
const nullable = (s: string) => s.trim() || null
function useSubmit(close: () => void) {
  const { notify, refresh } = useWorkspace(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit(operation: () => Promise<unknown>, success: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await operation()
      await refresh()
      notify(success)
      close()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit }
}
function TaskEditor({
  item,
  close,
}: {
  item: Extract<EditorState, { kind: 'task' }>
  close: () => void
}) {
  const { settings, projects, resources, edit } = useWorkspace(),
    orig = item.task,
    t = orig ?? item.initial ?? {},
    zone = settings?.timezone ?? 'Asia/Hong_Kong'
  const [values, setValues] = useState({
    title: t.title ?? '',
    description: t.description ?? '',
    status: t.status ?? 'todo',
    priority: t.priority ?? 'medium',
    category: t.category ?? '',
    project_id: t.project_id?.toString() ?? '',
    estimated_minutes: t.estimated_minutes?.toString() ?? '',
    scheduled_date: t.scheduled_date ?? '',
    scheduled_period: t.scheduled_period ?? '',
    planned_start_at: localInput(t.planned_start_at, zone),
    planned_end_at: localInput(t.planned_end_at, zone),
    planning_window: t.planning_window ?? null,
    window_start: t.window_start ?? null,
    due_period: t.due_period ?? '',
    due_date: t.due_date ?? '',
    due_at: localInput(t.due_at, zone),
  })
  const [pinned, setPinned] = useState(t.pinned ?? false),
    [links, setLinks] = useState<number[]>(t.resource_ids ?? []),
    [allow, setAllow] = useState(false)
  const { busy, error, submit } = useSubmit(close)
  const props = (key: keyof typeof values) => ({
    value: values[key] ?? '',
    onChange: (e: { target: { value: string } }) =>
      setValues({ ...values, [key]: e.target.value }),
  })
  function shiftPlan(date: string, window: PlanDate['planning_window'] = null, anchor: string | null = null) {
    const previous =
      values.scheduled_date || values.planned_start_at.slice(0, 10)
    const shiftMoment = (local: string) => {
      if (!date || !local) return ''
      if (!previous) return local
      const difference =
        Date.parse(date + 'T12:00:00Z') - Date.parse(previous + 'T12:00:00Z')
      return new Date(Date.parse(local + 'Z') + difference)
        .toISOString()
        .slice(0, local.length)
    }
    setValues({
      ...values,
      scheduled_date: date,
      planning_window: window ?? null,
      window_start: anchor,
      scheduled_period: date ? values.scheduled_period : '',
      planned_start_at: shiftMoment(values.planned_start_at),
      planned_end_at: shiftMoment(values.planned_end_at),
    })
    setAllow(false)
  }
  function save(e: FormEvent) {
    e.preventDefault()
    void submit(
      () => {
        const v = values
        const valuesToSave = {
            ...v,
            title: v.title.trim(),
            description: v.description.trim(),
            category: v.category.trim(),
            project_id: v.project_id ? Number(v.project_id) : null,
            estimated_minutes: v.estimated_minutes
              ? Number(v.estimated_minutes)
              : null,
            scheduled_date: v.scheduled_date || null,
            scheduled_period: v.scheduled_period || null,
            planned_start_at: toIso(
              v.planned_start_at,
              zone,
              t.planned_start_at,
            ),
            planned_end_at: toIso(v.planned_end_at, zone, t.planned_end_at),
            due_period: !v.due_at && v.due_date ? v.due_period || null : null,
            due_date: v.due_at ? null : v.due_date || null,
            due_at: toIso(v.due_at, zone, t.due_at),
            pinned,
            resource_ids: links,
            allow_due_conflict: allow,
        }
        if (!orig) return api('/tasks', 'POST', valuesToSave)
        const patch = Object.fromEntries(
          Object.entries(valuesToSave).filter(([key, value]) => {
            if (key === 'allow_due_conflict') return value === true
            return JSON.stringify(orig[key as keyof typeof orig]) !== JSON.stringify(value)
          }),
        )
        return api('/tasks/' + orig.id, 'PATCH', patch)
      },
      orig ? '任务已更新' : '任务已创建',
    )
  }
  return (
    <Modal title={orig ? '编辑任务' : '新建任务'} close={close}>
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="任务名称" wide>
            <input
              required
              maxLength={300}
              autoFocus
              {...props('title')}
              placeholder="想完成什么？"
            />
          </Field>
          <Field label="状态">
            <select {...props('status')}>{opts(statusLabels)}</select>
          </Field>
          <Field label="优先级">
            <select {...props('priority')}>{opts(priorityLabels)}</select>
          </Field>
          <PlanDatePicker plan={values} zone={zone} change={plan =>
            shiftPlan(plan.scheduled_date ?? '', plan.planning_window, plan.window_start ?? null)} />
          {values.scheduled_date && <Field label="计划时段">
            <select {...props('scheduled_period')}>
              <option value="">不限时段</option>
              {opts(periodLabels)}
            </select>
          </Field>}
          <Field label="截止日期">
            <input
              type="date"
              disabled={!!values.due_at}
              {...props('due_date')}
            />
          </Field>
          {values.due_date && !values.due_at && <Field label="截止时段"><select {...props('due_period')}>
            <option value="">不限时段</option>{opts(periodLabels)}
          </select></Field>}
          <Field label="预计耗时（分钟）">
            <input type="number" min={1} {...props('estimated_minutes')} />
          </Field>
          <Field label="所属项目">
            <select {...props('project_id')}>
              <option value="">无项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="分类">
            <input
              maxLength={80}
              {...props('category')}
              placeholder="工作、生活、学习…"
            />
          </Field>
          <label className="check-label wide">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            置为今日重点
          </label>
          <details className="wide form-details">
            <summary>具体时刻、关联资料与备注</summary>
            <div className="form-grid">
              <Field label={'计划开始 · ' + zone}>
                <input
                  type="datetime-local"
                  step="any"
                  {...props('planned_start_at')}
                />
              </Field>
              <Field label="计划结束">
                <input
                  type="datetime-local"
                  step="any"
                  {...props('planned_end_at')}
                />
              </Field>
              <Field label="精确截止时刻" wide>
                <input type="datetime-local" step="any" {...props('due_at')} />
              </Field>
              <Field label="备注" wide>
                <textarea rows={3} {...props('description')} />
              </Field>
              {resources.length > 0 && (
                <div className="wide">
                  <span className="field-label">关联资料</span>
                  <div className="checks">
                    {resources.map((r) => (
                      <label key={r.id}>
                        <input
                          type="checkbox"
                          checked={links.includes(r.id)}
                          onChange={(e) =>
                            setLinks(
                              e.target.checked
                                ? [...links, r.id]
                                : links.filter((id) => id !== r.id),
                            )
                          }
                        />
                        {r.title}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
          {orig && links.length > 0 && (
            <div className="wide linked-list">
              {resources
                .filter((r) => links.includes(r.id))
                .map((r) => {
                  const url = r.file_url ? workspaceLink(r.file_url) : safeUrl(r.url)
                  return (
                    url && (
                      <a href={url} target="_blank" rel="noreferrer" key={r.id}>
                        <ExternalLink size={14} />
                        {r.title}
                      </a>
                    )
                  )
                })}
            </div>
          )}
          {error && (
            <div className="wide">
              <ErrorBox message={error} />
              {/截止|deadline|conflict|due/i.test(error) && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={allow}
                    onChange={(e) => setAllow(e.target.checked)}
                  />
                  保留现有截止时间，按此计划保存
                </label>
              )}
            </div>
          )}
        </div>
        <footer>
          {orig && (
            <button
              className="danger subtle"
              type="button"
              onClick={() =>
                edit({
                  kind: 'confirm',
                  title: '删除任务',
                  message: '删除“' + orig.title + '”？你可以在变更记录中撤销。',
                  action: () =>
                    api('/tasks/' + orig.id + '?confirm=true', 'DELETE'),
                })
              }
            >
              <Trash2 size={15} />
              删除
            </button>
          )}
          {orig && (
            <button
              className="subtle"
              type="button"
              onClick={() => {
                const from = values.scheduled_date ?? ''
                const later = new Date(
                  Date.parse((from || dateInZone(zone)) + 'T12:00:00Z') +
                    86400000,
                )
                shiftPlan(later.toISOString().slice(0, 10))
              }}
            >
              顺延一天
            </button>
          )}
          <span />
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? '正在保存…' : '保存任务'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
function ProjectEditor({
  project,
  close,
}: {
  project?: Project
  close: () => void
}) {
  const [name, setName] = useState(project?.name ?? ''),
    [desc, setDesc] = useState(project?.description ?? ''),
    [status, setStatus] = useState(project?.status ?? 'active'),
    [due, setDue] = useState(project?.target_date ?? ''),
    { busy, error, submit } = useSubmit(close)
  return (
    <Modal close={close} title={project ? '编辑项目' : '新建项目'}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit(
            () =>
              api(
                project ? '/projects/' + project.id : '/projects',
                project ? 'PATCH' : 'POST',
                {
                  name: name.trim(),
                  description: desc.trim(),
                  status,
                  target_date: due || null,
                },
              ),
            '项目已保存',
          )
        }}
      >
        <div className="form-grid">
          <Field label="项目名称" wide>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
            />
          </Field>
          <Field label="描述" wide>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
            />
          </Field>
          <Field label="项目状态">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {opts(projectLabels)}
            </select>
          </Field>
          <Field label="目标日期">
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
          {error && (
            <div className="wide">
              <ErrorBox message={error} />
            </div>
          )}
        </div>
        <footer>
          <span />
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            保存项目
          </button>
        </footer>
      </form>
    </Modal>
  )
}
function ResourceEditor({
  item,
  close,
}: {
  item: Extract<EditorState, { kind: 'resource' }>
  close: () => void
}) {
  const resource = item.resource,
    r = resource ?? item.initial ?? {},
    { projects } = useWorkspace(),
    { busy, error, submit } = useSubmit(close)
  const [file, setFile] = useState<File | null>(null),
    [uploaded, setUploaded] = useState<number | null>(null),
    [links, setLinks] = useState(r.project_ids ?? [])
  const [v, set] = useState({
    title: r.title ?? '',
    url: r.url ?? '',
    type: r.type ?? 'web',
    source: r.source ?? '',
    description: r.description ?? '',
    reason: r.reason ?? '',
    notes: r.notes ?? '',
    position: r.current_position?.toString() ?? '0',
    status: r.progress_status ?? 'unstarted',
    duration: r.duration_seconds?.toString() ?? '',
    pages: r.total_pages?.toString() ?? '',
  })
  const props = (k: keyof typeof v) => ({
    value: v[k],
    onChange: (e: { target: { value: string } }) =>
      set({ ...v, [k]: e.target.value }),
  })
  const [mode, setMode] = useState<'link' | 'upload'>('link'),
    unit =
      v.type === 'video' ? 'seconds' : v.type === 'pdf' ? 'pages' : 'percent'
  async function save() {
    let id = resource?.id ?? uploaded
    if (!id && mode === 'upload') {
      if (!file) throw new Error('请选择要上传的文件。')
      const data = new FormData()
      data.append('file', file)
      data.append('title', v.title.trim() || file.name)
      const result = await api<Resource>('/resources/upload', 'POST', data)
      id = result.id
      setUploaded(id)
    }
    return api(id ? '/resources/' + id : '/resources', id ? 'PATCH' : 'POST', {
      title: v.title.trim() || file?.name,
      url: mode === 'upload' ? null : nullable(v.url),
      type: v.type,
      source: v.source.trim(),
      description: v.description.trim(),
      reason: v.reason.trim(),
      notes: v.notes.trim(),
      position_unit: unit,
      current_position: Number(v.position) || 0,
      progress_status: v.status,
      project_ids: links,
      duration_seconds: v.duration ? Number(v.duration) : null,
      total_pages: v.pages ? Number(v.pages) : null,
    })
  }
  return (
    <Modal close={close} title={resource ? '编辑资料' : '添加资料'}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit(save, '资料已保存')
        }}
      >
        <div className="form-grid">
          {!resource && (
            <div className="tabs wide">
              {(['link', 'upload'] as const).map((m) => (
                <button
                  type="button"
                  className={mode === m ? 'active' : ''}
                  key={m}
                  onClick={() => {
                    setMode(m)
                    if (m === 'upload') set({ ...v, type: 'pdf' })
                  }}
                >
                  {m === 'link' ? '保存链接' : '上传文件'}
                </button>
              ))}
            </div>
          )}
          {mode === 'upload' ? (
            <Field label="选择 PDF 或 Markdown 文件" wide>
              <input
                type="file"
                accept=".pdf,.md,.markdown"
                required
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f)
                  if (f)
                    set({
                      ...v,
                      title: v.title || f.name,
                      type: /\.pdf$/i.test(f.name) ? 'pdf' : 'markdown',
                    })
                }}
              />
            </Field>
          ) : (
            !r.file_url && (
              <Field label="资料链接" wide>
                <input
                  type="url"
                  required
                  value={v.url}
                  placeholder="https://"
                  onChange={(e) => {
                    const url = e.target.value
                    set({
                      ...v,
                      url,
                      ...(/youtu|bilibili|b23\.tv/i.test(url)
                        ? { type: 'video' }
                        : {}),
                    })
                  }}
                />
              </Field>
            )
          )}
          <Field label="标题" wide>
            <input
              required
              {...props('title')}
              maxLength={300}
              placeholder="便于以后找到它的名字"
            />
          </Field>
          <Field label="资料类型">
            <select {...props('type')}>{opts(typeLabels)}</select>
          </Field>
          <Field label="来源">
            <input {...props('source')} />
          </Field>
          <Field label="阅读 / 观看状态">
            <select {...props('status')}>{opts(progressLabels)}</select>
          </Field>
          <Field
            label={
              '当前进度（' +
              { seconds: '秒', pages: '页', percent: '%' }[unit] +
              '）'
            }
          >
            <input
              type="number"
              min={0}
              max={unit === 'percent' ? 100 : undefined}
              {...props('position')}
            />
          </Field>
          {v.type === 'video' && (
            <Field label="总时长（秒）">
              <input type="number" min={1} {...props('duration')} />
            </Field>
          )}
          {v.type === 'pdf' && (
            <Field label="总页数">
              <input type="number" min={1} {...props('pages')} />
            </Field>
          )}
          <Field label="保存原因" wide>
            <input {...props('reason')} />
          </Field>
          <Field label="描述" wide>
            <textarea rows={2} {...props('description')} />
          </Field>
          <Field label="个人笔记" wide>
            <textarea rows={2} {...props('notes')} />
          </Field>
          {projects.length > 0 && (
            <div className="wide">
              <span className="field-label">关联项目</span>
              <div className="checks">
                {projects.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={links.includes(p.id)}
                      onChange={(e) =>
                        setLinks(
                          e.target.checked
                            ? [...links, p.id]
                            : links.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && (
            <div className="wide">
              <ErrorBox message={error} />
            </div>
          )}
        </div>
        <footer>
          <span />
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? '正在保存…' : '保存资料'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
function Confirmation({
  item,
  close,
}: {
  item: Extract<EditorState, { kind: 'confirm' }>
  close: () => void
}) {
  const { busy, error, submit } = useSubmit(close)
  return (
    <Modal title={item.title} close={close}>
      <div className="modal-body">
        <p>{item.message}</p>
        {error && <ErrorBox message={error} />}
      </div>
      <footer>
        <span />
        <button className="secondary" onClick={close}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void submit(item.action, '操作已完成')}
        >
          确认{item.title}
        </button>
      </footer>
    </Modal>
  )
}
export function Editors({
  item,
  close,
}: {
  item: EditorState
  close: () => void
}) {
  if (!item) return null
  if (item.kind === 'task') return <TaskEditor item={item} close={close} />
  if (item.kind === 'resource')
    return <ResourceEditor item={item} close={close} />
  if (item.kind === 'project')
    return <ProjectEditor project={item.project} close={close} />
  return <Confirmation item={item} close={close} />
}
