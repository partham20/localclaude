// OpenCode (https://github.com/anomalyco/opencode, MIT): the third engine a chat can run on.
// Shared by the main process and the window. LocalClaude isn't made by, or affiliated with, the OpenCode team.

/** The npm packages OpenCode's prebuilt binaries ship in: @opencode/cli-<os>-<arch>[-musl] */
export const OPENCODE_NPM_SCOPE = '@opencode/cli'
export const OPENCODE_REPO = 'https://github.com/anomalyco/opencode'

/** OpenCode's models, used until a running OpenCode lists its own (which depends on the providers you've connected). */
export const OPENCODE_MODELS: { value: string; displayName: string; description: string }[] = [{ value: '', displayName: 'Default', description: 'OpenCode’s default model' }]

/** opencode/big-pickle → Big Pickle · OpenCode; openai/gpt-5.5 → gpt-5.5 */
export function opencodeModelLabel(value: string, models = OPENCODE_MODELS): string {
  const known = models.find((m) => m.value === value)
  if (known) return known.displayName
  if (!value) return 'Default'
  const i = value.indexOf('/')
  return i >= 0 ? value.slice(i + 1) : value
}

/** The provider part of an OpenCode model value (openai/gpt-5.5 → openai). */
export const opencodeProvider = (value: string): string => (value.includes('/') ? value.slice(0, value.indexOf('/')) : '')

/**
 * Providers you can give an API key for in Settings → OpenCode. The key goes to OpenCode as the
 * environment variable it reads for that provider (from models.dev). Anything else: add the variable by name.
 */
export const OPENCODE_PROVIDERS: { id: string; name: string; env: string; url: string }[] = [
  { id: 'openai', name: 'OpenAI', env: 'OPENAI_API_KEY', url: 'https://platform.openai.com/api-keys' },
  { id: 'google', name: 'Google Gemini', env: 'GEMINI_API_KEY', url: 'https://aistudio.google.com/apikey' },
  { id: 'anthropic', name: 'Anthropic (Console key)', env: 'ANTHROPIC_API_KEY', url: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/keys' },
  { id: 'xai', name: 'xAI (Grok)', env: 'XAI_API_KEY', url: 'https://console.x.ai' },
  { id: 'groq', name: 'Groq', env: 'GROQ_API_KEY', url: 'https://console.groq.com/keys' },
  { id: 'mistral', name: 'Mistral', env: 'MISTRAL_API_KEY', url: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', name: 'DeepSeek', env: 'DEEPSEEK_API_KEY', url: 'https://platform.deepseek.com/api_keys' },
  { id: 'togetherai', name: 'Together AI', env: 'TOGETHER_API_KEY', url: 'https://api.together.ai/settings/api-keys' },
  { id: 'fireworks-ai', name: 'Fireworks AI', env: 'FIREWORKS_API_KEY', url: 'https://fireworks.ai/account/api-keys' },
  { id: 'cerebras', name: 'Cerebras', env: 'CEREBRAS_API_KEY', url: 'https://cloud.cerebras.ai' },
  { id: 'moonshotai', name: 'Moonshot AI (Kimi)', env: 'MOONSHOT_API_KEY', url: 'https://platform.moonshot.ai' },
  { id: 'zai', name: 'Z.AI (GLM)', env: 'ZHIPU_API_KEY', url: 'https://z.ai/manage-apikey/apikey-list' },
  { id: 'alibaba', name: 'Alibaba (Qwen)', env: 'DASHSCOPE_API_KEY', url: 'https://dashscope.console.aliyun.com' },
  { id: 'ollama-cloud', name: 'Ollama Cloud', env: 'OLLAMA_API_KEY', url: 'https://ollama.com/settings/keys' },
  { id: 'huggingface', name: 'Hugging Face', env: 'HF_TOKEN', url: 'https://huggingface.co/settings/tokens' },
  { id: 'vercel', name: 'Vercel AI Gateway', env: 'AI_GATEWAY_API_KEY', url: 'https://vercel.com/ai-gateway' },
  { id: 'github-copilot', name: 'GitHub Copilot (token)', env: 'GITHUB_TOKEN', url: 'https://github.com/settings/tokens' },
  { id: 'opencode', name: 'OpenCode Zen', env: 'OPENCODE_API_KEY', url: 'https://opencode.ai/zen' }
]

/** An environment variable name LocalClaude will pass on: letters, digits and underscores. */
export const isEnvName = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_]{1,63}$/.test(name)

/** Whether OpenCode can run here, and how it would be started. Never contains a key. */
export interface OpenCodeStatus {
  found: boolean
  /** downloaded by LocalClaude, OpenCode's own installer (~/.opencode/bin), opencode on PATH, your own path, or LOCALCLAUDE_OPENCODE */
  via?: 'app' | 'home' | 'path' | 'custom' | 'env'
  location?: string
  version?: string
  /** the build LocalClaude would download for this computer, e.g. cli-windows-x64 */
  platform?: string
  /** a download is running now */
  downloading: boolean
  /** the names of the provider keys saved in LocalClaude (never the keys) */
  keys: string[]
}

/** Progress of "Download OpenCode". */
export interface OpenCodeDownloadEvent {
  type: 'progress' | 'done'
  /** bytes so far and in all (progress) */
  received?: number
  total?: number
  /** what it's doing now: looking up, downloading, checking, unpacking */
  phase?: string
  ok?: boolean
  error?: string
  version?: string
}
