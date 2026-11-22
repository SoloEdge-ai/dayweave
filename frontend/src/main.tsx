import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { i18n, setLanguage } from './i18n'
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import * as Dialog from '@radix-ui/react-dialog'
import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronRight,
  FolderClosed,
  History,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageCircle,
  PanelLeft,
  Search,
  SlidersHorizontal,
  SunMedium,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  api,
  errorText,
  setActiveAccount,
  useApi,
  viewLabels,
  type Project,
  type Resource,
  type Settings,
  type Access,
  type Account,
  type WorkspaceInfo,
} from './api'
import { Login } from './access'
import { Chat } from './chat'
import { Editors } from './editors'
import { HomePage, LibraryPage, ProjectsPage, TasksPage } from './pages'
import { PlannerPage } from './planner'
import { WorkspaceChooser } from './workspaces'
import { AuditPage, SettingsPage } from './settings'
import {
  Brand,
  Emblem,
  ErrorBox,
  IconButton,
  Loading,
  Workspace,
  type EditorState,
} from './ui'
import './style.css'
import './workspace.css'

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: true },
  },
})
function useMedia(query: string) {
  const [matches, set] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const media = matchMedia(query)
    const update = () => set(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}
const navEntries = (): [string, string, LucideIcon][] => [
  ['/', '今日总览', LayoutDashboard],
  ['/planner', '日程编排', CalendarRange],
  ['/tasks/inbox', '收件箱', Inbox],
  ['/tasks/today', '今天', SunMedium],
  ['/tasks/tomorrow', '明天', CalendarDays],
  ['/tasks/week', '本周', CalendarRange],
  ['/tasks/all', '全部任务', ListChecks],
]
const libraryEntries = (): [string, string, LucideIcon][] => [
  ['/projects', '项目', FolderClosed],
  ['/library', '资料库', BookOpen],
  ['/chat', '织日助手', MessageCircle],
]
const extraEntries = (): [string, string, LucideIcon][] => [
  ['/history', '变更记录', History],
  ['/settings', '设置', SlidersHorizontal],
]
function SideNav({ close, logout, account }: { close: () => void; logout: () => void; account: Account & { email: string } }) {
  const links = (items: [string, string, LucideIcon][]) =>
    items.map(([url, label, Icon]) => (
      <NavLink
        key={url}
        to={url}
        end={url === '/'}
        onClick={close}
        className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}
      >
        <Icon size={17} />
        <span>{label}</span>
      </NavLink>
    ))
  return (
    <nav className="side-nav" aria-label="主导航">
      <Link className="brand-link" to="/" onClick={close}>
        <Brand />
      </Link>
      <div className="navigation">
        <div className="nav-caption">工作台</div>
        {links(navEntries())}
        <div className="nav-caption second">个人空间</div>
        {links(libraryEntries())}
      </div>
      <div className="nav-bottom">
        {links(extraEntries())}
        <div className="account">
          <span className="avatar" aria-hidden="true">{account.username.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{account.username}</strong>
            <small title={account.email}>{account.email}</small>
          </div>
          <IconButton icon={LogOut} label="退出登录" onClick={logout} />
        </div>
      </div>
    </nav>
  )
}
function Shell({ logout, account, workspace, switcher }: {
  logout: () => void; account: Account & { email: string }; workspace: WorkspaceInfo; switcher: ReactNode
}) {
  const loc = useLocation(),
    nav = useNavigate(),
    client = useQueryClient()
  const settings = useApi<Settings>('/settings'),
    projects = useApi<Project[]>('/projects'),
    resources = useApi<Resource[]>('/resources')
  const large = useMedia('(min-width: 1260px)'),
    mobileNav = useMedia('(max-width: 899px)') || (loc.pathname === '/planner' && !large),
    dark = useMedia('(prefers-color-scheme: dark)')
  const [navOpen, setNavOpen] = useState(false),
    [aiOpen, setAiOpen] = useState(
      () => matchMedia('(min-width:1260px)').matches,
    ),
    [editor, setEditor] = useState<EditorState>(null),
    [toast, setToast] = useState(''),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>()
  const planner = loc.pathname === '/planner'
  const dockAssistant = large && !planner
  const [plannerAssistant, setPlannerAssistant] = useState(false)
  const full = loc.pathname === '/chat',
    title =
      loc.pathname === '/'
        ? '今日总览'
        : loc.pathname.startsWith('/tasks/')
          ? viewLabels[loc.pathname.split('/')[2]]
          : ([...navEntries().slice(1), ...libraryEntries(), ...extraEntries()].find(([url]) =>
              loc.pathname.startsWith(url),
            )?.[1] ?? '工作台')
  useEffect(() => {
    document.title = title + ' · 织日 DayWeave'
    setNavOpen(false)
    setPlannerAssistant(false)
    if (!large) setAiOpen(false)
  }, [loc.pathname, large, title])
  useEffect(() => {
    if (settings.data?.language && settings.data.language !== i18n.language) {
      setLanguage(settings.data.language)
      void client.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/ai/') })
    }
  }, [settings.data?.language, client])
  useEffect(() => {
    document.documentElement.dataset.theme =
      settings.data?.theme === 'dark' ||
      (settings.data?.theme === 'system' && dark)
        ? 'dark'
        : 'light'
  }, [settings.data?.theme, dark])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        nav('/tasks/all')
        setTimeout(
          () =>
            document
              .querySelector<HTMLInputElement>('.search-input input')
              ?.focus(),
          60,
        )
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [nav])
  const notify = useCallback((text: string) => {
    setToast(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(''), 4000)
  }, [])
  const refresh = useCallback(async () => {
    await client.invalidateQueries({
      predicate: (q) => q.queryKey[0] !== '/auth/status',
    })
  }, [client])
  const activateAssistant = planner ? setPlannerAssistant : setAiOpen
  const close = () => activateAssistant(false),
    showAi = (planner ? plannerAssistant : aiOpen) && !full
  return (
    <Workspace.Provider
      value={{
        settings: settings.data,
        projects: projects.data ?? [],
        resources: resources.data ?? [],
        accountId: account.id,
        workspaceId: workspace.id,
        edit: setEditor,
        notify,
        refresh,
      }}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className={'shell ' + (showAi && dockAssistant ? 'with-ai' : planner && mobileNav ? 'planning-tablet' : '')}>
        {!mobileNav && (
          <SideNav close={() => setNavOpen(false)} logout={logout} account={account} />
        )}
        <div className="work-area">
          <header className="topbar">
            <div className="crumb">
              {mobileNav ? (
                <IconButton
                  icon={Menu}
                  label="打开导航"
                  onClick={() => setNavOpen(true)}
                />
              ) : (
                <PanelLeft size={16} />
              )}
              <span className="crumb-base">工作台</span>
              <ChevronRight size={13} />
              <strong>{title}</strong>
            </div>
            <div className="top-actions">
              {switcher}
              <button
                className="search-shortcut"
                title="搜索任务"
                aria-label="搜索任务"
                onClick={() => {
                  nav('/tasks/all')
                  setTimeout(
                    () =>
                      document
                        .querySelector<HTMLInputElement>('.search-input input')
                        ?.focus(),
                    50,
                  )
                }}
              >
                <Search size={16} />
                <kbd>Ctrl K</kbd>
              </button>
              {!full && (
                <button
                  className={'assistant-toggle ' + (showAi ? 'selected' : '')}
                  onClick={() => activateAssistant(!showAi)}
                  aria-label={showAi ? '收起织日助手' : '打开织日助手'}
                  aria-expanded={showAi}
                >
                  <Emblem />
                  <span>织日助手</span>
                </button>
              )}
            </div>
          </header>
          <main
            id="main-content"
            className={full ? 'full-chat-page' : planner ? 'content planner-page' : 'content'}
          >
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/planner" element={<PlannerPage />} />
              <Route path="/tasks/:view" element={<TasksPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectsPage />} />
              <Route path="/history" element={<AuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/chat" element={<Chat full close={() => {}} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
        {showAi && dockAssistant && <Chat full={false} close={close} />}
      </div>
      {mobileNav && (
        <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="scrim" />
            <Dialog.Content
              className="drawer left"
              aria-describedby={undefined}
            >
              <Dialog.Title className="sr-only">工作区导航</Dialog.Title>
              <Dialog.Close asChild>
                <button className="drawer-close icon-btn" aria-label="关闭导航">
                  <X size={18} />
                </button>
              </Dialog.Close>
              <SideNav close={() => setNavOpen(false)} logout={logout} account={account} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {!dockAssistant && (
        <Dialog.Root open={showAi} onOpenChange={activateAssistant}>
          <Dialog.Portal>
            <Dialog.Overlay className="scrim" />
            <Dialog.Content
              className="drawer right"
              aria-describedby={undefined}
            >
              <Dialog.Title className="sr-only">织日助手</Dialog.Title>
              <Chat full={false} close={close} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <Editors item={editor} close={() => setEditor(null)} />
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button onClick={() => setToast('')} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
    </Workspace.Provider>
  )
}
function App() {
  useTranslation()
  const auth = useApi<Access>('/auth/status'),
    client = useQueryClient()
  useEffect(() => {
    const clear = () => {
      const signup = client.getQueryData<Access>(['/auth/status'])?.signup_enabled ?? false
      setActiveAccount(null)
      client.removeQueries({ predicate: query => query.queryKey[0] !== '/auth/status' })
      client.setQueryData<Access>(['/auth/status'], { authenticated: false, account: null, signup_enabled: signup })
    }
    window.addEventListener('session-ended', clear)
    return () => window.removeEventListener('session-ended', clear)
  }, [client])
  if (auth.isPending)
    return (
      <div className="boot">
        <Brand />
        <Loading />
      </div>
    )
  if (auth.error)
    return (
      <div className="boot">
        <Brand />
        <ErrorBox
          message={errorText(auth.error)}
          retry={() => void auth.refetch()}
        />
      </div>
    )
  if (!auth.data?.authenticated || !auth.data.account)
    return (
      <Login
        signupEnabled={auth.data?.signup_enabled ?? false}
        done={status => {
          client.removeQueries({ predicate: query => query.queryKey[0] !== '/auth/status' })
          client.setQueryData(['/auth/status'], status)
        }}
      />
    )
  const { account, signup_enabled } = auth.data
  return (
    <WorkspaceChooser key={account.id} account={account}>
    {(workspace, switcher) => <Shell
      key={workspace.id}
      account={account}
      workspace={workspace}
      switcher={switcher}
      logout={async () => {
        try {
          await api('/auth/logout', 'POST')
          client.removeQueries({ predicate: query => query.queryKey[0] !== '/auth/status' })
          client.setQueryData<Access>(['/auth/status'], { authenticated: false, account: null, signup_enabled })
        } catch (e) {
          window.alert(errorText(e))
        }
      }}
    />}
    </WorkspaceChooser>
  )
}
createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}>
  <QueryClientProvider client={client}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>
  </I18nextProvider>,
)
