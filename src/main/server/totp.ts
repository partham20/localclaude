// Time-based one-time codes (RFC 6238, the 6-digit codes authenticator apps show), without dependencies.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('Invalid base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new 160-bit secret, base32 as authenticator apps expect it. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

const STEP = 30

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const off = h[h.length - 1] & 15
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

export const currentStep = (now = Date.now()): number => Math.floor(now / 1000 / STEP)

/**
 * Checks a code against the previous, current and next 30-second step (clocks drift).
 * Returns the matching step, or null. Pass the last step used to refuse a code that was already used.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep = -1, now = Date.now()): number | null {
  const c = String(code).replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return null
  const cur = currentStep(now)
  for (const step of [cur - 1, cur, cur + 1]) {
    if (step <= lastUsedStep) continue
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(c))) return step
  }
  return null
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`
}
