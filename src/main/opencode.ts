// OpenCode (https://github.com/anomalyco/opencode, MIT) as a chat engine. OpenCode runs as a child
// process in its ACP mode (`opencode acp`), one process per open chat; acpEngine.ts does the talking.
//
// OpenCode ships as one prebuilt binary per platform (npm packages @opencode/cli-<os>-<arch>). It isn't
// bundled with LocalClaude: "Download OpenCode" fetches the build for this computer from the npm
// registry the first time you want it, checks it against the registry's sha512, and unpacks it into
// LocalClaude's own folder. Nothing is installed globally.
import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { OPENCODE_NPM_SCOPE, isEnvName, type OpenCodeDownloadEvent, type OpenCodeStatus } from '../shared/opencode'
import type { AgentEvent, AppSettings, PermissionModeUI, SessionMeta } from '../shared/types'
import { AcpSession, type AcpDeps, type AcpEngine } from './acpEngine'
import { onPath } from './deepseek'
import { log } from './log'
import type { SecureStore } from './store'

const EXE = process.platform === 'win32' ? 'opencode.exe' : 'opencode'

// ---------------------------------------------------------------- which build
/** The npm package with OpenCode's binary for this computer, e.g. @opencode/cli-windows-x64. */
export function opencodePackage(platform: string = process.platform, arch: string = process.arch, musl = isMusl()): string | null {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null
  if (!os || (arch !== 'x64' && arch !== 'arm64')) return null
  return `${OPENCODE_NPM_SCOPE}-${os}-${arch}${os === 'linux' && musl ? '-musl' : ''}`
}

function isMusl(): boolean {
  if (process.platform !== 'linux') return false
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    return !report?.header?.glibcVersionRuntime
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- finding OpenCode
/** Where "Download OpenCode" puts it: LocalClaude's own folder, one subfolder per version. */
export function opencodeDir(): string {
  return join(app.getPath('userData'), 'opencode')
}

interface Current {
  version: string
  path: string
}
function current(): Current | null {
  try {
    const c = JSON.parse(readFileSync(join(opencodeDir(), 'current.json'), 'utf8')) as Current
    return c.path && existsSync(c.path) ? c : null
  } catch {
    return null
  }
}

export interface OpenCodeLaunch {
  bin: string
  args: string[]
  /** run bin as Node (bin is LocalClaude itself, args[0] is a script): only the test stand-in */
  asNode: boolean
  via: NonNullable<OpenCodeStatus['via']>
  location: string
  version?: string
}

function viaPath(p: string, via: OpenCodeLaunch['via'], version?: string): OpenCodeLaunch {
  if (/\.(c|m)?js$/i.test(p)) return { bin: process.execPath, args: [p], asNode: true, via, location: p, version }
  return { bin: p, args: [], asNode: false, via, location: p, version }
}

/** How to start OpenCode, or null when it isn't on this computer. */
export function findOpenCode(s: Pick<AppSettings, 'opencodeCommand'>): OpenCodeLaunch | null {
  // tests point this at a stand-in
  const env = process.env.LOCALCLAUDE_OPENCODE
  if (env) return viaPath(env, 'env')
  const custom = s.opencodeCommand.trim()
  if (custom) return viaPath(custom, 'custom')
  const mine = current()
  if (mine) return viaPath(mine.path, 'app', mine.version)
  // OpenCode's own installer
  const home = join(homedir(), '.opencode', 'bin', EXE)
  if (existsSync(home)) return viaPath(home, 'home')
  const cmd = onPath('opencode')
  if (cmd) return viaPath(cmd, 'path')
  return null
}

const versions = new Map<string, string | undefined>()
/** `opencode --version` for one you installed yourself (cached; LocalClaude's own download knows its version). */
function versionOf(l: OpenCodeLaunch): string | undefined {
  if (l.version || l.asNode) return l.version
  if (versions.has(l.location)) return versions.get(l.location)
  let v: string | undefined
  try {
    const r = spawnSync(l.bin, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(l.bin) })
    v = /(\d+\.\d+\.\d+[\w.-]*)/.exec(r.stdout ?? '')?.[1]
  } catch {
    v = undefined
  }
  versions.set(l.location, v)
  return v
}

let downloading = false

export function opencodeStatus(store: SecureStore, s: AppSettings): OpenCodeStatus {
  const l = findOpenCode(s)
  return {
    found: !!l,
    via: l?.via,
    location: l?.location,
    version: l ? versionOf(l) : undefined,
    platform: opencodePackage()?.replace(`${OPENCODE_NPM_SCOPE}-`, 'cli-'),
    downloading,
    keys: Object.keys(store.getOpenCodeKeys())
  }
}

