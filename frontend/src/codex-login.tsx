import { useEffect, useState } from 'react'
import { ExternalLink, Link2 } from 'lucide-react'
import { api, errorText, useApi } from './api'
import { ErrorBox, useWorkspace } from './ui'

type Flow = { state: 'idle' | 'starting' | 'pending' | 'connected' | 'failed'; verification_url?: string; user_code?: string }

export function CodexLogin({ connected }: { connected: boolean }) {
  const status = useApi<Flow>('/ai/codex/login')
  const { refresh } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const state = status.data?.state
  const waiting = state === 'starting' || state === 'pending'
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => { void status.refetch() }, 2200)
    return () => window.clearInterval(timer)
  }, [waiting, status.refetch])
  useEffect(() => {
    if (state === 'connected' && !connected) void refresh()
  }, [state, connected, refresh])

  async function act(disconnect = false) {
    setBusy(true)
    setError('')
    try {
      await api(disconnect ? '/ai/codex/disconnect' : '/ai/codex/login', 'POST')
      setConfirm(false)
      await status.refetch()
      await refresh()
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  return <div className="wide codex-login">
    {connected ? <>
      <strong>本账号已连接 Codex</strong>
      {confirm ? <div><p>确认断开 Codex？</p><button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>取消</button>
        <button className="primary" disabled={busy} onClick={() => void act(true)}>确认断开</button></div> :
        <button className="secondary" onClick={() => setConfirm(true)}>断开 Codex 登录</button>}
    </> : waiting ? <>
      <strong>{state === 'starting' ? '正在准备登录…' : '正在等待授权'}</strong>
      {status.data?.user_code && <><p>在新标签页打开 OpenAI，输入此设备码授权。</p>
        <code aria-label="设备验证码">{status.data.user_code}</code>
        <a className="primary" href={status.data.verification_url} target="_blank" rel="noreferrer">在 OpenAI 完成登录<ExternalLink size={14} /></a></>}
      <button className="secondary" disabled={busy} onClick={() => void act(true)}>取消</button>
    </> : <button className="primary" disabled={busy} onClick={() => void act()}><Link2 size={15} />用 Codex 登录</button>}
    {!connected && <details className="codex-help">
      <summary>如何开启设备代码登录？</summary>
      <p>在 ChatGPT 的「设置 → 安全」中开启设备代码登录。如果已经获取设备码，请回到这里取消本次登录，然后重新获取。</p>
      <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">打开 ChatGPT <ExternalLink size={14} /></a>
    </details>}
    {(error || status.error || state === 'failed') && <ErrorBox message={error || (status.error ? errorText(status.error) : 'Codex 登录未完成，请重试。')} />}
  </div>
}
