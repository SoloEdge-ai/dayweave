import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  useState,
  type ReactNode,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { httpTaskUrl, taskLinkLabel } from './link-format'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Film,
  FolderOpen,
  LoaderCircle,
  PanelTop,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  api,
  errorText,
  type Project,
  type Resource,
  type Settings,
  type Task,
  type TaskResume,
} from './api'

export type EditorState =
  | { kind: 'task'; task?: Task; initial?: Partial<Task> }
  | { kind: 'resource'; resource?: Resource; initial?: Partial<Resource> }
  | { kind: 'project'; project?: Project }
  | { kind: 'resume'; task: Task }
  | {
      kind: 'confirm'
      title: string
      message: string
      action: () => Promise<unknown>
    }
  | null
export const Workspace = createContext<{
  edit: (editor: EditorState) => void
  discussTask: (taskId: number) => void
  resumes: TaskResume[]
  resumeByTask: Map<number, TaskResume>
  resumeError: unknown
  notify: (message: string) => void
  refresh: () => Promise<void>
  settings: Settings | undefined
  projects: Project[]
  resources: Resource[]
  accountId: string
  workspaceId: string
}>({
  edit: () => {},
  discussTask: () => {},
  resumes: [],
  resumeByTask: new Map(),
  resumeError: null,
  notify: () => {},
  refresh: async () => {},
  settings: undefined,
  projects: [],
  resources: [],
  accountId: '',
  workspaceId: '',
})
export const useWorkspace = () => useContext(Workspace)
export function Brand() {
  return (
    <div className="brand">
      <span className="mark" aria-hidden="true"/>
      <span>DayWeave</span>
    </div>
  )
}
export function Emblem({ size = '' }: { size?: string }) {
  return (
    <span className={'ai-emblem ' + size} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}
export function Empty({
  icon: Icon = PanelTop,
  title,
  children,
  action,
  onAction,
}: {
  icon?: LucideIcon
  title: string
  children?: ReactNode
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={21} />
      </div>
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {onAction && (
        <button className="text-button" onClick={onAction}>
          {action}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  )
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string
  retry?: () => void
}) {
  return (
    <div role="alert" className="errorbox">
      <AlertCircle size={16} />
      <span>{message}</span>
      {retry && <button onClick={retry}>重试</button>}
    </div>
  )
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={17} className="spin" />
      正在加载…
    </div>
  )
}
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={17} />
    </button>
  )
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string
  close: () => void
  children: ReactNode
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="modal" aria-describedby={undefined}>
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-btn" aria-label="关闭">
                <X size={19} />
              </button>
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  const id = useId(),
    labelId = id + '-label'
  return (
    <div className={'field ' + (wide ? 'wide' : '')}>
      <label id={labelId} htmlFor={id}>
        {label}
      </label>
      {Children.map(children, (child) => {
        if (
          isValidElement<{ id?: string; 'aria-labelledby'?: string }>(child) &&
          typeof child.type === 'string' &&
          ['input', 'select', 'textarea'].includes(child.type)
        ) {
          return cloneElement(child, { id, 'aria-labelledby': labelId })
        }
        return child
      })}
    </div>
  )
}
export function ResourceIcon({ type }: { type: string }) {
  const Icon =
    type === 'video'
      ? Film
      : type === 'pdf' || type === 'markdown'
        ? BookOpen
        : FolderOpen
  return (
    <span className={'resource-icon ' + type}>
      <Icon size={18} />
    </span>
  )
}
function captureLinks(text: string) {
  const links: { url: string }[] = []
  const value = text.trim()
  const plain = /^https?:\/\/\S+$/i.test(value)
  if (plain) {
    const url = httpTaskUrl(value)
    return { links: url ? [{ url: url.href }] : [], title: '', plain, invalid: !url }
  }
  let invalid = false
  const title = value.replace(/https?:\/\/[^\s<>"，。；！？、]+/gi, raw => {
    const url = httpTaskUrl(raw)
    if (!url) { invalid = true; return raw }
    if (!links.some(link => link.url === url.href)) links.push({url:url.href})
    return ' '
  }).replace(/\s+/g, ' ').trim()
  return { links, title, plain, invalid }
}

export function QuickCapture() {
  const { edit, refresh, notify } = useWorkspace(),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const capture = captureLinks(text)
  const submitLabel = capture.links.length ? '创建关联待办' : '添加'
  return (
    <div>
      <form
        className="quick-capture"
        onSubmit={async (e) => {
          e.preventDefault()
          const value = text.trim()
          if (!value) {
            edit({ kind: 'task' })
            return
          }
          if (capture.invalid) {
            setError('请输入有效的网页链接，链接中不能包含账户或密码。')
            return
          }
          if (capture.links.length) {
            edit({ kind:'task', initial:{
              title: capture.title || taskLinkLabel(capture.links[0]),
              links: capture.links,
            } })
            setText('')
            setError('')
            return
          }
          setBusy(true)
          setError('')
          try {
            await api('/tasks', 'POST', { title: value })
            await refresh()
            setText('')
            notify('任务已放入收件箱')
          } catch (e) {
            setError(errorText(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Plus size={19} />
        <input
          aria-label="快捷录入"
          placeholder="添加任务、粘贴链接，或记下一个想法…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={5000}
        />
        <button disabled={busy} title={submitLabel} aria-label={submitLabel}>
          <span>{submitLabel}</span>
          <ArrowRight size={15} />
        </button>
      </form>
      {capture.plain && capture.links.length > 0 && <button type="button" className="text-button" onClick={() => {
        const url = capture.links[0].url
        edit({ kind:'resource', initial:{ url, type:/youtu|bilibili|b23\.tv/i.test(url) ? 'video' : 'web' } })
        setText('')
        setError('')
      }}>仅存资料</button>}
      {error && <ErrorBox message={error} />}
    </div>
  )
}
