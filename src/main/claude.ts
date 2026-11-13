// Locating the Claude Code binary, building a subscription-only environment,
// and sign-in / sign-out through Claude Code's own `auth` commands.
import { BrowserWindow, shell } from 'electron'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { AuthStatus, LoginEvent } from '../shared/types'

const require = createRequire(import.meta.url)

/** Resolve the native Claude Code binary that ships with the Agent SDK for this OS/arch. */
export function resolveClaudeBinary(): string | undefined {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const base = '@anthropic-ai/claude-agent-sdk'
  const candidates =
    process.platform === 'linux'
      ? [`${base}-linux-${process.arch}`, `${base}-linux-${process.arch}-musl`]
      : [`${base}-${process.platform}-${process.arch}`]
  for (const pkg of candidates) {
    try {
      let p = join(dirname(require.resolve(`${pkg}/package.json`)), exe)
      // Inside a packaged app the binary lives in app.asar.unpacked (see electron-builder.yml)
      p = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
      if (existsSync(p)) return p
    } catch {
      /* try next */
    }
  }
  return undefined
}

const STRIP = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY'
]

/** True if the user's environment would make Claude Code bill an API key instead of the subscription. */
export function hadApiKeyInEnv(): boolean {
  return STRIP.some((k) => !!process.env[k])
}

/**
 * Environment for every Claude Code process this app starts.
 * API-key / third-party-provider variables are removed so requests always go
 * through your Claude subscription login (OAuth), never pay-per-token billing.
 * CLAUDE_CODE_OAUTH_TOKEN is a subscription token, so it is kept: that's how token sign-in works.
 */
export function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const k of STRIP) delete env[k]
  delete env.LOCALCLAUDE_API_KEY
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'localclaude/1.0.0'
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/** A Console key saved in Settings (kept in the encrypted vault; set at start-up and when it changes). */
let savedConsoleKey: string | undefined
export function setSavedConsoleKey(key: string | undefined): void {
  savedConsoleKey = key || undefined
}

/** The Console key chats and designs can bill: LOCALCLAUDE_API_KEY wins over one saved in Settings. */
function consoleKey(): string | undefined {
  return process.env.LOCALCLAUDE_API_KEY || savedConsoleKey
}

/** Where the Console key comes from, if there is one. The key itself never leaves the main process. */
export function consoleKeySource(): 'env' | 'saved' | undefined {
  return process.env.LOCALCLAUDE_API_KEY ? 'env' : savedConsoleKey ? 'saved' : undefined
}

/** True if there's a Console key (LOCALCLAUDE_API_KEY, or one saved in Settings). */
export function consoleKeySet(): boolean {
  return !!consoleKey()
}

/** Tidy and sanity-check a pasted key. Returns an error to show, or the key. */
export function cleanConsoleKey(raw: string): { key: string } | { error: string } {
  const key = String(raw ?? '').trim()
  if (!key) return { error: 'Paste a key first.' }
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { error: 'That doesn’t look like a Console API key (they start with sk-ant-).' }
  return { key }
}

/**
 * Ask the API whether it accepts the key (listing models costs nothing). Only a clear "no"
 * (401/403) stops it being saved; if the check itself fails (offline), the key is saved anyway.
 */
export async function checkConsoleKey(key: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10000)
    })
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Anthropic rejected this key. Check it in the Console and try again.' }
    if (!r.ok) return { ok: true, warning: `Couldn’t confirm the key (the API answered ${r.status}); it’s saved anyway.` }
    return { ok: true }
  } catch {
    return { ok: true, warning: 'Couldn’t reach Anthropic to check the key; it’s saved anyway.' }
  }
}

/**
 * Environment for chat and design sessions only. Uses the subscription unless
 * there's a Console key (LOCALCLAUDE_API_KEY, or one saved in Settings), in which case those sessions bill it
 * (unless `useConsoleKey` is false: Settings → Account → "Chats and designs use").
 * Titles, usage checks, sign-in and remote control stay on subscriptionEnv().
 */
export function agentEnv(useConsoleKey = true): Record<string, string | undefined> {
  const env = subscriptionEnv()
  const key = consoleKey()
  if (key && useConsoleKey) env.ANTHROPIC_API_KEY = key
  delete env.LOCALCLAUDE_API_KEY
  return env
}