// ---------------------------------------------------------------- provider keys
export function cleanOpenCodeKey(envName: string, raw: string): { env: string; key: string } | { error: string } {
  const env = envName.trim().toUpperCase()
  if (!isEnvName(env)) return { error: 'Use the environment variable’s name, like OPENAI_API_KEY (letters, digits and _).' }
  if (/^(PATH|HOME|USERPROFILE|APPDATA|NODE_OPTIONS|ELECTRON_.*|OPENCODE_CONFIG.*|LD_.*|DYLD_.*)$/.test(env)) return { error: `${env} can’t be set here.` }
  const key = raw.trim().replace(/^["']|["']$/g, '')
  if (!key) return { error: 'Paste the key.' }
  if (/\s/.test(key)) return { error: 'That doesn’t look like a key: it has spaces in it.' }
  return { env, key }
}

// ---------------------------------------------------------------- downloading OpenCode
/** The registry the binaries come from (tests point this at a local server). */
const registry = (): string => (process.env.LOCALCLAUDE_OPENCODE_REGISTRY || 'https://registry.npmjs.org').replace(/\/$/, '')

/**
 * A streaming .tar reader that writes one entry (OpenCode's binary, package/bin/opencode[.exe]) to
 * `dest`. Enough of the format for npm's tarballs: ustar headers, GNU long names and pax paths.
 */
export function tarEntryWriter(match: (path: string) => boolean, dest: string): Writable & { found: () => boolean } {
  let buf: Buffer = Buffer.alloc(0)
  let remaining = 0 // bytes of the current entry still to come
  let pad = 0 // padding after it
  let fd: number | null = null
  let collect: Buffer[] | null = null // a long-name or pax header's body
  let collectKind = ''
  let nextName: string | null = null
  let found = false
  const octal = (b: Buffer): number => parseInt(b.toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8)
  const finishEntry = (): void => {
    if (collect) {
      const body = Buffer.concat(collect).toString('utf8')
      if (collectKind === 'L') nextName = body.replace(/\0.*$/s, '')
      else {
        const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body)
        if (m) nextName = m[1]
      }
      collect = null
    }
    if (fd !== null) {
      closeSync(fd)
      fd = null
    }
  }
  const w = new Writable({
    write(chunk: Buffer, _enc, cb) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
        for (;;) {
          if (remaining > 0) {
            if (!buf.length) break
            const n = Math.min(remaining, buf.length)
            const part = buf.subarray(0, n)
            buf = buf.subarray(n)
            remaining -= n
            if (fd !== null) writeSync(fd, part)
            else if (collect) collect.push(Buffer.from(part))
            if (remaining === 0) finishEntry()
            continue
          }
          if (pad > 0) {
            if (!buf.length) break
            const n = Math.min(pad, buf.length)
            buf = buf.subarray(n)
            pad -= n
            continue
          }
          if (buf.length < 512) break
          const h = buf.subarray(0, 512)
          buf = buf.subarray(512)
          if (h.every((x) => x === 0)) continue // end blocks
          const size = octal(h.subarray(124, 136))
          const type = String.fromCharCode(h[156] || 48)
          const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '')
          const base = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '')
          const name = nextName ?? (prefix ? `${prefix}/${base}` : base)
          remaining = size
          pad = (512 - (size % 512)) % 512
          if (type === 'L' || type === 'x') {
            collect = []
            collectKind = type
          } else {
            nextName = null
            if ((type === '0' || type === '7') && !found && match(name)) {
              found = true
              fd = openSync(dest, 'w', 0o755)
            }
          }
          if (remaining === 0) finishEntry()
        }
        cb()
      } catch (e) {
        cb(e as Error)
      }
    },
    final(cb) {
      if (fd !== null) closeSync(fd)
      fd = null
      cb()
    }
  }) as Writable & { found: () => boolean }
  w.found = () => found
  return w
}

