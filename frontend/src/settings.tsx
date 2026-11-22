import { LayoutControls } from './pane-layout'
import { CodexLogin } from './codex-login'
import { useState } from 'react'
import { i18n, languageChoices } from './i18n'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  Check,
  ExternalLink,
  History,
  Link2,
  RotateCcw,
  Save,
  Unplug,
} from 'lucide-react'
import {
  api,
  errorText,
  workspaceLink,
  modelLabel,
  useApi,
  type Access,
  type Change,
  type Provider,
  type ModelCatalog,
  type Settings,
} from './api'
import { Heading } from './pages'
import { Empty, ErrorBox, Field, Loading, useWorkspace } from './ui'

const states: Record<string, string> = {
  connected: '已连接',
  configured: '待测试',
  unconfigured: '未配置',
  error: '连接失败',
  restricted: '需官方授权',
  disconnected: '未连接',
}
export function General({ settings: s }: { settings: Settings }) {
  const { refresh, notify } = useWorkspace(),
    access = useApi<Access>('/auth/status'),
    [v, set] = useState({ ...s }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  return (
    <form
      className="settings-panel"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        try {
          await api('/settings', 'PATCH', {
            language: v.language,
            timezone: v.timezone,
            theme: v.theme,
            planning_preferences: v.planning_preferences ?? '',
          })
          await refresh()
          notify('偏好已保存')
        } catch (e) {
          setError(errorText(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      {access.data?.account && <div className="account-identity">
        <span>已验证邮箱</span><strong>{access.data.account.email}</strong>
      </div>}
      <h2>工作区偏好</h2>
      <div className="form-grid">
        <Field label="时区">
          <input
            required
            value={v.timezone}
            onChange={(e) => set({ ...v, timezone: e.target.value })}
            list="zones"
          />
          <datalist id="zones">
            {[
              'Asia/Hong_Kong',
              'Asia/Shanghai',
              'Asia/Taipei',
              'Asia/Tokyo',
              'Europe/London',
              'America/New_York',
              'America/Los_Angeles',
              'UTC',
            ].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </datalist>
        </Field>
        <Field label="外观">
          <select
            value={v.theme}
            onChange={(e) => set({ ...v, theme: e.target.value })}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </Field>
        <Field label="界面语言">
          <select value={v.language} onChange={e => set({ ...v, language: e.target.value })}>
            {languageChoices.map(lang => <option key={lang.code} value={lang.code} lang={lang.code}>{lang.name}</option>)}
          </select>
        </Field>
        <Field label="每日规划偏好" wide>
          <textarea
            rows={3}
            value={v.planning_preferences ?? ''}
            onChange={(e) =>
              set({ ...v, planning_preferences: e.target.value })
            }
            placeholder="例如：把深度工作安排在上午"
          />
        </Field>
      </div>
      {error && <ErrorBox message={error} />}
      <button className="primary" disabled={busy}>
        <Check size={15} />
        保存偏好
      </button>
    </form>
  )
}
function ProviderForm({ p, guideOpen=false }: { p: Provider; guideOpen?:boolean }) {
  const { refresh, notify, settings } = useWorkspace(),
    [key, setKey] = useState(''),
    [base, setBase] = useState(p.base_url ?? ''),
    [model, setModel] = useState(p.model ?? ''),
    [effort, setEffort] = useState(p.reasoning || 'auto'),
    [enabled, setEnabled] = useState(p.enabled),
    [def, setDef] = useState(settings?.default_provider === p.id),
    [showGuide, setShowGuide] = useState(guideOpen),
    [reviewDisconnect, setReviewDisconnect] = useState(false)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const account = p.id === 'chatgpt',
    guide = useApi<{ steps: string[]; documentation: string }>(
      '/ai/chatgpt/guide',
      account && showGuide,
    )
  const codex = p.id === 'codex'
  const caps = useApi<ModelCatalog>(
    '/ai/models?provider=' + p.id + '&model=' + encodeURIComponent(model),
    !!model && !codex,
  )
  const catalog = codex && !p.has_key ? [] : p.models ?? []
  const selected = p.catalog?.find(entry => entry.id === model)
  const efforts = codex ? selected?.efforts ?? [] : caps.data?.efforts ?? p.efforts ?? []
  async function run(action: 'save' | 'test' | 'disconnect') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (action === 'disconnect') {
        const result = await api<Provider>('/ai/chatgpt/disconnect', 'POST')
        setNotice(result.detail || '已断开本地授权')
      } else if (codex && action === 'test') {
        const provider = await api<Provider>('/ai/providers/codex/test', 'POST')
        if (provider.status !== 'connected') setError(provider.detail || '模型同步失败')
        else {
          setModel(current => provider.models.includes(current) ? current : provider.model ?? '')
          setNotice('模型目录已更新')
        }
      } else {
        const changes = {
          enabled,
          ...(key ? { api_key: key } : {}),
          ...(p.id === 'compatible' ? { base_url: base.trim() } : {}),
          ...(model ? { model } : {}),
          reasoning: efforts.includes(effort) ? effort : 'auto',
        }
        let provider = await api<Provider>(
          '/ai/providers/' + p.id,
          'PATCH',
          changes,
        )
        setKey('')
        if (action === 'test') {
          provider = await api<Provider>(
            '/ai/providers/' + p.id + '/test',
            'POST',
          )
          setNotice(
            provider.detail || states[provider.status] || provider.status,
          )
          setModel(provider.model ?? '')
        }
        if (def)
          await api('/settings', 'PATCH', {
            default_provider: p.id,
            default_model: provider.model,
            default_reasoning: provider.reasoning || 'auto',
          })
        else if (settings?.default_provider === p.id)
          await api('/settings', 'PATCH', {
            default_provider: null,
            default_model: null,
            default_reasoning: 'auto',
          })
        if (action === 'save') notify('服务商设置已保存')
      }
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="settings-panel">
      <div className="provider-title">
        <h2>{p.name}</h2>
        <span className={'connection ' + p.status}>
          <i />
          {codex && p.has_key && p.status === 'error' ? '模型同步失败' : states[p.status] ?? p.status}
        </span>
      </div>
      {p.detail && (!codex || p.has_key) && !notice && <p className="hint">{p.detail}</p>}
      <div className="form-grid">
        {p.id === 'codex' ? <CodexLogin connected={p.has_key} /> : account ? (
          <div className="wide">
            <button
              className="secondary"
              onClick={() => setShowGuide(!showGuide)}
            >
              <Link2 size={15} />
              Continue with ChatGPT
            </button>
            {showGuide &&
              (guide.error ? (
                <ErrorBox message={errorText(guide.error)} />
              ) : (
                <div className="guide">
                  <ol>
                    {guide.data?.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                  {guide.data?.documentation && (
                    <a
                      href={guide.data.documentation}
                      target="_blank"
                      rel="noreferrer"
                    >
                      官方接入说明 <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <Field label="API Key" wide>
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                p.has_key ? '已保存凭据，输入新值以替换' : '输入服务商密钥'
              }
            />
          </Field>
        )}
        {p.id === 'compatible' && (
          <Field label="接口地址（Base URL）" wide>
            <input
              type="url"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="https://example.org/v1"
            />
          </Field>
        )}
        <Field label="默认模型">
          {codex || catalog.length ? (
            <select
              disabled={busy || !catalog.length}
              value={catalog.includes(model) ? model : ''}
              onChange={(e) => {
                setModel(e.target.value)
                setEffort('auto')
              }}
            >
              {!catalog.includes(model) && <option value="" disabled>{codex && !p.has_key ? '请先连接 Codex' : catalog.length ? '选择模型' : codex ? '点击「刷新模型」读取目录' : '测试连接以读取模型'}</option>}
              {catalog.map((m) => (
                <option key={m} value={m}>{modelLabel(codex ? p.catalog : caps.data?.catalog ?? p.catalog, m)}</option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              readOnly={account || p.id === 'codex'}
              onChange={(e) => {
                setModel(e.target.value)
                setEffort('auto')
              }}
              placeholder="测试连接以读取模型"
            />
          )}
        </Field>
        <Field label="推理强度">
          <select
            value={efforts.includes(effort) ? effort : 'auto'}
            disabled={efforts.filter((v) => v !== 'auto').length === 0}
            onChange={(e) => setEffort(e.target.value)}
          >
            <option value="auto">自动 / 默认</option>
            {efforts
              .filter((e) => e !== 'auto')
              .map((e) => (
                <option key={e}>{e}</option>
              ))}
          </select>
        </Field>
        <label className="check-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          启用服务商
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={def}
            onChange={(e) => setDef(e.target.checked)}
          />
          设为默认服务商
        </label>
      </div>
      {error && <ErrorBox message={error} />}{' '}
      {notice && (
        <div className="test-notice" role="status">
          {notice}
        </div>
      )}
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void run('save')}
        >
          <Save size={15} />
          保存配置
        </button>
        <button
          className="secondary"
          disabled={busy || (codex && !p.has_key)}
          onClick={() => void run('test')}
        >
          <Link2 size={15} />
          {busy ? '处理中…' : codex ? '刷新模型' : '测试连接'}
        </button>
        {account && p.has_key && (
          <button
            className="secondary"
            onClick={() => setReviewDisconnect(true)}
            disabled={busy}
          >
            <Unplug size={15} />
            断开授权
          </button>
        )}
      </div>
      {reviewDisconnect&&<div className="test-notice"><p>确认断开当前 ChatGPT 授权？</p><div className="actions"><button className="secondary" onClick={()=>setReviewDisconnect(false)}>取消</button><button className="primary" disabled={busy} onClick={()=>{setReviewDisconnect(false);void run('disconnect')}}>确认断开</button></div></div>}
    </div>
  )
}
export function Providers({ initial='deepseek',guideOpen=false }: {initial?:string;guideOpen?:boolean}={}) {
  const ps = useApi<Provider[]>('/ai/providers'),
    [active, setActive] = useState(initial)
  if (ps.isPending) return <Loading />
  if (ps.error)
    return (
      <ErrorBox message={errorText(ps.error)} retry={() => void ps.refetch()} />
    )
  const provider = ps.data?.find((p) => p.id === active) ?? ps.data?.[0]
  return (
    <>
      <div className="provider-choices">
        {ps.data?.map((p) => (
          <button
            key={p.id}
            className={provider?.id === p.id ? 'active' : ''}
            onClick={() => setActive(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      {provider && <ProviderForm key={provider.id + (provider.id === 'codex' && provider.has_key ? (provider.models.length ? '-models' : '-connected') : '')} p={provider} guideOpen={guideOpen&&provider.id==='chatgpt'} />}
    </>
  )
}
export function AuditPage() {
  const changes = useApi<Change[]>('/changes'),
    { edit } = useWorkspace()
  return (
    <>
      <Heading title="变更记录" />
      {changes.isPending ? (
        <Loading />
      ) : changes.error ? (
        <ErrorBox message={errorText(changes.error)} />
      ) : changes.data?.length ? (
        <div className="audit-list">
          {changes.data.map((c) => (
            <div key={c.id}>
              <div className="audit-icon">
                <History size={17} />
              </div>
              <div>
                <strong>
                  {String(
                    c.after?.title ??
                      c.after?.name ??
                      c.before?.title ??
                      c.before?.name ??
                      '记录 #' + c.entity_id,
                  )}
                </strong>
                <p>
                  {(
                    {
                      create: '创建',
                      update: '更新',
                      delete: '删除',
                      undo: '撤销',
                    } as Record<string, string>
                  )[c.action] ?? c.action}{' '}
                  · {c.source === 'ai' ? '织日助手' : '手动操作'} ·{' '}
                  <AuditTime iso={c.created_at} />
                </p>
              </div>
              {c.undone_at ? (
                <small>已撤销</small>
              ) : (
                c.action !== 'undo' && (
                  <button
                    className="secondary"
                    onClick={() =>
                      edit({
                        kind: 'confirm',
                        title: '撤销变更',
                        message: '恢复这次操作前的状态？',
                        action: () => api('/changes/' + c.id + '/undo', 'POST'),
                      })
                    }
                  >
                    <RotateCcw size={13} />
                    撤销
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={History} title="暂无变更记录">
          任务、项目和资料的变更会显示在这里。
        </Empty>
      )}
    </>
  )
}
function AuditTime({ iso }: { iso: string }) {
  const { settings } = useWorkspace()
  return (
    <time dateTime={iso}>
      {new Intl.DateTimeFormat(i18n.language, {
        timeZone: settings?.timezone,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(iso))}
    </time>
  )
}
export function SettingsPage() {
  const { settings } = useWorkspace(),
    [params, setParams] = useSearchParams(),
    active = params.get('tab') ?? 'general'
  return (
    <>
      <Heading title="设置" />
      <div className="view-tabs">
        {[
          ['general', '通用偏好'],
          ['ai', 'AI 服务商'],
          ['data', '数据导出'],
        ].map(([tab, label]) => (
          <button
            key={tab}
            className={active === tab ? 'active' : ''}
            onClick={() => setParams({ tab })}
          >
            {label}
          </button>
        ))}
      </div>
      {active === 'ai' ? (
        <Providers />
      ) : active === 'data' ? (
        <div className="settings-panel">
          <h2>导出工作区</h2>
          <p className="hint">
            导出任务、项目、资料、对话及偏好的 JSON
            快照。上传的文件请使用服务器备份一并保存。
          </p>
          <a
            href={workspaceLink('/api/export')}
            className="primary"
            download="dayweave-export.json"
          >
            <ArrowDownToLine size={15} />
            导出 JSON
          </a>
        </div>
      ) : settings ? (
        <><General
          key={settings.timezone + settings.theme + settings.week_start}
          settings={settings}
        /><LayoutControls /></>
      ) : (
        <Loading />
      )}
    </>
  )
}
