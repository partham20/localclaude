// Chat engines that speak ACP (Agent Client Protocol: JSON-RPC over stdio), one child process per
// open chat: DeepSeek Harness (`dsh --profile acp`) and OpenCode (`opencode acp`). Their updates are
// translated into the same UI events Claude Code chats use. What differs between them (how they're
// found and started, their tool names, permission modes, errors) is an AcpEngine.
import type * as acp from '@agentclientprotocol/sdk'
import { skillsForChat, skillsPreamble, enabledPluginMcpServers } from './extensions'
import { withMcpAuth } from './mcpAuth'
import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { applyEvent } from '../shared/reducer'
import type {
  AgentEvent,
  AppSettings,
  ChatMessage,
  ContentPart,
  DiffHunk,
  Engine,
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
export type ModelOption = { value: string; displayName: string; description: string }

/** How one ACP engine is started and how its tools look. */
export interface AcpLaunch {
  bin: string
  args: string[]
  env: Record<string, string | undefined>
  /** a .cmd shim on Windows needs a shell */
  shell?: boolean
  version?: string
  /** shown in the log: where it came from */
  describe: string
}

export interface AcpEngine {
  engine: Exclude<Engine, 'claude'>
  /** DeepSeek Harness, OpenCode */
  label: string
  /** prefix of the message ids made from its updates */
  idPrefix: string
  /** in the log and in errors: dsh, opencode */
  tag: string
  /** How to start it for this chat. Throws an Error with a message for the user when it can't. */
  launch(ctx: { settings: AppSettings; meta: SessionMeta; store: SecureStore }): AcpLaunch
  /** When this changes (say, the chat's permission mode) the process restarts and the session resumes. */
  restartKey(meta: SessionMeta, settings: AppSettings): string
  /** An error, with what to do about it in front. */
  friendly(text: string): string
  /** Its tool, shown with Claude Code's name and input shape where there is one, so it gets the same card. */
  tool(name: string | undefined, title: string | undefined, rawInput: unknown): { name: string; input: Record<string, unknown> }
  /** it takes images in prompts */
  images: boolean
  /** it has no skills of its own: tell it what yours are for and where they are */
  skillsInPreamble: boolean
  /** SSE MCP servers are passed (neither does yet) */
  sse?: boolean
  /** Config options to set before a prompt, besides the model (applied when it has that option). */
  config(meta: SessionMeta, settings: AppSettings): [string, string][]
  /** Why a permission request is unusual, if it is. */
  permissionReason?(input: Record<string, unknown>): string | undefined
}

// ---------------------------------------------------------------- ACP over stdio
/** A tiny JSON-RPC 2.0 client over newline-delimited JSON, enough for ACP's client side. */
export class AcpConnection {
  private nextId = 1
  private waits = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private stderr = ''
  exited = false

  constructor(
    private proc: ChildProcessWithoutNullStreams,
    private tag: string,
    private onNotification: (method: string, params: unknown) => void,
    private onRequest: (method: string, params: unknown) => Promise<unknown>,
    private onExit: (detail: string) => void
  ) {
    createInterface({ input: proc.stdout, crlfDelay: Infinity }).on('line', (line) => this.receive(line))
    proc.stderr.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000)
      if (process.env.LOCALCLAUDE_DEBUG) console.error(`[${tag}]`, d.toString())
    })
    proc.on('error', (e) => this.fail(String(e)))
    proc.on('exit', (code, signal) => this.fail(`${tag} stopped (${signal ?? code})`))
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
      if (m.error) {
        const data = m.error.data && typeof m.error.data === 'object' ? JSON.stringify(m.error.data) : ''
        w.reject(new Error([m.error.message || `${this.tag} returned an error`, data && data !== '{}' ? data : ''].filter(Boolean).join(' ')))
      } else w.resolve(m.result)
    }
  }

  private write(msg: unknown): void {
    if (!this.exited) this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.exited) return Promise.reject(new Error(`${this.tag} isn’t running`))
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
    // give it a moment to save the session, then make sure it's gone
    setTimeout(() => {
      if (!this.exited) this.proc.kill()
    }, 1500).unref()
  }
}

/** A tool's output as text, and a diff when the engine reports one. */
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

