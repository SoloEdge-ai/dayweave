import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Clock3,
  History,
  ListChecks,
  MessageCircle,
  Mic,
  PanelRightClose,
  Plus,
  RotateCcw,
  Square,
  SlidersHorizontal,
} from 'lucide-react'
import {
  api,
  errorText,
  modelLabel,
  responseError,
  statusLabels,
  periodLabels,
  priorityLabels,
  progressLabels,
  useApi,
  type Provider,
  type ModelCatalog,
  workspaceHeaders,
} from './api'
import { useSearchParams } from 'react-router-dom'
import { Emblem, ErrorBox, IconButton, useWorkspace } from './ui'
import { TaskDraftCard, type DraftEvent } from './draft'
import { WorkspaceCommands, actionName, allowedAction, localCommand, type ChatAction } from './chat-actions'
import { VoiceInput } from './voice'
import { httpTaskUrl } from './link-format'
import './chat-tools.css'

type ToolItem = {
  type?: string
  name?: string
  result?: unknown
  id?: string | number
  summary?: string
  resolved?: boolean
}
function isDraft(tool:ToolItem):tool is ToolItem & DraftEvent {
  return tool.type==='task_draft' && 'drafts' in tool && Array.isArray(tool.drafts)
}
function lastConversation(storageKey: string){
  try{const value=Number(sessionStorage.getItem(storageKey));return Number.isSafeInteger(value)&&value>0?value:null}catch{return null}
}
type TokenUsage = { total_tokens:number; input_tokens:number|null; output_tokens:number|null; partial:boolean }

