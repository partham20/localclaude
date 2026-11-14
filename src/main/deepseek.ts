// DeepSeek Harness (dsh) as a chat engine. dsh runs as a child process in its ACP mode
// (`dsh --profile acp`, Agent Client Protocol: JSON-RPC over stdio), one process per open chat,
// and its updates are translated into the same UI events Claude Code chats use.
//
// dsh needs Node 24.9+, which Electron itself ships, so when dsh's entry file can be found it runs
// on LocalClaude's own runtime (ELECTRON_RUN_AS_NODE) and no separate Node is needed to run it.
import type * as acp from '@agentclientprotocol/sdk'
import { enabledPluginMcpServers, skillsForChat, skillsPreamble } from './extensions'
import { withMcpAuth } from './mcpAuth'
import { app } from 'electron'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { DSH_PACKAGE, type DeepSeekInstallEvent, type DeepSeekStatus } from '../shared/deepseek'
import { applyEvent } from '../shared/reducer'
import type {
  AgentEvent,
  AppSettings,
  ChatMessage,
  ContentPart,
  DiffHunk,
  ImageRef,
  PermissionDecision,
  PermissionModeUI,
  RewindPreview,
  RewindRequest,
  SendPayload,
  SessionMeta
} from '../shared/types'
import { importedContext } from './exporter'
import { storeImage } from './images'
import { log } from './log'
import type { SecureStore } from './store'

type Emit = (e: AgentEvent) => void
type ModelOption = { value: string; displayName: string; description: string }

// ---------------------------------------------------------------- finding dsh
/** dsh's entry file inside an installed @deepseek-ai/dsh package folder */
const entryIn = (nodeModules: string): string => join(nodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** Where "Install DeepSeek Harness" puts dsh: LocalClaude's own folder, nothing global. */
export function appInstallDir(): string {
  return join(app.getPath('userData'), 'deepseek-harness')
}

let npmRootCache: string | null | undefined
function npmGlobalRoot(): string | null {
  if (npmRootCache !== undefined) return npmRootCache
  try {
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', timeout: 8000, shell: process.platform === 'win32', windowsHide: true })
    npmRootCache = r.status === 0 ? r.stdout.trim() || null : null
  } catch {
    npmRootCache = null
  }
  return npmRootCache
}

function onPath(cmd: string): string | null {
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const d of dirs) for (const e of exts) if (existsSync(join(d, cmd + e))) return join(d, cmd + e)
  return null
}

export interface DshLaunch {
  bin: string
  args: string[]
  /** run bin as Node (bin is LocalClaude itself, args[0] is dsh's entry file) */
  asNode: boolean
  via: NonNullable<DeepSeekStatus['via']>
  location: string
  version?: string
}

function versionOf(entry: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8')) as { version?: string }).version
  } catch {
    return undefined
  }
}

function viaEntry(entry: string, via: DshLaunch['via']): DshLaunch {
  return { bin: process.execPath, args: [entry], asNode: true, via, location: entry, version: versionOf(entry) }
}

/** How to start dsh, or null when it isn't installed. */
export function findDsh(s: Pick<AppSettings, 'deepseekCommand'>): DshLaunch | null {
  // tests point this at a stand-in
  const env = process.env.LOCALCLAUDE_DSH
  if (env) return viaEntry(env, 'env')
  const custom = s.deepseekCommand.trim()
  if (custom) {
    if (/\.(c|m)?js$/i.test(custom)) return viaEntry(custom, 'custom')
    return { bin: custom, args: [], asNode: false, via: 'custom', location: custom }
  }
  const mine = entryIn(join(appInstallDir(), 'node_modules'))
  if (existsSync(mine)) return viaEntry(mine, 'app')
  const roots = [
    npmGlobalRoot(),
    process.platform === 'win32' && process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules') : null,
    join(homedir(), '.npm-global', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules'
  ]
  for (const r of roots) if (r && existsSync(entryIn(r))) return viaEntry(entryIn(r), 'global')
  // a dsh command we can't look inside: it runs on its own Node, which must be 24.9 or newer
  const cmd = onPath('dsh')
  if (cmd) return { bin: cmd, args: [], asNode: false, via: 'path', location: cmd }
  return null
}

/** The API key dsh gets: DEEPSEEK_API_KEY from the environment wins over the saved one, like LOCALCLAUDE_API_KEY. */
export function deepseekKeySource(store: SecureStore): 'env' | 'saved' | undefined {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return 'env'
  return store.getDeepSeekKey() ? 'saved' : undefined
}

export function cleanDeepSeekKey(raw: string): { key: string } | { error: string } {
  const key = raw.trim().replace(/^["']|["']$/g, '')
  if (!key) return { error: 'Paste your DeepSeek API key.' }
  if (/\s/.test(key)) return { error: 'That doesn’t look like a key: it has spaces in it.' }
  if (key.length < 20) return { error: 'That key looks too short. Copy the whole key from platform.deepseek.com.' }
  return { key }
}

/** Ask DeepSeek whether the key works (the model list needs a valid key and costs nothing). */
export async function checkDeepSeekKey(key: string): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  try {
    const r = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) })
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'DeepSeek didn’t accept this key. Check it at platform.deepseek.com and paste it again.' }
    if (!r.ok) return { ok: true, warning: `Saved, but DeepSeek answered ${r.status} when it was checked.` }
    return { ok: true }
  } catch {
    return { ok: true, warning: 'Saved, but it couldn’t be checked because DeepSeek couldn’t be reached.' }
  }
}

