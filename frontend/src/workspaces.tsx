import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { UsersRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, errorText, setActiveWorkspace, useApi, type Account, type WorkspaceInfo } from './api'
import { ErrorBox, Field, Loading, Modal } from './ui'

type Member = Account & { role: 'owner' | 'member' }

export function WorkspaceChooser({ account, children }: {
  account: Account
  children: (workspace: WorkspaceInfo, switcher: React.ReactNode) => React.ReactNode
}) {
  const key = 'dayweave:workspace:' + account.id
  const [preferred, setPreferred] = useState(() => sessionStorage.getItem(key))
  const [editing, setEditing] = useState(false)
  const workspaces = useApi<WorkspaceInfo[]>('/workspaces')
  const navigate = useNavigate()
  const available = workspaces.data ?? []
  const selected = available.find(row => row.id === preferred) ?? available[0]
  if (workspaces.isPending) return <Loading />
  if (workspaces.isError) return <ErrorBox message={errorText(workspaces.error)} retry={() => void workspaces.refetch()} />
  if (!selected) return <ErrorBox message="当前账号没有可用工作区。" />

  setActiveWorkspace(selected.id)
  function switchTo(id: string) {
    sessionStorage.setItem(key, id)
    setPreferred(id)
    navigate('/')
  }
  return <>
    {children(selected, <div className="workspace-switcher">
      <select aria-label="切换工作区" value={selected.id} onChange={e => switchTo(e.target.value)}>
        {available.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      <button className="secondary manage-workspace" aria-label="管理工作区" onClick={() => setEditing(true)}><UsersRound size={16} /><span>管理工作区</span></button>
    </div>)}
    {editing && <WorkspaceEditor selected={selected} close={() => setEditing(false)}
      created={id => { switchTo(id); setEditing(false) }} />}
  </>
}

function WorkspaceEditor({ selected, close, created }: {
  selected: WorkspaceInfo; close: () => void; created: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const client = useQueryClient()
  const membersPath = '/workspaces/' + selected.id + '/members'
  const members = useApi<Member[]>(membersPath, selected.role === 'owner')

  async function submit(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (problem) {
      setError(errorText(problem))
    } finally {
      setBusy(false)
    }
  }
  return <Modal title="管理工作区" close={close}>
    <div className="modal-body workspace-editor">
      <form onSubmit={e => void submit(e, async () => {
        const row = await api<WorkspaceInfo>('/workspaces', 'POST', { name })
        await client.invalidateQueries({queryKey:['/workspaces']})
        created(row.id)
      })}>
        <Field label="工作区名称"><input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></Field>
        <button className="primary" disabled={busy}>创建工作区</button>
      </form>
      {selected.role === 'owner' && <>
        <h3>{selected.name} · <span>成员</span></h3>
        {members.isError && <ErrorBox message={errorText(members.error)} />}
        <ul>{members.data?.map(member => <li key={member.id}>
          <span>{member.username}</span>
          {member.role === 'owner' ? <small>所有者</small> :
            <form onSubmit={e => void submit(e, async () => {
              await api(membersPath + '/' + member.id, 'DELETE')
              await members.refetch()
            })}><button className="secondary" disabled={busy}>移除成员</button></form>}
        </li>)}</ul>
        <form onSubmit={e => void submit(e, async () => {
          await api(membersPath, 'POST', { username })
          setUsername('')
          await members.refetch()
        })}>
          <Field label="成员用户名"><input required value={username} onChange={e => setUsername(e.target.value)} /></Field>
          <button className="secondary" disabled={busy}>添加成员</button>
        </form>
      </>}
      {error && <ErrorBox message={error} />}
    </div>
  </Modal>
}
