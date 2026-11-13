// Everything you can change about how LocalClaude looks and behaves: themes, colors, fonts,
// layout, keyboard shortcuts, and mods. Pure helpers shared by the window, the main process and the tests.

// ---------------------------------------------------------------- appearance

export type Density = 'compact' | 'comfortable' | 'spacious'
export type Corners = 'sharp' | 'soft' | 'round'

export interface Appearance {
  /** a built-in theme or one a mod adds ('claude' is LocalClaude's own palette) */
  preset: string
  /** accent color ('' = the theme's own) */
  accent: string
  /** your own colors for any theme token (see COLOR_TOKENS), applied over the theme in light and dark */
  colors: Record<string, string>
  /** font for code ('system' = the platform's monospace font) */
  monoFont: 'system' | 'jetbrains-mono'
  /** any font installed on this computer, used instead of the interface / reply font when set */
  customUiFont: string
  customReplyFont: string
  /** whole-window zoom, 0.8–1.4 */
  zoom: number
  /** size of Claude's replies in px */
  replySize: number
  /** widest the conversation gets, in px */
  chatWidth: number
  density: Density
  corners: Corners
  /** frosted, translucent sidebar, menus and dialogs */
  glass: boolean
  /** transitions and little animations */
  animations: boolean
  /** your messages as bubbles, or plain text with a bar */
  userBubbles: boolean
  /** a soft gradient glow behind empty screens */
  backdrop: boolean
  /** your own CSS, added last so it wins */
  customCss: string
}

export const DEFAULT_APPEARANCE: Appearance = {
  preset: 'claude',
  accent: '',
  colors: {},
  monoFont: 'system',
  customUiFont: '',
  customReplyFont: '',
  zoom: 1,
  replySize: 17.5,
  chatWidth: 820,
  density: 'comfortable',
  corners: 'soft',
  glass: true,
  animations: true,
  userBubbles: true,
  backdrop: true,
  customCss: ''
}

export const LIMITS = {
  zoom: { min: 0.8, max: 1.4, step: 0.05 },
  replySize: { min: 13, max: 24, step: 0.5 },
  chatWidth: { min: 600, max: 1600, step: 20 }
}

const clamp = (n: unknown, lo: number, hi: number, d: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : d
  return Math.min(hi, Math.max(lo, v))
}

/** Settings saved by an older version (or edited by hand) filled in and kept in range. */
export function normalizeAppearance(a: Partial<Appearance> | null | undefined): Appearance {
  const x = { ...DEFAULT_APPEARANCE, ...(a ?? {}) }
  return {
    ...x,
    colors: x.colors && typeof x.colors === 'object' ? Object.fromEntries(Object.entries(x.colors).filter(([k, v]) => isToken(k) && isColor(v))) : {},
    accent: isColor(x.accent) ? x.accent : '',
    zoom: clamp(x.zoom, LIMITS.zoom.min, LIMITS.zoom.max, 1),
    replySize: clamp(x.replySize, LIMITS.replySize.min, LIMITS.replySize.max, 17.5),
    chatWidth: clamp(x.chatWidth, LIMITS.chatWidth.min, LIMITS.chatWidth.max, 820),
    density: (['compact', 'comfortable', 'spacious'] as const).includes(x.density) ? x.density : 'comfortable',
    corners: (['sharp', 'soft', 'round'] as const).includes(x.corners) ? x.corners : 'soft',
    monoFont: x.monoFont === 'jetbrains-mono' ? 'jetbrains-mono' : 'system',
    customUiFont: cleanFontName(x.customUiFont),
    customReplyFont: cleanFontName(x.customReplyFont),
    customCss: typeof x.customCss === 'string' ? x.customCss : ''
  }
}

/** A font family name someone typed, safe to put in a CSS font-family list. */
export function cleanFontName(s: unknown): string {
  return String(s ?? '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .slice(0, 60)
}

/** A CSS color we accept for a token: hex, rgb()/hsl()/oklch(), or a named color. Nothing that could break out of the value. */
export function isColor(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > 80) return false
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([\d\s.,%/+-]+\)$/i.test(v) || /^[a-z]{3,20}$/i.test(v)
}

