import { useWorkspaceDialogs } from './workspaces'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownToLine, ArrowRight, BookOpen, CalendarDays, ChevronLeft, FileUp, FolderOpen, History, KeyRound, ListChecks, Plus, Settings2, SlidersHorizontal, X, type LucideIcon } from 'lucide-react'
import { api, errorText, useApi, workspaceLink, type Resource, type Task } from './api'
import { ResourceRow, TaskRow } from './pages'
import { AuditPage, General, Providers } from './settings'
import { ErrorBox, Field, IconButton, Loading, useWorkspace } from './ui'

type NativeName='upload_resource'|'provider_credentials'|'chatgpt_authorize'|'chatgpt_disconnect'|'export_data'|'open_planner'|'open_history'|'open_settings'|'create_workspace'|'manage_workspace'|'open_board'
type LocalName=NativeName|'menu'|'manage_tasks'|'manage_projects'|'manage_resources'
export type ChatAction={action:LocalName;provider?:string;view?:string}
const nativeNames:NativeName[]=['upload_resource','provider_credentials','chatgpt_authorize','chatgpt_disconnect','export_data','open_planner','open_history','open_settings','create_workspace','manage_workspace','open_board']
const providerIds=['deepseek','openai','compatible','chatgpt','codex']
export function allowedAction(result:unknown):ChatAction|null {
  if(!result||typeof result!=='object')return null
  const data=result as Record<string,unknown>
  if(data.kind!=='ui_action'||!nativeNames.includes(data.action as NativeName))return null
  const provider=typeof data.provider==='string'&&providerIds.includes(data.provider)?data.provider:undefined
  const view=typeof data.view==='string'&&['backlog','day','today','tomorrow','week','next_week','month'].includes(data.view)?data.view:undefined
  return {action:data.action as NativeName,provider,view}
}
const names:Record<LocalName,string>={
  create_workspace:'创建工作区',manage_workspace:'管理工作区',open_board:'任务看板',
  menu:'工作区操作',manage_tasks:'任务管理',manage_projects:'项目',manage_resources:'资料库',
  upload_resource:'上传资料',provider_credentials:'配置 AI 服务商',chatgpt_authorize:'连接 ChatGPT',chatgpt_disconnect:'断开 ChatGPT',
  export_data:'导出工作区',open_planner:'计划页',open_history:'变更记录',open_settings:'工作区偏好',
}
export const actionName=(action:ChatAction)=>names[action.action]
const entries: [LocalName,LucideIcon][]=[
  ['manage_tasks',ListChecks],['open_board',ListChecks],['manage_workspace',Settings2],['open_planner',CalendarDays],['manage_projects',FolderOpen],['manage_resources',BookOpen],
  ['upload_resource',FileUp],['open_settings',Settings2],['provider_credentials',KeyRound],['open_history',History],['export_data',ArrowDownToLine],
]
export function secretInComposer(text:string){
  return /(?:\bsk-[a-zA-Z0-9_-]{8,}|\bBearer\s+[a-zA-Z0-9._-]{12,}|(?:api[ _-]?key|密钥|金鑰|キー|password|token)\s*(?:[:：=]|是|は)\s*\S{4,})/i.test(text)
}
// Local commands remain usable before the first provider has been set up.
export function localCommand(text:string,offline:boolean):ChatAction|null{
  const provider=/codex/i.test(text)?'codex':/deepseek/i.test(text)?'deepseek':/compatible|兼容|互換/i.test(text)?'compatible':/chatgpt/i.test(text)?'chatgpt':/openai/i.test(text)?'openai':undefined
  if(secretInComposer(text)||/(?:设置|设定|配置|更换|输入|填写|configure|set up|enter|connect|replace|設定|入力).{0,24}(?:api[\s_-]?key|密钥|服务商|provider|プロバイダ|キー)/i.test(text))return {action:'provider_credentials',provider}
  if(provider==='codex' && /login|log.?in|sign.?in|connect|登录|登錄|授权|断开|接続|ログイン/i.test(text))return {action:'provider_credentials',provider:'codex'}
  if(/(?:创建|新建|建立).{0,7}工作区|(?:create|new) (?:a |an? new )?workspace|ワークスペース.{0,5}(?:新規|作成)/i.test(text))return {action:'create_workspace'}
  if(/管理工作区|manage workspaces?|ワークスペース管理/i.test(text))return {action:'manage_workspace'}
  if(/^(?:打开|查看|open |show )?(?:任务看板|task board|看板|ボード)(?:を開く)?[。.!！]?$/i.test(text.trim()))return {action:'open_board'}
  if(!offline&&!text.startsWith('/'))return null
  if(/chatgpt/i.test(text)&&/断开|disconnect|解除/i.test(text))return {action:'chatgpt_disconnect',provider:'chatgpt'}
  if(/chatgpt/i.test(text)&&/授权|连接|connect|sign.?in|認証|接続/i.test(text))return {action:'chatgpt_authorize',provider:'chatgpt'}
  if(provider||/provider|api[ _-]?key|服务商|密钥|プロバイダ|キー/i.test(text))return {action:'provider_credentials',provider}
  if(/upload|上传|アップロード/i.test(text))return {action:'upload_resource'}
  if(/export|导出|エクスポート/i.test(text))return {action:'export_data'}
  if(/history|undo|撤销|变更记录|履歴|取り消/i.test(text))return {action:'open_history'}
  if(/planner|计划|日程|予定|プランナー/i.test(text))return {action:'open_planner'}
  if(/setting|theme|timezone|language|设置|偏好|主题|时区|语言|設定|言語|テーマ/i.test(text))return {action:'open_settings'}
  if(/project|项目|プロジェクト/i.test(text))return {action:'manage_projects'}
  if(/library|resource|资料|文档|ライブラリ|資料/i.test(text))return {action:'manage_resources'}
  if(/task|todo|任务|待办|タスク/i.test(text))return {action:'manage_tasks'}
  return text.startsWith('/')?{action:'menu'}:null
}
function LocalUpload(){
  const {refresh}=useWorkspace(),[file,setFile]=useState<File|null>(null),[title,setTitle]=useState('')
  const [saved,setSaved]=useState<Resource|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  return <div className="secure-form"><p className="hint">文件直接保存到本地资料库。</p>
    <form onSubmit={async e=>{e.preventDefault();if(!file||busy)return;setBusy(true);setError('')
      try{const data=new FormData();data.append('file',file);if(title.trim())data.append('title',title.trim())
        const resource=await api<Resource>('/resources/upload','POST',data);setSaved(resource);setFile(null);setTitle('');await refresh()
      }catch(e){setError(errorText(e))}finally{setBusy(false)}
    }}><Field label="选择 PDF 或 Markdown 文件"><input key={saved?.id??'initial'} type="file" required accept=".pdf,.md,.markdown" onChange={e=>{setFile(e.target.files?.[0]??null);setError('')}}/></Field>
    <Field label="标题"><input value={title} maxLength={500} onChange={e=>setTitle(e.target.value)} placeholder={file?.name??''}/></Field>
    <button className="primary" disabled={!file||busy}><FileUp size={15}/>{busy?'正在保存…':'保存到资料库'}</button></form>
    {error&&<ErrorBox message={error}/>} {saved&&<ResourceRow r={saved}/>}</div>
}
function Records({kind}:{kind:'manage_tasks'|'manage_projects'|'manage_resources'}){
  const {projects,resources,edit}=useWorkspace(),[q,setQuery]=useState(''),[limit,setLimit]=useState(8)
  const taskQuery=useApi<Task[]>('/tasks?view=all&q='+encodeURIComponent(q),kind==='manage_tasks')
  const source=kind==='manage_tasks'?taskQuery.data??[]:kind==='manage_projects'?projects.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())):resources.filter(r=>r.title.toLowerCase().includes(q.toLowerCase()))
  return <div className="chat-records"><div className="local-record-tools"><input type="search" value={q} aria-label="搜索" placeholder="搜索" onChange={e=>{setQuery(e.target.value);setLimit(8)}}/><button className="secondary" onClick={()=>edit({kind:kind==='manage_tasks'?'task':kind==='manage_projects'?'project':'resource'})}><Plus size={14}/>{kind==='manage_tasks'?'新建任务':kind==='manage_projects'?'新建项目':'添加资料'}</button></div>
    {kind==='manage_tasks'&&taskQuery.isPending?<Loading/>:taskQuery.error?<ErrorBox message={errorText(taskQuery.error)}/>:<>
    {source.slice(0,limit).map(item=>'name'in item?<button className="local-project" key={item.id} onClick={()=>edit({kind:'project',project:item})}><FolderOpen size={15}/>{item.name}<ArrowRight size={13}/></button>:'resource_ids'in item?<TaskRow key={item.id} t={item} showDate/>:<ResourceRow key={item.id} r={item}/>)}
    {!source.length&&<p className="hint">暂无记录</p>}{source.length>limit&&<button className="text-button" onClick={()=>setLimit(limit+8)}>显示更多</button>}</>}
  </div>
}
export function WorkspaceCommands({spec,open,close,leave}:{spec:ChatAction;open:(a:ChatAction)=>void;close:()=>void;leave:()=>void}) {
  const openWorkspace = useWorkspaceDialogs()
  const {settings}=useWorkspace(),kind=spec.action,account=kind==='chatgpt_authorize'||kind==='chatgpt_disconnect'
  const provider=account?'chatgpt':spec.provider??settings?.default_provider??'deepseek'
  return <section className="local-commands" aria-label="工作区操作"><header><div>{kind==='menu'?<SlidersHorizontal size={18}/>:<IconButton icon={ChevronLeft} label="返回操作列表" onClick={()=>open({action:'menu'})}/>}<h2>{actionName(spec)}</h2></div><IconButton icon={X} label="返回对话" onClick={close}/></header>
    {kind==='menu'?<div className="command-menu">{entries.map(([id,Icon])=><button key={id} onClick={()=>open({action:id})}><Icon size={17}/><span>{names[id]}</span><ArrowRight size={14}/></button>)}</div>:
     kind==='open_settings'?settings?<General settings={settings}/>:<Loading/>:
     kind==='provider_credentials'||account?<><p className="private-note"><KeyRound size={14}/>凭据仅提交到本地设置，不进入对话。</p><Providers key={provider} initial={provider} guideOpen={kind==='chatgpt_authorize'}/></>:
     kind==='create_workspace'||kind==='manage_workspace'?<button className="primary" onClick={()=>openWorkspace(kind==='create_workspace'?'create':'manage')}>{actionName(spec)}<ArrowRight size={15}/></button>:
     kind==='open_board'?<Link className="primary" to="/board" onClick={leave}>任务看板<ArrowRight size={15}/></Link>:
     kind==='upload_resource'?<LocalUpload/>:
     kind==='open_history'?<div className="chat-audit"><AuditPage/></div>:
     kind==='open_planner'?<Link className="primary" to={'/planner'+(spec.view==='backlog'?'?view=today&panel=backlog':spec.view?'?view='+(spec.view==='day'?'today':spec.view):'')} onClick={leave}><CalendarDays size={16}/>打开计划页</Link>:
     kind==='export_data'?<a className="primary" href={workspaceLink('/api/export')} download="dayweave-export.json"><ArrowDownToLine size={15}/>导出 JSON</a>:
     <Records key={kind} kind={kind as 'manage_tasks'|'manage_projects'|'manage_resources'}/>}
  </section>
}
