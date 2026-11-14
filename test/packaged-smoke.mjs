// Launches a packaged LocalClaude (the unpacked folder electron-builder makes, which is what the
// portable zip and tar.gz hold) and checks its window really comes up: the setup screen when
// nobody is signed in, or the app itself. Uses a throwaway profile, so it never touches yours.
//
//   node test/packaged-smoke.mjs release/win-unpacked/LocalClaude.exe
//   node test/packaged-smoke.mjs release/linux-unpacked/localclaude
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const exe = resolve(process.argv[2] ?? '')
if (!process.argv[2] || !existsSync(exe)) {
  console.error(`✗ no packaged app at ${exe}`)
  process.exit(1)
}

const freePort = () =>
  new Promise((done, fail) => {
    const s = createServer()
    s.on('error', fail)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => done(port))
    })
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const port = await freePort()
const profile = mkdtempSync(join(tmpdir(), 'lc-packaged-'))
const env = { ...process.env, LOCALCLAUDE_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
// CI's Linux machines (and root) don't set up Chromium's sandbox helper
const noSandbox = process.platform === 'linux' && (process.env.CI || process.getuid?.() === 0)
const child = spawn(exe, [`--remote-debugging-port=${port}`, ...(noSandbox ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (d) => (output += d))
child.stderr.on('data', (d) => (output += d))
let exited = null
child.on('exit', (code, signal) => (exited = { code, signal }))
child.on('error', (e) => (exited = { error: String(e) }))

const stop = () => {
  if (exited) return
  // the whole tree: Electron's helper processes too
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  else child.kill('SIGKILL')
}

/** Run an expression in the app's window over the DevTools protocol. */
async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl)
  try {
    await new Promise((ok, fail) => {
      ws.onopen = ok
      ws.onerror = () => fail(new Error('could not connect to the window'))
    })
    const reply = new Promise((ok, fail) => {
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data)
        if (msg.id === 1) (msg.error ? fail(new Error(msg.error.message)) : ok(msg.result))
      }
      setTimeout(() => fail(new Error('the window did not answer')), 10000)
    })
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    const r = await reply
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  } finally {
    ws.close()
  }
}

const LOOK = `(() => {
  const has = (s) => !!document.querySelector(s)
  return { setup: has('.setup-card'), app: has('.sidebar'), title: document.title, text: (document.body?.innerText ?? '').slice(0, 200) }
})()`

let seen = null
let last = 'the window never opened'
const deadline = Date.now() + 90000
try {
  while (Date.now() < deadline && !exited) {
    await sleep(500)
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = pages.find((p) => p.type === 'page' && !p.url.startsWith('devtools://'))
      if (!page) continue
      const look = await evaluate(page.webSocketDebuggerUrl, LOOK)
      last = `window open (${page.url.slice(0, 80)}) but neither the setup screen nor the app showed: ${JSON.stringify(look)}`
      if (look.setup || look.app) {
        seen = look
        break
      }
    } catch (e) {
      last = String(e)
    }
  }
} finally {
  stop()
  await sleep(500)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Windows can hold files for a moment after the app is stopped */
  }
}

if (!seen) {
  console.error(`✗ the packaged app did not come up: ${exited ? `it exited (${JSON.stringify(exited)})` : last}`)
  if (output.trim()) console.error('--- its output ---\n' + output.trim().slice(-3000))
  process.exit(1)
}
console.log(`✓ the packaged app starts: ${seen.setup ? 'the setup screen' : 'the app'} is showing (“${seen.text.split('\n').find((l) => l.trim()) ?? seen.title}”)`)
process.exit(0)