// ---------------------------------------------------------------- the session
interface Pending {
  resolve: (r: acp.RequestPermissionResponse) => void
  options: acp.PermissionOption[]
}

export interface AcpDeps {
  titleFor?: (firstUser: string, firstReply: string) => Promise<string | null>
  /** the engine's model list from a running session, for the model menu */
  onModels: (models: ModelOption[]) => void
}

/** One chat on an ACP engine. Same surface as a Claude Code chat, so the session manager can hold either. */
export class AcpSession {
  history: ChatMessage[]
  running = false
  private conn?: AcpConnection
  private starting?: Promise<string>
  /** the engine's id for this chat's session while the process runs */
  private acpSession?: string
  private config: acp.SessionConfigOption[] = []
  private pending = new Map<string, Pending>()
  /** prompts wait for the one before (one at a time per session) */
  private chain: Promise<void> = Promise.resolve()
  private queued = 0
  private interrupted = false
  private restartAfterTurn = false
  private startedKey?: string
  private saveTimer?: NodeJS.Timeout
  private titleAttempts = 0
  /** a "retrying" note was shown this turn */
  private retryShown = false
  /** the assistant message being built from the engine's updates in this turn */
  private cur?: ChatMessage
  private curAcpId?: string
  /** tool call id → the message holding it, and the engine's own name for the tool */
  private toolMsg = new Map<string, ChatMessage>()
  private toolRaw = new Map<string, string>()

  constructor(
    readonly spec: AcpEngine,
    public meta: SessionMeta,
    private store: SecureStore,
    private emitRaw: Emit,
    private settings: () => AppSettings,
    private deps: AcpDeps
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
  private mcpServers(): (acp.McpServerStdio | (acp.McpServerHttp & { type: 'http' }) | (acp.McpServerSse & { type: 'sse' }))[] {
    const out: (acp.McpServerStdio | (acp.McpServerHttp & { type: 'http' }) | (acp.McpServerSse & { type: 'sse' }))[] = []
    const s = this.settings()
    // your servers, then the ones enabled plugins bring (Claude Code chats get those from Claude Code itself)
    const servers = { ...(s.loadUserSettings ? enabledPluginMcpServers() : {}), ...s.mcpServers }
    for (const [name, raw] of Object.entries(servers)) {
      if (raw.enabled === false) continue
      const cfg = withMcpAuth(this.store, raw)
      const headers = Object.entries(cfg.headers ?? {}).map(([n, value]) => ({ name: n, value }))
      if (cfg.type === 'http' && cfg.url) out.push({ type: 'http', name, url: cfg.url, headers })
      else if (cfg.type === 'sse' && cfg.url && this.spec.sse) out.push({ type: 'sse', name, url: cfg.url, headers })
      else if ((!cfg.type || cfg.type === 'stdio') && cfg.command)
        out.push({ name, command: cfg.command, args: cfg.args ?? [], env: Object.entries(cfg.env ?? {}).map(([n, value]) => ({ name: n, value })) })
    }
    return out
  }

  /** Start the engine and open (or resume) this chat's session. Resolves to its session id. */
  private ensureStarted(): Promise<string> {
    if (this.conn && !this.conn.exited && this.acpSession) return Promise.resolve(this.acpSession)
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => (this.starting = undefined))
    return this.starting
  }