// ---------------------------------------------------------------- installing dsh
let installing = false

export function deepseekStatus(store: SecureStore, s: AppSettings): DeepSeekStatus {
  const d = findDsh(s)
  return {
    found: !!d,
    via: d?.via,
    location: d?.location,
    version: d?.version,
    key: deepseekKeySource(store),
    canInstall: !!npmGlobalRoot() || !!onPath('npm'),
    installing
  }
}

/**
 * Install dsh into LocalClaude's own folder with npm (it needs npm, but not a new Node: dsh then runs
 * on LocalClaude's runtime). It's large, around 1 GB with everything it brings.
 */
export function installDsh(onEvent: (e: DeepSeekInstallEvent) => void): void {
  if (installing) return
  installing = true
  const dir = appInstallDir()
  const win = process.platform === 'win32'
  const args = ['install', '--prefix', dir, `${DSH_PACKAGE}@latest`, '--no-audit', '--no-fund', '--engine-strict=false', '--loglevel=error']
  onEvent({ type: 'output', text: `npm ${args.join(' ')}\n` })
  let p: ReturnType<typeof spawn>
  try {
    p = spawn(win ? 'npm.cmd' : 'npm', args, { shell: win, windowsHide: true, env: process.env })
  } catch (e) {
    installing = false
    onEvent({ type: 'done', ok: false, error: e instanceof Error ? e.message : String(e) })
    return
  }
  let tail = ''
  const out = (d: Buffer): void => {
    const t = d.toString()
    tail = (tail + t).slice(-4000)
    onEvent({ type: 'output', text: t })
  }
  p.stdout?.on('data', out)
  p.stderr?.on('data', out)
  p.on('error', (e) => {
    installing = false
    onEvent({ type: 'done', ok: false, error: /ENOENT/.test(String(e)) ? 'npm wasn’t found. Install Node.js from nodejs.org, then try again.' : String(e) })
  })
  p.on('close', (code) => {
    if (!installing) return
    installing = false
    const ok = code === 0 && existsSync(entryIn(join(dir, 'node_modules')))
    log(ok ? 'info' : 'warn', `DeepSeek Harness install finished (${code})`)
    onEvent({ type: 'done', ok, error: ok ? undefined : `npm stopped with code ${code}. ${tail.trim().split('\n').slice(-3).join(' ')}` })
  })
}

// ---------------------------------------------------------------- ACP over stdio
/** A tiny JSON-RPC 2.0 client over newline-delimited JSON, enough for ACP's client side. */
class AcpConnection {
  private nextId = 1
  private waits = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private stderr = ''
  exited = false

