import type { ModelOption } from './types'

/**
 * Shown until Claude Code reports the real menu for this account (it does on the first message of any chat,
 * and the app remembers it). Aliases, not ids, so Claude Code resolves each to the newest model of that family.
 */
export const MODEL_ALIASES: ModelOption[] = [
  { value: '', displayName: 'Default', description: "Claude Code's default for your plan" },
  { value: 'fable', displayName: 'Fable', description: 'Most capable, for the hardest and longest tasks' },
  { value: 'opus', displayName: 'Opus', description: 'Very capable, for complex work' },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Fast and capable' },
  { value: 'haiku', displayName: 'Haiku', description: 'Fastest' }
]

/** Strongest first. Unknown values keep their place after the families we know. */
const FAMILY_ORDER = ['fable', 'opus', 'sonnet', 'haiku']
function rank(value: string): number {
  const v = value.toLowerCase()
  const i = FAMILY_ORDER.findIndex((f) => v.startsWith(f) || v.includes('-' + f + '-'))
  return i < 0 ? FAMILY_ORDER.length : i
}

/**
 * The menu to show: "Default" first, then what Claude Code reported (or the built-in aliases when it hasn't yet),
 * ordered strongest first, with duplicates and Claude Code's own "default" entry dropped.
 */
export function claudeModelMenu(reported: ModelOption[]): ModelOption[] {
  const source = reported.length ? reported : MODEL_ALIASES
  const seen = new Set<string>([''])
  const rest: ModelOption[] = []
  for (const m of source) {
    if (!m.value || m.value === 'default' || seen.has(m.value)) continue
    seen.add(m.value)
    rest.push(m)
  }
  rest.sort((a, b) => rank(a.value) - rank(b.value))
  return [MODEL_ALIASES[0], ...rest]
}
