# Customizing LocalClaude

LocalClaude 1.4 lets you change nearly everything about how it looks and works, from a few clicks to your own code:

| Where | What you can change |
|---|---|
| **Settings → Appearance** | Light, dark or system mode · 9 built-in themes (and any a mod adds) · accent color · **every color** (background, sidebar, text, borders, your messages, modes, status colors…) · interface, reply and code fonts, or any font installed on your computer · zoom · reply text size · chat width · density · corner style · frosted glass · glow · animations · bubbles or plain messages · **your own CSS** · copy your look and paste it on another computer |
| **Settings → Keyboard** | Every app shortcut: click it and press new keys (Backspace removes it). Clashes are flagged |
| **Ctrl+K** | The command palette: every action, setting page, theme and chat, plus commands from mods |
| **Settings → Mods** | Mods from your mods folder: CSS, themes and scripts |

## Mods

A mod is a folder inside your **mods folder** (Settings → Mods → *Open mods folder*; it's `mods/` in the app-data folder). The folder holds a `mod.json` and the files it names. Mods are off until you switch them on in Settings → Mods. After you edit a mod's files, click **Reload mods** (or bind *Reload mods* to a key).

The quickest way to start is **Settings → Mods → Add the example mod**, which writes a working mod with a theme, CSS and a script to copy from.

### mod.json

```json
{
  "id": "my-mod",
  "name": "My mod",
  "version": "1.0.0",
  "description": "What it does, in a sentence.",
  "author": "You",
  "homepage": "https://example.com",
  "styles": ["style.css"],
  "themes": ["midnight-blue.json"],
  "main": "main.js"
}
```

| Field | |
|---|---|
| `id` | Letters, digits, `-` and `_`. Defaults to the folder's name |
| `name` | Shown in Settings |
| `styles` | CSS files added to the page while the mod is on |
| `themes` | Theme files (or theme objects written inline), listed with the built-in themes |
| `main` | A JavaScript module that runs while the mod is on (see below) |

Every path must stay inside the mod's folder.

### CSS

Anything in a mod's CSS is added to LocalClaude's page. Colors are CSS variables, so a few lines go a long way:

```css
:root[data-theme='dark'] {
  --bg: #0b0e14;
  --accent: #ffb454;
}
.sidebar { border-right: 2px solid var(--accent); }
.turn > .md { letter-spacing: 0.01em; }
```

Useful variables: `--bg`, `--bg-elev`, `--sidebar`, `--text`, `--muted`, `--side-text`, `--border`, `--border-strong`, `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent`, `--user-bubble`, `--input-bg`, `--input-border`, `--hover`, `--active`, `--code-inline`, `--ok`, `--warn`, `--danger`, `--mode-edits`, `--mode-plan`, `--sans`, `--serif`, `--mono`, `--reply-size`, `--chat-width`, and the radii `--r-xs` … `--r-xl`.

The page's `<html>` element also carries what you chose in Appearance: `data-theme` (light/dark), `data-preset`, `data-density`, `data-corners`, `data-glass`, `data-motion`, `data-bubbles`, `data-backdrop`. Your own CSS from Settings → Appearance is added after every mod, so it always wins.

### Themes

```json
{
  "id": "midnight-blue",
  "name": "Midnight blue",
  "description": "Shown as the theme's tooltip.",
  "light": { "bg": "#f6f8fc", "sidebar": "#eef2f9", "text": "#101828", "muted": "#5b6474", "border": "#dde3ee", "accent": "#2563eb", "user-bubble": "#e7edf8" },
  "dark":  { "bg": "#0b1020", "sidebar": "#080c18", "text": "#e6ebf5", "muted": "#8b95a8", "border": "#1c2540", "accent": "#60a5fa", "user-bubble": "#141c33" }
}
```

Give `light`, `dark` or both (a theme with only one switches the window to that mode). You only need the main colors: hover, borders, inputs, accent shades and the text on accent buttons are worked out from them. Any variable above (without `--`) can be set too. Colors can be hex, `rgb()`, `hsl()`, `oklch()` or a color name.

### Scripts

`main` is an ES module whose default export is called with the mod API when the mod is switched on. Return a function to clean up anything the API doesn't; everything you add through the API is removed automatically when the mod is switched off or reloaded.

```js
export default function activate(lc) {
  lc.commands.register({
    id: 'focus',
    title: 'Focus mode',
    shortcut: 'Mod+Shift+F',
    run: () => lc.app.setAppearance({ chatWidth: 700, density: 'spacious' })
  })
  lc.ui.addSidebarItem({ id: 'focus', label: 'Focus', icon: 'sparkle', onClick: () => lc.commands.run('focus') })
  const s = lc.ui.addStatusItem({ id: 'clock', text: new Date().toLocaleTimeString() })
  const t = setInterval(() => s.update({ text: new Date().toLocaleTimeString() }), 1000)
  return () => clearInterval(t)
}
```

| API | |
|---|---|
| `lc.id`, `lc.appVersion` | The mod's id and LocalClaude's version |
| `lc.commands.register({ id, title, run, shortcut?, keywords? })` | A command in the palette (Ctrl+K), with an optional shortcut like `Mod+Shift+H` (Mod is Ctrl, or ⌘ on a Mac). App shortcuts win if they clash |
| `lc.commands.run(id)` | Run one of your commands (or another mod's, by its full `modId:commandId`) |
| `lc.themes.register(theme)` | Add a theme from code (same format as a theme file) |
| `lc.ui.toast(text, { error? })` | A short message at the bottom of the window |
| `lc.ui.addStyle(css)` | Add CSS; returns a function that removes it |
| `lc.ui.setCssVar(name, value)` | Set a CSS variable on the page |
| `lc.ui.addSidebarItem({ id, label, icon?, title?, onClick })` | A button under Projects, Artifacts and Design |
| `lc.ui.addStatusItem({ id, text, title?, onClick? })` | A small item above your name in the sidebar; returns `{ update(patch), dispose() }` |
| `lc.events.on(event, callback)` | `chat-opened` `{ id }`, `turn-done` `{ sessionId, stats }`, `theme-changed` `{ dark }` |
| `lc.app.newChat()` | Start a new chat |
| `lc.app.send(text)` | Send a message in the open chat (or a new one) |
| `lc.app.activeChat()` | `{ id, title, cwd }` of the open chat, or `null` |
| `lc.app.openSettings(tab?)` | `general`, `appearance`, `keyboard`, `mods`, `tools`, `memory`, `account`… |
| `lc.app.open(page)` | `projects`, `artifacts` or `designs` |
| `lc.app.appearance()` / `lc.app.setAppearance(patch)` | Read or change Appearance settings (any field: `preset`, `accent`, `colors`, `zoom`, `replySize`, `chatWidth`, `density`, `corners`, `glass`, `animations`, `userBubbles`, `backdrop`, `customCss`…) |
| `lc.app.setTheme('light' \| 'dark' \| 'system')` | Switch the mode |
| `lc.storage.get(key)` / `set(key, value)` / `remove(key)` | Small values kept for your mod on this computer |

Icons for sidebar items: `sparkle`, `spark`, `palette`, `puzzle`, `keyboard`, `key`, `sun`, `moon`, `chat`, `compose`, `project`, `folder`, `file`, `search`, `settings`, `globe`, `terminal`, `bulb`, `pin`, `memory`, `grid`, `layout`, `image`, `penTool`, `shapes` and more (anything unknown shows `sparkle`).

A script can import other files from its folder (`import { x } from './lib.js'`) and load images or fonts from it (`lcmod://<mod id>/<file>`).

### Safety

Styles and themes only change how things look. **A script runs inside LocalClaude with everything the app can do**, including reading your chats and starting new ones, which is why LocalClaude asks before switching on a mod with a script. Only switch on mods you wrote or trust. Mod files are served only while the mod is on, and only from its own folder.