function run(args: string[], timeoutMs = 20000): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const bin = resolveClaudeBinary()
    if (!bin) return resolve({ code: -1, out: '', err: 'Claude Code binary not found (run npm install)' })
    const p = spawn(bin, args, { env: subscriptionEnv() as NodeJS.ProcessEnv, windowsHide: true })
    let out = ''
    let err = ''
    const t = setTimeout(() => p.kill(), timeoutMs)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => {
      clearTimeout(t)
      resolve({ code: -1, out, err: String(e) })
    })
    p.on('close', (code) => {
      clearTimeout(t)
      resolve({ code, out, err })
    })
  })
}

/**
 * True if CLAUDE_CODE_OAUTH_TOKEN is set (a long-lived subscription token from `claude setup-token`).
 * It is kept in subscriptionEnv(), so Claude Code signs in with it; `claude auth logout` can't remove it.
 */
export function hasOAuthTokenEnv(): boolean {
  return !!process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
}

/** Whether there's a Console key and where it's from, and whether a subscription token is set: never the secrets themselves. */
function keyStatus(): Pick<AuthStatus, 'usingConsoleKey' | 'consoleKeySource' | 'consoleKeySaved' | 'usingOAuthTokenEnv'> {
  return { usingConsoleKey: consoleKeySet(), consoleKeySource: consoleKeySource(), consoleKeySaved: !!savedConsoleKey, usingOAuthTokenEnv: hasOAuthTokenEnv() }
}

export async function authStatus(): Promise<AuthStatus> {
  if (process.env.LOCALCLAUDE_FAKE_AGENT)
    return { loggedIn: true, authMethod: 'claude.ai', email: 'e2e@example.com', subscriptionType: 'max', usingApiKeyEnv: false, ...keyStatus() }
  const r = await run(['auth', 'status', '--json'])
  const base: AuthStatus = { loggedIn: false, usingApiKeyEnv: hadApiKeyInEnv(), ...keyStatus() }
  try {
    const j = JSON.parse(r.out)
    return {
      ...base,
      loggedIn: !!j.loggedIn,
      authMethod: j.authMethod,
      apiProvider: j.apiProvider,
      email: j.email ?? j.account?.email,
      subscriptionType: j.subscriptionType ?? j.account?.subscriptionType
    }
  } catch {
    return { ...base, error: (r.err || r.out || 'Could not read auth status').trim() }
  }
}

export async function logout(): Promise<void> {
  await run(['auth', 'logout'])
}

let loginProc: ChildProcessWithoutNullStreams | null = null
const URL_RE = /https:\/\/[^\s"'<>]+/g

/** Start `claude auth login --claudeai` and stream its output to the window. */
export function startLogin(win: BrowserWindow): void {
  cancelLogin()
  const bin = resolveClaudeBinary()
  const send = (e: LoginEvent): void => {
    if (!win.isDestroyed()) win.webContents.send('login:event', e)
  }
  if (!bin) {
    send({ type: 'output', text: 'Claude Code binary not found. Run `npm install` in the app folder.\n' })
    send({ type: 'exit', code: -1 })
    return
  }
  const opened = new Set<string>()
  loginProc = spawn(bin, ['auth', 'login', '--claudeai'], {
    env: { ...(subscriptionEnv() as NodeJS.ProcessEnv), BROWSER: process.env.BROWSER ?? '' },
    windowsHide: true
  })
  const onData = (d: Buffer): void => {
    // strip ANSI escape codes
    // eslint-disable-next-line no-control-regex
    const text = d.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    const urls = text.match(URL_RE) ?? []
    let url: string | undefined
    for (const u of urls) {
      if (!opened.has(u) && /oauth|authorize|login|claude\.ai|anthropic\.com/.test(u)) {
        opened.add(u)
        url = u
        void shell.openExternal(u)
      }
    }
    send({ type: 'output', text, url })
  }
  loginProc.stdout.on('data', onData)
  loginProc.stderr.on('data', onData)
  loginProc.on('close', (code) => {
    loginProc = null
    send({ type: 'exit', code })
  })
  loginProc.on('error', (e) => send({ type: 'output', text: String(e) + '\n' }))
}

/** Some login flows ask you to paste a code back into the terminal. */
export function sendLoginInput(text: string): void {
  loginProc?.stdin.write(text.trim() + '\n')
}

export function cancelLogin(): void {
  if (loginProc) {
    loginProc.kill()
    loginProc = null
  }
}
