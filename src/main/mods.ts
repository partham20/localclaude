// Mods: folders of CSS, themes and scripts in <app data>/mods that change LocalClaude.
// Each mod is a folder with a mod.json (see MODS.md). Styles and themes are read here and
// sent to the window; a mod's script is served to the window over lcmod:// while the mod is on.
import { app, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize, relative, sep } from 'node:path'
import { modThemeId, parseManifest, parseTheme, type ModInfo, type ThemePreset } from '../shared/customize'

/** the mods folder (LOCALCLAUDE_MODS_DIR for tests) */
export function modsDir(): string {
  return process.env.LOCALCLAUDE_MODS_DIR || join(app.getPath('userData'), 'mods')
}

const MAX_FILE = 2 * 1024 * 1024

/** A file inside a mod's folder, or null if the path would leave it. */
export function modFile(modDir: string, rel: string): string | null {
  const p = normalize(join(modDir, rel))
  const r = relative(modDir, p)
  if (!r || r.startsWith('..') || r.includes(`..${sep}`) || /^[a-z]:/i.test(r)) return null
  return p
}

function readText(path: string): string {
  if (statSync(path).size > MAX_FILE) throw new Error(`${path} is larger than 2 MB`)
  return readFileSync(path, 'utf8')
}

/** Every mod in the mods folder, with what's wrong with the ones that can't load. */
export function listMods(dir = modsDir()): ModInfo[] {
  if (!existsSync(dir)) return []
  const out: ModInfo[] = []
  for (const name of readdirSync(dir).sort()) {
    const folder = join(dir, name)
    try {
      if (!statSync(folder).isDirectory() || name.startsWith('.')) continue
    } catch {
      continue
    }
    const base: ModInfo = { id: name, name, css: '', themes: [], dir: folder }
    const manifestFile = join(folder, 'mod.json')
    if (!existsSync(manifestFile)) {
      out.push({ ...base, error: 'No mod.json in this folder.' })
      continue
    }
    let raw: unknown
    try {
      raw = JSON.parse(readText(manifestFile))
    } catch (e) {
      out.push({ ...base, error: `mod.json isn’t valid JSON: ${e instanceof Error ? e.message : e}` })
      continue
    }
    const parsed = parseManifest(raw, name)
    if ('error' in parsed) {
      out.push({ ...base, error: parsed.error })
      continue
    }
    const m = parsed.manifest
    const info: ModInfo = { ...base, id: m.id, name: m.name, version: m.version, description: m.description, author: m.author, homepage: m.homepage }
    try {
      info.css = (m.styles ?? [])
        .map((rel) => {
          const f = modFile(folder, rel)
          if (!f || !existsSync(f)) throw new Error(`Style file “${rel}” wasn’t found.`)
          return `/* ${m.id}: ${rel} */\n` + readText(f)
        })
        .join('\n')
      const themes: ThemePreset[] = []
      for (const t of m.themes ?? []) {
        let rawTheme: unknown = t
        if (typeof t === 'string') {
          const f = modFile(folder, t)
          if (!f || !existsSync(f)) throw new Error(`Theme file “${t}” wasn’t found.`)
          rawTheme = JSON.parse(readText(f))
        }
        const theme = parseTheme(rawTheme, m.name)
        if (!theme) throw new Error(`A theme in this mod needs an id, a name, and light or dark colors.`)
        themes.push({ ...theme, id: modThemeId(m.id, theme.id) })
      }
      info.themes = themes
      if (m.main) {
        const f = modFile(folder, m.main)
        if (!f || !existsSync(f)) throw new Error(`Script “${m.main}” wasn’t found.`)
        info.main = m.main
      }
    } catch (e) {
      info.error = e instanceof Error ? e.message : String(e)
    }
    // two folders with the same id: the second one is reported, not loaded
    if (out.some((x) => x.id === info.id && !x.error)) info.error = `Another mod already uses the id “${info.id}”.`
    out.push(info)
  }
  return out
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
}

/**
 * lcmod://<mod id>/<file>: a file from a mod that's switched on (its script, and anything that
 * script imports or loads). Anything else is a 404.
 */