// ---------------------------------------------------------------- themes

/** Theme tokens you can recolor, with what each one paints. They are CSS variables (--bg, --text…). */
export const COLOR_TOKENS: { token: string; label: string; group: 'Surfaces' | 'Text' | 'Accents' | 'Status' }[] = [
  { token: 'bg', label: 'Background', group: 'Surfaces' },
  { token: 'bg-elev', label: 'Cards and menus', group: 'Surfaces' },
  { token: 'sidebar', label: 'Sidebar', group: 'Surfaces' },
  { token: 'user-bubble', label: 'Your messages', group: 'Surfaces' },
  { token: 'input-bg', label: 'Reply box', group: 'Surfaces' },
  { token: 'border', label: 'Borders', group: 'Surfaces' },
  { token: 'text', label: 'Text', group: 'Text' },
  { token: 'muted', label: 'Secondary text', group: 'Text' },
  { token: 'side-text', label: 'Sidebar text', group: 'Text' },
  { token: 'code-inline', label: 'Inline code', group: 'Text' },
  { token: 'accent', label: 'Accent', group: 'Accents' },
  { token: 'mode-edits', label: 'Auto-accept edits mode', group: 'Accents' },
  { token: 'mode-plan', label: 'Plan mode', group: 'Accents' },
  { token: 'ok', label: 'Success', group: 'Status' },
  { token: 'warn', label: 'Warning', group: 'Status' },
  { token: 'danger', label: 'Danger', group: 'Status' }
]
const TOKEN_SET = new Set([
  ...COLOR_TOKENS.map((t) => t.token),
  'bg-elev',
  'hover',
  'active',
  'border-strong',
  'accent-hover',
  'accent-soft',
  'code-bg',
  'faint',
  'new-icon-bg',
  'search-bg',
  'search-border',
  'input-border',
  'chip-bg',
  'glow-1',
  'glow-2',
  'on-accent'
])
export const isToken = (k: string): boolean => TOKEN_SET.has(k)

export type Palette = Record<string, string>

export interface ThemePreset {
  id: string
  name: string
  /** one line about it */
  description?: string
  /** colors for light and dark; leave one out and that mode keeps LocalClaude's own palette */
  light?: Palette
  dark?: Palette
  /** a theme that only makes sense in one mode switches the window to it */
  mode?: 'light' | 'dark'
  /** where it came from: built in, or the mod that added it */
  source?: string
}

/** Text on an accent-colored button: white, or near-black when the accent is light. */
export function onAccent(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (!m) return '#ffffff'
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // white unless it would fall below 3:1 (the minimum for large text and controls)
  return 1.05 / (lum + 0.05) >= 3 ? '#ffffff' : '#111111'
}

/** Fill in the tokens a short palette leaves out (hover, borders, inputs…), from the ones it gives. */
export function expandPalette(p: Palette, dark: boolean): Palette {
  const out: Palette = { ...p }
  const text = p.text
  if (text) {
    out.hover ??= `color-mix(in srgb, ${text} ${dark ? 8 : 6}%, transparent)`
    out.active ??= `color-mix(in srgb, ${text} ${dark ? 14 : 10}%, transparent)`
    out.faint ??= `color-mix(in srgb, ${text} ${dark ? 28 : 30}%, transparent)`
    out['new-icon-bg'] ??= `color-mix(in srgb, ${text} ${dark ? 12 : 8}%, transparent)`
    out['chip-bg'] ??= `color-mix(in srgb, ${text} ${dark ? 10 : 6}%, transparent)`
  }
  if (p.border) {
    out['border-strong'] ??= `color-mix(in srgb, ${p.border} 70%, ${text ?? (dark ? '#fff' : '#000')} 30%)`
    out['search-border'] ??= p.border
  }
  if (p['bg-elev']) {
    out['search-bg'] ??= p['bg-elev']
    out['input-bg'] ??= p['bg-elev']
  }
  if (out['border-strong']) out['input-border'] ??= out['border-strong']
  if (p.text && !p['side-text']) out['side-text'] = `color-mix(in srgb, ${p.text} 82%, ${p.sidebar ?? p.bg ?? 'transparent'})`
  if (p.accent) {
    out['accent-hover'] ??= `color-mix(in srgb, ${p.accent} 85%, ${dark ? '#fff' : '#000'})`
    out['accent-soft'] ??= `color-mix(in srgb, ${p.accent} ${dark ? 18 : 13}%, transparent)`
    out['glow-1'] ??= `color-mix(in srgb, ${p.accent} ${dark ? 22 : 16}%, transparent)`
    out['on-accent'] ??= onAccent(p.accent)
  }
  return out
}

