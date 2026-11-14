import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyEvent } from '../../shared/reducer'
import type {
  AgentEvent,
  Artifact,
  ExportScope,
  ImportResult,
  MemoryItem,
  AppSettings,
  AuthStatus,
  ChatMessage,
  ContextUsage,
  DesignInfo,
  InitInfo,
  LockStatus,
  McpStatus,
  PermissionRequest,
  Project,
  RateLimitInfo,
  RemoteState,
  SessionMeta,
  SlashCommandInfo,
  TurnStats
} from '../../shared/types'
import { api } from './api'
import { allThemes, useAppearance } from './appearance'
import { applyFonts } from './fonts'
import { modHost, useModHost } from './mods/host'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
import { SetupScreen } from './components/SetupScreen'
import { KEY_ACTIONS, comboFromEvent, normalizeAppearance, resolveBindings, LIMITS } from '../../shared/customize'
import type { ModInfo } from '../../shared/types'
import { ArtifactsView } from './components/ArtifactsView'
import { ChatView } from './components/ChatView'
import { DesignsView } from './components/DesignsView'
import { LockScreen } from './components/LockScreen'
import { ExportDialog } from './components/ExportDialog'
import { PasswordDialog } from './components/PasswordDialog'
import { ProjectView, ProjectsView } from './components/Projects'
import type { TranscriptMode } from './components/MessageView'
import { SettingsDialog } from './components/SettingsDialog'
import { SIDEBAR_WIDTH, Sidebar } from './components/Sidebar'
import { Icon } from './components/Icon'
import { Spark } from './components/Spark'
import { billsConsoleKey } from '../../shared/billing'
import { engineLabel } from '../../shared/deepseek'

export interface SessionRuntime {
  status: 'idle' | 'running' | 'starting'
  init?: InitInfo
  lastStats?: TurnStats
  context?: ContextUsage
  commands?: SlashCommandInfo[]
  mcp?: McpStatus[]
  /** when the current turn started (for the working timer) */
  turnStartedAt?: number
}

const NARROW = '(max-width: 900px)'

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* per-viewer convenience only */
  }
}

/** Sidebar open/closed. Wide windows remember it; narrow windows start closed and open as an overlay. */
function useSidebar(): { open: boolean; narrow: boolean; toggle: () => void; close: () => void } {
  const mq = useMemo(() => window.matchMedia(NARROW), [])
  const [narrow, setNarrow] = useState(mq.matches)
  const [open, setOpen] = useState(() => !mq.matches && readPref('sidebar') !== 'closed')
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent): void => {
      setNarrow(e.matches)
      setOpen(!e.matches && readPref('sidebar') !== 'closed')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mq])
  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!narrow) writePref('sidebar', o ? 'closed' : 'open')
      return !o
    })
  }, [narrow])
  const close = useCallback(() => {
    if (narrow) setOpen(false)
  }, [narrow])
  return { open, narrow, toggle, close }
}

function loadTranscriptMode(): TranscriptMode {
  try {
    return localStorage.getItem('transcript') === 'verbose' ? 'verbose' : 'normal'
  } catch {
    return 'normal'
  }
}

const isMac = navigator.platform.toLowerCase().includes('mac')

