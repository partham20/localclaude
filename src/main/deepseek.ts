// DeepSeek Harness (dsh) as a chat engine. dsh runs as a child process in its ACP mode
// (`dsh --profile acp`, Agent Client Protocol: JSON-RPC over stdio), one process per open chat,
// and its updates are translated into the same UI events Claude Code chats use.
//
// dsh needs Node 24.9+, which Electron itself ships, so when dsh's entry file can be found it runs
// on LocalClaude's own runtime (ELECTRON_RUN_AS_NODE) and no separate Node is needed to run it.
import { app } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DSH_PACKAGE, type DeepSeekInstallEvent, type DeepSeekStatus } from '../shared/deepseek'
import type { AgentEvent, AppSettings, PermissionModeUI, SessionMeta } from '../shared/types'
import { AcpSession, toolOutput, type AcpDeps, type AcpEngine } from './acpEngine'
import { log } from './log'
import type { SecureStore } from './store'

export { toolOutput }

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

export function onPath(cmd: string): string | null {
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

// ---------------------------------------------------------------- dsh as an ACP engine
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

export const deepseekEngine: AcpEngine = {
  engine: 'deepseek',
  label: 'DeepSeek Harness',
  idPrefix: 'ds-',
  tag: 'dsh',
  images: false,
  skillsInPreamble: true,
  launch({ settings, meta, store }) {
    const launch = findDsh(settings)
    if (!launch) throw new Error('DeepSeek Harness isn’t installed. Install it in Settings → DeepSeek (or run npm i -g @deepseek-ai/dsh), then send your message again.')
    const key = process.env.DEEPSEEK_API_KEY?.trim() || store.getDeepSeekKey()
    if (!key) throw new Error('Add your DeepSeek API key in Settings → DeepSeek first. You can create one at platform.deepseek.com.')
    const mode = dshPermissionMode(meta.permissionMode)
    const env: Record<string, string | undefined> = { ...process.env, DEEPSEEK_API_KEY: key, DSH_PERMISSION_MODE: mode }
    if (launch.asNode) env.ELECTRON_RUN_AS_NODE = '1'
    else delete env.ELECTRON_RUN_AS_NODE
    return {
      bin: launch.bin,
      args: [...launch.args, '--profile', 'acp'],
      env,
      // a dsh.cmd shim on Windows needs a shell
      shell: process.platform === 'win32' && !launch.asNode && /\.(cmd|bat)$/i.test(launch.bin),
      version: launch.version,
      describe: `${launch.via}, ${mode}`
    }
  },
  // dsh takes its sandbox mode when it starts
  restartKey: (meta) => dshPermissionMode(meta.permissionMode),
  friendly,
  tool: (_name, title, rawInput) => displayTool(title, rawInput),
  config: (_meta, s) => [['reasoning_effort', s.deepseekEffort]],
  permissionReason(input) {
    const wider = typeof input.sandbox_permissions === 'string' ? input.sandbox_permissions : ''
    return wider ? `DeepSeek Harness wants to step outside its sandbox (${wider})${input.justification ? ': ' + String(input.justification) : '.'}` : undefined
  }
}

export type DeepSeekDeps = AcpDeps

/** One chat on DeepSeek Harness. */
export class DeepSeekSession extends AcpSession {
  constructor(meta: SessionMeta, store: SecureStore, emit: (e: AgentEvent) => void, settings: () => AppSettings, deps: DeepSeekDeps) {
    super(deepseekEngine, meta, store, emit, settings, deps)
  }
}