export const BUILTIN_THEMES: ThemePreset[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Warm paper and ink, like the Claude app.',
    // the same colors as base.css, so previews show it; picking it sets nothing extra
    light: { bg: '#faf9f5', 'bg-elev': '#ffffff', sidebar: '#f5f4ee', text: '#1f1e1d', muted: '#6f6c64', border: 'rgba(31, 30, 29, 0.14)', accent: '#c2603e', 'user-bubble': '#efece3' },
    dark: { bg: '#151515', 'bg-elev': '#1d1d1d', sidebar: '#111111', text: '#f0efec', muted: '#898781', border: '#292929', accent: '#d97757', 'user-bubble': '#212121', 'input-bg': '#20201f' }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep navy with a periwinkle accent.',
    light: { bg: '#f7f8fb', 'bg-elev': '#ffffff', sidebar: '#eef0f6', text: '#161a23', muted: '#5f6879', border: '#dfe3ec', accent: '#4f5fe8', 'user-bubble': '#e8ebf6', 'code-inline': '#4351c9', 'glow-2': 'rgba(56, 189, 248, 0.12)' },
    dark: { bg: '#0d1017', 'bg-elev': '#151a23', sidebar: '#0a0d13', text: '#e6e9ef', muted: '#8a93a6', border: '#222937', accent: '#7c8cff', 'user-bubble': '#1b2130', 'input-bg': '#121722', 'code-inline': '#a5b0ff', 'glow-2': 'rgba(56, 189, 248, 0.12)' }
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Violet and teal glow on near-black.',
    light: { bg: '#fbfaff', 'bg-elev': '#ffffff', sidebar: '#f3f1fb', text: '#1b1930', muted: '#6b6880', border: '#e4e0f2', accent: '#7c3aed', 'user-bubble': '#efebfb', 'code-inline': '#6d28d9', 'glow-2': 'rgba(20, 184, 166, 0.14)' },
    dark: { bg: '#0f0f14', 'bg-elev': '#17171f', sidebar: '#0b0b10', text: '#ededf2', muted: '#8e8ea0', border: '#24242f', accent: '#a78bfa', 'user-bubble': '#1e1e2a', 'input-bg': '#15151d', 'code-inline': '#c4b5fd', 'glow-2': 'rgba(45, 212, 191, 0.14)' }
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Cool arctic blues.',
    light: { bg: '#eceff4', 'bg-elev': '#f8f9fb', sidebar: '#e5e9f0', text: '#2e3440', muted: '#5e687c', border: '#d8dee9', accent: '#5e81ac', 'user-bubble': '#e0e5ed', 'code-inline': '#5e81ac' },
    dark: { bg: '#2e3440', 'bg-elev': '#3b4252', sidebar: '#292e39', text: '#eceff4', muted: '#a3acbd', border: '#434c5e', accent: '#88c0d0', 'user-bubble': '#3b4252', 'input-bg': '#353b49', 'code-inline': '#8fbcbb', ok: '#a3be8c', warn: '#ebcb8b', danger: '#bf616a' }
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Moss greens, easy on the eyes.',
    light: { bg: '#f6f8f4', 'bg-elev': '#ffffff', sidebar: '#edf1ea', text: '#18221c', muted: '#5b6b60', border: '#dde4d9', accent: '#2f8f5f', 'user-bubble': '#e6ede3', 'code-inline': '#2a7a52' },
    dark: { bg: '#121714', 'bg-elev': '#18201b', sidebar: '#0e1310', text: '#e4ece6', muted: '#8b9a90', border: '#233029', accent: '#5fbf8f', 'user-bubble': '#1c2620', 'input-bg': '#161d19', 'code-inline': '#86d6ad' }
  },
  {
    id: 'rose',
    name: 'Rosé',
    description: 'Muted roses and dusk purples.',
    light: { bg: '#faf4ed', 'bg-elev': '#fffaf3', sidebar: '#f2e9e1', text: '#575279', muted: '#797593', border: '#e8ddd2', accent: '#b4637a', 'user-bubble': '#f2e9e1', 'code-inline': '#907aa9' },
    dark: { bg: '#191724', 'bg-elev': '#1f1d2e', sidebar: '#15131f', text: '#e0def4', muted: '#908caa', border: '#2a273f', accent: '#eb6f92', 'user-bubble': '#26233a', 'input-bg': '#1c1a2a', 'code-inline': '#c4a7e7', ok: '#9ccfd8', warn: '#f6c177' }
  },
  {
    id: 'solar',
    name: 'Solar',
    description: 'The classic Solarized palette.',
    light: { bg: '#fdf6e3', 'bg-elev': '#fffbef', sidebar: '#eee8d5', text: '#073642', muted: '#657b83', border: '#e4dcc4', accent: '#cb4b16', 'user-bubble': '#eee8d5', 'code-inline': '#d33682' },
    dark: { bg: '#002b36', 'bg-elev': '#073642', sidebar: '#00232c', text: '#eee8d5', muted: '#93a1a1', border: '#0e4553', accent: '#b58900', 'user-bubble': '#0a3a47', 'input-bg': '#04313d', 'code-inline': '#2aa198' }
  },
  {
    id: 'mono',
    name: 'Mono',
    description: 'High-contrast black and white with a blue accent.',
    light: { bg: '#ffffff', 'bg-elev': '#ffffff', sidebar: '#f4f4f5', text: '#09090b', muted: '#52525b', border: '#e4e4e7', accent: '#2563eb', 'user-bubble': '#f1f1f3', 'code-inline': '#1d4ed8' },
    dark: { bg: '#000000', 'bg-elev': '#0d0d0f', sidebar: '#050506', text: '#fafafa', muted: '#a1a1aa', border: '#27272a', accent: '#3b82f6', 'user-bubble': '#161618', 'input-bg': '#0b0b0d', 'code-inline': '#93c5fd' }
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm amber and coral, dark only.',
    mode: 'dark',
    dark: { bg: '#17120f', 'bg-elev': '#211915', sidebar: '#120e0b', text: '#f6ebe2', muted: '#a8968a', border: '#33271f', accent: '#ff8a5b', 'user-bubble': '#2a1f19', 'input-bg': '#1c1612', 'code-inline': '#ffb38a', 'glow-2': 'rgba(244, 63, 94, 0.14)' }
  }
]