export default function App() {
  const [lock, setLock] = useState<LockStatus | null>(null)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [histories, setHistories] = useState<Record<string, ChatMessage[]>>({})
  const [runtime, setRuntime] = useState<Record<string, SessionRuntime>>({})
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null)
  const [settingsOpen, setSettingsOpen] = useState<false | string>(false)
  /** chats and designs bill LOCALCLAUDE_API_KEY (false without it, so nothing changes) */
  const consoleKey = !!auth && billsConsoleKey(auth, settings)
  const [transcript, setTranscriptState] = useState<TranscriptMode>(loadTranscriptMode)
  const sidebar = useSidebar()
  const [sideWidth, setSideWidth] = useState(() => {
    const w = Number(readPref('sidebarWidth'))
    return w >= SIDEBAR_WIDTH.min && w <= SIDEBAR_WIDTH.max ? w : SIDEBAR_WIDTH.default
  })
  const [page, setPage] = useState<{ kind: 'chat' } | { kind: 'projects' } | { kind: 'artifacts' } | { kind: 'designs' } | { kind: 'project'; id: string }>({ kind: 'chat' })
  const [projects, setProjects] = useState<Project[]>([])
  const [artifacts, setArtifacts] = useState<Record<string, Artifact[]>>({})
  /** the artifact Claude touched most recently, so the chat can open it in the side panel */
  const [lastArtifact, setLastArtifact] = useState<{ sessionId: string; id: string; at: number } | null>(null)
  const [globalMemory, setGlobalMemory] = useState<MemoryItem[]>([])
  // Remote Control (one server at a time, for any chat's folder)
  const [remote, setRemote] = useState<RemoteState>({ status: 'off', log: [] })
  useEffect(() => {
    void api.remoteState().then(setRemote)
    return api.onRemote(setRemote)
  }, [])
  const [exportReq, setExportReq] = useState<{ scope: ExportScope; sessionId?: string; sessionIds?: string[]; projectId?: string } | null>(null)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  /** ask the open chat to show its find bar */
  const [findRequest, setFindRequest] = useState<{ query: string; n: number } | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.error ? 9000 : 6000)
    return () => clearTimeout(t)
  }, [toast])
  const loaded = useRef(new Set<string>())
  // back/forward through chats you opened, like the Claude app
  const nav = useRef<{ stack: string[]; i: number }>({ stack: [], i: -1 })
  const [, bumpNav] = useState(0)
  const openChat = useCallback((id: string | null) => {
    setActiveId(id)
    setPage({ kind: 'chat' })
    if (!id) return
    const n = nav.current
    if (n.stack[n.i] === id) return
    n.stack = [...n.stack.slice(0, n.i + 1), id]
    n.i = n.stack.length - 1
    bumpNav((x) => x + 1)
  }, [])
  const stepNav = useCallback((d: -1 | 1) => {
    const n = nav.current
    const i = n.i + d
    if (i < 0 || i >= n.stack.length) return
    n.i = i
    setActiveId(n.stack[i])
    setPage({ kind: 'chat' })
    bumpNav((x) => x + 1)
  }, [])

  const setTranscript = useCallback((m: TranscriptMode) => {
    setTranscriptState(m)
    writePref('transcript', m)
  }, [])

  // ---- mods: their CSS and themes, and their scripts while they're switched on
  const [mods, setMods] = useState<ModInfo[]>([])
  const modSnap = useModHost()
  const reloadMods = useCallback(async () => {
    const list = await api.listMods()
    setMods(list)
    await modHost.sync(list, settingsRef.current?.mods ?? {}, true)
  }, [])
  const settingsRef = useRef<AppSettings | null>(null)
  settingsRef.current = settings
  const modsKey = JSON.stringify(settings?.mods ?? {})
  useEffect(() => {
    if (!settings) return
    void modHost.sync(mods, settings.mods ?? {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mods, modsKey, !!settings])

  useAppearance(settings, modSnap.themes, (dark) => modHost.emit('theme-changed', { dark }))
  useEffect(() => {
    if (settings) applyFonts(settings)
  }, [settings?.replyFont, settings?.uiFont, settings?.appearance?.monoFont, settings?.appearance?.customUiFont, settings?.appearance?.customReplyFont])
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** the look-picking step after signing in on the setup screen */
  const [onboarding, setOnboarding] = useState(false)
  // signed in to Claude, or set up with DeepSeek Harness only (a DeepSeek key, no Claude sign-in)
  const ready = !!auth && (auth.loggedIn || (settings?.signInMethod === 'deepseek' && !!auth.deepseekKey))

  // how you sign in lives in settings too (signInMethod, defaultEngine), so read both
  const refreshAuth = useCallback(async () => {
    const [a, st] = await Promise.all([api.authStatus(), api.getSettings()])
    setSettings(st)
    setAuth(a)
  }, [])

  // ---- boot: lock → settings/sessions → auth
  const boot = useCallback(async () => {
    const l = await api.lockStatus()
    setLock(l)
    if (!l.ok) return
    const [s, list, projs, memory] = await Promise.all([api.getSettings(), api.listSessions(), api.listProjects(), api.globalMemory()])
    setSettings(s)
    setSessions(list)
    setProjects(projs)
    setGlobalMemory(memory)
    if (list.length) setActiveId((cur) => cur ?? list[0].id)
    if (list.length && nav.current.i < 0) nav.current = { stack: [list[0].id], i: 0 }
    void refreshAuth()
    void api.listMods().then(setMods)
  }, [refreshAuth])

  useEffect(() => {
    void boot()
  }, [boot])

  // ---- live agent events
  useEffect(() => {
    return api.onEvent((e: AgentEvent) => {
      switch (e.type) {
        case 'status':
          setRuntime((r) => {
            const cur = r[e.sessionId]
            const wasIdle = !cur || cur.status === 'idle'
            const turnStartedAt = e.status === 'idle' ? undefined : wasIdle ? Date.now() : cur.turnStartedAt
            return { ...r, [e.sessionId]: { ...cur, status: e.status, turnStartedAt } }
          })
          return
        case 'context':
          setRuntime((r) => ({ ...r, [e.sessionId]: { ...(r[e.sessionId] ?? { status: 'idle' }), context: e.usage } }))
          return
        case 'commands':
          setRuntime((r) => ({ ...r, [e.sessionId]: { ...(r[e.sessionId] ?? { status: 'idle' }), commands: e.commands } }))
          return
        case 'mcp-status':
          setRuntime((r) => ({ ...r, [e.sessionId]: { ...(r[e.sessionId] ?? { status: 'idle' }), mcp: e.servers } }))
          return
        case 'init':
          setRuntime((r) => ({ ...r, [e.sessionId]: { ...r[e.sessionId], status: r[e.sessionId]?.status ?? 'running', init: e.info } }))
          return
        case 'meta':
          setSessions((list) => {
            const i = list.findIndex((s) => s.id === e.meta.id)
            const next = i >= 0 ? list.map((s) => (s.id === e.meta.id ? e.meta : s)) : [e.meta, ...list]
            return next.sort((a, b) => b.updatedAt - a.updatedAt)
          })
          return
        case 'permission':
          setPermissions((p) => [...p, e.request])
          return
        case 'permission-cancel':
          setPermissions((p) => p.filter((x) => x.requestId !== e.requestId))
          return
        case 'rate-limit':
          setRateLimit(e.info)
          return
        case 'sdk-session':
          return
        case 'artifact':
          setArtifacts((all) => {
            const list = all[e.sessionId] ?? []
            const i = list.findIndex((a) => a.id === e.artifact.id)
            return { ...all, [e.sessionId]: i >= 0 ? list.map((a) => (a.id === e.artifact.id ? e.artifact : a)) : [...list, e.artifact] }
          })
          setLastArtifact({ sessionId: e.sessionId, id: e.artifact.id, at: Date.now() })
          return
        case 'project':
          setProjects((list) => list.map((p) => (p.id === e.project.id ? e.project : p)))
          return
        case 'global-memory':
          setGlobalMemory(e.items)
          return
        case 'account':
          setAuth((a) => (a ? { ...a, email: e.email ?? a.email, subscriptionType: e.subscriptionType ?? a.subscriptionType } : a))
          return
        default:
          break
      }
      if ('sessionId' in e) {
        if (e.type === 'turn-done') {
          setRuntime((r) => ({ ...r, [e.sessionId]: { ...r[e.sessionId], status: 'idle', lastStats: e.stats } }))
          modHost.emit('turn-done', { sessionId: e.sessionId, stats: e.stats })
        }
        setHistories((h) => (h[e.sessionId] ? { ...h, [e.sessionId]: applyEvent(h[e.sessionId], e) } : h))
      }
    })
  }, [])

  // ---- load history when a chat is opened
  useEffect(() => {
    if (!activeId || loaded.current.has(activeId)) return
    loaded.current.add(activeId)
    void Promise.all([api.history(activeId), api.isRunning(activeId), api.listArtifacts(activeId)]).then(([h, running, arts]) => {
      setHistories((cur) => ({ ...cur, [activeId]: cur[activeId] ?? h }))
      setArtifacts((cur) => ({ ...cur, [activeId]: cur[activeId] ?? arts }))
      if (running) setRuntime((r) => ({ ...r, [activeId]: { ...r[activeId], status: 'running' } }))
    })
  }, [activeId])

  /** Show a chat that was just made (it has no history yet). */
  const adoptChat = useCallback(
    (meta: SessionMeta) => {
      loaded.current.add(meta.id)
      setHistories((h) => ({ ...h, [meta.id]: [] }))
      setSessions((list) => [meta, ...list.filter((s) => s.id !== meta.id)])
      openChat(meta.id)
      return meta
    },
    [openChat]
  )
  const newChat = useCallback(
    async (cwd?: string, projectId?: string, design?: DesignInfo) => adoptChat(await api.createSession(cwd, projectId, design)),
    [adoptChat]
  )

  /** Build a design in code: a new chat in your project's folder, which reads the design's file. */
  const handoffDesign = useCallback(
    async (sessionId: string, artifactId: string, version: number) => {
      const folder = await api.pickFolder('Folder of the project to build the design in')
      if (!folder) return
      try {
        const { meta, path } = await api.designHandoff(sessionId, artifactId, version, folder)
        adoptChat(meta)
        const file = path.includes(' ') ? `@"${path}"` : `@${path}`
        await api.send({
          sessionId: meta.id,
          text:
            `Build this design in this project: ${file} (a single HTML file I made in LocalClaude's Design space).\n\n` +
            `Match its layout, colors, typography, spacing and content closely, but write it the way this project does things, with its framework, components and conventions, instead of pasting the HTML in. Look at how the project is organized first.`,
          attachments: []
        })
      } catch (e) {
        setToast({ text: e instanceof Error ? e.message : String(e), error: true })
      }
    },
    [adoptChat]
  )

  const deleteChat = useCallback(
    async (id: string) => {
      await api.deleteSession(id)
      loaded.current.delete(id)
      setSessions((list) => {
        const next = list.filter((s) => s.id !== id)
        if (activeId === id) setActiveId(next[0]?.id ?? null)
        nav.current.stack = nav.current.stack.filter((x) => x !== id)
        nav.current.i = Math.min(nav.current.i, nav.current.stack.length - 1)
        return next
      })
      setPermissions((p) => p.filter((x) => x.sessionId !== id))
    },
    [activeId]
  )

  const renameChat = useCallback(async (id: string, title: string) => {
    const meta = await api.updateSession(id, { title })
    setSessions((list) => list.map((s) => (s.id === id ? meta : s)))
  }, [])

  const pinChat = useCallback(async (id: string, pinned: boolean) => {
    const meta = await api.updateSession(id, { pinned })
    setSessions((list) => list.map((s) => (s.id === id ? meta : s)))
  }, [])

  const upsertProject = useCallback((p: Project) => {
    setProjects((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list]))
  }, [])

  const moveChat = useCallback(async (id: string, projectId: string | undefined) => {
    const meta = await api.updateSession(id, { projectId })
    setSessions((list) => list.map((s) => (s.id === id ? meta : s)))
  }, [])

  const pinProject = useCallback(
    async (id: string, pinned: boolean) => upsertProject(await api.updateProject(id, { pinned })),
    [upsertProject]
  )

  // several chats at once: from selecting them in the sidebar, or dragging them onto a project
  const moveChats = useCallback(
    async (ids: string[], projectId: string | undefined) => {
      for (const id of ids) await moveChat(id, projectId)
      const to = projects.find((p) => p.id === projectId)?.name
      setToast({ text: `${to ? 'Moved' : 'Removed'} ${ids.length} chat${ids.length === 1 ? '' : 's'} ${to ? `to “${to}”` : 'from their project'}.` })
    },
    [moveChat, projects]
  )
  const pinChats = useCallback(
    async (ids: string[], pinned: boolean) => {
      for (const id of ids) await pinChat(id, pinned)
    },
    [pinChat]
  )
  const deleteChats = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        await api.deleteSession(id)
        loaded.current.delete(id)
      }
      const gone = new Set(ids)
      setSessions((list) => {
        const next = list.filter((s) => !gone.has(s.id))
        if (activeId && gone.has(activeId)) setActiveId(next[0]?.id ?? null)
        nav.current.stack = nav.current.stack.filter((x) => !gone.has(x))
        nav.current.i = Math.min(nav.current.i, nav.current.stack.length - 1)
        return next
      })
      setPermissions((p) => p.filter((x) => !gone.has(x.sessionId)))
      setToast({ text: `Deleted ${ids.length} chat${ids.length === 1 ? '' : 's'}.` })
    },
    [activeId]
  )

  const projectDeleted = useCallback((id: string) => {
    setProjects((list) => list.filter((p) => p.id !== id))
    setSessions((list) => list.map((s) => (s.projectId === id ? { ...s, projectId: undefined } : s)))
  }, [])

  /** Open a chat with one of its artifacts showing in the side panel. */
  const openArtifact = useCallback(
    (sessionId: string, artifactId: string) => {
      setLastArtifact({ sessionId, id: artifactId, at: Date.now() })
      openChat(sessionId)
    },
    [openChat]
  )

  /** a password-protected backup was picked: ask for its password */
  const [restoreAsk, setRestoreAsk] = useState(false)
  const imported = useCallback(async (r: ImportResult) => {
    const [list, projs, memory] = await Promise.all([api.listSessions(), api.listProjects(), api.globalMemory()])
    setSessions(list)
    setProjects(projs)
    setGlobalMemory(memory)
    const parts = [`${r.chats} chat${r.chats === 1 ? '' : 's'}`, `${r.projects} project${r.projects === 1 ? '' : 's'}`, `${r.artifacts} artifact${r.artifacts === 1 ? '' : 's'}`]
    if (r.memory) parts.push(`${r.memory} memor${r.memory === 1 ? 'y' : 'ies'}`)
    setToast({
      text:
        `Imported ${parts.join(', ')}.` +
        (r.skipped ? ` Skipped ${r.skipped} already here.` : '') +
        (r.withoutTranscript ? ` ${r.withoutTranscript} chat${r.withoutTranscript === 1 ? '' : 's'} will send ${r.withoutTranscript === 1 ? 'its' : 'their'} earlier messages to Claude as context.` : '')
    })
  }, [])
  const runImport = useCallback(async () => {
    const r = await api.importData()
    if (r.canceled) return
    if (r.needsPassword) return setRestoreAsk(true)
    if (!r.ok) return setToast({ text: r.error ?? 'Import failed.', error: true })
    await imported(r)
  }, [imported])
  const cancelRestore = useCallback(() => {
    setRestoreAsk(false)
    void api.cancelImport()
  }, [])

  const signOut = useCallback(async () => {
    await api.logout()
    setSettingsOpen(false)
    await refreshAuth()
  }, [refreshAuth])

  // Chats restart when what they bill changes (the choice, or a key saved or removed). Until each idle
  // one starts again (and reports what it really uses), forget its old report, so it doesn't show a
  // stale warning. Busy ones keep theirs: they still bill the old source until their turn ends.
  const forgetIdleKeySources = useCallback(
    () =>
      setRuntime((r) =>
        Object.fromEntries(Object.entries(r).map(([id, rt]) => [id, rt.status === 'idle' && rt.init ? { ...rt, init: { ...rt.init, apiKeySource: '' } } : rt]))
      ),
    []
  )
  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      setSettings(await api.setSettings(patch))
      if ('chatBilling' in patch) forgetIdleKeySources()
    },
    [forgetIdleKeySources]
  )

  // a notification was clicked / the global shortcut was pressed
  useEffect(() => api.onOpenSession((id) => openChat(id)), [openChat])
  useEffect(() => api.onNewChat(() => void newChat()), [newChat])

  // ---- what each action does (keyboard shortcuts, the command palette and mods all use these)
  const cycleTheme = useCallback(() => {
    if (!settings) return
    const themes = allThemes(modSnap.themes)
    const a = normalizeAppearance(settings.appearance)
    const i = themes.findIndex((t) => t.id === a.preset)
    const next = themes[(i + 1) % themes.length]
    void updateSettings({ appearance: { ...a, preset: next.id } })
    setToast({ text: `Theme: ${next.name}` })
  }, [settings, modSnap.themes, updateSettings])
  const zoomBy = useCallback(
    (d: number) => {
      if (!settings) return
      const a = normalizeAppearance(settings.appearance)
      const zoom = d === 0 ? 1 : Math.round(Math.min(LIMITS.zoom.max, Math.max(LIMITS.zoom.min, a.zoom + d)) * 100) / 100
      void updateSettings({ appearance: { ...a, zoom } })
    },
    [settings, updateSettings]
  )
  const actions = useMemo<Record<string, () => void>>(
    () => ({
      commandPalette: () => setPaletteOpen((o) => !o),
      newChat: () => void newChat(),
      settings: () => setSettingsOpen('general'),
      appearance: () => setSettingsOpen('appearance'),
      toggleSidebar: () => sidebar.toggle(),
      toggleTranscript: () => setTranscript(transcript === 'verbose' ? 'normal' : 'verbose'),
      find: () => {
        if (page.kind === 'chat' && activeId) setFindRequest({ query: window.getSelection()?.toString().trim().slice(0, 100) ?? '', n: Date.now() })
      },
      export: () => {
        // export what's on screen: the chat, the project, or everything
        if (page.kind === 'project') setExportReq({ scope: 'project', projectId: page.id })
        else if (page.kind === 'chat' && activeId) setExportReq({ scope: 'chat', sessionId: activeId })
        else setExportReq({ scope: 'all' })
      },
      back: () => stepNav(-1),
      forward: () => stepNav(1),
      toggleTheme: () => {
        const dark = document.documentElement.dataset.theme === 'dark'
        void updateSettings({ theme: dark ? 'light' : 'dark' })
      },
      nextTheme: cycleTheme,
      zoomIn: () => zoomBy(LIMITS.zoom.step),
      zoomOut: () => zoomBy(-LIMITS.zoom.step),
      zoomReset: () => zoomBy(0),
      projects: () => setPage({ kind: 'projects' }),
      artifacts: () => setPage({ kind: 'artifacts' }),
      design: () => setPage({ kind: 'designs' }),
      reloadMods: () => void reloadMods().then(() => setToast({ text: 'Mods reloaded.' }))
    }),
    [newChat, sidebar, setTranscript, transcript, page, activeId, stepNav, updateSettings, cycleTheme, zoomBy, reloadMods]
  )

  // keyboard shortcuts: yours from Settings → Keyboard, then the ones mods' commands ask for
  const bindings = useMemo(() => resolveBindings(settings?.keybindings), [settings?.keybindings])
  useEffect(() => {
    const byCombo = new Map<string, () => unknown>()
    for (const act of KEY_ACTIONS) {
      const c = bindings[act.id]
      if (c && !byCombo.has(c)) byCombo.set(c, actions[act.id])
    }
    for (const cmd of modSnap.commands) if (cmd.shortcut && !byCombo.has(cmd.shortcut)) byCombo.set(cmd.shortcut, cmd.run)
    const onKey = (e: KeyboardEvent): void => {
      if (!lock?.ok || !ready || onboarding) return
      const fn = byCombo.get(comboFromEvent(e, isMac))
      if (!fn) return
      e.preventDefault()
      void Promise.resolve(fn()).catch((err) => setToast({ text: String(err instanceof Error ? err.message : err), error: true }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bindings, actions, modSnap.commands, lock?.ok, ready, onboarding])

  // ---- what mods can reach
  const activeRef = useRef<SessionMeta | null>(null)
  activeRef.current = sessions.find((s) => s.id === activeId) ?? null
  useEffect(() => {
    modHost.bridge = {
      newChat: () => newChat(),
      openSettings: (tab) => setSettingsOpen(tab || 'general'),
      open: (kind) => setPage({ kind }),
      send: async (text) => {
        const id = activeRef.current?.id ?? (await newChat()).id
        await api.send({ sessionId: id, text, attachments: [] })
      },
      activeChat: () => (activeRef.current ? { id: activeRef.current.id, title: activeRef.current.title, cwd: activeRef.current.cwd } : null),
      settings: () => settingsRef.current!,
      setAppearance: (patch) => updateSettings({ appearance: { ...normalizeAppearance(settingsRef.current?.appearance), ...patch } }),
      setTheme: (theme) => updateSettings({ theme }),
      toast: (text, error) => setToast({ text, error })
    }
  }, [newChat, updateSettings])
  useEffect(() => {
    if (activeId) modHost.emit('chat-opened', { id: activeId })
  }, [activeId])

  // ---- the command palette: actions, chats, themes, settings pages, and mods' commands
  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (!paletteOpen) return []
    const icons: Record<string, string> = {
      newChat: 'compose',
      settings: 'settings',
      appearance: 'palette',
      toggleSidebar: 'sidebar',
      toggleTranscript: 'list',
      find: 'search',
      export: 'download',
      back: 'back',
      forward: 'forward',
      toggleTheme: 'moon',
      nextTheme: 'palette',
      zoomIn: 'plus',
      zoomOut: 'expand',
      zoomReset: 'retry',
      projects: 'project',
      artifacts: 'shapes',
      design: 'penTool',
      reloadMods: 'puzzle'
    }
    const items: PaletteItem[] = KEY_ACTIONS.filter((a) => a.id !== 'commandPalette').map((a) => ({
      id: `app:${a.id}`,
      title: a.label,
      run: actions[a.id],
      shortcut: bindings[a.id] || undefined,
      icon: icons[a.id],
      group: 'LocalClaude'
    }))
    const tabs: [string, string, string][] = [
      ['appearance', 'Appearance', 'palette'],
      ['keyboard', 'Keyboard shortcuts', 'keyboard'],
      ['mods', 'Mods', 'puzzle'],
      ['tools', 'Tools & computer', 'monitor'],
      ['memory', 'Memory & data', 'memory'],
      ['account', 'Account & sign-in', 'key'],
      ['usage', 'Usage', 'sliders']
    ]
    tabs.push(['deepseek', 'DeepSeek Harness', 'terminal'])
    for (const [tab, label, icon] of tabs) items.push({ id: `settings:${tab}`, title: `Settings: ${label}`, run: () => setSettingsOpen(tab), icon, group: 'Settings' })
    // switch harness: the chat you're in, and what new chats use
    const current = sessions.find((x) => x.id === activeId)
    if (current && !current.design) {
      const to = current.engine === 'deepseek' ? 'claude' : 'deepseek'
      items.push({
        id: 'engine:switch',
        title: `Switch harness: move this chat to ${engineLabel(to)}`,
        keywords: 'engine deepseek claude dsh model provider',
        run: () =>
          void api.setEngine(current.id, to).then(
            (m) => setSessions((list) => list.map((x) => (x.id === m.id ? m : x))),
            (e: unknown) => setToast({ text: String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), error: true })
          ),
        icon: 'terminal',
        group: 'Chat'
      })
    }
    if (settings) {
      const next = settings.defaultEngine === 'deepseek' ? 'claude' : 'deepseek'
      items.push({
        id: 'engine:default',
        title: `Switch harness: new chats use ${engineLabel(next)}`,
        keywords: 'engine deepseek claude dsh default',
        run: () => void updateSettings({ defaultEngine: next }),
        icon: 'terminal',
        group: 'Settings'
      })
    }
    const a = settings ? normalizeAppearance(settings.appearance) : null
    for (const t of allThemes(modSnap.themes))
      items.push({
        id: `theme:${t.id}`,
        title: `Theme: ${t.name}${a?.preset === t.id ? ' (current)' : ''}`,
        keywords: t.description,
        run: () => a && void updateSettings({ appearance: { ...a, preset: t.id } }),
        icon: 'palette',
        group: t.source ? t.source.replace(/^script:/, '') : 'Themes'
      })
    for (const m of ['system', 'light', 'dark'] as const)
      items.push({ id: `mode:${m}`, title: `Mode: ${m === 'system' ? 'Match system' : m === 'light' ? 'Light' : 'Dark'}`, run: () => void updateSettings({ theme: m }), icon: m === 'dark' ? 'moon' : m === 'light' ? 'sun' : 'monitor', group: 'Themes' })
    for (const c of modSnap.commands) items.push({ ...c, icon: 'puzzle' })
    for (const s of sessions.slice(0, 200)) items.push({ id: `chat:${s.id}`, title: s.title || 'New chat', run: () => openChat(s.id), icon: s.design ? 'penTool' : 'chat', group: 'Chat' })
    for (const p of projects) items.push({ id: `project:${p.id}`, title: p.name, run: () => setPage({ kind: 'project', id: p.id }), icon: 'project', group: 'Project' })
    return items
  }, [paletteOpen, actions, bindings, settings, modSnap.themes, modSnap.commands, sessions, projects, openChat, updateSettings, activeId])

  if (!lock) return <div className="splash">Opening…</div>
  if (!lock.ok)
    return (
      <LockScreen
        lock={lock}
        onReset={async () => {
          await api.resetData()
          loaded.current.clear()
          setHistories({})
          setActiveId(null)
          await boot()
        }}
      />
    )
  if (!settings || !auth)
    return (
      <div className="splash">
        <Spark size={36} animate className="working-spark" />
        <span>Checking your Claude sign-in…</span>
      </div>
    )
  if (!ready || onboarding)
    return (
      <SetupScreen
        auth={auth}
        settings={settings}
        canSkip={ready}
        onAuthChanged={async () => {
          setOnboarding(true)
          await refreshAuth()
        }}
        onChange={updateSettings}
        onFinish={() => setOnboarding(false)}
      />
    )

  const active = sessions.find((s) => s.id === activeId) ?? null
  const pendingBySession: Record<string, number> = {}
  for (const p of permissions) pendingBySession[p.sessionId] = (pendingBySession[p.sessionId] ?? 0) + 1

  const canBack = nav.current.i > 0
  const canForward = nav.current.i < nav.current.stack.length - 1
  // Shown in the chat's top bar while the sidebar is hidden.
  const headerLeft = !sidebar.open && (
    <div className="header-actions no-drag">
      <button className="icon-btn" onClick={sidebar.toggle} title="Show sidebar (Ctrl+B)">
        <Icon name="sidebar" size={18} />
      </button>
      <button className="icon-btn" disabled={!canBack} onClick={() => stepNav(-1)} title="Back (Alt+←)">
        <Icon name="back" size={18} />
      </button>
      <button className="icon-btn" disabled={!canForward} onClick={() => stepNav(1)} title="Forward (Alt+→)">
        <Icon name="forward" size={18} />
      </button>
      <button className="icon-btn" onClick={() => void newChat()} title="New chat (Ctrl+N)">
        <Icon name="compose" size={17} />
      </button>
    </div>
  )

  return (
    <div className={'app' + (sidebar.narrow ? ' narrow' : '')}>
      {sidebar.open && sidebar.narrow && <div className="sidebar-backdrop" onClick={sidebar.toggle} />}
      <Sidebar
        open={sidebar.open}
        overlay={sidebar.narrow}
        onCollapse={sidebar.toggle}
        sessions={sessions}
        projects={projects}
        activeId={page.kind === 'chat' ? activeId : null}
        activeProjectId={page.kind === 'project' ? page.id : null}
        runtime={runtime}
        pending={pendingBySession}
        auth={auth}
        consoleKey={consoleKey}
        canBack={canBack}
        canForward={canForward}
        onBack={() => stepNav(-1)}
        onForward={() => stepNav(1)}
        onPin={(id, p) => void pinChat(id, p)}
        onExportChat={(id) => setExportReq({ scope: 'chat', sessionId: id })}
        onOpenSearchHit={(id, query) => {
          openChat(id)
          setFindRequest({ query, n: Date.now() })
          sidebar.close()
        }}
        onOpenProject={(id) => {
          setPage({ kind: 'project', id })
          sidebar.close()
        }}
        onPinProject={(id, p) => void pinProject(id, p)}
        onExportAll={() => setExportReq({ scope: 'all' })}
        onImport={() => void runImport()}
        projectsActive={page.kind === 'projects'}
        onProjects={() => {
          setPage({ kind: 'projects' })
          sidebar.close()
        }}
        artifactsActive={page.kind === 'artifacts'}
        onArtifacts={() => {
          setPage({ kind: 'artifacts' })
          sidebar.close()
        }}
        designActive={page.kind === 'designs' || (page.kind === 'chat' && !!active?.design)}
        onDesign={() => {
          setPage({ kind: 'designs' })
          sidebar.close()
        }}
        onSignOut={() => void signOut()}
        onSelect={(id) => {
          openChat(id)
          sidebar.close()
        }}
        onNew={() => {
          void newChat()
          sidebar.close()
        }}
        onNewIn={(cwd, projectId) => {
          void newChat(cwd, projectId)
          sidebar.close()
        }}
        width={sideWidth}
        onResize={(w, done) => {
          setSideWidth(w)
          if (done) writePref('sidebarWidth', String(w))
        }}
        userName={settings.userName ?? ''}
        onDelete={(id) => void deleteChat(id)}
        onDeleteChats={(ids) => void deleteChats(ids)}
        onPinChats={(ids, p) => void pinChats(ids, p)}
        onMoveChats={(ids, pid) => void moveChats(ids, pid)}
        onExportChats={(ids) => setExportReq({ scope: 'chats', sessionIds: ids })}
        onRename={(id, t) => void renameChat(id, t)}
        onSettings={() => setSettingsOpen('general')}
        onPalette={() => setPaletteOpen(true)}
        modItems={modSnap.sidebar.map((m) => ({
          key: `${m.modId}:${m.id}`,
          label: m.label,
          icon: m.icon,
          title: m.title,
          onClick: () => void Promise.resolve(m.onClick()).catch((e) => setToast({ text: String(e), error: true }))
        }))}
        statusItems={modSnap.status.map((m) => ({
          key: `${m.modId}:${m.id}`,
          text: m.text,
          title: m.title,
          onClick: m.onClick ? () => void Promise.resolve(m.onClick!()).catch((e) => setToast({ text: String(e), error: true })) : undefined
        }))}
      />
      <main className="main">
        {page.kind === 'artifacts' ? (
          <ArtifactsView headerLeft={headerLeft} projects={projects} onOpen={openArtifact} />
        ) : page.kind === 'designs' ? (
          <DesignsView
            headerLeft={headerLeft}
            sessions={sessions}
            onOpen={openChat}
            onCreate={async (d) => {
              const meta = await newChat(d.cwd, undefined, d.design)
              if (d.model !== meta.model) await api.setModel(meta.id, d.model)
              if (d.permissionMode !== meta.permissionMode) await api.setMode(meta.id, d.permissionMode)
              await api.send({ sessionId: meta.id, text: d.text, attachments: d.attachments })
            }}
            onPin={(id, p) => void pinChat(id, p)}
            onDelete={(id) => void deleteChat(id)}
            settings={settings}
            onSettings={updateSettings}
          />
        ) : page.kind === 'projects' ? (
          <ProjectsView
            projects={projects}
            sessions={sessions}
            headerLeft={headerLeft}
            onOpen={(id) => setPage({ kind: 'project', id })}
            onCreated={(p) => {
              upsertProject(p)
              setPage({ kind: 'project', id: p.id })
            }}
            onPin={(id, p) => void pinProject(id, p)}
            onExport={(id) => setExportReq({ scope: 'project', projectId: id })}
            onDeleted={projectDeleted}
            onDropChats={(pid, ids) => void moveChats(ids, pid)}
          />
        ) : page.kind === 'project' && projects.some((p) => p.id === page.id) ? (
          <ProjectView
            key={page.id}
            project={projects.find((p) => p.id === page.id)!}
            sessions={sessions}
            headerLeft={headerLeft}
            defaultCwd={settings.defaultCwd}
            memoryEnabled={settings.memory}
            onEnableMemory={() => void updateSettings({ memory: true })}
            onBack={() => setPage({ kind: 'projects' })}
            onChanged={upsertProject}
            onDeleted={() => {
              projectDeleted(page.id)
              setPage({ kind: 'projects' })
            }}
            onOpenChat={openChat}
            onOpenArtifact={openArtifact}
            onExport={() => setExportReq({ scope: 'project', projectId: page.id })}
            onPin={(p) => void pinProject(page.id, p)}
            onStartChat={(text) =>
              void newChat(undefined, page.id).then((meta) => api.send({ sessionId: meta.id, text, attachments: [] }))
            }
          />
        ) : active ? (
          <ChatView
            key={active.id}
            meta={active}
            history={histories[active.id] ?? []}
            runtime={runtime[active.id] ?? { status: 'idle' }}
            permission={permissions.find((p) => p.sessionId === active.id) ?? null}
            settings={settings}
            rateLimit={rateLimit}
            consoleKey={consoleKey}
            transcript={transcript}
            onTranscript={setTranscript}
            onPermissionDone={(rid) => setPermissions((p) => p.filter((x) => x.requestId !== rid))}
            onMeta={(m) => setSessions((list) => list.map((s) => (s.id === m.id ? m : s)))}
            onOpenSettings={(tab) => setSettingsOpen(tab)}
            headerLeft={headerLeft}
            artifacts={artifacts[active.id] ?? []}
            lastArtifact={lastArtifact?.sessionId === active.id ? lastArtifact : null}
            project={projects.find((p) => p.id === active.projectId)}
            projects={projects}
            onOpenProject={(id) => setPage({ kind: 'project', id })}
            onMoveToProject={(pid) => void moveChat(active.id, pid)}
            onProjectChanged={upsertProject}
            remote={remote}
            onSettings={updateSettings}
            onRename={(t) => void renameChat(active.id, t)}
            onPin={(p) => void pinChat(active.id, p)}
            onDelete={() => {
              void deleteChat(active.id)
              if (active.design) setPage({ kind: 'designs' })
            }}
            onExport={() => setExportReq({ scope: 'chat', sessionId: active.id })}
            findRequest={findRequest}
            onFindHandled={() => setFindRequest(null)}
            onOpenDesigns={() => setPage({ kind: 'designs' })}
            onHandoff={(artifactId, version) => void handoffDesign(active.id, artifactId, version)}
          />
        ) : (
          <div className="empty-main">
            <div className="titlebar floating">{headerLeft}</div>
            <Spark size={44} className="welcome-spark" />
            <h1>What should we work on?</h1>
            <p>Claude can read and edit your files, run commands, browse and use your tools — all on this machine.</p>
            <button className="btn primary" onClick={() => void newChat()}>
              Start a new chat
            </button>
          </div>
        )}
      </main>
      {settingsOpen && (
        <SettingsDialog
          tab={settingsOpen}
          settings={settings}
          auth={auth}
          onTab={setSettingsOpen}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onLogout={signOut}
          onSignInClaude={() => {
            setSettingsOpen(false)
            setOnboarding(true)
          }}
          onAuthChanged={async () => {
            forgetIdleKeySources()
            await refreshAuth()
          }}
          globalMemory={globalMemory}
          onGlobalMemory={setGlobalMemory}
          onExportAll={() => setExportReq({ scope: 'all' })}
          onImport={() => void runImport()}
          mods={mods}
          onReloadMods={reloadMods}
        />
      )}
      {paletteOpen && <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />}
      {exportReq && (
        <ExportDialog
          scope={exportReq.scope}
          sessionId={exportReq.sessionId}
          sessionIds={exportReq.sessionIds}
          projectId={exportReq.projectId}
          sessions={sessions}
          projects={projects}
          onClose={() => setExportReq(null)}
        />
      )}
      {restoreAsk && (
        <PasswordDialog
          title="Restore a backup"
          body="Enter the password this backup was made with. Chats, projects and memory that are already here are skipped."
          submitLabel="Restore"
          onCancel={cancelRestore}
          onSubmit={async (password) => {
            const r = await api.importWithPassword(password)
            if (!r.ok) return r.error ?? 'Couldn’t restore this backup.'
            setRestoreAsk(false)
            await imported(r)
            return null
          }}
        />
      )}
      {toast && (
        <div className={'toast' + (toast.error ? ' error' : '')} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