export function serveModFile(url: string, enabled: (id: string) => boolean, dir = modsDir()): Response {
  const u = new URL(url)
  const id = u.hostname
  const mod = enabled(id) ? listMods(dir).find((m) => m.id === id && !m.error) : undefined
  if (!mod) return new Response('Mod not found or switched off', { status: 404 })
  const f = modFile(mod.dir, decodeURIComponent(u.pathname.replace(/^\/+/, '')))
  if (!f || !existsSync(f) || !statSync(f).isFile()) return new Response('Not found', { status: 404 })
  const type = TYPES[extname(f).toLowerCase()]
  if (!type) return new Response('Not a file type mods can serve', { status: 403 })
  return new Response(new Uint8Array(readFileSync(f)), { headers: { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' } })
}

export function openModsFolder(): Promise<string> {
  mkdirSync(modsDir(), { recursive: true })
  return shell.openPath(modsDir())
}

/** Write the example mod (styles, a theme and a script) so there's something to start from. Returns its id. */
export function createExampleMod(dir = modsDir()): string {
  const id = 'example-mod'
  const folder = join(dir, id)
  mkdirSync(folder, { recursive: true })
  const files: Record<string, string> = {
    'mod.json': JSON.stringify(
      {
        id,
        name: 'Example mod',
        version: '1.0.0',
        description: 'A starting point: a theme, a little CSS, a command, a sidebar button and a status item. Edit the files, then Reload in Settings → Mods.',
        author: 'You',
        styles: ['style.css'],
        themes: ['ocean.json'],
        main: 'main.js'
      },
      null,
      2
    ),
    'style.css': `/* Anything here is added to LocalClaude's page while the mod is on.
   Every color is a CSS variable (--bg, --text, --accent…), so you can restyle a lot with a few lines. */

/* a soft accent line under the top bar */
.titlebar {
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent) 25%, transparent);
}
`,
    'ocean.json': JSON.stringify(
      {
        id: 'ocean',
        name: 'Ocean',
        description: 'Deep sea blues (from the example mod).',
        light: { bg: '#f3f8fb', 'bg-elev': '#ffffff', sidebar: '#e8f1f6', text: '#0d2230', muted: '#4f6b7b', border: '#d5e3ec', accent: '#0e7490', 'user-bubble': '#e2eef4' },
        dark: { bg: '#061420', 'bg-elev': '#0b1d2c', sidebar: '#04101a', text: '#dceaf3', muted: '#7d98aa', border: '#14304a', accent: '#22d3ee', 'user-bubble': '#0f2638' }
      },
      null,
      2
    ),
    'main.js': `// A mod's script: a JavaScript module whose default export gets the mod API.
// It runs in LocalClaude's window while the mod is on. See MODS.md for everything the API can do.
export default function activate(lc) {
  // a command in the command palette (Ctrl+K), with an optional shortcut
  lc.commands.register({
    id: 'say-hello',
    title: 'Example: say hello',
    shortcut: 'Mod+Shift+H',
    run: () => lc.ui.toast('Hello from the example mod 👋')
  })

  // a button in the sidebar
  lc.ui.addSidebarItem({ id: 'hello', label: 'Example mod', icon: 'spark', onClick: () => lc.commands.run('say-hello') })

  // a status item at the bottom of the sidebar that counts finished replies
  let replies = Number(lc.storage.get('replies') ?? 0)
  const status = lc.ui.addStatusItem({ id: 'replies', text: replies + (replies === 1 ? ' reply' : ' replies'), title: 'Replies since you turned the example mod on' })
  lc.events.on('turn-done', () => {
    replies += 1
    lc.storage.set('replies', replies)
    status.update({ text: replies + (replies === 1 ? ' reply' : ' replies') })
  })

  // return a function to clean up anything the API doesn't (it's called when the mod is switched off)
  return () => {}
}
`
  }
  for (const [name, body] of Object.entries(files)) {
    const f = join(folder, name)
    if (!existsSync(f)) writeFileSync(f, body)
  }
  return id
}