/** Accent colors offered as swatches (any color works). */
export const ACCENT_SWATCHES = ['#d97757', '#e5484d', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#64748b']

/**
 * The CSS variables to set on the page for this appearance: the theme's palette for the mode,
 * your accent, then your own colors. Empty for LocalClaude's own palette with nothing changed.
 */
export function themeVars(a: Appearance, dark: boolean, themes: ThemePreset[]): Record<string, string> {
  const preset = themes.find((t) => t.id === a.preset)
  // LocalClaude's own theme is base.css itself; only an accent or your colors change it
  const base = preset?.id === 'claude' ? {} : ((dark ? preset?.dark : preset?.light) ?? {})
  const palette: Palette = { ...base }
  if (a.accent) {
    palette.accent = a.accent
    for (const k of ['accent-hover', 'accent-soft', 'glow-1']) delete palette[k]
  }
  for (const [k, v] of Object.entries(a.colors)) if (isColor(v)) palette[k] = v
  const full = expandPalette(palette, dark)
  // tokens the user set win over derived ones
  for (const [k, v] of Object.entries(a.colors)) if (isColor(v)) full[k] = v
  return Object.fromEntries(Object.entries(full).filter(([k, v]) => isToken(k) && typeof v === 'string'))
}

/** The colors to draw a theme's preview card with. */
export function previewVars(theme: ThemePreset, dark: boolean): Record<string, string> {
  const p = (dark ? theme.dark : theme.light) ?? theme.dark ?? theme.light ?? {}
  return Object.fromEntries(Object.entries(expandPalette(p, dark)).filter(([k]) => isToken(k)))
}

/** Which mode the window should be in: a one-mode theme picks it, otherwise your Light / Dark / System choice. */
export function effectiveDark(theme: 'system' | 'light' | 'dark', systemDark: boolean, preset?: ThemePreset): boolean {
  if (preset?.mode) return preset.mode === 'dark'
  return theme === 'dark' || (theme !== 'light' && systemDark)
}

/** A theme shared as JSON (exported from Settings, or a mod's theme file), checked before it's used. */
export function parseTheme(raw: unknown, source?: string): ThemePreset | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const id = typeof t.id === 'string' ? t.id.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : ''
  const name = typeof t.name === 'string' ? t.name.slice(0, 40) : ''
  if (!id || !name) return null
  const palette = (p: unknown): Palette | undefined => {
    if (!p || typeof p !== 'object') return undefined
    const out = Object.fromEntries(Object.entries(p as Record<string, unknown>).filter(([k, v]) => isToken(k) && isColor(v))) as Palette
    return Object.keys(out).length ? out : undefined
  }
  const light = palette(t.light)
  const dark = palette(t.dark)
  if (!light && !dark) return null
  return {
    id,
    name,
    description: typeof t.description === 'string' ? t.description.slice(0, 120) : undefined,
    light,
    dark,
    mode: t.mode === 'light' || t.mode === 'dark' ? t.mode : !light ? 'dark' : !dark ? 'light' : undefined,
    source
  }
}

