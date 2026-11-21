// Server-mode settings, from environment variables (see docs/self-hosting.md).
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ServerConfig {
  port: number
  host: string
  dataDir: string
  /** encrypts the app's data and the 2FA secret; keep it outside the data folder */
  secret: string
  /** stands in for the OS machine id the desktop app binds its data to */
  machineId: string
  trustProxy: boolean
  insecureCookies: boolean
}

const on = (v: string | undefined): boolean => !!v && !/^(0|false|no|off)$/i.test(v)

export function serverConfig(): ServerConfig | null {
  const env = process.env
  if (!on(env.LOCALCLAUDE_SERVER) && !process.argv.includes('--server')) return null
  env.LOCALCLAUDE_SERVER = '1'
  const dataDir = env.LOCALCLAUDE_DATA || join(homedir(), '.localclaude-server')
  mkdirSync(dataDir, { recursive: true })

  let secret = env.LOCALCLAUDE_SECRET?.trim() || ''
  if (!secret && env.LOCALCLAUDE_SECRET_FILE) secret = readFileSync(env.LOCALCLAUDE_SECRET_FILE, 'utf8').trim()
  if (!secret) {
    // works, but the key then sits next to the data it protects; the docs say to set LOCALCLAUDE_SECRET
    const f = join(dataDir, 'secret')
    if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('base64url'), { mode: 0o600 })
    secret = readFileSync(f, 'utf8').trim()
    console.warn('LocalClaude: LOCALCLAUDE_SECRET is not set, so a generated key in the data folder is used.')
  }
  if (secret.length < 16) throw new Error('LOCALCLAUDE_SECRET must be at least 16 characters (use: openssl rand -base64 32)')

  env.LOCALCLAUDE_USER_DATA ||= join(dataDir, 'app')
  return {
    port: Number(env.LOCALCLAUDE_PORT || env.PORT || 8080),
    host: env.LOCALCLAUDE_HOST || '127.0.0.1',
    dataDir,
    secret,
    machineId: 'server:' + createHash('sha256').update('localclaude-machine:' + secret).digest('hex'),
    trustProxy: on(env.LOCALCLAUDE_TRUST_PROXY),
    insecureCookies: on(env.LOCALCLAUDE_INSECURE_COOKIES)
  }
}
