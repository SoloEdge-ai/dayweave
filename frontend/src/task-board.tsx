import { useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable,
  useSensor, useSensors, type Announcements, type DragEndEvent,
} from '@dnd-kit/core'
import { CalendarDays, Check, CheckSquare2, Flag, GripVertical, Plus, X } from 'lucide-react'
import { api, dateLabel, errorText, priorityLabels, statusLabels, taskTags, type Task } from './api'
import { ErrorBox, useWorkspace } from './ui'
import { TaskDestinations } from './task-links'

import { PaneGrip, useContainerWidth, useLayout, usePane, type Pane } from './pane-layout'

function BoardLane({ id, fallback, available, children }: {
  id: Pane; fallback: number; available: number; children: ReactNode
}) {
  const pane = usePane(id, fallback, available)
  const { setNodeRef, isOver } = useDroppable({ id })
  return <section ref={setNodeRef} id={pane.id} className={'board-column state-' + id + (isOver ? ' drop-target' : '')} style={{ width: pane.size }}>
    {children}<PaneGrip pane={pane} />
  </section>
}

function CardContents({ task, project }: { task: Task; project?: string }) {
  const tags = taskTags(task)
  return <>
    <span className="board-card-heading"><strong>{task.title}</strong><GripVertical size={16} aria-hidden="true" /></span>
    {(project || tags.length > 0) && <span className="board-tags">
      {project && <span>{project}</span>}{tags.map(tag => <span key={tag}>{tag}</span>)}
    </span>}
    <span className="board-card-foot">
      <CheckSquare2 size={14} /><span>#{task.id}</span>
      {task.scheduled_date && <><CalendarDays size={13} /><span>{dateLabel(task.scheduled_date)}</span></>}
      {task.priority === 'high' && <Flag className="high-flag" size={15} aria-label={priorityLabels.high} />}
    </span>
  </>
}

function BoardCard({ task, project, enabled, pending, moveSideways }: {
  task: Task; project?: string; enabled: boolean; pending: boolean; moveSideways: (direction: number) => void
}) {
  const { edit } = useWorkspace()
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: task.id, data: { task }, disabled: !enabled || pending,
  })
  return <li><button id={'board-task-' + task.id} ref={setNodeRef} type="button" className={'board-card' + (isDragging ? ' drag-source' : '')}
    {...listeners} aria-describedby={enabled ? attributes['aria-describedby'] : undefined}
    aria-keyshortcuts={enabled ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined}
    disabled={pending} onClick={() => edit({kind:'task', task})}
    onKeyDown={e => {
      if (enabled && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        if (!e.repeat) moveSideways(e.key === 'ArrowRight' ? 1 : -1)
      }
    }}>
    <CardContents task={task} project={project} />
  </button><TaskDestinations ids={task.resource_ids} primary={task} /></li>
}

function dropAnnouncements(): Announcements {
  return {
    onDragStart: ({ active }) => '正在移动任务' + ' · ' + active.data.current?.task.title,
    onDragOver: ({ over }) => over ? '目标状态' + ' · ' + statusLabels[String(over.id)] : undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => '已取消移动',
  }
}

export function TaskBoard({ items, defaults, status, view }: {
  items: Task[]; defaults: Partial<Task>; view: string; status: string | null
}) {
  const { projects, refresh, notify } = useWorkspace()
  const { widths } = useLayout()
  const container = useContainerWidth()
  const [adding, setAdding] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragged, setDragged] = useState<Task | null>(null)
  const [pending, setPending] = useState<Record<number, string>>({})
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 240, tolerance: 8 } }),
  )
  const [moveError, setMoveError] = useState('')
  async function move(task: Task, status: string, keyboard = false) {
    if (pending[task.id] || task.status === status) return
    setMoveError('')
    setPending(previous => ({ ...previous, [task.id]: status }))
    try {
      await api('/tasks/' + task.id + '/status', 'PATCH', { expected_status: task.status, status })
      notify('任务状态已更新' + ' · ' + statusLabels[status])
    } catch (e) {
      setMoveError(errorText(e))
    } finally {
      try { await refresh() } finally {
        setPending(previous => {
          const next = { ...previous }
          delete next[task.id]
          return next
        })
        if (keyboard) requestAnimationFrame(() => {
          if (document.activeElement === document.body) document.getElementById('board-task-' + task.id)?.focus()
        })
      }
    }
  }
  function drop({ over }: DragEndEvent) {
    setDragged(null)
    if (dragged && over && lanes.some(id => id === over.id)) void move(dragged, String(over.id))
  }

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
  const lanes = allowed.filter(id => !status || status === id) as Pane[]
  const available = Math.max(1, container.width - 4)
  const reserved = lanes.reduce((sum, id) => sum + Math.min(available, widths[id] ?? 0), 0)
  const automatic = lanes.filter(id => !widths[id]).length
  const fallback = container.width < 570 ? available * .82 :
    Math.max(215, (available - reserved - (lanes.length - 1) * 10) / Math.max(1, automatic))
  return <DndContext sensors={sensors} collisionDetection={args => {
    const point = args.pointerCoordinates
    const bounds = container.node?.getBoundingClientRect()
    if (!point || !bounds || point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return []
    return pointerWithin(args)
  }} accessibility={{ announcements: dropAnnouncements(), screenReaderInstructions: {
    draggable: '按住卡片拖动，或按 Alt 加左右方向键移到相邻列。',
  } }} onDragStart={({active}) => setDragged(active.data.current?.task ?? null)}
    onDragEnd={drop} onDragCancel={() => setDragged(null)}>
    {moveError && <ErrorBox message={moveError} />}
    <div ref={container.ref} className={'board-scroll' + (dragged ? ' dragging' : '')} role="region" aria-label="任务看板" tabIndex={0}>
    {lanes.map(id => {
      const label = statusLabels[id]
      const cards = items.filter(task => (pending[task.id] ?? task.status) === id)
      return <BoardLane key={id} id={id} fallback={fallback} available={available}>
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
        <ul>{cards.map(task => <BoardCard key={task.id} task={task}
          project={projects.find(p => p.id === task.project_id)?.name} enabled={lanes.length > 1}
          pending={!!pending[task.id]} moveSideways={step => {
            const next = lanes[lanes.indexOf(id) + step]
            if (next) void move(task, next, true)
          }} />)}</ul>
      </BoardLane>
    })}
    </div>
    {createPortal(<DragOverlay dropAnimation={null} style={{pointerEvents:'none'}}>
      {dragged && <div className="board-card drag-overlay" aria-hidden="true">
        <CardContents task={dragged} project={projects.find(p => p.id === dragged.project_id)?.name} />
      </div>}
    </DragOverlay>, document.body)}
  </DndContext>
}
