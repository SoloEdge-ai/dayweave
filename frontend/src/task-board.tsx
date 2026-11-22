import { useState, type FormEvent } from 'react'
import { CalendarDays, Check, CheckSquare2, Flag, Plus, X } from 'lucide-react'
import { api, dateLabel, errorText, priorityLabels, statusLabels, type Task } from './api'
import { ErrorBox, useWorkspace } from './ui'

export function TaskBoard({ items, defaults, status, view }: {
  items: Task[]; defaults: Partial<Task>; view: string; status: string | null
}) {
  const { edit, projects, refresh, notify } = useWorkspace()
  const [adding, setAdding] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api('/tasks', 'POST', { ...defaults, title: title.trim(), status: adding })
      setAdding('')
      setTitle('')
      await refresh()
      notify('任务已创建')
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  const allowed = view === 'completed' ? ['done'] : ['upcoming', 'inbox'].includes(view) ? ['todo', 'in_progress'] : Object.keys(statusLabels)
  return <div className="board-scroll" role="region" aria-label="任务看板" tabIndex={0}>
    {Object.entries(statusLabels).filter(([id]) => allowed.includes(id) && (!status || status === id)).map(([id, label]) => {
      const cards = items.filter(task => task.status === id)
      return <section className={'board-column state-' + id} key={id}>
        <header><span className="state-dot" /><h2>{label}</h2><span className="lane-count">{cards.length}</span>
          <button type="button" className="board-add" aria-label={'添加任务' + ' · ' + label} disabled={busy}
            onClick={() => { setAdding(id); setTitle(''); setError('') }}><Plus size={18} /></button>
        </header>
        {adding === id && <form onSubmit={save} className="board-entry">
          <input autoFocus required maxLength={500} aria-label="任务标题" placeholder="任务标题"
            value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && !busy) setAdding('') }} />
          {error && <ErrorBox message={error} />}
          <div><button className="primary" disabled={busy || !title.trim()}><Check size={15} />添加</button>
            <button type="button" className="icon-btn" disabled={busy} aria-label="取消" onClick={() => setAdding('')}><X size={16} /></button></div>
        </form>}
        <ul>{cards.map(task => {
          const project = projects.find(row => row.id === task.project_id)
          return <li key={task.id}><button type="button" className="board-card" onClick={() => edit({kind:'task', task})}>
            <strong>{task.title}</strong>
            {(project || task.category) && <span className="board-tags">
              {project && <span>{project.name}</span>}{task.category && <span>{task.category}</span>}
            </span>}
            <span className="board-card-foot">
              <CheckSquare2 size={14} /><span>#{task.id}</span>
              {task.scheduled_date && <><CalendarDays size={13} /><span>{dateLabel(task.scheduled_date)}</span></>}
              {task.priority === 'high' && <Flag className="high-flag" size={15} aria-label={priorityLabels.high} />}
            </span>
          </button></li>
        })}</ul>

      </section>
    })}
  </div>
}