// ---------------------------------------------------------------- keyboard shortcuts

export interface KeyAction {
  id: string
  label: string
  /** e.g. 'Mod+Shift+E' (Mod is Ctrl, or ⌘ on a Mac); '' = no shortcut until you set one */
  default: string
}

export const KEY_ACTIONS: KeyAction[] = [
  { id: 'commandPalette', label: 'Command palette', default: 'Mod+K' },
  { id: 'newChat', label: 'New chat', default: 'Mod+N' },
  { id: 'settings', label: 'Settings', default: 'Mod+,' },
  { id: 'appearance', label: 'Appearance settings', default: 'Mod+Shift+,' },
  { id: 'toggleSidebar', label: 'Show or hide the sidebar', default: 'Mod+B' },
  { id: 'toggleTranscript', label: 'Show or hide Claude’s steps in detail', default: 'Mod+O' },
  { id: 'find', label: 'Find in chat', default: 'Mod+F' },
  { id: 'export', label: 'Export what’s on screen', default: 'Mod+Shift+E' },
  { id: 'back', label: 'Back', default: 'Alt+ArrowLeft' },
  { id: 'forward', label: 'Forward', default: 'Alt+ArrowRight' },
  { id: 'toggleTheme', label: 'Switch between light and dark', default: 'Mod+Shift+L' },
  { id: 'nextTheme', label: 'Next theme', default: '' },
  { id: 'zoomIn', label: 'Zoom in', default: '' },
  { id: 'zoomOut', label: 'Zoom out', default: '' },
  { id: 'zoomReset', label: 'Reset zoom', default: '' },
  { id: 'projects', label: 'Projects', default: '' },
  { id: 'artifacts', label: 'Artifacts', default: '' },
  { id: 'design', label: 'Design', default: '' },
  { id: 'reloadMods', label: 'Reload mods', default: '' }
]

const CODE_KEYS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space'
}
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/**
 * A key press as a shortcut string ('Mod+Shift+E'), or '' for a lone modifier. Letters, digits and
 * punctuation come from the physical key, so Shift+, is still ',' and layouts don't matter.
 */
export function comboFromEvent(e: KeyLike, mac = false): string {
  if (MODIFIER_KEYS.has(e.key)) return ''
  let key: string
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code]
  else if (e.key.length === 1) key = e.key.toUpperCase()
  else key = e.key
  const parts: string[] = []
  const mod = mac ? e.metaKey : e.ctrlKey
  if (mod) parts.push('Mod')
  if (mac && e.ctrlKey) parts.push('Ctrl')
  if (!mac && e.metaKey) parts.push('Meta')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** The shortcut for each action: yours where you changed it, else the default. */
