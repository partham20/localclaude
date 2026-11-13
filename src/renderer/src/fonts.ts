import type { AppSettings, Appearance } from '../../shared/types'

// Bundled fonts (OFL) are imported in main.tsx; the others are system fonts.
export const REPLY_FONTS: { value: AppSettings['replyFont']; label: string; stack: string }[] = [
  { value: 'source-serif', label: 'Source Serif 4', stack: "'Source Serif 4 Variable', Georgia, serif" },
  { value: 'newsreader', label: 'Newsreader', stack: "'Newsreader Variable', Georgia, serif" },
  { value: 'lora', label: 'Lora', stack: "'Lora Variable', Georgia, serif" },
  { value: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  { value: 'georgia', label: 'Georgia', stack: 'Georgia, serif' },
  { value: 'cambria', label: 'Cambria', stack: 'Cambria, Georgia, serif' },
  { value: 'sans', label: 'Same as interface (sans-serif)', stack: 'var(--sans)' }
]

export const UI_FONTS: { value: AppSettings['uiFont']; label: string; stack: string }[] = [
  { value: 'dm-sans', label: 'DM Sans', stack: "'DM Sans Variable', system-ui, 'Segoe UI', sans-serif" },
  { value: 'inter', label: 'Inter', stack: "'Inter Variable', system-ui, 'Segoe UI', sans-serif" },
  { value: 'geist', label: 'Geist', stack: "'Geist Variable', system-ui, 'Segoe UI', sans-serif" },
  { value: 'system', label: 'System (Segoe UI)', stack: "system-ui, 'Segoe UI', Roboto, 'Noto Sans', sans-serif" }
]

export const MONO_FONTS: { value: Appearance['monoFont']; label: string; stack: string }[] = [
  { value: 'system', label: 'System monospace', stack: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, 'DejaVu Sans Mono', monospace" },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', stack: "'JetBrains Mono Variable', ui-monospace, Consolas, monospace" }
]

/** Point the --serif / --sans / --mono CSS variables at the chosen fonts (a font you typed in wins). */
export function applyFonts(s: Pick<AppSettings, 'replyFont' | 'uiFont'> & { appearance?: Pick<Appearance, 'monoFont' | 'customUiFont' | 'customReplyFont'> }): void {
  const root = document.documentElement.style
  const a = s.appearance
  const ui = (UI_FONTS.find((f) => f.value === s.uiFont) ?? UI_FONTS[0]).stack
  const reply = (REPLY_FONTS.find((f) => f.value === s.replyFont) ?? REPLY_FONTS[0]).stack
  root.setProperty('--sans', a?.customUiFont ? `'${a.customUiFont}', ${ui}` : ui)
  root.setProperty('--serif', a?.customReplyFont ? `'${a.customReplyFont}', ${reply}` : reply)
  root.setProperty('--mono', (MONO_FONTS.find((f) => f.value === a?.monoFont) ?? MONO_FONTS[0]).stack)
}