function UsageLine({ usage }: { usage?: TokenUsage | null }) {
  if (!usage) return <small className="turn-usage">Token 用量未记录</small>
  const number = new Intl.NumberFormat(document.documentElement.lang)
  return <small className="turn-usage" aria-label="本轮 Token 用量">
    <span>{usage.partial ? '已报告用量' : '本轮用量'} · {number.format(usage.total_tokens)} tokens</span>
    {usage.input_tokens != null && <span>{'输入'} {number.format(usage.input_tokens)}</span>}
    {usage.output_tokens != null && <span>{'输出'} {number.format(usage.output_tokens)}</span>}
  </small>
}
type ChatMessage = {
  token_usage?: TokenUsage | null
  id?: number
  role: string
  content: string
  tools?: ToolItem[]
}
type Conversation = { id: number; title: string; messages?: ChatMessage[] }
type StreamEvent = {
  usage?: TokenUsage | null
  type: string
  id?: number
  name?: string
  text?: string
  message?: string
  summary?: string
  result?: unknown
}
const prompts = () => [
  {
    icon: ListChecks,
    label: '整理今天的待办',
    text: '查一下我今天的任务，按优先级整理。',
  },
  {
    icon: Clock3,
    label: '帮我规划明天',
    text: '根据待办、截止时间和已有安排，为明天做个计划。',
  },
  {
    icon: RotateCcw,
    label: '回顾本周进展',
    text: '帮我回顾本周完成了什么，还有哪些未完成。',
  },
]
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20),
  ].join('-')
}
export function Chat({ full, close }: { full: boolean; close: () => void }) {
  const { settings, refresh, notify, accountId, workspaceId } = useWorkspace(),
    activeConversation = 'dayweave:conversation:' + accountId + ':' + workspaceId,
    providers = useApi<Provider[]>('/ai/providers'),
    convs = useApi<Conversation[]>('/ai/conversations')
  const [cid, setCid] = useState<number | null>(() => lastConversation(activeConversation)),
    history = useApi<Conversation>('/ai/conversations/' + cid, cid !== null)
  const [draft, setDraft] = useState(''),
    [current, setCurrent] = useState<ChatMessage[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [showHistory, setShowHistory] = useState(false),
    [config, setConfig] = useState(false)
  const [provider, setProvider] = useState(''),
    [model, setModel] = useState(''),
    [effort, setEffort] = useState(''),
    bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    cancel = useRef<AbortController | null>(null)
  const list = providers.data ?? [],
    chosen =
      list.find((p) => p.id === (provider || settings?.default_provider)) ??
      list.find((p) => p.enabled && p.has_key) ??
      list[0]
  const chosenModel =
      model ||
      (settings?.default_provider === chosen?.id
        ? settings?.default_model
        : '') ||
      chosen?.model ||
      '',
    canSend = !!(
      chosen?.enabled &&
      (chosen.has_key ||
        (chosen.id === 'chatgpt' && chosen.status === 'connected'))
    )
  const models = useApi<ModelCatalog>(
    '/ai/models?provider=' +
      encodeURIComponent(chosen?.id ?? '') +
      '&model=' +
      encodeURIComponent(chosenModel),
    !!chosen && config,
  )
  const enabledModels = Array.from(
      new Set(
        [chosenModel, ...(models.data?.models ?? chosen?.models ?? [])].filter(
          Boolean,
        ),
      ),
    ),
    efforts = models.data?.efforts ?? chosen?.efforts ?? []
  const values =
    current ??
    history.data?.messages?.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    ) ??
    []
  const [search] = useSearchParams()
  const [command, setCommand] = useState<ChatAction | null>(null)
  const [voice, setVoice] = useState(() => full && search.get('input') === 'voice')
  function openCommand(action:ChatAction) {
    setCommand(action);setVoice(false);setConfig(false);setShowHistory(false);setError('')
  }
  useEffect(()=>{
    try{if(cid)sessionStorage.setItem(activeConversation,String(cid));else sessionStorage.removeItem(activeConversation)}catch{/* History remains available in SQLite. */}
  },[cid, activeConversation])
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [values.length, values[values.length - 1]?.content])
  useEffect(() => () => cancel.current?.abort(), [])
  function pick(id: number | null) {
    if (busy) return
    setCid(id)
    setCurrent(null)
    setError('')
    setShowHistory(false)
    setCommand(null)
  }
  const pastedLink = /^https?:\/\/\S+$/i.test(draft.trim()) && httpTaskUrl(draft.trim())
  async function send(e: FormEvent, content = draft.trim()) {
    e.preventDefault()
    if (!content || busy || providers.isPending) return
    const local=localCommand(content,!canSend)
    if(local){
      setDraft('');openCommand(local);return
    }
    if (!canSend) {
      openCommand({action:'provider_credentials'})
      return
    }
    if(!chosen)return
    setCommand(null);setVoice(false)
    setCurrent([
      ...values,
      { role: 'user', content },
      { role: 'assistant', content: '', tools: [] },
    ])
    setDraft('')
    setBusy(true)
    setError('')
    setShowHistory(false)
    const control = new AbortController()
    cancel.current = control
    function tail(update: (m: ChatMessage) => ChatMessage) {
      setCurrent(
        (messages) =>
          messages?.map((m, i) =>
            i === messages.length - 1 ? update(m) : m,
          ) ?? null,
      )
    }
    function handle(event: StreamEvent) {
      if (event.type === 'usage') tail(m => ({...m, token_usage:event.usage}))
      if (event.type === 'conversation' && event.id) setCid(event.id)
      if (event.type === 'delta')
        tail((m) => ({ ...m, content: m.content + (event.text ?? '') }))
      if (isDraft(event)) tail(m=>({...m,tools:[...(m.tools??[]),event]}))
      if (event.type === 'tool') {
        tail((m) => ({
          ...m,
          tools: [
            ...(m.tools ?? []),
            { name: event.name, result: event.result },
          ],
        }))
        void refresh()
      }
      if (event.type === 'confirmation')
        tail((m) => ({
          ...m,
          tools: [
            ...(m.tools ?? []),
            { id: event.id, summary: event.summary ?? '确认变更' },
          ],
        }))
      if (event.type === 'error')
        throw new Error(event.message || '模型暂时无法回应。')
    }
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': document.documentElement.lang, ...workspaceHeaders(accountId, workspaceId) },
        body: JSON.stringify({
          content,
          conversation_id: cid,
          provider: chosen.id,
          model: chosenModel || undefined,
          reasoning: effort || undefined,
          request_id: requestId(),
        }),
        signal: control.signal,
      })
      if (!response.ok) throw new Error(await responseError(response))
      const reader = response.body?.getReader()
      if (!reader) throw new Error('浏览器无法读取流式响应。')
      const decoder = new TextDecoder()
      let buffer = ''
      function process(line: string) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (data && data !== '[DONE]') handle(JSON.parse(data))
        }
      }
      for (;;) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        lines.forEach(process)
        if (done) {
          if (buffer) process(buffer)
          break
        }
      }
    } catch (e) {
      if (control.signal.aborted)
        setError('已停止接收，可在历史对话中查看已保存的消息。')
      else setError(errorText(e))
    } finally {
      setBusy(false)
      cancel.current = null
      void refresh()
    }
  }
  async function decide(id: string | number, approve: boolean) {
    try {
      await api('/ai/confirmations/' + id, 'POST', { approve })
      setCurrent(
        values.map((m) => ({
          ...m,
          tools: m.tools?.map((t) =>
            t.id === id ? { ...t, resolved: true } : t,
          ),
        })),
      )
      await refresh()
      notify(approve ? '已应用变更' : '已取消变更')
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <aside className={'chat ' + (full ? 'full' : '')} aria-label="织日助手">
      <header className="chat-header">
        <div>
          <Emblem />
          <strong>织日助手</strong>
        </div>
        <div>
          <IconButton
            icon={History}
            label="历史对话"
            onClick={() => setShowHistory(!showHistory)}
          />
          {full ? (
            <IconButton
              icon={Plus}
              label="新建对话"
              onClick={() => pick(null)}
              disabled={busy}
            />
          ) : (
            <IconButton
              icon={PanelRightClose}
              label="收起助手"
              onClick={close}
            />
          )}
        </div>
      </header>
      {showHistory && (
        <div className="chat-history">
          <button disabled={busy} onClick={() => pick(null)}>
            <Plus size={15} />
            新建对话
          </button>
          {convs.data?.map((c) => (
            <button disabled={busy} key={c.id} onClick={() => pick(c.id)}>
              <MessageCircle size={14} />
              {c.title}
            </button>
          ))}
          {!convs.data?.length && <p>暂无历史对话</p>}
        </div>
      )}
      <div className="chat-flow">
        {command?<WorkspaceCommands spec={command} open={openCommand} close={()=>setCommand(null)} leave={()=>{setCommand(null);close()}}/>:!values.length ? (
          <div className="chat-intro">
            <div className="emblem-tile">
              <Emblem size="large" />
            </div>
            <h2>从哪里开始？</h2>
            <div className="starter-list">
              <button type="button" className="voice-starter" aria-expanded={voice} onClick={() => {
                setVoice(!voice)
                setConfig(false)
              }}><Mic size={17} /><span>用语音创建任务</span><ArrowRight size={15} /></button>
              {prompts().map(({ icon: Icon, label, text }) => (
                <button
                  key={label}
                  onClick={() => {
                    setDraft(text)
                    input.current?.focus()
                  }}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {values.map((m, i) => (
              <article className={'message ' + m.role} key={m.id ?? i}>
                <span className="speaker">
                  {m.role === 'user' ? '你' : '织日助手'}
                </span>
                {m.content && <p>{m.content}</p>}
                {m.tools?.filter(t=>t.type!=='error').map((t, j) => isDraft(t) ? (
                  <TaskDraftCard key={t.id} event={t} settled={()=>setCurrent(null)} closeAssistant={close}/>
                ): (
                  <div className="tool-card" key={j}>
                    {t.summary ? (
                      <>
                        <strong>{t.summary}</strong>
                        {!t.resolved && t.id && (
                          <div>
                            <button onClick={() => void decide(t.id!, true)}>
                              确认
                            </button>
                            <button onClick={() => void decide(t.id!, false)}>
                              取消
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <ToolResult item={t} openAction={openCommand} />
                    )}
                  </div>
                ))}
                {m.role === 'assistant' && (m.token_usage || !busy || i < values.length - 1) && <UsageLine usage={m.token_usage} />}
              </article>
            ))}
            {busy && (
              <span className="thinking" role="status">
                助手正在处理…
              </span>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="chat-bottom">
        {error && <ErrorBox message={error} />}
        {config && (
          <div className="chat-config">
            <label>
              服务商
              <select
                value={chosen?.id ?? ''}
                onChange={(e) => {
                  setProvider(e.target.value)
                  setModel('')
                  setEffort('')
                }}
              >
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型
              <select
                value={chosenModel}
                onChange={(e) => {
                  setModel(e.target.value)
                  setEffort('')
                }}
              >
                <option value="">服务商默认</option>
                {enabledModels.map((m) => (
                  <option key={m} value={m}>{modelLabel(models.data?.catalog ?? chosen?.catalog,m)}</option>
                ))}
              </select>
            </label>
            {efforts.length > 0 && (
              <label>
                推理强度
                <select
                  value={effort}
                  onChange={(e) => setEffort(e.target.value)}
                >
                  <option value="">自动</option>
                  {efforts
                    .filter((e) => !['auto', 'default'].includes(e))
                    .map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                </select>
              </label>
            )}
            <button type="button" className="text-button" onClick={()=>openCommand({action:'provider_credentials',provider:chosen?.id})}>
              管理服务商
              <ArrowRight size={13} />
            </button>
          </div>
        )}
        {!canSend && !config && !providers.isPending && (
          <button
            className="connect-notice"
            onClick={()=>openCommand({action:'provider_credentials'})}
          >
            <i />
            连接 AI 服务
            <ArrowUpRightIcon />
          </button>
        )}
        {voice&&<VoiceInput close={()=>setVoice(false)} insert={text=>{
          setDraft(previous=>previous.trim()?previous+'\n'+text:text)
          setVoice(false);input.current?.focus()
        }}/>}
        {pastedLink && !busy && <button type="button" className="text-button" disabled={providers.isPending}
          onClick={e => void send(e, '创建一个待办，查看并关联这个链接。' + '\n' + draft.trim())}>
          <Plus size={15} />创建关联待办
        </button>}
        <form className="composer" onSubmit={send}>
          <textarea
            ref={input}
            rows={2}
            aria-label="给织日助手发消息"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="给织日助手发消息…"
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <div>
            <button
              type="button"
              className="model-select"
              onClick={() => setConfig(!config)}
              aria-expanded={config}
            >
              <Emblem />
              {modelLabel(models.data?.catalog ?? chosen?.catalog,chosenModel) || '选择模型'}
              <ChevronDown size={12} />
            </button>
            <div className="composer-controls">
            <button className={'composer-action '+(command?'active':'')} type="button" aria-expanded={!!command} aria-label="工作区操作" title="工作区操作" onClick={()=>command?setCommand(null):openCommand({action:'menu'})}><SlidersHorizontal size={17}/></button>
            <button className={'composer-action '+(voice?'active':'')} type="button" aria-expanded={voice} aria-label="语音输入" title="语音输入" onClick={()=>{setVoice(!voice);setConfig(false)}}><Mic size={17}/></button>
            {busy ? (
              <button
                type="button"
                className="send"
                title="停止"
                aria-label="停止生成"
                onClick={() => cancel.current?.abort()}
              >
                <Square size={13} />
              </button>
            ) : (
              <button
                className="send"
                title="发送"
                aria-label="发送"
                disabled={!draft.trim() || providers.isPending}
              >
                <ArrowUp size={17} />
              </button>
            )}</div>
          </div>
        </form>
      </div>
    </aside>
  )
}
const toolNames: Record<string, string> = {
  create_task: '创建任务',
  get_task: '查看任务',
  search_tasks: '查询任务',
  update_task: '修改任务',
  complete_task: '完成任务',
  delete_task: '删除任务',
  list_tasks_by_date: '查询日程',
  create_project: '创建项目',
  list_projects: '查询项目',
  get_project: '查询项目',
  create_resource: '保存资料',
  search_resources: '查询资料',
  link_resource_to_task: '关联资料',
  schedule_task: '安排任务',
  generate_daily_plan: '规划建议',
  save_and_schedule_resource: '保存资料并安排任务',
}
function ArrowUpRightIcon() {
  return <ArrowRight size={12} />
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function RecordCard({ row }: { row: Record<string, unknown> }) {
  const name = String(row.title ?? row.name ?? ''),
    minutes = row.minutes ?? row.estimated_minutes
  const labels = [
    row.deleted
      ? '已删除'
      : (statusLabels[String(row.status)] ??
        progressLabels[String(row.progress_status)]),
    priorityLabels[String(row.priority)],
    row.scheduled_date &&
      '计划 ' +
        row.scheduled_date +
        (periodLabels[String(row.scheduled_period)] ?? ''),
    row.due_date && '截止 ' + row.due_date + (periodLabels[String(row.due_period)] ?? ''),
    minutes && minutes + ' 分钟',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="result-record">
      <strong>{name}</strong>
      {labels && <small>{labels}</small>}
    </div>
  )
}
function ToolResult({ item,openAction }: { item: ToolItem;openAction:(item:ChatAction)=>void }) {
  const value = item.result,
    name = toolNames[item.name ?? ''] ?? item.name ?? '工具结果'
  const local=item.name==='open_workspace_action'?allowedAction(value):null
  if(local)return <button className="action-receipt" onClick={()=>openAction(local)}><SlidersHorizontal size={15}/>{actionName(local)}<ArrowRight size={14}/></button>
  if (
    isRecord(value) &&
    value.saved === false &&
    Array.isArray(value.proposed)
  ) {
    const proposed = value.proposed.filter(isRecord)
    return (
      <div className="tool-result">
        <strong>规划建议 · 待采纳</strong>
        <p className="tool-plan">
          {String(value.date)} · 可用 {String(value.available_minutes)} 分钟
        </p>
        {proposed.map((r, i) => (
          <RecordCard key={i} row={r} />
        ))}
        {!proposed.length && <p>暂无可添加的任务。</p>}
      </div>
    )
  }
  const rows = Array.isArray(value)
    ? value.filter(isRecord)
    : isRecord(value) && isRecord(value.task) && isRecord(value.resource)
      ? [value.task, value.resource]
      : isRecord(value)
        ? [value]
        : []
  return (
    <div className="tool-result">
      <strong>
        {name}
        {Array.isArray(value) ? ' · ' + rows.length + ' 条' : ''}
      </strong>
      {rows.slice(0, 3).map((r, i) => (
        <RecordCard key={i} row={r} />
      ))}
      {rows.length > 3 && (
        <details>
          <summary>查看其余 {rows.length - 3} 条</summary>
          {rows.slice(3).map((r, i) => (
            <RecordCard key={i} row={r} />
          ))}
        </details>
      )}
    </div>
  )
}
