// Server mode: the app without a window, served to a browser. The same handlers the desktop window
// calls over IPC answer HTTP requests here, and events go out as server-sent events. Every route but
// the sign-in pages needs a signed-in session (password + authenticator code, see auth.ts).
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { basename, extname, join, normalize, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import qrcode from 'qrcode-generator'
import { decodeWire, encodeWire } from '../../shared/wire'
import { log } from '../log'
import { passwordProblem, WebAuth } from './auth'
import { accountPage, loginPage, setupPage, setupTotpPage } from './pages'
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp'

export type Handler = (...args: unknown[]) => unknown
export type ProtocolHandler = (req: Request) => Response | Promise<Response>

export interface WebServerOptions {
  handlers: Map<string, Handler>
  protocols: Record<string, ProtocolHandler>
  rendererDir: string
  dataDir: string
  secret: string
  port: number
  host: string
  /** trust Cloudflare / reverse-proxy headers for the visitor's address */
  trustProxy: boolean
  /** cookies without the Secure flag (only for plain-http testing on a LAN) */
  insecureCookies: boolean
  version: string
}

interface CallContext {
  clientId?: string
  downloads: string[]
}

const ctx = new AsyncLocalStorage<CallContext>()

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp'
}

const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

const COOKIE = 'lc_session'
const SETUP_COOKIE = 'lc_setup'
const MAX_UPLOAD = 512 * 1024 * 1024

export class WebServer {
  readonly auth: WebAuth
  private clients = new Map<string, ServerResponse>()
  private picks = new Map<string, { resolve: (paths: string[] | null) => void; clientId?: string }>()
  private downloads = new Map<string, { path: string; name: string; expires: number }>()
  private pendingSetup = new Map<string, { password: string; secret: string; expires: number }>()
  private setupCode: string
  private uploadsDir: string
  readonly downloadsDir: string
  private indexHtml: string | null = null

  constructor(private o: WebServerOptions) {
    this.auth = new WebAuth(join(o.dataDir, 'web', 'account.json'), join(o.dataDir, 'web', 'sessions.json'), o.secret)
    this.uploadsDir = join(o.dataDir, 'web', 'uploads')
    this.downloadsDir = join(o.dataDir, 'web', 'downloads')
    rmSync(this.downloadsDir, { recursive: true, force: true })
    mkdirSync(this.uploadsDir, { recursive: true })
    mkdirSync(this.downloadsDir, { recursive: true })
    this.setupCode = process.env.LOCALCLAUDE_SETUP_CODE || randomBytes(9).toString('base64url')
    this.registerChannels()
  }

  // ---------------------------------------------------------------- events to browsers
  broadcast(channel: string, payload: unknown): void {
    const data = `data: ${encodeWire({ ch: channel, payload })}\n\n`
    for (const res of this.clients.values()) res.write(data)
  }

  /** To the browser tab that made the current call (or every tab when there isn't one). */
  toCaller(channel: string, payload: unknown): void {
    const id = ctx.getStore()?.clientId
    const res = id ? this.clients.get(id) : undefined
    if (res) res.write(`data: ${encodeWire({ ch: channel, payload })}\n\n`)
    else this.broadcast(channel, payload)
  }

  // ---------------------------------------------------------------- desktop stand-ins
  /** Ask the browser to pick a folder (on the server) or files (uploaded from the visitor's computer). */
  pick(kind: 'folder' | 'files', opts: { title?: string; multi?: boolean; start?: string }): Promise<string[] | null> {
    if (!this.clients.size) return Promise.resolve(null)
    const id = randomBytes(8).toString('hex')
    const clientId = ctx.getStore()?.clientId
    return new Promise((res) => {
      const timer = setTimeout(() => this.finishPick(id, null), 15 * 60_000)
      this.picks.set(id, {
        resolve: (p) => {
          clearTimeout(timer)
          res(p)
        },
        clientId
      })
      this.toCaller('web:pick', { id, kind, ...opts })
    })
  }

  private finishPick(id: string, paths: string[] | null): void {
    const p = this.picks.get(id)
    if (!p) return
    this.picks.delete(id)
    p.resolve(paths)
  }