export function resolveBindings(custom: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of KEY_ACTIONS) out[a.id] = custom && typeof custom[a.id] === 'string' ? custom[a.id] : a.default
  return out
}

/** Actions sharing a shortcut (the first one listed wins when you press it). */
export function conflicts(bindings: Record<string, string>): Record<string, string[]> {
  const byCombo: Record<string, string[]> = {}
  for (const [id, combo] of Object.entries(bindings)) if (combo) (byCombo[combo] ??= []).push(id)
  return Object.fromEntries(Object.entries(byCombo).filter(([, ids]) => ids.length > 1))
}

/** How a shortcut is shown: Ctrl+Shift+E, or ⌘⇧E on a Mac. */
export function displayCombo(combo: string, mac = false): string {
  if (!combo) return ''
  const names: Record<string, string> = mac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: '↩', Escape: 'Esc' }
    : { Mod: 'Ctrl', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc' }
  return combo
    .split('+')
    .map((p) => names[p] ?? p)
    .join(mac ? '' : '+')
}

// ---------------------------------------------------------------- mods

/** mod.json, in a folder of its own inside the mods folder. */
export interface ModManifest {
  /** letters, digits, - and _; the folder name is used when it's left out */
  id: string
  name: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  /** CSS files in the mod's folder, added to the page while the mod is on */
  styles?: string[]
  /** a JavaScript module in the mod's folder whose default export is activate(api) */
  main?: string
  /** theme files (JSON) in the mod's folder, or themes written inline */
  themes?: (string | ThemePreset)[]
}

/** A mod as the window sees it. */
export interface ModInfo {
  id: string
  name: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  /** the CSS of all its style files, in order */
  css: string
  /** it has a script (runs only while the mod is on) */
  main?: string
  themes: ThemePreset[]
  /** what's wrong with it, if it can't load */
  error?: string
  /** its folder on disk */
  dir: string
}

export const MOD_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

/** Check a mod.json. Paths must stay inside the mod's folder. */
export function parseManifest(raw: unknown, folder: string): { manifest: ModManifest } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'mod.json must be a JSON object.' }
  const m = raw as Record<string, unknown>
  const id = typeof m.id === 'string' && m.id ? m.id : folder
  if (!MOD_ID_RE.test(id)) return { error: `“${id}” isn’t a usable id (letters, digits, - and _ only).` }
  const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 60) : id
  const safePath = (p: unknown): string | null => {
    if (typeof p !== 'string' || !p) return null
    const n = p.replace(/\\/g, '/').replace(/^\.\//, '')
    if (n.startsWith('/') || /^[a-z]:/i.test(n) || n.split('/').includes('..')) return null
    return n
  }
  const styles = Array.isArray(m.styles) ? m.styles.map(safePath) : []
  if (styles.some((s) => s === null)) return { error: 'Every style must be a file inside the mod’s folder.' }
  let main: string | undefined
  if (m.main !== undefined) {
    const p = safePath(m.main)
    if (!p || !/\.m?js$/.test(p)) return { error: '“main” must be a .js file inside the mod’s folder.' }
    main = p
  }
  const themes: (string | ThemePreset)[] = []
  if (Array.isArray(m.themes))
    for (const t of m.themes) {
      if (typeof t === 'string') {
        const p = safePath(t)
        if (!p) return { error: 'Every theme file must be inside the mod’s folder.' }
        themes.push(p)
      } else if (t && typeof t === 'object') themes.push(t as ThemePreset)
    }
  const str = (v: unknown, n: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
  return {
    manifest: {
      id,
      name,
      version: str(m.version, 20),
      description: str(m.description, 300),
      author: str(m.author, 80),
      homepage: typeof m.homepage === 'string' && /^https?:\/\//.test(m.homepage) ? m.homepage : undefined,
      styles: styles as string[],
      main,
      themes
    }
  }
}

/** Mod themes get ids prefixed with the mod's, so two mods can't clash with each other or the built-in ones. */
export function modThemeId(modId: string, themeId: string): string {
  return `${modId}/${themeId}`
}
