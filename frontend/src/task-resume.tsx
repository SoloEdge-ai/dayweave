import { useState, type FormEvent } from 'react'
import { MessageCircle, Mic, NotebookPen } from 'lucide-react'
import { api, errorText, useApi, type ResumeNote, type Task } from './api'
import { ErrorBox, IconButton, Loading, Modal, useWorkspace } from './ui'
import { VoiceInput } from './voice'
import './task-resume.css'

export function TaskAssist({ task, note = true }: { task: Task; note?: boolean }) {
  const { edit, discussTask } = useWorkspace()
  return <div className="task-assist">
    <button type="button" className="task-discuss" aria-label={'与助手讨论' + ' · ' + task.title}
      onClick={() => discussTask(task.id)}><MessageCircle size={16} aria-hidden="true" />与助手讨论</button>
    {note && <IconButton icon={NotebookPen} label={'记一下进展' + ' · ' + task.title}
      onClick={() => edit({kind:'resume', task})} />}
  </div>
}

export function ResumeLine({ taskId }: { taskId: number }) {
  const { resumeByTask } = useWorkspace()
  const text = resumeByTask.get(taskId)?.text
  return text ? <p className="resume-line"><span>上次留给自己</span>{text}</p> : null
}

export function ResumeEditor({ task, close }: { task: Task; close: () => void }) {
  const query = useApi<ResumeNote>('/tasks/' + task.id + '/resume')
  return <Modal title="记一下进展" close={close}>
    {query.data ? <ResumeForm task={task} initial={query.data} reload={async () => {
      const result = await query.refetch({throwOnError:true})
      return result.data ?? {text:'', updated_at:null}
    }} close={close} /> : query.error ? <ErrorBox message={errorText(query.error)} retry={() => void query.refetch()} /> : <Loading />}
  </Modal>
}

function ResumeForm({ task, initial, reload, close }: {
  task: Task; initial: ResumeNote; reload: () => Promise<ResumeNote>; close: () => void
}) {
  const { refresh, notify } = useWorkspace()
  const [version, setVersion] = useState(initial.updated_at)
  const [text, setText] = useState(initial.text)
  const [voice, setVoice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy || voice) return
    setBusy(true)
    setError('')
    try {
      await api('/tasks/' + task.id + '/resume', 'PUT', {text, expected_updated_at:version})
      await refresh()
      notify('接续记录已保存')
      close()
    } catch (e) {
      setError(errorText(e))
    } finally { setBusy(false) }
  }
  async function loadLatest() {
    try {
      const latest = await reload()
      setVersion(latest.updated_at)
      setText(latest.text)
      setError('')
    } catch (e) { setError(errorText(e)) }
  }
  return <form onSubmit={save}>
    <div className="modal-body resume-form">
      <strong>{task.title}</strong>
      <small>仅自己可见</small>
      <label htmlFor="resume-text">下次从这里继续</label>
      <textarea id="resume-text" autoFocus value={text} maxLength={600} rows={4}
        placeholder="记下已做到哪一步，或下次先做什么…" onChange={e => setText(e.target.value)} />
      {voice ? <VoiceInput close={() => setVoice(false)} insert={value => {
        setText(prior => (prior.trim() ? prior.trimEnd() + '\n' + value : value).slice(0,600))
        setVoice(false)
      }} /> : <button type="button" className="secondary" onClick={() => setVoice(true)}><Mic size={16} />语音记录</button>}
      {error && <ErrorBox message={error} />}
      {error && <button className="text-button" type="button" onClick={() => void loadLatest()}>载入最新记录</button>}
    </div>
    <footer><span /><button className="secondary" type="button" onClick={close}>取消</button>
      <button className="primary" disabled={busy || voice}>保存接续记录</button></footer>
  </form>
}

export function PlanResumeToday({ task, today }: { task: Task; today: string }) {
  const { refresh, notify } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="resume-plan"><button type="button" className="secondary" disabled={busy} onClick={async () => {
    setBusy(true)
    setError('')
    try {
      await api('/tasks/' + task.id + '/schedule', 'PATCH', {scheduled_date:today, expected_updated_at:task.updated_at})
      await refresh()
      notify('已排到今天')
    } catch (e) {
      setError(errorText(e))
      await refresh()
    } finally { setBusy(false) }
  }}>排到今天</button>{error && <ErrorBox message={error} />}</div>
}