  /** A place to save a file the browser will then download (stands in for a save dialog). */
  saveTarget(defaultName: string): string {
    const name = basename(defaultName || 'download').replace(/[\\/:*?"<>|]/g, '_') || 'download'
    const dir = join(this.downloadsDir, randomBytes(8).toString('hex'))
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    ctx.getStore()?.downloads.push(path)
    return path
  }

  /** Offer a file on the server to the browser as a download. */
  offerDownload(path: string): void {
    if (!existsSync(path) || !statSync(path).isFile()) return
    const token = randomBytes(18).toString('base64url')
    this.downloads.set(token, { path, name: basename(path), expires: Date.now() + 3600_000 })
    this.toCaller('web:download', { url: `/api/download/${token}`, name: basename(path) })
  }

  notice(text: string): void {
    this.toCaller('web:notice', { text })
  }

  open(url: string): void {
    this.toCaller('web:open', { url })
  }

  private registerChannels(): void {
    const h = this.o.handlers
    h.set('web:pickResult', (id, paths) => this.finishPick(String(id), Array.isArray(paths) ? paths.map(String) : null))
    h.set('web:listDir', (p) => listDir(typeof p === 'string' && p ? p : workspaceDir()))
    h.set('web:mkdir', (parent, name) => {
      const n = String(name)
      if (!n || /[\\/]/.test(n) || n === '.' || n === '..') throw new Error('Not a valid folder name')
      const dir = join(resolve(String(parent || workspaceDir())), n)
      mkdirSync(dir, { recursive: true })
      return dir
    })
  }

  // ---------------------------------------------------------------- HTTP
  start(): Promise<void> {
    const server = createServer((req, res) => {
      this.route(req, res).catch((e) => {
        log('error', 'web request failed:', e)
        if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Something went wrong')
        else res.end()
      })
    })
    server.requestTimeout = 0
    server.headersTimeout = 30_000
    setInterval(() => {
      for (const res of this.clients.values()) res.write(': keep-alive\n\n')
      const now = Date.now()
      for (const [t, d] of this.downloads) if (d.expires < now) this.downloads.delete(t)
      for (const [t, s] of this.pendingSetup) if (s.expires < now) this.pendingSetup.delete(t)
    }, 25_000).unref()
    return new Promise((ok, fail) => {
      server.once('error', fail)
      server.listen(this.o.port, this.o.host, () => {
        log('info', `web: listening on http://${this.o.host}:${this.o.port}`)
        if (!this.auth.hasAccount) {
          const banner = `\n  LocalClaude has no account yet. Open it in a browser and use this setup code:\n\n      ${this.setupCode}\n`
          console.log(banner)
          log('info', 'web: waiting for first-time setup (setup code printed to the console)')
        }
        ok()
      })
    })
  }

  private ip(req: IncomingMessage): string {
    if (this.o.trustProxy) {
      const cf = req.headers['cf-connecting-ip']
      if (typeof cf === 'string' && cf) return cf
      const xff = req.headers['x-forwarded-for']
      if (typeof xff === 'string' && xff) return xff.split(',')[0].trim()
    }
    return req.socket.remoteAddress ?? 'unknown'
  }

  private cookie(name: string, value: string, maxAge: number | null): string {
    const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict']
    if (!this.o.insecureCookies) parts.push('Secure')
    if (maxAge !== null) parts.push(`Max-Age=${maxAge}`)
    return parts.join('; ')
  }

  /** Form posts and API calls must come from this site (on top of SameSite cookies). */
  private sameOrigin(req: IncomingMessage): boolean {
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin') return false
    const origin = req.headers.origin
    if (!origin || origin === 'null') return site === 'same-origin' || site === undefined
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const method = req.method ?? 'GET'
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    if (!this.o.insecureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000')

    if (path === '/healthz') return send(res, 200, 'text/plain', 'ok')
    if (path === '/robots.txt') return send(res, 200, 'text/plain', 'User-agent: *\nDisallow: /\n')

    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[COOKIE]

    // ---- first-time setup
    if (!this.auth.hasAccount) {
      if (path === '/setup' && method === 'POST') return this.setupPost(req, res)
      if (path === '/setup/totp' && method === 'POST') return this.setupTotpPost(req, res, cookies[SETUP_COOKIE])
      if (path === '/setup' || path === '/setup/totp') return html(res, 200, setupPage())
      if (path.startsWith('/api/')) return send(res, 401, 'application/json', '{"error":"setup"}')
      return redirect(res, '/setup')
    }

    // ---- sign-in
    if (path === '/login' && method === 'POST') return this.loginPost(req, res)
    if (path === '/login') return this.auth.check(token) ? redirect(res, '/') : html(res, 200, loginPage())
    if (path === '/logout' && method === 'POST') {
      if (!this.sameOrigin(req)) return send(res, 403, 'text/plain', 'Forbidden')
      this.auth.endSession(token)
      res.setHeader('Set-Cookie', this.cookie(COOKIE, '', 0))
      return redirect(res, '/login')
    }

    const session = this.auth.check(token)
    if (!session) {
      if (path.startsWith('/api/') || path.startsWith('/proto/')) return send(res, 401, 'application/json', '{"error":"signed out"}')
      return redirect(res, '/login')
    }

    // ---- signed in
    if (path === '/api/session') return json(res, 200, { ok: true, shared: session.shared, version: this.o.version })
    if (path === '/logout-all' && method === 'POST') {
      if (!this.sameOrigin(req)) return send(res, 403, 'text/plain', 'Forbidden')
      this.auth.endAllSessions()
      res.setHeader('Set-Cookie', this.cookie(COOKIE, '', 0))
      return redirect(res, '/login')
    }
    if (path === '/account' && method === 'GET') return html(res, 200, this.account(session.id))
    if (path === '/account/password' && method === 'POST') {
      if (!this.sameOrigin(req)) return send(res, 403, 'text/plain', 'Forbidden')
      const f = await readForm(req)
      const ip = this.ip(req)
      const wait = this.auth.lockedFor(ip)
      if (wait) return html(res, 429, this.account(session.id, undefined, `Too many tries. Wait ${Math.ceil(wait / 60)} minutes.`))
      const problem = this.auth.changePassword(f.current ?? '', f.code ?? '', f.password ?? '')
      if (problem) {
        if (problem.startsWith('The current')) this.auth.recordFailure(ip)
        return html(res, 400, this.account(session.id, undefined, problem))
      }
      // everyone else is signed out by the change; keep this browser signed in
      const fresh = this.auth.createSession(session.shared, ip, String(req.headers['user-agent'] ?? ''))
      res.setHeader('Set-Cookie', this.cookie(COOKIE, fresh, this.auth.sessionMaxAge(session.shared)))
      return html(res, 200, accountPage(this.auth.listSessions().map((s) => ({ ...s, current: false })), 'Password changed. Other browsers are signed out.'))
    }

    if (path.startsWith('/api/')) {
      if (method === 'POST' && (req.headers['x-localclaude'] !== '1' || !this.sameOrigin(req))) return send(res, 403, 'text/plain', 'Forbidden')
      if (path === '/api/events' && method === 'GET') return this.events(req, res)
      if (path === '/api/invoke' && method === 'POST') return this.invoke(req, res)
      if (path === '/api/upload' && method === 'POST') return this.upload(req, res, url)
      if (path.startsWith('/api/download/') && method === 'GET') return this.download(res, path.slice('/api/download/'.length))
      return send(res, 404, 'text/plain', 'Not found')
    }

    if (path.startsWith('/proto/')) return this.proto(req, res, url)
    return this.static(res, path)
  }

  private account(currentId: string, notice?: string, error?: string): string {
    return accountPage(
      this.auth.listSessions().map((s) => ({ ...s, current: s.id === currentId })),
      notice,
      error
    )
  }

  // ---------------------------------------------------------------- setup & sign-in
  private async setupPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.sameOrigin(req)) return send(res, 403, 'text/plain', 'Forbidden')
    const ip = this.ip(req)
    const wait = this.auth.lockedFor(ip)
    if (wait) return html(res, 429, setupPage(`Too many tries. Wait ${Math.ceil(wait / 60)} minutes.`))
    const f = await readForm(req)
    if (!safeEqual(f.setupCode ?? '', this.setupCode)) {
      this.auth.recordFailure(ip)
      return html(res, 400, setupPage('That setup code is wrong. It is printed in the server log when LocalClaude starts.'))
    }
    if ((f.password ?? '') !== (f.password2 ?? '')) return html(res, 400, setupPage('The passwords are different.'))
    const problem = passwordProblem(f.password ?? '')
    if (problem) return html(res, 400, setupPage(problem))
    const t = randomBytes(24).toString('base64url')
    const secret = newTotpSecret()
    this.pendingSetup.set(t, { password: f.password!, secret, expires: Date.now() + 15 * 60_000 })
    res.setHeader('Set-Cookie', this.cookie(SETUP_COOKIE, t, 15 * 60))
    return html(res, 200, setupTotpPage(qrSvg(secret, req.headers.host ?? 'LocalClaude'), secret))
  }

  private async setupTotpPost(req: IncomingMessage, res: ServerResponse, t: string | undefined): Promise<void> {
    if (!this.sameOrigin(req)) return send(res, 403, 'text/plain', 'Forbidden')
    const pending = t ? this.pendingSetup.get(t) : undefined
    if (!pending || pending.expires < Date.now()) return html(res, 400, setupPage('Setup timed out. Start again.'))
    const f = await readForm(req)
    const step = verifyTotp(pending.secret, f.code ?? '')
    if (step === null) return html(res, 400, setupTotpPage(qrSvg(pending.secret, req.headers.host ?? 'LocalClaude'), pending.secret, 'That code is wrong. Check the time on your phone and try the newest code.'))
    this.auth.createAccount(pending.password, pending.secret, step)
    this.pendingSetup.clear()
    log('info', 'web: account created')
    const token = this.auth.createSession(false, this.ip(req), String(req.headers['user-agent'] ?? ''))
    res.setHeader('Set-Cookie', [this.cookie(SETUP_COOKIE, '', 0), this.cookie(COOKIE, token, this.auth.sessionMaxAge(false))])
    return redirect(res, '/')
  }

  private async loginPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.sameOrigin(req)) return send(res, 403, 'text/plain', 'Forbidden')
    const ip = this.ip(req)
    const wait = this.auth.lockedFor(ip)
    if (wait) {
      log('warn', `web: sign-in refused, locked (${ip})`)
      return html(res, 429, loginPage(`Too many wrong tries. Wait ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'} and try again.`))
    }
    const f = await readForm(req)
    if (!this.auth.verify(f.password ?? '', f.code ?? '')) {
      this.auth.recordFailure(ip)
      log('warn', `web: failed sign-in from ${ip}`)
      return html(res, 401, loginPage('The password or code is wrong.'))
    }
    this.auth.clearFailures(ip)
    const shared = f.shared === '1'
    const token = this.auth.createSession(shared, ip, String(req.headers['user-agent'] ?? ''))
    log('info', `web: signed in from ${ip}${shared ? ' (shared computer)' : ''}`)
    res.setHeader('Set-Cookie', this.cookie(COOKIE, token, this.auth.sessionMaxAge(shared)))
    return redirect(res, '/')
  }

  // ---------------------------------------------------------------- API
  private events(req: IncomingMessage, res: ServerResponse): void {
    const id = randomBytes(8).toString('hex')
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    res.write(`retry: 3000\n\ndata: ${encodeWire({ ch: 'web:hello', payload: { clientId: id } })}\n\n`)
    this.clients.set(id, res)
    req.on('close', () => {
      this.clients.delete(id)
      // a pick this tab was answering won't be answered now
      for (const [pid, p] of this.picks) if (p.clientId === id) this.finishPick(pid, null)
    })
  }

  private async invoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req, 64 * 1024 * 1024)
    let ch = ''
    let args: unknown[] = []
    try {
      const msg = decodeWire(body.toString('utf8')) as { ch: string; args: unknown[] }
      ch = String(msg.ch)
      args = Array.isArray(msg.args) ? msg.args : []
    } catch {
      return send(res, 400, 'text/plain', 'Bad request')
    }
    const fn = this.o.handlers.get(ch)
    if (!fn) return json(res, 404, { ok: false, error: `Unknown call ${ch}` })
    const clientId = typeof req.headers['x-localclaude-client'] === 'string' ? req.headers['x-localclaude-client'] : undefined
    const call: CallContext = { clientId, downloads: [] }
    let out: { ok: boolean; value?: unknown; error?: string }
    try {
      out = { ok: true, value: await ctx.run(call, () => fn(...args)) }
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    // files the call saved through a stand-in save dialog go to the browser
    ctx.run(call, () => {
      for (const p of call.downloads) this.offerDownload(p)
    })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(encodeWire(out))
  }

  private async upload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const len = Number(req.headers['content-length'] ?? 0)
    if (len > MAX_UPLOAD) return send(res, 413, 'text/plain', 'File too large')
    const name = basename(url.searchParams.get('name') || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200) || 'file'
    const dir = join(this.uploadsDir, new Date().toISOString().slice(0, 10), randomBytes(6).toString('hex'))
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_UPLOAD) req.destroy(new Error('too large'))
    })
    try {
      await pipeline(req, createWriteStream(path))
    } catch {
      rmSync(dir, { recursive: true, force: true })
      return send(res, 413, 'text/plain', 'Upload failed')
    }
    return json(res, 200, { path })
  }

  private download(res: ServerResponse, token: string): void {
    const d = this.downloads.get(token)
    if (!d || d.expires < Date.now() || !existsSync(d.path)) return send(res, 404, 'text/plain', 'This download has expired')
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': statSync(d.path).size,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'cache-control': 'no-store'
    })
    createReadStream(d.path).pipe(res)
  }

  /** artifact://, lcimg:// and lcmod:// from the desktop app, as /proto/<scheme>/… */
  private async proto(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const m = /^\/proto\/(artifact|lcimg|lcmod)\/(.*)$/.exec(url.pathname)
    const handler = m ? this.o.protocols[m[1]] : undefined
    if (!m || !handler) return send(res, 404, 'text/plain', 'Not found')
    const r = await handler(new Request(`${m[1]}://${m[2]}${url.search}`, { method: req.method }))
    const headers: Record<string, string> = {}
    r.headers.forEach((v, k) => (headers[k] = v))
    if (m[1] === 'artifact') {
      // the page runs with an opaque origin even if opened on its own, so it can't reach the app
      headers['content-security-policy'] = (headers['content-security-policy'] ?? "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'") + "; sandbox allow-scripts allow-popups allow-forms allow-modals; frame-ancestors 'self'"
    } else headers['x-frame-options'] = 'DENY'
    delete headers['access-control-allow-origin']
    res.writeHead(r.status, headers)
    res.end(Buffer.from(await r.arrayBuffer()))
  }

  private static(res: ServerResponse, path: string): void {
    const dir = this.o.rendererDir
    if (path === '/' || path === '/index.html') {
      if (!this.indexHtml) {
        // the desktop page's CSP names the app:// schemes; the browser version uses its own (sent as a header)
        this.indexHtml = readFileSync(join(dir, 'index.html'), 'utf8').replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, '')
      }
      res.writeHead(200, { 'content-type': MIME['.html'], 'content-security-policy': APP_CSP, 'x-frame-options': 'DENY', 'cache-control': 'no-store' })
      return void res.end(this.indexHtml)
    }
    const file = normalize(join(dir, decodeURIComponent(path)))
    if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'text/plain', 'Not found')
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': path.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'no-cache'
    })
    createReadStream(file).pipe(res)
  }
}

