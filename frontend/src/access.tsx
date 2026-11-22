import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, Mail } from 'lucide-react'
import { api, errorText, type Access } from './api'
import { i18n, languageChoices, setLanguage } from './i18n'
import { Brand, ErrorBox } from './ui'

type Mode = 'login' | 'register' | 'reset'

export function Login({ done, signupEnabled }: { done: (status: Access) => void; signupEnabled: boolean }) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<'code' | 'reset' | null>(null)
  const [operation, setOperation] = useState<'sending' | 'submitting' | null>(null)
  const busy = operation !== null
  const [remaining, setRemaining] = useState(0)
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({})
  const emailField = useRef<HTMLInputElement>(null)
  const codeField = useRef<HTMLInputElement>(null)
  const cooldown = cooldowns[mode + ':' + email.trim().toLowerCase()] ?? 0
  useEffect(() => {
    function tick() { setRemaining(Math.max(0, Math.ceil((cooldown - Date.now()) / 1000))) }
    tick()
    if (cooldown > Date.now()) {
      const timer = window.setInterval(tick, 1000)
      return () => window.clearInterval(timer)
    }
  }, [cooldown])

  function change(next: Mode) {
    setMode(next)
    setPassword('')
    setCode('')
    setError('')
    setNotice(null)
  }

  async function sendCode() {
    if (!emailField.current?.reportValidity()) return
    setOperation('sending')
    setError('')
    setNotice(null)
    try {
      await api('/auth/email-code', 'POST', { email, purpose: mode })
      setCooldowns(prev => ({ ...prev, [mode + ':' + email.trim().toLowerCase()]: Date.now() + 60000 }))
      setNotice('code')
      codeField.current?.focus()
    } catch (e) { setError(errorText(e)) }
    finally { setOperation(null) }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setOperation('submitting')
    setError('')
    try {
      if (mode === 'reset') {
        await api('/auth/reset-password', 'POST', { email, code, password })
        setUsername(email)
        change('login')
        setNotice('reset')
        return
      }
      const status = await api<Access>(mode === 'login' ? '/auth/login' : '/auth/register', 'POST',
        mode === 'login' ? { username, password } : { username, email, code, password })
      const language = sessionStorage.getItem('dayweave.login-language')
      if (language) {
        await api('/settings', 'PATCH', { language })
        sessionStorage.removeItem('dayweave.login-language')
      }
      done(status)
    } catch (e) { setError(errorText(e)) }
    finally { setOperation(null) }
  }

  return <div className="access-screen">
    <header className="access-top"><Brand />
      <label className="language-picker"><span>界面语言</span>
        <select lang={i18n.language} value={i18n.language} onChange={e => {
          sessionStorage.setItem('dayweave.login-language', e.target.value)
          setLanguage(e.target.value)
        }}>{languageChoices.map(lang => <option key={lang.code} value={lang.code} lang={lang.code}>{lang.name}</option>)}</select>
      </label>
    </header>
    <main className="access-main">
      <div className="access-symbol" aria-hidden="true">{mode === 'login' ? <KeyRound /> : <Mail />}</div>
      <h1>{mode === 'login' ? '欢迎回到织日' : mode === 'register' ? '创建账号' : '找回密码'}</h1>
      {mode !== 'login' && <p className="access-instruction">
        {mode === 'register' ? '使用邮箱验证码创建你的个人工作区。' : '使用注册邮箱接收验证码，然后设置新密码。'}
      </p>}
      <form onSubmit={submit}>
        {mode !== 'reset' && <label className="field"><span>{mode === 'login' ? '用户名或邮箱' : '用户名'}</span>
          <input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)}
            pattern={mode === 'register' ? '[a-zA-Z0-9][a-zA-Z0-9_.\\-]{2,47}' : undefined}
            autoCapitalize="none" spellCheck={false} maxLength={mode === 'register' ? 48 : 320} />
        </label>}
        {mode !== 'login' && <>
          <label className="field"><span>邮箱</span>
            <input ref={emailField} type="email" autoComplete="email" required value={email} disabled={busy}
              autoCapitalize="none" spellCheck={false} onChange={e => { setEmail(e.target.value); setCode(''); setNotice(null) }} />
          </label>
          <div className="access-code"><label className="field"><span>邮箱验证码</span>
            <input ref={codeField} autoComplete="one-time-code" inputMode="numeric" required
              pattern="[0-9]{8}" maxLength={8} value={code} onChange={e => setCode(e.target.value)} />
          </label>
            <button type="button" className="secondary" disabled={busy || remaining > 0} onClick={sendCode}>
              {operation === 'sending' ? '正在发送…' : remaining ? '重新发送' + ' (' + remaining + 's)' : '发送验证码'}
            </button>
          </div>
        </>}
        <label className="field"><span>{mode === 'reset' ? '新密码' : '密码'}</span>
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required minLength={mode === 'login' ? 1 : 10} maxLength={1024} value={password}
            onChange={e => setPassword(e.target.value)} aria-describedby={mode === 'login' ? undefined : 'password-hint'} />
          {mode !== 'login' && <small id="password-hint">至少十个字符</small>}
        </label>
        {error && <ErrorBox message={error} />}
        {notice && <p role="status">{notice === 'reset' ? '密码已更新，请重新登录。' :
          mode === 'reset' ? '如果邮箱已注册，你将收到十分钟内有效的验证码。' : '请在邮箱中查看注册验证码，十分钟内有效。'}</p>}
        <button className="primary" disabled={busy}>{mode === 'login' ? '进入工作区' : mode === 'register' ? '注册并登录' : '重设密码'}<ArrowRight size={17} /></button>
      </form>
      <footer>{mode === 'login' ? <>
        {signupEnabled && <button className="text-button" disabled={busy} onClick={() => change('register')}>创建账号</button>}
        <button className="text-button" disabled={busy} onClick={() => change('reset')}>忘记密码？</button>
      </> : <button className="text-button" disabled={busy} onClick={() => change('login')}>返回登录</button>}</footer>
    </main>
  </div>
}