  private async start(): Promise<string> {
    const s = this.settings()
    const spec = this.spec
    const launch = spec.launch({ settings: s, meta: this.meta, store: this.store })
    const key = spec.restartKey(this.meta, s)
    log('info', `starting ${spec.label} (${launch.describe}${launch.version ? ' ' + launch.version : ''})`)
    const proc = spawn(launch.bin, launch.args, { cwd: this.meta.cwd, env: launch.env, windowsHide: true, shell: !!launch.shell })
    const conn = new AcpConnection(
      proc,
      spec.tag,
      (method, params) => {
        if (method === 'session/update') this.onUpdate(params as acp.SessionNotification)
      },
      (method, params) => this.onRequest(method, params),
      (detail) => {
        if (this.conn !== conn) return
        this.conn = undefined
        this.acpSession = undefined
        this.cancelAllPermissions()
        if (detail && !/SIGTERM|\(0\)|\(null\)/.test(detail.split('\n')[0])) log('warn', `[${spec.tag}] ${detail}`)
      }
    )
    this.conn = conn
    this.startedKey = key
    await conn.request<acp.InitializeResponse>('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'LocalClaude', version: app.getVersion() } })
    const params = { cwd: this.meta.cwd, mcpServers: this.mcpServers() }
    let sessionId: string | undefined
    if (this.meta.sdkSessionId) {
      try {
        const r = await conn.request<acp.ResumeSessionResponse>('session/resume', { ...params, sessionId: this.meta.sdkSessionId })
        sessionId = this.meta.sdkSessionId
        this.setConfig(r?.configOptions ?? [])
      } catch (e) {
        // it lost the session (its data was cleared, or another machine): carry on with the earlier messages as context
        log('warn', `${spec.label} session couldn’t be resumed: ${e instanceof Error ? e.message : e}`)
        this.touchMeta({ sdkSessionId: undefined, imported: this.history.some((m) => m.role === 'user') || undefined })
        this.system(`${spec.label} couldn’t reopen this chat’s session, so your earlier messages are sent to it as context.`)
      }
    }
    if (!sessionId) {
      const r = await conn.request<acp.NewSessionResponse>('session/new', params)
      sessionId = r.sessionId
      this.setConfig(r.configOptions ?? [])
    }
    this.acpSession = sessionId
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
        claudeCodeVersion: `${spec.label} ${launch.version ?? ''}`.trim(),
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

  private hasValue(id: string, value: string): boolean {
    const o = this.config.find((x) => x.id === id)
    if (!o || o.type !== 'select') return false
    return (o.options as (acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup)[]).some((x) => ('options' in x ? x.options.some((y) => y.value === value) : x.value === value))
  }

  /** Apply the chat's model and the engine's other settings before a prompt, when they differ from the engine's. */
  private async syncConfig(sessionId: string): Promise<void> {
    const want: [string, string][] = []
    const model = this.meta.model
    if (model && this.config.some((o) => o.id === 'model') && this.currentValue('model') !== model) want.push(['model', model])
    for (const [id, value] of this.spec.config(this.meta, this.settings()))
      if (value && this.hasValue(id, value) && this.currentValue(id) !== value) want.push([id, value])
    for (const [configId, value] of want) {
      try {
        const r = await this.conn!.request<acp.SetSessionConfigOptionResponse>('session/set_config_option', { sessionId, configId, value })
        if (r?.configOptions) this.setConfig(r.configOptions)
      } catch (e) {
        log('warn', `${this.spec.tag} rejected ${configId}=${value}: ${e instanceof Error ? e.message : e}`)
        if (configId === 'model') this.system(`${this.spec.label} couldn’t switch to ${value}, so it kept ${this.currentValue('model') || 'its model'}.`)
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
    if (conn && this.acpSession) conn.request('session/close', { sessionId: this.acpSession }).catch(() => {})
    this.acpSession = undefined
    conn?.kill()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.store.saveHistory(this.meta.id, this.history)
    }
  }

  hasProcess(): boolean {
    // plan usage is a Claude thing: never read through another engine's process
    return false
  }
  usageRaw(): never {
    throw new Error(`${this.spec.label} chats have no Claude plan usage`)
  }

  // ---------------------------------------------------------------- input
  send(p: SendPayload): void {
    // an edited or retried message sends its images again (to engines that take images)
    const images: ImageRef[] = []
    const data: string[] = []
    if (this.spec.images)
      for (const r of p.reuseImages ?? []) {
        const b = this.store.loadImage(this.meta.id, r.id)
        if (b) images.push(r), data.push(b.toString('base64'))
      }
    for (const a of p.attachments) {
      const ref = storeImage(this.store, this.meta.id, Buffer.from(a.base64, 'base64'))
      if (ref) images.push(ref), data.push(a.base64)
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
    const context = this.meta.imported && !this.meta.sdkSessionId && this.history.length ? importedContext(this.meta, this.history, this.spec.engine) : ''
    this.emit({ type: 'message-start', sessionId: this.meta.id, message: userMsg })
    if (!this.spec.images && (images.length || p.reuseImages?.length)) this.system(`${this.spec.label} can’t see images, so only your text was sent.`)
    if (/^(New chat|New design)$/.test(this.meta.title) && p.text.trim()) this.touchMeta({ title: p.text.trim().replace(/\s+/g, ' ').slice(0, 60) })
    else this.touchMeta({})
    const blocks: acp.ContentBlock[] = []
    if (context) blocks.push({ type: 'text', text: context })
    const pre = this.preamble()
    if (pre) blocks.push({ type: 'text', text: pre })
    if (p.text.trim()) blocks.push({ type: 'text', text: p.text })
    if (this.spec.images) images.forEach((ref, i) => blocks.push({ type: 'image', mimeType: ref.mediaType, data: data[i] }))
    if (!blocks.length) return
    this.queued++
    if (!this.running) this.setStatus('starting')
    this.chain = this.chain.then(() => this.runPrompt(blocks)).catch(() => {})
  }

  /** What Claude chats get in their system prompt, for a fresh session: your name, your instructions, the project's. */
  private preamble(): string {
    if (this.meta.sdkSessionId) return ''
    const s = this.settings()
    const project = this.meta.projectId ? this.store.getProject(this.meta.projectId) : undefined
    const parts = [
      s.userName?.trim() ? `The user's name is ${s.userName.trim()}.` : '',
      s.appendSystemPrompt?.trim() ?? '',
      project?.instructions?.trim() ? `Instructions for the project “${project.name}”:\n${project.instructions.trim()}` : '',
      this.spec.skillsInPreamble ? skillsPreamble(skillsForChat(s, this.meta.cwd)) : ''
    ].filter(Boolean)
    return parts.length ? `<context>\n${parts.join('\n\n')}\n</context>` : ''
  }

  private async runPrompt(prompt: acp.ContentBlock[]): Promise<void> {
    const started = Date.now()
    this.cur = undefined
    this.curAcpId = undefined
    this.retryShown = false
    let errorText: string | undefined
    let usage: { inputTokens?: number; outputTokens?: number } | undefined
    try {
      const sessionId = await this.ensureStarted()
      if (!this.meta.sdkSessionId || this.meta.sdkSessionId !== sessionId) {
        this.touchMeta({ sdkSessionId: sessionId, imported: undefined, switchedFrom: undefined })
        this.emitRaw({ type: 'sdk-session', sessionId: this.meta.id, sdkSessionId: sessionId })
      } else if (this.meta.imported) this.touchMeta({ imported: undefined, switchedFrom: undefined })
      this.setStatus('running')
      await this.syncConfig(sessionId)
      // stopped while it was still starting: don't send it
      const r = this.interrupted ? { stopReason: 'cancelled' as const } : await this.conn!.request<acp.PromptResponse>('session/prompt', { sessionId, prompt })
      usage = (r as { usage?: typeof usage }).usage ?? undefined
      if (r.stopReason === 'cancelled' || this.interrupted) this.system('Stopped.')
      else if (r.stopReason === 'refusal') errorText = `${this.spec.label} declined to continue.`
      else if (r.stopReason === 'max_tokens') this.system('The reply hit the output limit.')
    } catch (e) {
      errorText = this.interrupted ? undefined : this.spec.friendly(e instanceof Error ? e.message : String(e))
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
      stats: { costUsd: 0, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, durationMs: Date.now() - started, numTurns: 1 }
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
    if (this.conn && this.acpSession) this.conn.notify('session/cancel', { sessionId: this.acpSession })
  }

  // ---------------------------------------------------------------- engine → UI
  private assistant(acpId: string | undefined): ChatMessage {
    if (!this.cur || (acpId && acpId !== this.curAcpId)) {
      this.cur = { id: this.spec.idPrefix + (acpId ?? randomUUID()), role: 'assistant', parts: [], ts: Date.now() }
      this.curAcpId = acpId
    }
    return this.cur
  }

  private publish(m: ChatMessage): void {
    this.emit({ type: 'message-final', sessionId: this.meta.id, message: { ...m, parts: m.parts.slice() } })
  }

  private onUpdate(n: acp.SessionNotification): void {
    if (n.sessionId !== this.acpSession) return
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
        // OpenCode adds the tool's own name beside a human title
        const rawName = typeof (u as { name?: unknown }).name === 'string' ? ((u as { name?: string }).name as string) : undefined
        if (rawName) this.toolRaw.set(u.toolCallId, rawName)
        const m = this.assistant(undefined)
        const t = this.spec.tool(rawName, u.title, u.rawInput)
        const part: ContentPart = { kind: 'tool', toolUseId: u.toolCallId, name: t.name, input: t.input, done: false }
        const i = m.parts.findIndex((p) => p.kind === 'tool' && p.toolUseId === u.toolCallId)
        if (i >= 0) m.parts[i] = part
        else m.parts.push(part)
        this.toolMsg.set(u.toolCallId, m)
        this.publish(m)
        // text after a tool goes into a new message, as in Claude chats
        this.curAcpId = '\u0000after-tool'
        if (u.status === 'completed' || u.status === 'failed') this.toolDone(u.toolCallId, u.status, u.content)
        return
      }
      case 'tool_call_update': {
        const m = this.toolMsg.get(u.toolCallId)
        if (m && (u.rawInput !== undefined || u.title)) {
          const i = m.parts.findIndex((p) => p.kind === 'tool' && p.toolUseId === u.toolCallId)
          if (i >= 0) {
            const old = m.parts[i] as Extract<ContentPart, { kind: 'tool' }>
            const raw = this.toolRaw.get(u.toolCallId)
            const t = this.spec.tool(raw, u.title ?? undefined, u.rawInput ?? old.input)
            m.parts[i] = { ...old, name: raw || u.title ? t.name : old.name, input: u.rawInput !== undefined ? t.input : old.input }
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
      case 'session_info_update': {
        // OpenCode retries a failing provider by itself: say so once a turn, so a long wait isn't a mystery
        const retry = (u._meta as Record<string, { error?: { message?: string } } | null> | undefined)?.['opencode/retry']
        if (retry?.error?.message && !this.retryShown) {
          this.retryShown = true
          this.system(`${this.spec.label} is retrying after an error from the provider: ${retry.error.message}`)
        }
        return
      }
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
    const rawName = this.toolRaw.get(p.toolCall.toolCallId) ?? (typeof (p.toolCall as { name?: unknown }).name === 'string' ? (p.toolCall as { name?: string }).name : undefined)
    const t =
      p.toolCall.rawInput !== undefined || (p.toolCall.title && !known)
        ? this.spec.tool(rawName, p.toolCall.title ?? undefined, p.toolCall.rawInput ?? known?.input)
        : { name: known?.name ?? 'tool', input: (known?.input as Record<string, unknown>) ?? {} }
    const requestId = randomUUID()
    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      this.pending.set(requestId, { resolve, options: p.options })
      this.emitRaw({
        type: 'permission',
        request: {
          requestId,
          sessionId: this.meta.id,
          toolName: t.name,
          input: t.input,
          title: `Allow ${this.spec.label} to use ${t.name}?`,
          decisionReason: this.spec.permissionReason?.(t.input),
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
    // what's fixed when the engine starts changed: restart it (the session resumes)
    if (this.conn && this.spec.restartKey(this.meta, this.settings()) !== this.startedKey) this.restartSoon()
    else if (this.conn && this.acpSession && !this.running) await this.syncConfig(this.acpSession)
  }

  async setModel(model: string): Promise<void> {
    this.touchMeta({ model })
    if (this.conn && this.acpSession && !this.running) await this.syncConfig(this.acpSession)
  }

  setAdditionalDirs(dirs: string[]): void {
    // no extra directories over ACP yet; kept so switching back to Claude Code keeps them
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

  // ---------------------------------------------------------------- what these engines can't do over ACP
  async rewindPreview(_messageId: string): Promise<RewindPreview> {
    return { canRewind: false, error: `Rewind isn’t available in ${this.spec.label} chats yet.` }
  }
  async rewind(_req: RewindRequest): Promise<{ ok: boolean; error?: string; text?: string; filesChanged?: number }> {
    return { ok: false, error: `Rewind isn’t available in ${this.spec.label} chats yet.` }
  }
  async toggleMcp(_name: string, _enabled: boolean): Promise<void> {}
  async reconnectMcp(_name: string): Promise<void> {}
  refreshMcp(): void {}
}