  constructor(
    private proc: ChildProcessWithoutNullStreams,
    private onNotification: (method: string, params: unknown) => void,
    private onRequest: (method: string, params: unknown) => Promise<unknown>,
    private onExit: (detail: string) => void
  ) {
    createInterface({ input: proc.stdout }).on('line', (line) => this.receive(line))
    proc.stderr.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000)
      if (process.env.LOCALCLAUDE_DEBUG) console.error('[dsh]', d.toString())
    })
    proc.on('error', (e) => this.fail(String(e)))
    proc.on('exit', (code, signal) => this.fail(`dsh stopped (${signal ?? code})`))
    proc.stdin.on('error', () => {})
  }

  private fail(why: string): void {
    if (this.exited) return
    this.exited = true
    const detail = [why, this.stderr.trim().split('\n').slice(-4).join('\n')].filter(Boolean).join('\n')
    for (const w of this.waits.values()) w.reject(new Error(detail))
    this.waits.clear()
    this.onExit(detail)
  }

  private receive(line: string): void {
    if (!line.trim()) return
    let m: { id?: number | string | null; method?: string; params?: unknown; result?: unknown; error?: { message?: string; data?: unknown } }
    try {
      m = JSON.parse(line)
    } catch {
      return // not protocol traffic
    }
    if (m.method && m.id !== undefined && m.id !== null) {
      const id = m.id
      this.onRequest(m.method, m.params).then(
        (result) => this.write({ jsonrpc: '2.0', id, result }),
        (e: unknown) => this.write({ jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } })
      )
    } else if (m.method) {
      this.onNotification(m.method, m.params)
    } else if (m.id !== undefined && m.id !== null) {
      const w = this.waits.get(Number(m.id))
      if (!w) return
      this.waits.delete(Number(m.id))
      if (m.error) w.reject(new Error(m.error.message || 'dsh returned an error'))
      else w.resolve(m.result)
    }
  }

  private write(msg: unknown): void {
    if (!this.exited) this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.exited) return Promise.reject(new Error('dsh isn’t running'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.waits.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  kill(): void {
    try {
      this.proc.stdin.end()
    } catch {
      /* gone */
    }
    // give dsh a moment to save the session, then make sure it's gone
    setTimeout(() => {
      if (!this.exited) this.proc.kill()
    }, 1500).unref()
  }
}

// ---------------------------------------------------------------- translating dsh's tools
/** dsh's tools match Claude Code's closely: show them with the same names, so they get the same cards and diffs. */
const TOOL_NAMES: Record<string, string> = {
  bash: 'Bash',
  pwsh: 'PowerShell',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  todo_write: 'TodoWrite',
  subagent: 'Agent',
  skill: 'Skill'
}

export function displayTool(title: string | undefined, rawInput: unknown): { name: string; input: Record<string, unknown> } {
  const raw = title ?? 'tool'
  const input = rawInput && typeof rawInput === 'object' ? { ...(rawInput as Record<string, unknown>) } : {}
  const name = TOOL_NAMES[raw] ?? raw
  if (name === 'WebSearch' && Array.isArray(input.queries) && input.query === undefined) input.query = input.queries.join(' · ')
  if (name === 'Skill' && input.skill === undefined && input.name !== undefined) input.skill = input.name
  return { name, input }
}

/** A tool's output as text, and a diff when dsh reports one. */
export function toolOutput(content: acp.ToolCallContent[] | null | undefined): { text: string; patch?: DiffHunk[] } {
  const texts: string[] = []
  const patch: DiffHunk[] = []
  for (const c of content ?? []) {
    if (c.type === 'content') {
      const b = c.content
      if (b.type === 'text') texts.push(b.text)
      else if (b.type === 'resource_link') texts.push(b.uri)
      else if (b.type === 'image') texts.push('[image]')
    } else if (c.type === 'diff') {
      const oldLines = c.oldText ? c.oldText.split('\n') : []
      const newLines = c.newText.split('\n')
      patch.push({ oldStart: 1, oldLines: oldLines.length, newStart: 1, newLines: newLines.length, lines: [...oldLines.map((l) => '-' + l), ...newLines.map((l) => '+' + l)] })
    } else if (c.type === 'terminal') texts.push(`[terminal ${c.terminalId}]`)
  }
  return { text: texts.join('\n'), patch: patch.length ? patch : undefined }
}

/** LocalClaude's permission modes, as dsh's sandbox presets (set when dsh starts). */
export function dshPermissionMode(mode: PermissionModeUI): string {
  if (mode === 'plan') return 'read-only'
  if (mode === 'bypassPermissions') return 'danger-full-access'
  return 'workspace-write'
}

function friendly(text: string): string {
  if (/401|unauthori[sz]ed|invalid api key|authentication/i.test(text))
    return 'DeepSeek didn’t accept your API key. Check it in Settings → DeepSeek.\n\n' + text
  if (/402|insufficient balance/i.test(text)) return 'Your DeepSeek account is out of balance. Top it up at platform.deepseek.com.\n\n' + text
  if (/ENOENT|not recognized|command not found/i.test(text))
    return 'DeepSeek Harness couldn’t be started. Install it in Settings → DeepSeek, or set the command to start it there.\n\n' + text
  if (/Unsupported engine|requires Node|node.*24\.9/i.test(text))
    return 'dsh needs Node 24.9 or newer. Install it from Settings → DeepSeek so it runs on LocalClaude’s own runtime instead.\n\n' + text
  return text
}

// ---------------------------------------------------------------- the session
interface Pending {
  resolve: (r: acp.RequestPermissionResponse) => void
  options: acp.PermissionOption[]
}

export interface DeepSeekDeps {
  titleFor?: (firstUser: string, firstReply: string) => Promise<string | null>
  /** dsh's model list from a running session, for the model menu */
  onModels: (models: ModelOption[]) => void
}

/** One chat on DeepSeek Harness. Same surface as a Claude Code chat, so the session manager can hold either. */
export class DeepSeekSession {
  history: ChatMessage[]
  running = false
  private conn?: AcpConnection
  private starting?: Promise<string>
  /** dsh's id for this chat's session while the process runs */
  private dshSession?: string
  private config: acp.SessionConfigOption[] = []
  private pending = new Map<string, Pending>()
  /** prompts wait for the one before (dsh takes one at a time per session) */
  private chain: Promise<void> = Promise.resolve()
  private queued = 0
  private interrupted = false
  private restartAfterTurn = false
  private startedMode?: string
  private saveTimer?: NodeJS.Timeout
  private titleAttempts = 0
  /** the assistant message being built from dsh's updates in this turn */
  private cur?: ChatMessage
  private curDshId?: string
  /** tool call id → the message holding it */
  private toolMsg = new Map<string, ChatMessage>()

  constructor(
    public meta: SessionMeta,
    private store: SecureStore,
    private emitRaw: Emit,
    private settings: () => AppSettings,
    private deps: DeepSeekDeps
  ) {
    this.history = store.loadHistory(meta.id)
  }

  private emit(e: AgentEvent): void {
    this.history = applyEvent(this.history, e)
    this.emitRaw(e)
    if (e.type === 'turn-done' || e.type === 'message-final' || e.type === 'message-start' || e.type === 'error') this.scheduleSave()
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.store.saveHistory(this.meta.id, this.history), 400)
  }

  private touchMeta(patch: Partial<SessionMeta>): void {
    this.meta = { ...this.meta, ...patch, updatedAt: Date.now() }
    this.store.upsertSession(this.meta)
    this.emitRaw({ type: 'meta', meta: this.meta })
  }

  private setStatus(status: 'idle' | 'running' | 'starting'): void {
    this.running = status !== 'idle'
    this.emitRaw({ type: 'status', sessionId: this.meta.id, status })
  }

  private system(text: string): void {
    this.emit({ type: 'message-start', sessionId: this.meta.id, message: { id: 'sys-' + randomUUID(), role: 'system', parts: [{ kind: 'text', text }], ts: Date.now() } })
  }

  // ---------------------------------------------------------------- lifecycle
  private mcpServers(): (acp.McpServerStdio | (acp.McpServerHttp & { type: 'http' }))[] {
    const out: (acp.McpServerStdio | (acp.McpServerHttp & { type: 'http' }))[] = []
    const s = this.settings()
    // your servers, then the ones enabled plugins bring (Claude Code chats get those from Claude Code itself)
    const servers = { ...(s.loadUserSettings ? enabledPluginMcpServers() : {}), ...s.mcpServers }
    for (const [name, raw] of Object.entries(servers)) {
      if (raw.enabled === false) continue
      const cfg = withMcpAuth(this.store, raw)
      if (cfg.type === 'http' && cfg.url)
        out.push({ type: 'http', name, url: cfg.url, headers: Object.entries(cfg.headers ?? {}).map(([n, value]) => ({ name: n, value })) })
      else if ((!cfg.type || cfg.type === 'stdio') && cfg.command)
        out.push({ name, command: cfg.command, args: cfg.args ?? [], env: Object.entries(cfg.env ?? {}).map(([n, value]) => ({ name: n, value })) })
      // dsh doesn't take SSE servers
    }
    return out
  }

  /** Start dsh and open (or resume) this chat's session. Resolves to dsh's session id. */
  private ensureStarted(): Promise<string> {
    if (this.conn && !this.conn.exited && this.dshSession) return Promise.resolve(this.dshSession)
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => (this.starting = undefined))
    return this.starting
  }

  private async start(): Promise<string> {
    const s = this.settings()
    const launch = findDsh(s)
    if (!launch) throw new Error('DeepSeek Harness isn’t installed. Install it in Settings → DeepSeek (or run npm i -g @deepseek-ai/dsh), then send your message again.')
    const key = process.env.DEEPSEEK_API_KEY?.trim() || this.store.getDeepSeekKey()
    if (!key) throw new Error('Add your DeepSeek API key in Settings → DeepSeek first. You can create one at platform.deepseek.com.')
    const mode = dshPermissionMode(this.meta.permissionMode)
    const env: Record<string, string | undefined> = { ...process.env, DEEPSEEK_API_KEY: key, DSH_PERMISSION_MODE: mode }
    if (launch.asNode) env.ELECTRON_RUN_AS_NODE = '1'
    else delete env.ELECTRON_RUN_AS_NODE
    log('info', `starting DeepSeek Harness (${launch.via}${launch.version ? ' ' + launch.version : ''}, ${mode})`)
    const proc = spawn(launch.bin, [...launch.args, '--profile', 'acp'], {
      cwd: this.meta.cwd,
      env,
      windowsHide: true,
      // a dsh.cmd shim on Windows needs a shell
      shell: process.platform === 'win32' && !launch.asNode && /\.(cmd|bat)$/i.test(launch.bin)
    })
    const conn = new AcpConnection(
      proc,
      (method, params) => {
        if (method === 'session/update') this.onUpdate(params as acp.SessionNotification)
      },
      (method, params) => this.onRequest(method, params),
      (detail) => {
        if (this.conn !== conn) return
        this.conn = undefined
        this.dshSession = undefined
        this.cancelAllPermissions()
        if (detail && !/SIGTERM|\(0\)|\(null\)/.test(detail.split('\n')[0])) log('warn', `[dsh] ${detail}`)
      }
    )
    this.conn = conn
    this.startedMode = mode
    await conn.request<acp.InitializeResponse>('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'LocalClaude', version: app.getVersion() } })
    const params = { cwd: this.meta.cwd, mcpServers: this.mcpServers() }
    let sessionId: string | undefined
    if (this.meta.sdkSessionId) {
      try {
        const r = await conn.request<acp.ResumeSessionResponse>('session/resume', { ...params, sessionId: this.meta.sdkSessionId })
        sessionId = this.meta.sdkSessionId
        this.setConfig(r?.configOptions ?? [])
      } catch (e) {
        // dsh lost it (its data was cleared, or another machine): carry on with the earlier messages as context
        log('warn', `DeepSeek session couldn’t be resumed: ${e instanceof Error ? e.message : e}`)
        this.touchMeta({ sdkSessionId: undefined, imported: this.history.some((m) => m.role === 'user') || undefined })
        this.system('DeepSeek Harness couldn’t reopen this chat’s session, so your earlier messages are sent to it as context.')
      }
    }
    if (!sessionId) {
      const r = await conn.request<acp.NewSessionResponse>('session/new', params)
      sessionId = r.sessionId
      this.setConfig(r.configOptions ?? [])
    }
    this.dshSession = sessionId
    this.emitRaw({
      type: 'init',
      sessionId: this.meta.id,
      info: {
        model: this.currentValue('model') ?? '',
        cwd: this.meta.cwd,
        tools: [],
        slashCommands: [],
        skills: [],
        mcpServers: [],
        // not a Claude billing source, so no Claude billing tag
        apiKeySource: '',
        claudeCodeVersion: `DeepSeek Harness ${launch.version ?? ''}`.trim(),
        permissionMode: this.meta.permissionMode
      }
    })
    return sessionId
  }

  private setConfig(options: acp.SessionConfigOption[]): void {
    this.config = options
    const model = options.find((o) => o.id === 'model' || o.category === 'model')
    if (model?.type !== 'select') return
    const flat: ModelOption[] = []
    for (const o of model.options as (acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup)[]) {
      if ('options' in o) for (const x of o.options) flat.push({ value: x.value, displayName: x.name, description: x.description ?? '' })
      else flat.push({ value: o.value, displayName: o.name, description: o.description ?? '' })
    }
    if (flat.length) this.deps.onModels(flat)
  }

  private currentValue(id: string): string | undefined {
    const o = this.config.find((x) => x.id === id)
    return o && o.type === 'select' ? String(o.currentValue) : undefined
  }

  /** Apply the chat's model and the effort setting before a prompt, when they differ from dsh's. */
  private async syncConfig(sessionId: string): Promise<void> {
    const want: [string, string][] = []
    const model = this.meta.model
    if (model && this.config.some((o) => o.id === 'model') && this.currentValue('model') !== model) want.push(['model', model])
    const effort = this.settings().deepseekEffort
    if (effort && this.config.some((o) => o.id === 'reasoning_effort') && this.currentValue('reasoning_effort') !== effort) want.push(['reasoning_effort', effort])
    for (const [configId, value] of want) {
      try {
        const r = await this.conn!.request<acp.SetSessionConfigOptionResponse>('session/set_config_option', { sessionId, configId, value })
        if (r?.configOptions) this.setConfig(r.configOptions)
      } catch (e) {
        log('warn', `dsh rejected ${configId}=${value}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  flush(): void {
    if (!this.saveTimer) return
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    this.store.saveHistory(this.meta.id, this.history)
  }

  shutdown(): void {
    this.cancelAllPermissions()
    const conn = this.conn
    this.conn = undefined
    if (conn && this.dshSession) conn.request('session/close', { sessionId: this.dshSession }).catch(() => {})
    this.dshSession = undefined
    conn?.kill()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.store.saveHistory(this.meta.id, this.history)
    }
  }

  hasProcess(): boolean {
    // plan usage is a Claude thing: never read through a dsh process
    return false
  }
  usageRaw(): never {
    throw new Error('DeepSeek chats have no Claude plan usage')
  }

  // ---------------------------------------------------------------- input
  send(p: SendPayload): void {
    const images: ImageRef[] = []
    for (const a of p.attachments) {
      const ref = storeImage(this.store, this.meta.id, Buffer.from(a.base64, 'base64'))
      if (ref) images.push(ref)
    }
    if (!p.text.trim() && !images.length) return
    const userMsg: ChatMessage = {
      id: 'u-' + randomUUID(),
      role: 'user',
      parts: [{ kind: 'text', text: p.text }],
      images: images.length || undefined,
      imageRefs: images.length ? images : undefined,
      ts: Date.now()
    }
    // a chat that switched engines (or was restored from an export) sends its earlier messages once
    const context = this.meta.imported && !this.meta.sdkSessionId && this.history.length ? importedContext(this.meta, this.history, 'deepseek') : ''
    this.emit({ type: 'message-start', sessionId: this.meta.id, message: userMsg })
    if (images.length || p.reuseImages?.length) this.system('DeepSeek Harness can’t see images, so only your text was sent.')
    if (/^(New chat|New design)$/.test(this.meta.title) && p.text.trim()) this.touchMeta({ title: p.text.trim().replace(/\s+/g, ' ').slice(0, 60) })
    else this.touchMeta({})
    const blocks: acp.ContentBlock[] = []
    if (context) blocks.push({ type: 'text', text: context })
    const pre = this.preamble()
    if (pre) blocks.push({ type: 'text', text: pre })
    if (p.text.trim()) blocks.push({ type: 'text', text: p.text })
    if (!blocks.length) return
    this.queued++
    if (!this.running) this.setStatus('starting')
    this.chain = this.chain.then(() => this.runPrompt(blocks)).catch(() => {})
  }

  /** What Claude chats get in their system prompt, for a fresh dsh session: your name, your instructions, the project's. */
  private preamble(): string {
    if (this.meta.sdkSessionId) return ''
    const s = this.settings()
    const project = this.meta.projectId ? this.store.getProject(this.meta.projectId) : undefined
    const parts = [
      s.userName?.trim() ? `The user's name is ${s.userName.trim()}.` : '',
      s.appendSystemPrompt?.trim() ?? '',
      project?.instructions?.trim() ? `Instructions for the project “${project.name}”:\n${project.instructions.trim()}` : '',
      // DeepSeek Harness has no skills of its own: tell it what yours are for and where they are
      skillsPreamble(skillsForChat(s, this.meta.cwd))
    ].filter(Boolean)
    return parts.length ? `<context>\n${parts.join('\n\n')}\n</context>` : ''
  }

  private async runPrompt(prompt: acp.ContentBlock[]): Promise<void> {
    const started = Date.now()
    this.cur = undefined
    this.curDshId = undefined
    let errorText: string | undefined
    try {
      const sessionId = await this.ensureStarted()
      if (!this.meta.sdkSessionId || this.meta.sdkSessionId !== sessionId) {
        this.touchMeta({ sdkSessionId: sessionId, imported: undefined, switchedFrom: undefined })
        this.emitRaw({ type: 'sdk-session', sessionId: this.meta.id, sdkSessionId: sessionId })
      } else if (this.meta.imported) this.touchMeta({ imported: undefined, switchedFrom: undefined })
      this.setStatus('running')
      await this.syncConfig(sessionId)
      // stopped while dsh was still starting: don't send it
      const r = this.interrupted ? { stopReason: 'cancelled' as const } : await this.conn!.request<acp.PromptResponse>('session/prompt', { sessionId, prompt })
      if (r.stopReason === 'cancelled' || this.interrupted) this.system('Stopped.')
      else if (r.stopReason === 'refusal') errorText = 'DeepSeek declined to continue.'
      else if (r.stopReason === 'max_tokens') this.system('The reply hit the output limit.')
    } catch (e) {
      errorText = this.interrupted ? undefined : friendly(e instanceof Error ? e.message : String(e))
      if (this.interrupted) this.system('Stopped.')
    }
    this.interrupted = false
    this.queued--
    if (errorText) this.emit({ type: 'error', sessionId: this.meta.id, text: errorText })
    this.emit({
      type: 'turn-done',
      sessionId: this.meta.id,
      isError: !!errorText,
      errorText,
      stats: { costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: Date.now() - started, numTurns: 1 }
    })
    if (this.queued <= 0) {
      this.queued = 0
      this.setStatus('idle')
      if (this.restartAfterTurn) {
        this.restartAfterTurn = false
        this.shutdown()
      }
    }
    if (!errorText) this.maybeNameChat()
  }

  async interrupt(): Promise<void> {
    if (!this.running) return
    this.interrupted = true
    this.cancelAllPermissions()
    if (this.conn && this.dshSession) this.conn.notify('session/cancel', { sessionId: this.dshSession })
  }

  // ---------------------------------------------------------------- dsh → UI
  private assistant(dshId: string | undefined): ChatMessage {
    if (!this.cur || (dshId && dshId !== this.curDshId)) {
      this.cur = { id: 'ds-' + (dshId ?? randomUUID()), role: 'assistant', parts: [], ts: Date.now() }
      this.curDshId = dshId
    }
    return this.cur
  }

  private publish(m: ChatMessage): void {
    this.emit({ type: 'message-final', sessionId: this.meta.id, message: { ...m, parts: m.parts.slice() } })
  }

  private onUpdate(n: acp.SessionNotification): void {
    if (n.sessionId !== this.dshSession) return
    const u = n.update
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        if (u.content.type !== 'text' || !u.content.text) return
        const kind = u.sessionUpdate === 'agent_message_chunk' ? 'text' : 'thinking'
        const m = this.assistant(u.messageId ?? undefined)
        const last = m.parts[m.parts.length - 1]
        if (last && last.kind === kind) m.parts[m.parts.length - 1] = { kind, text: last.text + u.content.text }
        else m.parts.push({ kind, text: u.content.text })
        this.publish(m)
        return
      }
      case 'tool_call': {
        const m = this.assistant(undefined)
        const t = displayTool(u.title, u.rawInput)
        const part: ContentPart = { kind: 'tool', toolUseId: u.toolCallId, name: t.name, input: t.input, done: false }
        const i = m.parts.findIndex((p) => p.kind === 'tool' && p.toolUseId === u.toolCallId)
        if (i >= 0) m.parts[i] = part
        else m.parts.push(part)
        this.toolMsg.set(u.toolCallId, m)
        this.publish(m)
        // text after a tool goes into a new message, as in Claude chats
        this.curDshId = '\u0000after-tool'
        if (u.status === 'completed' || u.status === 'failed') this.toolDone(u.toolCallId, u.status, u.content)
        return
      }
      case 'tool_call_update': {
        const m = this.toolMsg.get(u.toolCallId)
        if (m && (u.rawInput !== undefined || u.title)) {
          const i = m.parts.findIndex((p) => p.kind === 'tool' && p.toolUseId === u.toolCallId)
          if (i >= 0) {
            const old = m.parts[i] as Extract<ContentPart, { kind: 'tool' }>
            const t = displayTool(u.title ?? undefined, u.rawInput ?? old.input)
            m.parts[i] = { ...old, name: u.title ? t.name : old.name, input: t.input }
            this.publish(m)
          }
        }
        if (u.status === 'completed' || u.status === 'failed') this.toolDone(u.toolCallId, u.status, u.content)
        return
      }
      case 'usage_update':
        if (u.size > 0)
          this.emitRaw({ type: 'context', sessionId: this.meta.id, usage: { percentage: Math.round((u.used / u.size) * 100), totalTokens: u.used, maxTokens: u.size, categories: [] } })
        return
      case 'config_option_update':
        this.setConfig(u.configOptions)
        return
      default:
        return
    }
  }

  private toolDone(id: string, status: 'completed' | 'failed', content: acp.ToolCallContent[] | null | undefined): void {
    const out = toolOutput(content)
    this.emit({ type: 'tool-result', sessionId: this.meta.id, toolUseId: id, result: out.text, isError: status === 'failed', patch: out.patch })
  }

  // ---------------------------------------------------------------- permissions
  private async onRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== 'session/request_permission') throw new Error(`LocalClaude doesn’t handle ${method}`)
    const p = params as acp.RequestPermissionRequest
    const known = this.toolMsg.get(p.toolCall.toolCallId)?.parts.find((x) => x.kind === 'tool' && x.toolUseId === p.toolCall.toolCallId) as
      | Extract<ContentPart, { kind: 'tool' }>
      | undefined
    const t = p.toolCall.title || p.toolCall.rawInput ? displayTool(p.toolCall.title ?? undefined, p.toolCall.rawInput) : { name: known?.name ?? 'tool', input: (known?.input as Record<string, unknown>) ?? {} }
    const requestId = randomUUID()
    const wider = typeof t.input.sandbox_permissions === 'string' ? t.input.sandbox_permissions : ''
    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      this.pending.set(requestId, { resolve, options: p.options })
      this.emitRaw({
        type: 'permission',
        request: {
          requestId,
          sessionId: this.meta.id,
          toolName: t.name,
          input: t.input,
          title: `Allow DeepSeek Harness to use ${t.name}?`,
          decisionReason: wider
            ? `DeepSeek Harness wants to step outside its sandbox (${wider})${t.input.justification ? ': ' + String(t.input.justification) : '.'}`
            : undefined,
          hasSuggestions: p.options.some((o) => o.kind === 'allow_always')
        }
      })
    })
  }

  respondPermission(requestId: string, d: PermissionDecision & { switchMode?: PermissionModeUI }): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.pending.delete(requestId)
    const pick = (kinds: acp.PermissionOptionKind[]): string | undefined => kinds.map((k) => p.options.find((o) => o.kind === k)?.optionId).find(Boolean)
    const optionId = d.behavior === 'allow' ? pick(d.always ? ['allow_always', 'allow_once'] : ['allow_once', 'allow_always']) : pick(['reject_once', 'reject_always'])
    p.resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
    if (d.switchMode) void this.setPermissionMode(d.switchMode)
  }

  private cancelAllPermissions(): void {
    for (const [id, p] of this.pending) {
      p.resolve({ outcome: { outcome: 'cancelled' } })
      this.emitRaw({ type: 'permission-cancel', requestId: id })
    }
    this.pending.clear()
  }

  // ---------------------------------------------------------------- settings of the chat
  async setPermissionMode(mode: PermissionModeUI): Promise<void> {
    this.touchMeta({ permissionMode: mode })
    // dsh takes its sandbox mode when it starts: restart (the session resumes)
    if (this.conn && dshPermissionMode(mode) !== this.startedMode) this.restartSoon()
  }

  async setModel(model: string): Promise<void> {
    this.touchMeta({ model })
    if (this.conn && this.dshSession && !this.running) await this.syncConfig(this.dshSession)
  }

  setAdditionalDirs(dirs: string[]): void {
    // dsh has no extra directories over ACP; kept so switching back to Claude Code keeps them
    this.touchMeta({ additionalDirs: dirs })
  }

  setStyle(style: string): void {
    this.touchMeta({ style })
  }

  restartIfIdle(): void {
    if (this.conn && !this.running) this.shutdown()
  }

  restartSoon(): void {
    if (!this.conn) return
    if (this.running) this.restartAfterTurn = true
    else this.shutdown()
  }

  private maybeNameChat(): void {
    if (this.meta.titleSource !== 'auto' || !this.deps.titleFor || this.titleAttempts >= 2 || !this.settings().autoTitles) return
    const firstUser = this.history.find((m) => m.role === 'user')
    const firstReply = this.history.find((m) => m.role === 'assistant' && m.parts.some((p) => p.kind === 'text' && p.text.trim()))
    const userText = firstUser?.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('').trim() ?? ''
    if (!userText || !firstReply) return
    this.titleAttempts++
    const replyText = firstReply.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('')
    void this.deps
      .titleFor(userText, replyText)
      .then((title) => {
        if (title && this.meta.titleSource === 'auto') this.touchMeta({ title, titleSource: 'ai' })
      })
      .catch(() => {})
  }

  // ---------------------------------------------------------------- what dsh can't do over ACP
  async rewindPreview(_messageId: string): Promise<RewindPreview> {
    return { canRewind: false, error: 'Rewind isn’t available in DeepSeek Harness chats yet.' }
  }
  async rewind(_req: RewindRequest): Promise<{ ok: boolean; error?: string; text?: string; filesChanged?: number }> {
    return { ok: false, error: 'Rewind isn’t available in DeepSeek Harness chats yet.' }
  }
  async toggleMcp(_name: string, _enabled: boolean): Promise<void> {}
  async reconnectMcp(_name: string): Promise<void> {}
  refreshMcp(): void {}
}
