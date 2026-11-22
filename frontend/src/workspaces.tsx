import { createContext, useContext, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Layers3, LockKeyhole, Plus, UsersRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, errorText, setActiveWorkspace, useApi, type Account, type WorkspaceInfo } from './api'
import { ErrorBox, Field, Loading, Modal } from './ui'

type Member = Account & { role: 'owner' | 'member' }

type WorkspaceDialog = 'manage' | 'create'
const WorkspaceDialogs = createContext<(mode: WorkspaceDialog) => void>(() => {})
export const useWorkspaceDialogs = () => useContext(WorkspaceDialogs)

export function WorkspaceChooser({ account, children }: {
  account: Account
  children: (workspace: WorkspaceInfo, switcher: React.ReactNode) => React.ReactNode
}) {
  const key = 'dayweave:workspace:' + account.id
  const [preferred, setPreferred] = useState(() => sessionStorage.getItem(key))
  const [editing, setEditing] = useState<WorkspaceDialog | null>(null)
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
  return <WorkspaceDialogs.Provider value={setEditing}>
    {children(selected, <div className="workspace-switcher">
      <select aria-label="切换工作区" value={selected.id} onChange={e => switchTo(e.target.value)}>
        {available.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      <button className="secondary manage-workspace" aria-label="管理工作区" onClick={() => setEditing('manage')}><UsersRound size={16} /><span>管理工作区</span></button>
    </div>)}
    {editing && <WorkspaceEditor initial={editing} selected={selected} close={() => setEditing(null)}
      created={id => { switchTo(id); setEditing(null) }} />}
  </WorkspaceDialogs.Provider>
}

function WorkspaceEditor({ initial, selected, close, created }: {
  initial: WorkspaceDialog; selected: WorkspaceInfo; close: () => void; created: (id: string) => void
}) {
  const [creating, setCreating] = useState(initial === 'create')
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
  if (creating) return <Modal title="创建工作区" close={close}>
    <form className="space-create" onSubmit={e => void submit(e, async () => {
      const row = await api<WorkspaceInfo>('/workspaces', 'POST', { name: name.trim() })
      await client.invalidateQueries({ queryKey: ['/workspaces'] })
      created(row.id)
    })}>
      <div className="modal-body">
        <div className="space-preview"><span className="space-mark"><Layers3 size={24} /></span>
          <div><strong>{name.trim() || '新工作区'}</strong><small><LockKeyhole size={13} />仅自己可见</small></div>
        </div>
        <Field label="工作区名称"><input autoFocus required maxLength={120} value={name}
          placeholder="例如：设计团队" onChange={e => setName(e.target.value)} /></Field>
        <p>创建后可以邀请其他账号协作。</p>
        {error && <ErrorBox message={error} />}
      </div>
      <footer><button type="button" className="secondary" disabled={busy} onClick={() => { setCreating(false); setError('') }}>返回</button>
        <button className="primary" disabled={busy || !name.trim()}>创建工作区<ArrowRight size={15} /></button></footer>
    </form>
  </Modal>
  return <Modal title="管理工作区" close={close}>
    <div className="modal-body workspace-editor">
      <div className="space-manager"><span className="space-mark"><Layers3 size={20} /></span>
        <strong>{selected.name}</strong>
        <button className="secondary" onClick={() => { setCreating(true); setError('') }}><Plus size={15} />新建工作区</button>
      </div>
      {selected.role === 'owner' && <>
        <h3>成员</h3>
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
