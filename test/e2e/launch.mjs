// Starts the end-to-end tests: the real app (built into out/) under Electron, with a scripted Claude.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron') // the binary's path when required from Node
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE // VS Code sets this; it would make Electron run as plain Node
// CI's Linux machines don't set up Chromium's sandbox helper
const flags = process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []
const args = process.argv.slice(2)
// `--setup` runs only the setup-screen suite; a step name runs the main suite up to that step
const suites = args.includes('--setup') ? ['setup'] : args.length ? ['main'] : ['main', 'setup']

function run(suite) {
  return new Promise((done) => {
    const child = spawn(electron, [...flags, resolve('test/e2e/run.mjs'), ...args.filter((a) => a !== '--setup')], {
      stdio: 'inherit',
      env: { ...env, LOCALCLAUDE_E2E_SUITE: suite }
    })
    const timer = setTimeout(() => {
      console.error(`✗ end-to-end tests (${suite}) timed out`)
      child.kill()
      done(1)
    }, 10 * 60 * 1000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      done(code ?? 1)
    })
  })
}

for (const suite of suites) {
  console.log(`\n— ${suite === 'main' ? 'the app' : 'setup screen, themes and mods'} —`)
  const code = await run(suite)
  if (code) process.exit(code)
}
process.exit(0)
