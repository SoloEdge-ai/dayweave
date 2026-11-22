import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useWorkspace } from './ui'
import { statusLabels } from './api'

const limits = {
  navigation: [180, 420], assistant: [300, 880], backlog: [185, 540],
  todo: [205, 1600], in_progress: [205, 1600], done: [205, 1600], cancelled: [205, 1600],
} as const
export type Pane = keyof typeof limits
export const panes = Object.keys(limits) as Pane[]
export function paneName(pane: Pane) {
  if (pane === 'navigation') return '导航栏'
  if (pane === 'assistant') return '助手侧栏'
  if (pane === 'backlog') return '待安排'
  return statusLabels[pane]
}
type Widths = Partial<Record<Pane, number>>
const Layout = createContext<{ widths: Widths; save: (key: Pane, size?: number) => void } | null>(null)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))

export function LayoutProvider({ account, children }: { account: string; children: ReactNode }) {
  const storageKey = 'dayweave.layout.' + account
  const [widths, setWidths] = useState<Widths>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
      return Object.fromEntries(panes.filter(id => Number.isFinite(saved?.[id]))
        .map(id => [id, clamp(saved[id], ...limitsFor(id))]))
    } catch { return {} }
  })
  function save(key: Pane, size?: number) {
    const next = { ...widths }
    if (size === undefined) delete next[key]
    else if (Number.isFinite(size)) next[key] = clamp(size, ...limitsFor(key))
    setWidths(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Keep using this session's layout. */ }
  }
  return <Layout.Provider value={{ widths, save }}>{children}</Layout.Provider>
}
function limitsFor(key: Pane): readonly [number, number] { return limits[key] }
export function useLayout() {
  const value = useContext(Layout)
  if (!value) throw new Error('LayoutProvider is required')
  return value
}

export function useContainerWidth() {
  const [node, ref] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(() => window.innerWidth)
  useLayoutEffect(() => {
    if (!node) return
    const measure = () => setWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return { ref, width }
}
export function usePane(key: Pane, fallback: number, available: number) {
  const { widths, save } = useLayout()
  const [preview, setPreview] = useState<number>()
  const max = Math.max(1, Math.min(limits[key][1], Math.floor(available)))
  const min = Math.min(limits[key][0], max)
  const size = clamp(preview ?? widths[key] ?? fallback, min, max)
  const id = useId()
  return { key, id, size, min, max, setPreview, save: (value?: number) => save(key, value) }
}
export function PaneGrip({ pane, edge = 'right' }: { pane: ReturnType<typeof usePane>; edge?: 'left' | 'right' }) {
  const drag = useRef<{ id: number; x: number; start: number } | null>(null)
  const direction = edge === 'right' ? 1 : -1
  const at = (x: number) => clamp(drag.current!.start + direction * (x - drag.current!.x), pane.min, pane.max)
  const label = '调整宽度' + ' · ' + paneName(pane.key)
  return <div className={'pane-grip edge-' + edge} role="separator" tabIndex={0}
    aria-controls={pane.id} aria-orientation="vertical" aria-label={label} title={label}
    aria-valuemin={pane.min} aria-valuemax={pane.max} aria-valuenow={pane.size} aria-valuetext={pane.size + ' px'}
    onPointerDown={e => {
      if (!e.isPrimary || e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { id: e.pointerId, x: e.clientX, start: pane.size }
      e.preventDefault()
      e.currentTarget.focus({ preventScroll: true })
    }}
    onPointerMove={e => { if (drag.current?.id === e.pointerId) pane.setPreview(at(e.clientX)) }}
    onPointerUp={e => {
      if (drag.current?.id !== e.pointerId) return
      if (e.clientX !== drag.current.x) pane.save(at(e.clientX))
      drag.current = null
      pane.setPreview(undefined)
    }}
    onLostPointerCapture={() => { drag.current = null; pane.setPreview(undefined) }}
    onDoubleClick={() => pane.save()}
    onKeyDown={e => {
      const step = e.shiftKey ? 48 : 16
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        pane.save(clamp(pane.size + (e.key === 'ArrowRight' ? step : -step) * direction, pane.min, pane.max))
      else if (e.key === 'Home' || e.key === 'End') pane.save(e.key === 'Home' ? pane.min : pane.max)
      else if (e.key === 'Enter') pane.save()
      else return
      e.preventDefault()
    }} />
}

export function LayoutControls({ initial = 'assistant', pixels }: { initial?: Pane; pixels?: number }) {
  const { widths, save } = useLayout()
  const { notify } = useWorkspace()
  const [key, select] = useState<Pane>(initial)
  const [value, edit] = useState(String(pixels ?? widths[initial] ?? ''))
  const [min, max] = limits[key]
  return <form className="settings-panel layout-controls" onSubmit={e => {
    e.preventDefault()
    save(key, value ? Number(value) : undefined)
    notify('栏目宽度已更新')
  }}>
    <h2>栏目宽度</h2>
    <div className="form-grid">
      <label className="field">栏目<select value={key} onChange={e => {
        const next = e.target.value as Pane
        select(next); edit(String(widths[next] ?? ''))
      }}>{panes.map(id => <option key={id} value={id}>{paneName(id)}</option>)}</select></label>
      <label className="field">宽度（像素）<input type="number" inputMode="numeric" min={min} max={max} step="1"
        placeholder="自适应" value={value} onChange={e => edit(e.target.value)} /></label>
    </div>
    <div className="actions"><button className="primary">应用宽度</button>
      <button className="secondary" type="button" onClick={() => { save(key); edit(''); notify('栏目宽度已更新') }}>恢复自适应</button></div>
  </form>
}
