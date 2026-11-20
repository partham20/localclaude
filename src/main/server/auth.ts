// Sign-in for the browser version: one account (password + authenticator code), sessions in cookies,
// and limits on failed attempts. Everything lives in the server's data folder; the 2FA secret is
// encrypted with the server secret, and session tokens are only kept as hashes.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { verifyTotp } from './totp'

interface AccountFile {
  version: 1
  /** scrypt$N$r$p$salt$hash (base64) */
  password: string
  /** 2FA secret, AES-256-GCM with a key from the server secret: iv.tag.data (base64) */
  totp: string
  totpLastStep: number
  createdAt: number
  passwordChangedAt: number
}

export interface WebSession {
  id: string
  created: number
  lastSeen: number
  /** "This is a shared computer": short idle timeout, cookie ends with the browser */
  shared: boolean
  ip: string
  agent: string
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1 }
const scryptOpts = { ...SCRYPT, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 }

export function hashPassword(pw: string): string {
  const salt = randomBytes(16)
  const h = scryptSync(pw.normalize('NFKC'), salt, 32, scryptOpts)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`
}

export function checkPassword(pw: string, stored: string): boolean {
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt') return false
  const N = Number(n)
  const want = Buffer.from(hash, 'base64')
  const got = scryptSync(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N, r: Number(r), p: Number(p), maxmem: 128 * N * Number(r) * 2 })
  return timingSafeEqual(got, want)
}

/** Rules for a new password. Returns a problem, or null when it's fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.'
  if (pw.length > 256) return 'That password is too long.'
  if (/^(.)\1+$/.test(pw)) return 'Pick something less repetitive.'
  return null
}

const NORMAL = { idleMs: 7 * 24 * 3600_000, maxMs: 30 * 24 * 3600_000 }
const SHARED = { idleMs: 30 * 60_000, maxMs: 12 * 3600_000 }

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

export class WebAuth {
  private account: AccountFile | null = null
  /** sessions by the hash of their token */
  private sessions = new Map<string, WebSession>()
  private key: Buffer
  private failures = new Map<string, { count: number; until: number; first: number }>()
  private globalFails: number[] = []
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    private accountFile: string,
    private sessionsFile: string,
    secret: string
  ) {
    this.key = createHash('sha256').update('localclaude-web-auth:' + secret).digest()
    mkdirSync(dirname(accountFile), { recursive: true })
    if (existsSync(accountFile)) this.account = JSON.parse(readFileSync(accountFile, 'utf8')) as AccountFile
    if (existsSync(sessionsFile)) {
      try {
        const list = JSON.parse(readFileSync(sessionsFile, 'utf8')) as [string, WebSession][]
        for (const [h, s] of list) this.sessions.set(h, s)
        this.prune()
      } catch {
        /* start with no sessions */
      }
    }
  }

  get hasAccount(): boolean {
    return !!this.account
  }

  // ---------------------------------------------------------------- account
  private seal(text: string): string {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key, iv)
    const data = Buffer.concat([c.update(text, 'utf8'), c.final()])
    return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.')
  }

  private open(sealed: string): string {
    const [iv, tag, data] = sealed.split('.').map((s) => Buffer.from(s, 'base64'))
    const d = createDecipheriv('aes-256-gcm', this.key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(data), d.final()]).toString('utf8')
  }

  private writeAccount(): void {
    const tmp = this.accountFile + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.account, null, 2), { mode: 0o600 })
    renameSync(tmp, this.accountFile)
  }

  createAccount(password: string, totpSecret: string, step: number): void {
    if (this.account) throw new Error('An account already exists')
    const now = Date.now()
    this.account = { version: 1, password: hashPassword(password), totp: this.seal(totpSecret), totpLastStep: step, createdAt: now, passwordChangedAt: now }
    this.writeAccount()
  }

  /** Password and current authenticator code. A code works once. */
  verify(password: string, code: string): boolean {
    const a = this.account
    if (!a) return false
    const pwOk = checkPassword(password, a.password)
    let secret: string
    try {
      secret = this.open(a.totp)
    } catch {
      // the server secret changed: the 2FA secret can't be read, so nobody can sign in
      return false
    }
    const step = verifyTotp(secret, code, a.totpLastStep)
    if (!pwOk || step === null) return false
    a.totpLastStep = step
    this.writeAccount()
    return true
  }

  changePassword(current: string, code: string, next: string): string | null {
    if (!this.verify(current, code)) return 'The current password or code is wrong.'
    const problem = passwordProblem(next)
    if (problem) return problem
    this.account!.password = hashPassword(next)
    this.account!.passwordChangedAt = Date.now()
    this.writeAccount()
    return null
  }

  // ---------------------------------------------------------------- failed attempts
  /** Seconds to wait before another try from this address (or from anywhere), or 0. */
  lockedFor(ip: string, now = Date.now()): number {
    this.globalFails = this.globalFails.filter((t) => now - t < 3600_000)
    // many failures from everywhere: someone is guessing from many addresses
    if (this.globalFails.length >= 30) return Math.ceil((this.globalFails[this.globalFails.length - 30] + 3600_000 - now) / 1000)
    const f = this.failures.get(ip)
    return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0
  }

  recordFailure(ip: string, now = Date.now()): void {
    this.globalFails.push(now)
    const f = this.failures.get(ip) ?? { count: 0, until: 0, first: now }
    if (now - f.first > 3600_000) Object.assign(f, { count: 0, first: now })
    f.count++
    // 5 wrong tries: wait 15 minutes, doubling after that (at most a day)
    if (f.count >= 5) f.until = now + Math.min(24 * 3600_000, 15 * 60_000 * 2 ** (f.count - 5))
    this.failures.set(ip, f)
  }

  clearFailures(ip: string): void {
    this.failures.delete(ip)
  }

  // ---------------------------------------------------------------- sessions
  createSession(shared: boolean, ip: string, agent: string): string {
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    this.sessions.set(sha(token), { id: randomBytes(6).toString('hex'), created: now, lastSeen: now, shared, ip, agent: agent.slice(0, 200) })
    this.persist()
    return token
  }

  /** The session for a cookie token, if it's still valid (and marks it as used). */
  check(token: string | undefined, now = Date.now()): WebSession | null {
    if (!token || !this.account) return null
    const h = sha(token)
    const s = this.sessions.get(h)
    if (!s) return null
    const lim = s.shared ? SHARED : NORMAL
    if (now - s.lastSeen > lim.idleMs || now - s.created > lim.maxMs || s.created < this.account.passwordChangedAt) {
      this.sessions.delete(h)
      this.persist()
      return null
    }
    if (now - s.lastSeen > 60_000) {
      s.lastSeen = now
      this.persist()
    }
    return s
  }

  endSession(token: string | undefined): void {
    if (token && this.sessions.delete(sha(token))) this.persist()
  }

  endAllSessions(): void {
    this.sessions.clear()
    this.persist()
  }

  listSessions(): WebSession[] {
    this.prune()
    return [...this.sessions.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  }

  sessionMaxAge(shared: boolean): number | null {
    return shared ? null : Math.floor(NORMAL.maxMs / 1000)
  }

  private prune(now = Date.now()): void {
    for (const [h, s] of this.sessions) {
      const lim = s.shared ? SHARED : NORMAL
      if (now - s.lastSeen > lim.idleMs || now - s.created > lim.maxMs) this.sessions.delete(h)
    }
  }

  private persist(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      const tmp = this.sessionsFile + '.tmp'
      writeFileSync(tmp, JSON.stringify([...this.sessions]), { mode: 0o600 })
      renameSync(tmp, this.sessionsFile)
    }, 200)
  }
}
