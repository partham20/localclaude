// Signing in to remote MCP servers (connectors) with OAuth: dynamic client registration and PKCE through
// the MCP SDK, the browser for the sign-in page, and a one-off loopback server for the redirect.
// Tokens stay in the encrypted vault and reach chats as an Authorization header, so Claude Code and
// DeepSeek Harness chats both use them (refreshed before they run out).
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { shell } from 'electron'
import { createServer, type Server } from 'node:http'
import type { McpAuthInfo } from '../shared/extensions'
import type { McpServerEntry } from '../shared/types'

/** What's kept for one server URL. */
export interface McpAuthRecord {
  client?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  /** ms */
  expiresAt?: number
}

export interface McpAuthStore {
  getMcpAuth(url: string): McpAuthRecord | undefined
  setMcpAuth(url: string, rec: McpAuthRecord | undefined): void
  allMcpAuth(): Record<string, McpAuthRecord>
}

const key = (url: string): string => {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.href
  } catch {
    return url
  }
}

class Provider implements OAuthClientProvider {
  verifier = ''
  authUrl?: URL
  constructor(
    private store: McpAuthStore,
    private url: string,
    private redirect: string,
    private state_: string
  ) {}
  get redirectUrl(): string | undefined {
    return this.redirect || undefined
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'LocalClaude',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }
  state(): string {
    return this.state_
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    const c = this.store.getMcpAuth(this.url)?.client
    // a registration made for another redirect address (another sign-in's port) can't be reused
    const uris = (c as { redirect_uris?: string[] } | undefined)?.redirect_uris
    if (c && uris && !uris.includes(this.redirect) && this.redirect) return undefined
    return c
  }
  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.store.setMcpAuth(this.url, { ...this.store.getMcpAuth(this.url), client: info })
  }
  tokens(): OAuthTokens | undefined {
    return this.store.getMcpAuth(this.url)?.tokens
  }
  saveTokens(tokens: OAuthTokens): void {
    const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined
    const prev = this.store.getMcpAuth(this.url)
    // a refresh may not send a new refresh token: keep the old one
    const merged = { ...tokens, refresh_token: tokens.refresh_token ?? prev?.tokens?.refresh_token }
    this.store.setMcpAuth(this.url, { ...prev, tokens: merged, expiresAt })
  }
  redirectToAuthorization(url: URL): void {
    this.authUrl = url
  }
  saveCodeVerifier(v: string): void {
    this.verifier = v
  }
  codeVerifier(): string {
    return this.verifier
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    const prev = this.store.getMcpAuth(this.url)
    if (!prev) return
    if (scope === 'all') this.store.setMcpAuth(this.url, undefined)
    else if (scope === 'client') this.store.setMcpAuth(this.url, { ...prev, client: undefined })
    else if (scope === 'tokens') this.store.setMcpAuth(this.url, { ...prev, tokens: undefined, expiresAt: undefined })
  }
}

let pending: { server: Server; cancel: () => void } | undefined

const PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#333"><div style="text-align:center"><h2>${title}</h2><p>${text}</p></div>`

/**
 * Sign in to the server at `url` in the browser. Resolves once the server has given LocalClaude a token,
 * or with an error (cancelled, refused, timed out after 5 minutes).
 */
export async function signInMcp(store: McpAuthStore, url: string, opts: { timeoutMs?: number } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  pending?.cancel()
  const u = key(url)
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36)
  let resolveCode!: (code: string) => void
  let rejectCode!: (e: Error) => void
  const code = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })
  code.catch(() => {})
  const server = createServer((req, res) => {
    const q = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (q.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const err = q.searchParams.get('error')
    const c = q.searchParams.get('code')
    if (q.searchParams.get('state') !== state) {
      res.writeHead(400, { 'content-type': 'text/html' }).end(PAGE('Sign-in didn’t match', 'Start it again from LocalClaude.'))
      return
    }
    if (err || !c) {
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('Not signed in', 'You can close this tab and try again from LocalClaude.'))
      rejectCode(new Error(q.searchParams.get('error_description') || err || 'The server didn’t sign you in.'))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('Signed in', 'You can close this tab and go back to LocalClaude.'))
    resolveCode(c)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const timer = setTimeout(() => rejectCode(new Error('Sign-in timed out. Try again.')), opts.timeoutMs ?? 5 * 60_000)
  pending = { server, cancel: () => rejectCode(new Error('Sign-in was cancelled.')) }
  const provider = new Provider(store, u, `http://127.0.0.1:${port}/callback`, state)
  try {
    const first = await auth(provider, { serverUrl: u })
    if (first === 'AUTHORIZED') return { ok: true }
    if (!provider.authUrl) return { ok: false, error: 'The server didn’t say where to sign in.' }
    await shell.openExternal(provider.authUrl.href)
    const c = await code
    const second = await auth(provider, { serverUrl: u, authorizationCode: c })
    return second === 'AUTHORIZED' ? { ok: true } : { ok: false, error: 'The server didn’t give LocalClaude a token.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
    server.close()
    if (pending?.server === server) pending = undefined
  }
}

export function cancelMcpSignIn(): void {
  pending?.cancel()
}

export function signOutMcp(store: McpAuthStore, url: string): void {
  store.setMcpAuth(key(url), undefined)
}

export function mcpAuthInfo(store: McpAuthStore): McpAuthInfo[] {
  return Object.entries(store.allMcpAuth())
    .filter(([, r]) => r.tokens?.access_token)
    .map(([url, r]) => ({ url, signedIn: true, expiresAt: r.expiresAt }))
}

/** The server entry as chats should get it: with the signed-in token as its Authorization header. */
export function withMcpAuth(store: McpAuthStore, entry: McpServerEntry): McpServerEntry {
  if ((entry.type !== 'http' && entry.type !== 'sse') || !entry.url) return entry
  const t = store.getMcpAuth?.(key(entry.url))?.tokens
  if (!t?.access_token) return entry
  const has = Object.keys(entry.headers ?? {}).some((h) => h.toLowerCase() === 'authorization')
  if (has) return entry
  return { ...entry, headers: { ...entry.headers, Authorization: `Bearer ${t.access_token}` } }
}

/** Refresh tokens that run out within `withinMs` (they're refreshed in the background, so chats keep working). */
export async function refreshMcpTokens(store: McpAuthStore, withinMs = 10 * 60_000): Promise<void> {
  for (const [url, r] of Object.entries(store.allMcpAuth())) {
    if (!r.tokens?.refresh_token || !r.expiresAt || r.expiresAt - Date.now() > withinMs) continue
    try {
      // no redirect address: a refresh needs none, and a failed one shouldn't open a browser
      await auth(new Provider(store, url, '', ''), { serverUrl: url })
    } catch {
      /* stays as it is: the next chat shows "needs sign-in" */
    }
  }
}
