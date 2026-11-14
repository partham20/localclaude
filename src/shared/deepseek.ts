// DeepSeek Harness (dsh, https://github.com/deepseek-ai/deepseek-harness): the second engine a chat
// can run on. Shared by the main process and the window.
import type { AppSettings, Engine } from './types'

/** the npm package that ships the dsh command */
export const DSH_PACKAGE = '@deepseek-ai/dsh'

export const ENGINES: { value: Engine; label: string; short: string; hint: string }[] = [
  { value: 'claude', label: 'Claude Code', short: 'Claude', hint: 'Claude models, with your subscription or Console key' },
  { value: 'deepseek', label: 'DeepSeek Harness', short: 'DeepSeek', hint: 'DeepSeek models through dsh, billed to your DeepSeek API key' }
]

export const engineLabel = (e: Engine | undefined): string => ENGINES.find((x) => x.value === (e ?? 'claude'))!.label

/**
 * dsh's models, used until a running dsh lists its own. Values are dsh's model option values
 * (a JSON [provider, model] pair), so they can be passed straight back to it.
 */
export const DEEPSEEK_MODELS: { value: string; displayName: string; description: string }[] = [
  { value: '', displayName: 'Default', description: 'DeepSeek Harness’s default (V4 Flash)' },
  { value: '["deepseek-official","deepseek-v4-flash"]', displayName: 'DeepSeek V4 Flash', description: 'Fast and cheap' },
  { value: '["deepseek-official","deepseek-flash"]', displayName: 'DeepSeek V4.1 Flash', description: 'Newer Flash' },
  { value: '["deepseek-official","deepseek-v4-pro"]', displayName: 'DeepSeek V4 Pro', description: 'Stronger agentic coding and reasoning, at a higher cost' }
]

export const DEEPSEEK_EFFORTS: { value: AppSettings['deepseekEffort']; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' }
]

/** ["deepseek-official","deepseek-v4-pro"] → DeepSeek V4 Pro */
export function deepseekModelLabel(value: string, models = DEEPSEEK_MODELS): string {
  const known = models.find((m) => m.value === value)
  if (known) return known.displayName
  try {
    const pair = JSON.parse(value) as unknown
    if (Array.isArray(pair) && typeof pair[1] === 'string') return pair[1]
  } catch {
    /* not a pair */
  }
  return value || 'Default'
}

/** Whether dsh can run here, and how it would be started. Never contains the API key. */
export interface DeepSeekStatus {
  /** dsh was found */
  found: boolean
  /** where: installed by LocalClaude, npm's global folder, a dsh command on PATH, or your own command */
  via?: 'app' | 'global' | 'path' | 'custom' | 'env'
  /** the dsh entry file or command */
  location?: string
  version?: string
  /** a DeepSeek API key is saved in LocalClaude, or DEEPSEEK_API_KEY is set */
  key?: 'saved' | 'env'
  /** npm is available, so LocalClaude can install dsh for you */
  canInstall: boolean
  /** an install is running now */
  installing: boolean
}

/** Progress of "Install DeepSeek Harness" (npm output, then the result). */
export interface DeepSeekInstallEvent {
  type: 'output' | 'done'
  text?: string
  ok?: boolean
  error?: string
}