/** Download OpenCode for this computer into LocalClaude's folder. */
export async function downloadOpenCode(onEvent: (e: OpenCodeDownloadEvent) => void): Promise<void> {
  if (downloading) return
  downloading = true
  const fail = (error: string): void => {
    downloading = false
    log('warn', `OpenCode download failed: ${error}`)
    onEvent({ type: 'done', ok: false, error })
  }
  try {
    const pkg = opencodePackage()
    if (!pkg) return fail(`OpenCode has no build for ${process.platform} ${process.arch}.`)
    onEvent({ type: 'progress', phase: 'Looking up the latest version…' })
    const metaRes = await fetch(`${registry()}/${pkg.replace('/', '%2f')}/latest`, { signal: AbortSignal.timeout(30000) })
    if (!metaRes.ok) return fail(`The npm registry answered ${metaRes.status} for ${pkg}.`)
    const meta = (await metaRes.json()) as { version?: string; dist?: { tarball?: string; integrity?: string; unpackedSize?: number } }
    const version = meta.version
    const tarball = meta.dist?.tarball
    const integrity = meta.dist?.integrity
    if (!version || !tarball || !integrity?.startsWith('sha512-')) return fail('The npm registry didn’t say where to download OpenCode from.')
    const dir = join(opencodeDir(), version)
    mkdirSync(dir, { recursive: true })
    const tgz = join(dir, 'download.tgz')
    const res = await fetch(tarball, { signal: AbortSignal.timeout(30 * 60 * 1000) })
    if (!res.ok || !res.body) return fail(`The download answered ${res.status}.`)
    const total = Number(res.headers.get('content-length')) || undefined
    let received = 0
    let last = 0
    const hash = createHash('sha512')
    const counter = new Transform({
      transform(chunk: Buffer, _e, cb) {
        received += chunk.length
        hash.update(chunk)
        const now = Date.now()
        if (now - last > 250) {
          last = now
          onEvent({ type: 'progress', phase: `Downloading OpenCode ${version}…`, received, total })
        }
        cb(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>), counter, createWriteStream(tgz))
    onEvent({ type: 'progress', phase: 'Checking it…', received, total })
    if (`sha512-${hash.digest('base64')}` !== integrity) {
      rmSync(tgz, { force: true })
      return fail('The download didn’t match the checksum the npm registry gave, so it was thrown away. Try again.')
    }
    onEvent({ type: 'progress', phase: 'Unpacking…', received, total })
    const tmp = join(dir, EXE + '.part')
    const writer = tarEntryWriter((p) => /(^|\/)bin\/opencode(\.exe)?$/.test(p), tmp)
    await pipeline(createReadStream(tgz), createGunzip(), writer)
    if (!writer.found()) {
      rmSync(tgz, { force: true })
      return fail('OpenCode’s binary wasn’t in the download.')
    }
    rmSync(tgz, { force: true })
    const bin = join(dir, EXE)
    renameSync(tmp, bin)
    if (process.platform !== 'win32') chmodSync(bin, 0o755)
    writeFileSync(join(opencodeDir(), 'current.json'), JSON.stringify({ version, path: bin } satisfies Current))
    // older downloads (one may still be running, so failures are fine)
    for (const d of readdirSync(opencodeDir(), { withFileTypes: true }))
      if (d.isDirectory() && d.name !== version)
        try {
          rmSync(join(opencodeDir(), d.name), { recursive: true, force: true })
        } catch {
          /* in use */
        }
    downloading = false
    log('info', `OpenCode ${version} downloaded (${pkg})`)
    onEvent({ type: 'done', ok: true, version })
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
  }
}

// ---------------------------------------------------------------- OpenCode as an ACP engine
type Rule = { action: string; resource: string; effect: 'allow' | 'ask' | 'deny' }

/** LocalClaude's permission modes, as OpenCode permission rules (fixed when it starts). Plan mode also picks OpenCode's plan agent. */
export function opencodePermissions(mode: PermissionModeUI): Rule[] {
  if (mode === 'bypassPermissions') return [{ action: '*', resource: '*', effect: 'allow' }]
  const ask = (action: string): Rule => ({ action, resource: '*', effect: 'ask' })
  const rules: Rule[] = [ask('shell'), ask('webfetch'), ask('external_directory')]
  rules.push(mode === 'acceptEdits' ? { action: 'edit', resource: '*', effect: 'allow' } : ask('edit'))
  return rules
}

/** The config LocalClaude hands OpenCode (OPENCODE_CONFIG_CONTENT): on top of your own opencode.json. */
export function opencodeConfig(meta: Pick<SessionMeta, 'permissionMode'>): Record<string, unknown> {
  return {
    // LocalClaude downloads new versions itself, and chats aren't shared anywhere
    update: 'disable',
    share: 'disabled',
    permissions: opencodePermissions(meta.permissionMode)
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** OpenCode's tools, as Claude Code's (name and input shape), so they get the same cards. */
export function opencodeTool(name: string | undefined, title: string | undefined, rawInput: unknown): { name: string; input: Record<string, unknown> } {
  const raw = rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {}
  const n = (name ?? title ?? 'tool').toLowerCase()
  const path = str(raw.path) ?? str(raw.filePath) ?? str(raw.file_path)
  switch (n) {
    case 'shell':
    case 'bash':
      return { name: 'Bash', input: { ...raw, command: str(raw.command) ?? str(raw.cmd) ?? '', description: str(raw.description) } }
    case 'read':
      return { name: 'Read', input: { ...raw, file_path: path ?? '' } }
    case 'write':
      return { name: 'Write', input: { ...raw, file_path: path ?? '', content: str(raw.content) ?? '' } }
    case 'edit':
      return {
        name: 'Edit',
        input: { file_path: path ?? '', old_string: str(raw.oldString) ?? str(raw.old_string) ?? '', new_string: str(raw.newString) ?? str(raw.new_string) ?? '', replace_all: raw.replaceAll }
      }
    case 'glob':
      return { name: 'Glob', input: raw }
    case 'grep':
      return { name: 'Grep', input: raw }
    case 'webfetch':
      return { name: 'WebFetch', input: raw }
    case 'websearch':
      return { name: 'WebSearch', input: raw }
    case 'todowrite':
    case 'todo':
      return { name: 'TodoWrite', input: raw }
    case 'subagent':
    case 'task':
      return { name: 'Agent', input: { ...raw, subagent_type: str(raw.agent), description: str(raw.description) ?? '', prompt: str(raw.prompt) ?? '' } }
    case 'skill':
      return { name: 'Skill', input: { ...raw, skill: str(raw.id) ?? str(raw.name) } }
    case 'patch':
    case 'apply_patch':
      return { name: 'Patch', input: raw }
    default:
      return { name: name ?? title ?? 'tool', input: raw }
  }
}

function friendly(text: string): string {
  if (/401|unauthori[sz]ed|invalid.{0,10}api.?key|authentication|no credential/i.test(text))
    return 'The provider didn’t accept the key OpenCode used. Check it in Settings → OpenCode.\n\n' + text
  if (/402|insufficient (balance|credit|quota)|billing/i.test(text)) return 'The provider’s account is out of credit.\n\n' + text
  if (/model not found/i.test(text)) return 'OpenCode doesn’t have that model. Pick another from the model menu, or connect its provider in Settings → OpenCode.\n\n' + text
  if (/ENOENT|EACCES|not recognized|command not found|is not a valid Win32/i.test(text))
    return 'OpenCode couldn’t be started. Download it again in Settings → OpenCode.\n\n' + text
  return text
}

export const opencodeEngine: AcpEngine = {
  engine: 'opencode',
  label: 'OpenCode',
  idPrefix: 'oc-',
  tag: 'opencode',
  images: true,
  // LocalClaude's skills (with the ones you switched off left out), the same way DeepSeek chats get them
  skillsInPreamble: true,
  launch({ settings, meta, store }) {
    const l = findOpenCode(settings)
    if (!l) throw new Error('OpenCode isn’t on this computer yet. Download it in Settings → OpenCode (about 120 MB), then send your message again.')
    const env: Record<string, string | undefined> = { ...process.env }
    // your saved provider keys, and the DeepSeek key you gave LocalClaude
    const deepseek = store.getDeepSeekKey()
    if (deepseek && !env.DEEPSEEK_API_KEY) env.DEEPSEEK_API_KEY = deepseek
    for (const [name, key] of Object.entries(store.getOpenCodeKeys())) if (isEnvName(name)) env[name] = key
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(opencodeConfig(meta))
    env.OPENCODE_DISABLE_AUTOUPDATE = '1'
    // skills come from LocalClaude, so the ones you switched off stay off
    env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1'
    if (l.asNode) env.ELECTRON_RUN_AS_NODE = '1'
    else delete env.ELECTRON_RUN_AS_NODE
    return {
      bin: l.bin,
      args: [...l.args, 'acp'],
      env,
      shell: process.platform === 'win32' && !l.asNode && /\.(cmd|bat)$/i.test(l.bin),
      version: versionOf(l),
      describe: `${l.via}, ${meta.permissionMode}`
    }
  },
  restartKey: (meta) => JSON.stringify(opencodePermissions(meta.permissionMode)),
  friendly,
  tool: opencodeTool,
  // Plan mode is OpenCode's plan agent (read-only); otherwise its build agent
  config: (meta) => [['mode', meta.permissionMode === 'plan' ? 'plan' : 'build']]
}

/** One chat on OpenCode. */
export class OpenCodeSession extends AcpSession {
  constructor(meta: SessionMeta, store: SecureStore, emit: (e: AgentEvent) => void, settings: () => AppSettings, deps: AcpDeps) {
    super(opencodeEngine, meta, store, emit, settings, deps)
  }
}