// ---------------------------------------------------------------- helpers
export function workspaceDir(): string {
  return process.env.LOCALCLAUDE_WORKSPACE || process.env.HOME || '/'
}

function listDir(p: string): { path: string; parent: string | null; dirs: string[] } {
  const path = resolve(p)
  const dirs = readdirSync(path, { withFileTypes: true })
    .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith('.'))
    .filter((d) => {
      try {
        return d.isDirectory() || statSync(join(path, d.name)).isDirectory()
      } catch {
        return false
      }
    })
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
  const parent = resolve(path, '..')
  return { path, parent: parent === path ? null : parent, dirs }
}

function qrSvg(secret: string, host: string): string {
  const q = qrcode(0, 'M')
  q.addData(otpauthUrl(secret, host.replace(/:\d+$/, ''), 'LocalClaude'))
  q.make()
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
}

function safeEqual(a: string, b: string): boolean {
  const h = (s: string): Buffer => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(a.trim()), h(b))
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        req.destroy()
        fail(new Error('Request too large'))
      } else chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks)))
    req.on('error', fail)
  })
}

async function readForm(req: IncomingMessage): Promise<Record<string, string | undefined>> {
  const body = await readBody(req, 64 * 1024)
  return Object.fromEntries(new URLSearchParams(body.toString('utf8')))
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', encodeWire(value))
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': MIME['.html'], 'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'cache-control': 'no-store' })
  res.end(body)
}

function redirect(res: ServerResponse, to: string): void {
  res.writeHead(303, { location: to, 'cache-control': 'no-store' })
  res.end()
}
