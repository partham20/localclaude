// Skills and plugins: what Claude Code would load from ~/.claude (or CLAUDE_CONFIG_DIR), the default folder's
// .claude/skills and installed plugins, and the `claude plugin` commands that install and switch them.
import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { AppSettings, McpServerEntry } from '../shared/types'
import {
  formatSkillMd,
  parseSkillMd,
  skillNameError,
  type AvailablePlugin,
  type ClaudeCodeMcpServer,
  type InstalledPlugin,
  type Marketplace,
  type PluginAction,
  type PluginActionResult,
  type PluginState,
  type SkillDraft,
  type SkillInfo
} from '../shared/extensions'
import { resolveClaudeBinary, subscriptionEnv } from './claude'
import { readZip } from './zip'

/** ~/.claude, or CLAUDE_CONFIG_DIR when that's set (Claude Code does the same). */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}
const userSkillsDir = (): string => join(claudeDir(), 'skills')
/** A folder's own .claude/skills; none for your home folder, whose .claude is your user config, not a project's. */
function projectSkillsDir(cwd: string | undefined): string | undefined {
  if (!cwd || resolve(cwd) === resolve(homedir())) return undefined
  const dir = join(cwd, '.claude', 'skills')
  return resolve(dir) === resolve(userSkillsDir()) ? undefined : dir
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const listDir = (p: string): string[] => {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

/** The skill folders (with a SKILL.md) directly inside `root`. */
function skillDirs(root: string): { dir: string; file: string }[] {
  return listDir(root)
    .filter((n) => !n.startsWith('.'))
    .map((n) => ({ dir: join(root, n), file: join(root, n, 'SKILL.md') }))
    .filter((x) => existsSync(x.file))
}

function readSkill(file: string): { name?: string; description?: string } {
  try {
    const p = parseSkillMd(readFileSync(file, 'utf8'))
    return { name: p.name, description: p.description }
  } catch {
    return {}
  }
}

// ---------- plugins, from disk ----------

interface InstalledRecord {
  scope?: string
  installPath: string
  version?: string
  projectPath?: string
}

/** Installed plugins as Claude Code records them, and whether your user settings switch them on. */
export function installedPlugins(): InstalledPlugin[] {
  const file = readJson<{ plugins?: Record<string, InstalledRecord[]> }>(join(claudeDir(), 'plugins', 'installed_plugins.json'))
  const enabled = readJson<{ enabledPlugins?: Record<string, boolean> }>(join(claudeDir(), 'settings.json'))?.enabledPlugins ?? {}
  const out: InstalledPlugin[] = []
  for (const [id, records] of Object.entries(file?.plugins ?? {})) {
    // user-scope installs are the ones every chat gets; a project install is that folder's business
    const r = (records ?? []).find((x) => !x.scope || x.scope === 'user') ?? records?.[0]
    if (!r?.installPath) continue
    const at = id.lastIndexOf('@')
    const name = at > 0 ? id.slice(0, at) : id
    const manifest =
      readJson<{ description?: string; version?: string; mcpServers?: unknown }>(join(r.installPath, '.claude-plugin', 'plugin.json')) ?? {}
    const mcp = pluginMcpServers(r.installPath, manifest.mcpServers)
    out.push({
      id,
      name,
      marketplace: at > 0 ? id.slice(at + 1) : '',
      version: r.version ?? manifest.version,
      enabled: enabled[id] !== false,
      installPath: r.installPath,
      description: manifest.description,
      skills: skillDirs(join(r.installPath, 'skills')).map((s) => readSkill(s.file).name ?? basename(s.dir)),
      commands: listDir(join(r.installPath, 'commands'))
        .filter((n) => n.endsWith('.md'))
        .map((n) => n.slice(0, -3)),
      agents: listDir(join(r.installPath, 'agents'))
        .filter((n) => n.endsWith('.md'))
        .map((n) => n.slice(0, -3)),
      mcpServers: Object.keys(mcp),
      hooks: existsSync(join(r.installPath, 'hooks', 'hooks.json'))
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** A plugin's MCP servers (its .mcp.json, or mcpServers in its manifest), with ${CLAUDE_PLUGIN_ROOT} filled in. */
export function pluginMcpServers(installPath: string, fromManifest?: unknown): Record<string, McpServerEntry> {
  let raw: unknown = fromManifest
  if (typeof raw === 'string') raw = readJson(resolve(installPath, raw))
  if (!raw || typeof raw !== 'object') raw = readJson(join(installPath, '.mcp.json'))
  const obj = (raw as { mcpServers?: Record<string, unknown> } | undefined)?.mcpServers ?? (raw as Record<string, unknown> | undefined) ?? {}
  const fill = (v: unknown): unknown =>
    typeof v === 'string'
      ? v.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, installPath)
      : Array.isArray(v)
        ? v.map(fill)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
          : v
  const out: Record<string, McpServerEntry> = {}
  for (const [name, cfg] of Object.entries(obj)) {
    if (cfg && typeof cfg === 'object' && ('command' in cfg || 'url' in cfg)) out[name] = fill(cfg) as McpServerEntry
  }
  return out
}

// ---------- skills ----------

/** Every skill a chat in the default folder would see, and whether it's switched off here. */
export function listSkills(settings: Pick<AppSettings, 'defaultCwd' | 'disabledSkills' | 'loadUserSettings' | 'loadProjectSettings'>): SkillInfo[] {
  const off = new Set(settings.disabledSkills ?? [])
  const out: SkillInfo[] = []
  const add = (source: SkillInfo['source'], root: string, plugin?: InstalledPlugin): void => {
    for (const { dir, file } of skillDirs(root)) {
      const m = readSkill(file)
      const name = m.name || basename(dir)
      const id = plugin ? `${plugin.name}:${name}` : name
      out.push({ id, name, description: m.description ?? '', source, plugin: plugin?.id, dir, file, enabled: !off.has(id), editable: !plugin })
    }
  }
  add('user', userSkillsDir())
  const project = projectSkillsDir(settings.defaultCwd)
  if (project) add('project', project)
  for (const p of installedPlugins()) if (p.enabled) add('plugin', join(p.installPath, 'skills'), p)
  return out
}

/** The skills a chat in `cwd` loads, given which settings it reads: what DeepSeek chats are told about. */
export function skillsForChat(settings: AppSettings, cwd: string): SkillInfo[] {
  const all = listSkills({ ...settings, defaultCwd: cwd })
  return all.filter(
    (s) => s.enabled && (s.source === 'project' ? settings.loadProjectSettings : settings.loadUserSettings)
  )
}

/** Claude Code's skillOverrides that hide the skills switched off in LocalClaude. */
export function skillOverrides(settings: Pick<AppSettings, 'disabledSkills'>): Record<string, 'off'> | undefined {
  const off = settings.disabledSkills ?? []
  return off.length ? Object.fromEntries(off.map((n) => [n, 'off' as const])) : undefined
}

/** Your skills and the default folder's: the only places a skill may be written or deleted. */
function editableRoots(settings: Pick<AppSettings, 'defaultCwd'>): string[] {
  const project = projectSkillsDir(settings.defaultCwd)
  return [userSkillsDir(), ...(project ? [project] : [])].map((p) => resolve(p))
}
function insideEditable(dir: string, settings: Pick<AppSettings, 'defaultCwd'>): boolean {
  const d = resolve(dir)
  return editableRoots(settings).some((root) => dirname(d) === root)
}

export function readSkillFile(dir: string): SkillDraft & { meta: Record<string, string> } {
  const p = parseSkillMd(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
  return { name: p.name ?? basename(dir), description: p.description ?? '', body: p.body, dir, meta: p.meta }
}

/** Create a skill in ~/.claude/skills, or save one you're editing (renaming its folder with it). */
export function saveSkill(d: SkillDraft, settings: Pick<AppSettings, 'defaultCwd'>): { ok: true; dir: string } | { ok: false; error: string } {
  const name = d.name.trim()
  const bad = skillNameError(name)
  if (bad) return { ok: false, error: bad }
  if (!d.description.trim()) return { ok: false, error: 'Say what the skill is for and when Claude should use it.' }
  let meta: Record<string, string> = {}
  let dir: string
  if (d.dir) {
    if (!insideEditable(d.dir, settings)) return { ok: false, error: 'That skill can’t be edited here.' }
    meta = existsSync(join(d.dir, 'SKILL.md')) ? parseSkillMd(readFileSync(join(d.dir, 'SKILL.md'), 'utf8')).meta : {}
    dir = d.dir
    const renamed = join(dirname(d.dir), name)
    if (basename(d.dir) !== name) {
      if (existsSync(renamed)) return { ok: false, error: `There’s already a skill called “${name}”.` }
      renameSync(d.dir, renamed)
      dir = renamed
    }
  } else {
    dir = join(userSkillsDir(), name)
    if (existsSync(dir)) return { ok: false, error: `There’s already a skill called “${name}”.` }
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(join(dir, 'SKILL.md'), formatSkillMd({ name, description: d.description, body: d.body }, meta))
  return { ok: true, dir }
}

/** Move one of your skills to the trash (the system's, so it can be restored). */
export async function deleteSkill(dir: string, settings: Pick<AppSettings, 'defaultCwd'>): Promise<{ ok: boolean; error?: string }> {
  if (!insideEditable(dir, settings) || !existsSync(join(dir, 'SKILL.md'))) return { ok: false, error: 'That skill can’t be deleted here.' }
  try {
    await shell.trashItem(dir)
  } catch {
    // no trash on this system (some Linux setups): delete it
    rmSync(dir, { recursive: true, force: true })
  }
  return { ok: true }
}

/**
 * Add a skill from a folder with a SKILL.md, or a .zip / .skill file holding one, to ~/.claude/skills.
 * The SKILL.md may sit at the top or inside one folder.
 */
export function importSkill(from: string, replace = false): { ok: true; name: string } | { ok: false; error: string; exists?: string } {
  let files: { name: string; data: Buffer }[] = []
  if (isDir(from)) {
    const root = existsSync(join(from, 'SKILL.md')) ? from : skillDirs(from)[0]?.dir
    if (!root) return { ok: false, error: 'There’s no SKILL.md in that folder.' }
    const md = readSkill(join(root, 'SKILL.md'))
    const name = (md.name || basename(root)).trim()
    if (skillNameError(name)) return { ok: false, error: `“${name}” isn’t a name Claude Code accepts for a skill.` }
    const dest = join(userSkillsDir(), name)
    if (resolve(dest) === resolve(root)) return { ok: true, name }
    if (existsSync(dest) && !replace) return { ok: false, error: `You already have a skill called “${name}”.`, exists: name }
    mkdirSync(userSkillsDir(), { recursive: true })
    cpSync(root, dest, { recursive: true, force: true })
    return { ok: true, name }
  }
  try {
    files = readZip(readFileSync(from), 50 * 1024 * 1024)
  } catch (e) {
    return { ok: false, error: `Couldn’t open that file: ${e instanceof Error ? e.message : String(e)}` }
  }
  const mds = files.map((f) => f.name.replace(/\\/g, '/')).filter((n) => n === 'SKILL.md' || n.endsWith('/SKILL.md'))
  mds.sort((a, b) => a.split('/').length - b.split('/').length)
  if (!mds[0]) return { ok: false, error: 'There’s no SKILL.md in that file.' }
  const prefix = mds[0].slice(0, -'SKILL.md'.length)
  const md = parseSkillMd(files.find((f) => f.name.replace(/\\/g, '/') === mds[0])!.data.toString('utf8'))
  const name = (md.name || basename(prefix.replace(/\/$/, '')) || basename(from).replace(/\.(zip|skill)$/i, '')).trim()
  if (skillNameError(name)) return { ok: false, error: `“${name}” isn’t a name Claude Code accepts for a skill.` }
  const dest = join(userSkillsDir(), name)
  if (existsSync(dest) && !replace) return { ok: false, error: `You already have a skill called “${name}”.`, exists: name }
  for (const f of files) {
    const n = f.name.replace(/\\/g, '/')
    if (!n.startsWith(prefix) || n.endsWith('/')) continue
    const target = resolve(dest, n.slice(prefix.length))
    // nothing outside the skill's folder (a zip can name ../ paths)
    if (!target.startsWith(resolve(dest) + sep)) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, f.data)
  }
  return { ok: true, name }
}

/** For DeepSeek chats, which have no skills of their own: what each skill is for and where its instructions are. */
export function skillsPreamble(skills: SkillInfo[]): string {
  if (!skills.length) return ''
  const list = skills
    .slice(0, 60)
    .map((s) => `- ${s.id}: ${s.description || '(no description)'} — ${s.file}`)
    .join('\n')
  return `Skills you can use. Each is a folder of instructions (and sometimes scripts). When a request matches one, read its SKILL.md first and follow it; paths inside it are relative to its folder.\n${list}`
}

// ---------- plugins, through `claude plugin` ----------

function runClaude(args: string[], timeoutMs = 180_000): Promise<{ code: number; out: string; err: string }> {
  const bin = resolveClaudeBinary()
  if (!bin) return Promise.resolve({ code: -1, out: '', err: 'Claude Code isn’t installed with LocalClaude.' })
  return new Promise((done) => {
    const child = spawn(bin, args, { env: { ...subscriptionEnv(), CI: '1', NO_COLOR: '1' }, cwd: homedir(), windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.stdin.end()
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ code: -1, out, err: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code: code ?? -1, out, err })
    })
  })
}

const clean = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[√×✔✘]\s*/g, '')
    .trim()

function parseJson<T>(out: string): T | undefined {
  const i = out.search(/[[{]/)
  if (i < 0) return undefined
  try {
    return JSON.parse(out.slice(i)) as T
  } catch {
    return undefined
  }
}

export async function pluginState(): Promise<PluginState> {
  const installed = installedPlugins()
  const r = await runClaude(['plugin', 'marketplace', 'list', '--json'], 60_000)
  const list = parseJson<{ name: string; source?: string; repo?: string; url?: string; path?: string; installLocation?: string }[]>(r.out)
  if (!list) return { installed, marketplaces: [], error: clean(r.err || r.out) || 'Claude Code didn’t list your marketplaces.' }
  const marketplaces: Marketplace[] = list.map((m) => ({ name: m.name, source: m.source ?? '', location: m.repo ?? m.url ?? m.path ?? m.installLocation ?? '' }))
  return { installed, marketplaces }
}

/** Every plugin your marketplaces offer (Claude Code's own directory included); can take a moment the first time. */
export async function availablePlugins(): Promise<{ plugins: AvailablePlugin[]; error?: string }> {
  const r = await runClaude(['plugin', 'list', '--available', '--json'], 120_000)
  const parsed = parseJson<{ available?: { pluginId: string; name: string; description?: string; marketplaceName: string; version?: string }[] }>(r.out)
  if (!parsed) return { plugins: [], error: clean(r.err || r.out) || 'Claude Code didn’t list the plugins.' }
  return {
    plugins: (parsed.available ?? []).map((p) => ({ id: p.pluginId, name: p.name, marketplace: p.marketplaceName, description: p.description, version: p.version }))
  }
}

export async function pluginAction(a: PluginAction): Promise<PluginActionResult> {
  const id = 'id' in a ? a.id : ''
  if ('id' in a && !/^[\w.:-]+@[\w.:-]+$/.test(id)) return { ok: false, message: 'That isn’t a plugin id (name@marketplace).' }
  const args =
    a.kind === 'install'
      ? ['plugin', 'install', id]
      : a.kind === 'uninstall'
        ? ['plugin', 'uninstall', id]
        : a.kind === 'enable'
          ? ['plugin', 'enable', id]
          : a.kind === 'disable'
            ? ['plugin', 'disable', id]
            : a.kind === 'update'
              ? ['plugin', 'update', id]
              : a.kind === 'addMarketplace'
                ? ['plugin', 'marketplace', 'add', a.source.trim()]
                : a.kind === 'removeMarketplace'
                  ? ['plugin', 'marketplace', 'remove', a.name]
                  : ['plugin', 'marketplace', 'update', ...(a.name ? [a.name] : [])]
  if (a.kind === 'addMarketplace' && !a.source.trim()) return { ok: false, message: 'Paste a GitHub repo (owner/repo), a git URL, or a folder.' }
  if (args.some((x) => x.startsWith('-'))) return { ok: false, message: 'That doesn’t look right.' }
  const r = await runClaude(args)
  const message = clean(r.code === 0 ? r.out || r.err : r.err || r.out) || (r.code === 0 ? 'Done.' : `Claude Code stopped (exit ${r.code}).`)
  return { ok: r.code === 0, message: message.split('\n').slice(-6).join('\n') }
}

/** MCP servers that enabled plugins bring, for DeepSeek chats (Claude Code starts them itself). */
export function enabledPluginMcpServers(): Record<string, McpServerEntry> {
  const out: Record<string, McpServerEntry> = {}
  for (const p of installedPlugins()) {
    if (!p.enabled) continue
    const manifest = readJson<{ mcpServers?: unknown }>(join(p.installPath, '.claude-plugin', 'plugin.json')) ?? {}
    for (const [name, cfg] of Object.entries(pluginMcpServers(p.installPath, manifest.mcpServers))) out[`${p.name}-${name}`] = cfg
  }
  return out
}

/** MCP servers in Claude Code's own config: ~/.claude.json (yours, and the default folder's) and the folder's .mcp.json. */
export function claudeCodeMcpServers(settings: Pick<AppSettings, 'defaultCwd' | 'mcpServers'>): ClaudeCodeMcpServer[] {
  const file = process.env.LOCALCLAUDE_CLAUDE_CONFIG || join(process.env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json')
  const cfg = readJson<{ mcpServers?: Record<string, McpServerEntry>; projects?: Record<string, { mcpServers?: Record<string, McpServerEntry> }> }>(file) ?? {}
  const cwd = settings.defaultCwd ? resolve(settings.defaultCwd) : ''
  const local = cwd ? Object.entries(cfg.projects ?? {}).find(([k]) => resolve(k) === cwd)?.[1]?.mcpServers : undefined
  const project = cwd ? readJson<{ mcpServers?: Record<string, McpServerEntry> }>(join(cwd, '.mcp.json'))?.mcpServers : undefined
  const out: ClaudeCodeMcpServer[] = []
  const add = (scope: ClaudeCodeMcpServer['scope'], servers: Record<string, McpServerEntry> | undefined): void => {
    for (const [name, e] of Object.entries(servers ?? {})) {
      if (!e || typeof e !== 'object' || (!e.command && !e.url) || out.some((x) => x.name === name)) continue
      const type = e.type === 'http' || e.type === 'sse' ? e.type : e.url ? 'http' : 'stdio'
      const entry: McpServerEntry =
        type === 'stdio'
          ? { type, command: e.command, args: e.args ?? [], ...(e.env ? { env: e.env } : {}) }
          : { type, url: e.url, ...(e.headers ? { headers: e.headers } : {}) }
      out.push({ name, scope, entry, exists: !!settings.mcpServers[name] })
    }
  }
  add('local', local)
  add('project', project)
  add('user', cfg.mcpServers)
  return out
}
