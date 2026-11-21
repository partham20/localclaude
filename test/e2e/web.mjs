// End-to-end test of server mode (the browser version): starts the built app with --server and a
// scripted Claude, then drives it in a real browser with Playwright: first-time setup with 2FA,
// a chat with a streamed reply, an artifact, a permission prompt, a file upload, sign-out, wrong-code
// lockout and sign-in again. Run with `npm run test:web` (after `npm run build`).
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  ;({ chromium } = await import('playwright'))
}

const PORT = 8000 + Math.floor(Math.random() * 900)
const BASE = `http://127.0.0.1:${PORT}`
const SETUP = 'e2e-setup-code'
const PASSWORD = 'correct horse battery staple'
const work = mkdtempSync(join(tmpdir(), 'lc-web-'))
const workspace = join(work, 'workspace')
mkdirSync(join(workspace, 'project-a'), { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- TOTP, as an authenticator app computes it
function b32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, val = 0
  const out = []
  for (const c of s.replace(/\s/g, '')) {
    val = (val << 5) | A.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}
function totp(secret, offset = 0) {
  const step = Math.floor(Date.now() / 30000) + offset
  const c = Buffer.alloc(8)
  c.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', b32(secret)).update(c).digest()
  const o = h[h.length - 1] & 15
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0')
}

// ---- the server
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.DISPLAY
Object.assign(env, {
  LOCALCLAUDE_SERVER: '1',
  LOCALCLAUDE_PORT: String(PORT),
  LOCALCLAUDE_DATA: join(work, 'data'),
  LOCALCLAUDE_SECRET: 'e2e-secret-0123456789abcdef',
  LOCALCLAUDE_SETUP_CODE: SETUP,
  LOCALCLAUDE_WORKSPACE: workspace,
  LOCALCLAUDE_FAKE_AGENT: '1',
  LOCALCLAUDE_TEST_MODE: '1',
  CLAUDE_CONFIG_DIR: join(work, 'claude-home'),
  LOCALCLAUDE_CLAUDE_CONFIG: join(work, 'claude-config.json'),
  LOCALCLAUDE_MODS_DIR: join(work, 'mods'),
  LOCALCLAUDE_OBSIDIAN_CONFIG: join(work, 'obsidian.json')
})
const server = spawn(electron, ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', resolve('.')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))

let browser
let failed = false
let n = 0
async function step(name, fn) {
  n++
  const t = Date.now()
  try {
    await fn()
    console.log(`✓ ${n}. ${name} (${Date.now() - t} ms)`)
  } catch (e) {
    console.log(`✗ ${n}. ${name}\n  ${e.stack ?? e}`)
    failed = true
    throw e
  }
}

try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(BASE + '/healthz')).ok) break
    } catch {}
    if (i > 100) throw new Error('server did not start:\n' + serverLog)
    await sleep(200)
  }
  // LOCALCLAUDE_CHROME: an installed Chrome/Chromium instead of Playwright's own download (CI uses the runner's Chrome)
  browser = await chromium.launch(process.env.LOCALCLAUDE_CHROME ? { executablePath: process.env.LOCALCLAUDE_CHROME } : {})
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  let secret = ''
  /** a GET from inside the signed-in page (with its cookie) */
  const get = (path) =>
    page.evaluate(async (p) => {
      const r = await fetch(p, { redirect: 'manual' })
      return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() }
    }, path)


  await step('the API refuses calls without a session', async () => {
    const r = await fetch(BASE + '/api/invoke', { method: 'POST', headers: { 'x-localclaude': '1', 'content-type': 'application/json' }, body: '{"ch":"sessions:list","args":[]}' })
    if (r.status !== 401) throw new Error('expected 401, got ' + r.status)
  })

  await step('first visit goes to setup; a wrong setup code is refused', async () => {
    await page.goto(BASE + '/')
    if (!page.url().endsWith('/setup')) throw new Error('not on /setup: ' + page.url())
    await page.fill('#sc', 'wrong')
    await page.fill('#pw', PASSWORD)
    await page.fill('#pw2', PASSWORD)
    await page.click('button[type=submit]')
    await page.waitForSelector('.err:has-text("setup code is wrong")')
  })

  await step('a short password is refused', async () => {
    await page.fill('#sc', SETUP)
    await page.fill('#pw', 'short')
    await page.fill('#pw2', 'short')
    await page.evaluate(() => document.querySelectorAll('input').forEach((i) => i.removeAttribute('minlength')))
    await page.click('button[type=submit]')
    await page.waitForSelector('.err:has-text("12 characters")')
  })

  await step('setup shows a QR code; a wrong code is refused, the right one finishes setup', async () => {
    await page.fill('#sc', SETUP)
    await page.fill('#pw', PASSWORD)
    await page.fill('#pw2', PASSWORD)
    await page.click('button[type=submit]')
    await page.waitForSelector('.qr svg')
    secret = (await page.textContent('.secret')).replace(/\s/g, '')
    await page.fill('#code', '000000' === totp(secret) ? '111111' : '000000')
    await page.click('button[type=submit]')
    await page.waitForSelector('.err:has-text("code is wrong")')
    await page.fill('#code', totp(secret))
    await page.click('button[type=submit]')
    await page.waitForSelector('.side-new', { timeout: 20000 })
  })

  await step('the app loads with its own security headers', async () => {
    const r = await get('/')
    if (r.status !== 200 || !r.body.includes('id="root"')) throw new Error('app page not served: ' + r.status)
    const csp = r.headers['content-security-policy'] ?? ''
    if (!csp.includes("frame-ancestors 'none'") || !csp.includes("script-src 'self'")) throw new Error('missing CSP: ' + csp)
    if (r.headers['x-frame-options'] !== 'DENY') throw new Error('missing X-Frame-Options')
  })

  const send = async (text, expect) => {
    await page.waitForSelector('.composer-input')
    await page.fill('.composer-input', text)
    await page.press('.composer-input', 'Enter')
    if (expect) await page.waitForFunction((e) => [...document.querySelectorAll('.turn')].some((t) => t.innerText.includes(e)) && !document.querySelector('.send.stop'), expect)
  }

  await step('a new chat gets a streamed reply', async () => {
    await page.click('.side-new')
    await send('hello from the browser', 'Echo: hello from the browser')
    await page.waitForSelector('.session-item')
  })

  await step('an artifact shows in a sandboxed frame served by the server', async () => {
    await send('make artifact please', 'I made a demo page')
    const frame = await page.waitForSelector('.artifact-panel .artifact-frame')
    const src = await frame.getAttribute('src')
    if (!src.startsWith('/proto/artifact/view/')) throw new Error('unexpected frame src ' + src)
    const r = await get(src)
    if (r.status !== 200) throw new Error('artifact not served: ' + r.status)
    if (!(r.headers['content-security-policy'] ?? '').includes('sandbox allow-scripts')) throw new Error('artifact page is not sandboxed')
    await page.click('.artifact-head button[title="Close"]')
  })

  await step('a permission prompt can be answered', async () => {
    await send('ask permission now')
    await page.waitForSelector('.perm-card')
    await page.click('.perm-card .btn:has-text("Allow once")')
    await page.waitForFunction(() => [...document.querySelectorAll('.turn')].some((t) => t.innerText.includes('Permission granted')) && !document.querySelector('.send.stop'))
  })

  await step('the folder picker lists the workspace and returns a choice', async () => {
    const picked = page.evaluate(() => window.api.pickFolder('Choose a folder'))
    await page.waitForSelector('[role=dialog][aria-label="Choose a folder"]')
    await page.click('[role=dialog] button:has-text("project-a")')
    await page.waitForFunction(() => document.querySelector('[role=dialog] input')?.value.endsWith('/project-a'))
    await page.click('[role=dialog] button:has-text("Choose this folder")')
    const got = await picked
    if (got !== join(workspace, 'project-a')) throw new Error('picked ' + got)
  })

  await step('files picked in the browser are uploaded to the server', async () => {
    const local = join(work, 'notes.txt')
    writeFileSync(local, 'hello upload')
    const picked = page.evaluate(() => window.api.pickFiles())
    await page.waitForSelector('[role=dialog][aria-label="Attach files"]')
    const chooser = page.waitForEvent('filechooser')
    await page.click('[role=dialog] div:has-text("Click to choose files")')
    await (await chooser).setFiles(local)
    const paths = await picked
    if (paths.length !== 1 || !paths[0].endsWith('notes.txt') || !paths[0].startsWith(join(work, 'data'))) throw new Error('uploaded to ' + JSON.stringify(paths))
  })

  await step('a save goes to the browser as a download', async () => {
    const download = page.waitForEvent('download')
    const sid = await page.evaluate(async () => (await window.api.listSessions())[0].id)
    const arts = await page.evaluate(async (s) => window.api.listArtifacts(s), sid)
    await page.evaluate(async ([s, a]) => window.api.saveArtifact(s, a, 0), [sid, arts[0].id])
    const d = await download
    if (!d.suggestedFilename()) throw new Error('no file name')
  })

  await step('on a phone-sized screen, Settings is a full-screen list, then one section with a back button', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE + '/')
    await page.waitForSelector('.app')
    if (await page.$('.sidebar.overlay:not(.collapsed)')) throw new Error('the sidebar should start closed on a phone')
    await page.keyboard.press('Control+,')
    await page.waitForSelector('.settings-modal.show-list')
    const box = await (await page.$('.settings-modal')).boundingBox()
    if (box.width < 389 || box.height < 843) throw new Error('Settings is not full screen: ' + JSON.stringify(box))
    await page.click('.modal-nav .nav-item[data-tab="account"]')
    await page.waitForSelector('.settings-modal.show-detail .sheet-title:has-text("Account")')
    await page.click('.sheet-back')
    await page.waitForSelector('.settings-modal.show-list')
    await page.click('.sheet-close >> nth=0')
    await page.waitForSelector('.settings-modal', { state: 'detached' })
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  await step('the account page lists this session; sign out works', async () => {
    await page.goto(BASE + '/account')
    await page.waitForSelector('td:has-text("(this one)")')
    await page.click('form[action="/logout"] button')
    await page.waitForURL(/\/login$/)
    const r = await page.request.post(BASE + '/api/invoke', { headers: { 'x-localclaude': '1', 'content-type': 'application/json' }, data: '{"ch":"sessions:list","args":[]}' })
    if (r.status() !== 401) throw new Error('still signed in after sign-out: ' + r.status())
  })

  await step('cross-site posts are refused', async () => {
    const r = await fetch(BASE + '/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=x&code=123456' })
    if (r.status !== 403) throw new Error('expected 403, got ' + r.status)
  })

  await step('wrong codes lock sign-in for a while', async () => {
    const ctx2 = await browser.newContext()
    const p2 = await ctx2.newPage()
    for (let i = 0; i < 5; i++) {
      await p2.goto(BASE + '/login')
      await p2.fill('#pw', PASSWORD)
      await p2.fill('#code', '123456' === totp(secret) ? '654321' : '123456')
      await p2.click('button[type=submit]')
    }
    await p2.goto(BASE + '/login')
    await p2.fill('#pw', PASSWORD)
    await p2.fill('#code', totp(secret, 1))
    await p2.click('button[type=submit]')
    await p2.waitForSelector('.err:has-text("Too many wrong tries")')
    await ctx2.close()
  })

  await step('after a restart the data still opens, and a shared-computer sign-in uses a browser-session cookie', async () => {
    // all tests share one address, so check sign-in itself on a fresh server process
    server.kill('SIGTERM')
    await new Promise((r) => server.once('exit', r))
    const again = spawn(electron, ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', resolve('.')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    again.stdout.on('data', (d) => (serverLog += d))
    again.stderr.on('data', (d) => (serverLog += d))
    globalThis.again = again
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(BASE + '/healthz')).ok) break
      } catch {}
      if (i > 100) throw new Error('server did not restart')
      await sleep(200)
    }
    await page.goto(BASE + '/login')
    if (await page.isVisible('#sc')) throw new Error('setup shown again after restart')
    // the next step's code: the one used for setup can't be used twice
    const code = totp(secret, 1)
    await page.fill('#pw', PASSWORD)
    await page.fill('#code', code)
    await page.check('input[name=shared]')
    await page.click('button[type=submit]')
    await page.waitForSelector('.session-item', { timeout: 20000 }).catch(async (e) => {
      throw new Error(e.message + '\nPage: ' + page.url() + '\n' + (await page.innerText('body')).slice(0, 500))
    })
    const cookies = await context.cookies()
    const c = cookies.find((x) => x.name === 'lc_session')
    if (!c || c.expires !== -1) throw new Error('a shared-computer sign-in should use a browser-session cookie')
    if (!c.httpOnly || c.sameSite !== 'Strict') throw new Error('cookie flags: ' + JSON.stringify(c))
  })
} catch {
  failed = true
} finally {
  await browser?.close().catch(() => {})
  server.kill('SIGTERM')
  globalThis.again?.kill('SIGTERM')
  await sleep(500)
  if (failed) console.log('\n--- server log ---\n' + serverLog.split('\n').filter((l) => !/dbus|Fontconfig|NODE_OPTION/.test(l)).slice(-60).join('\n'))
  rmSync(work, { recursive: true, force: true })
  console.log(failed ? '\n✗ server-mode tests failed' : '\n✓ server-mode tests passed')
  process.exit(failed ? 1 : 0)
}
