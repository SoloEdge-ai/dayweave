import { useQuery } from '@tanstack/react-query'
import { i18n } from './i18n'

export type Id = number
export type Task = {
  id: Id
  title: string
  description: string | null
  status: string
  priority: string
  project_id: Id | null
  category: string | null
  estimated_minutes: number | null
  scheduled_date: string | null
  planning_window?: 'week' | 'month' | null
  window_start?: string | null
  updated_at: string
  scheduled_period: string | null
  planned_start_at: string | null
  planned_end_at: string | null
  due_date: string | null
  due_at: string | null
  completed_at: string | null
  pinned: boolean
  resource_ids: Id[]
}
export type Resource = {
  id: Id
  title: string
  url: string | null
  type: string
  source: string | null
  description: string | null
  reason: string | null
  notes: string | null
  duration_seconds: number | null
  total_pages: number | null
  current_position: number
  position_unit: string
  progress_status: string
  file_url: string | null
  project_ids: Id[]
}
export type Project = {
  id: Id
  name: string
  description: string | null
  status: string
  target_date: string | null
  tasks?: Task[]
  resources?: Resource[]
}
export type Settings = {
  timezone: string
  week_start: number
  theme: string
  language: string
  default_provider: string | null
  default_model: string | null
  default_reasoning: string | null
  planning_preferences: string | null
}
export type Dashboard = {
  date: string
  focus: Task[]
  tasks: Task[]
  resources: Resource[]
  due_today: Task[]
  due_soon: Task[]
  overdue: Task[]
  missed: Task[]
}
export type Change = {
  id: Id
  entity_type: string
  entity_id: Id
  action: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  source: string
  created_at: string
  undone_at: string | null
}
export type ModelCatalog = {
  models: string[]
  efforts: string[]
  catalog: { id: string; name: string; efforts?: string[] }[]
}
export function modelLabel(catalog: ModelCatalog['catalog'] | undefined, id: string) {
  return catalog?.find((entry) => entry.id === id)?.name || id
}
export type Provider = ModelCatalog & {
  id: string
  name: string
  base_url: string | null
  model: string | null
  reasoning: string | null
  enabled: boolean
  status: string
  detail: string | null
  has_key: boolean
}
export const statusLabels: Record<string, string> = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
}
export const priorityLabels: Record<string, string> = {
  low: '低优先级',
  medium: '中优先级',
  high: '高优先级',
}
export const typeLabels: Record<string, string> = {
  video: '视频',
  web: '网页',
  pdf: 'PDF',
  markdown: 'Markdown',
  other: '其他',
}
export const progressLabels: Record<string, string> = {
  unstarted: '未开始',
  in_progress: '进行中',
  completed: '已完成',
}
export const periodLabels: Record<string, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
}
export const projectLabels: Record<string, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
}
export const viewLabels: Record<string, string> = {
  inbox: '收件箱',
  today: '今天',
  tomorrow: '明天',
  week: '本周',
  upcoming: '即将到来',
  all: '全部任务',
  completed: '已完成',
}

export function errorText(value: unknown): string {
  return value instanceof Error ? value.message : '操作失败，请重试。'
}
export async function responseError(r: Response): Promise<string> {
  const payload = await r.json().catch(() => null)
  const detail = payload?.detail ?? payload?.message
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail))
    return detail
      .map((item) =>
        [item.loc?.slice(1).join('.'), item.msg].filter(Boolean).join(' · '),
      )
      .join('，')
  if (detail && typeof detail.message === 'string') return detail.message
  return r.status === 401
    ? '请重新登录。'
    : '请求失败（' + r.status + '），请重试。'
}
export async function api<T>(
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const form = data instanceof FormData
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Accept-Language': i18n.language, ...(data !== undefined && !form ? { 'Content-Type': 'application/json' } : {}) },
    body: form ? data : data !== undefined ? JSON.stringify(data) : undefined,
  })
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth'))
      window.dispatchEvent(new Event('session-ended'))
    throw new Error(await responseError(res))
  }
  if (res.status === 204 || res.headers.get('content-length') === '0')
    return undefined as T
  const text = await res.text()
  return text ? (JSON.parse(text) as T) : (undefined as T)
}
export function useApi<T>(path: string, enabled = true) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path), enabled })
}
export function dateInZone(zone = 'Asia/Hong_Kong', offset = 0) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (key: string) => Number(parts.find((p) => p.type === key)?.value)
  return new Date(
    Date.UTC(part('year'), part('month') - 1, part('day') + offset, 12),
  )
    .toISOString()
    .slice(0, 10)
}
export function dateLabel(
  iso: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
) {
  return new Intl.DateTimeFormat(i18n.language, {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(iso.slice(0, 10) + 'T12:00:00Z'))
}
export function timeLabel(iso: string, zone: string) {
  return new Intl.DateTimeFormat(i18n.language, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}
export function readablePosition(r: Resource) {
  const pos = r.current_position || 0
  if (r.position_unit === 'seconds')
    return Math.floor(pos / 60) + ':' + String(pos % 60).padStart(2, '0')
  return r.position_unit === 'pages' ? '第 ' + pos + ' 页' : pos + '%'
}
export const safeUrl = (value: string | null | undefined) =>
  value && /^https?:\/\//i.test(value) ? value : undefined
