// Skills, plugins and connectors (Settings → Skills / Plugins / Connectors).

/** A skill Claude Code would load: a folder with a SKILL.md. */
export interface SkillInfo {
  /** the name Claude Code knows it by (plugin skills are "plugin:skill") */
  id: string
  /** the SKILL.md `name` (or the folder's) */
  name: string
  description: string
  /** where it comes from: your ~/.claude/skills, the default folder's .claude/skills, or a plugin */
  source: 'user' | 'project' | 'plugin'
  /** the plugin it comes with, e.g. "hello@my-market" */
  plugin?: string
  dir: string
  file: string
  /** not switched off in LocalClaude (Settings → Skills) */
  enabled: boolean
  /** your own skills and the folder's can be edited and deleted here; a plugin's come and go with it */
  editable: boolean
}

export interface SkillDraft {
  name: string
  description: string
  body: string
  /** the folder of the skill being edited (undefined = a new skill in ~/.claude/skills) */
  dir?: string
}

/** A plugin installed through Claude Code. */
export interface InstalledPlugin {
  /** "name@marketplace" */
  id: string
  name: string
  marketplace: string
  version?: string
  enabled: boolean
  installPath: string
  description?: string
  /** what it adds */
  skills: string[]
  commands: string[]
  agents: string[]
  mcpServers: string[]
  hooks: boolean
}

/** A plugin a marketplace offers. */
export interface AvailablePlugin {
  id: string
  name: string
  marketplace: string
  description?: string
  version?: string
}

export interface Marketplace {
  name: string
  /** github, git, url or directory */
  source: string
  /** the repo, URL or folder it comes from */
  location: string
}

export interface PluginState {
  installed: InstalledPlugin[]
  marketplaces: Marketplace[]
  /** Claude Code couldn't be run to list them */
  error?: string
}

export type PluginAction =
  | { kind: 'install'; id: string }
  | { kind: 'uninstall'; id: string }
  | { kind: 'enable'; id: string }
  | { kind: 'disable'; id: string }
  | { kind: 'update'; id: string }
  | { kind: 'addMarketplace'; source: string }
  | { kind: 'removeMarketplace'; name: string }
  | { kind: 'updateMarketplace'; name?: string }

export interface PluginActionResult {
  ok: boolean
  /** what Claude Code said (the error when it failed) */
  message: string
}

/** Signed in to a remote MCP server (OAuth), by server URL. What the window may see of it. */
export interface McpAuthInfo {
  url: string
  signedIn: boolean
  /** when the access token runs out (ms), if the server said */
  expiresAt?: number
}

/** A server found in Claude Code's own config (~/.claude.json, the folder's .mcp.json) that LocalClaude can copy. */
export interface ClaudeCodeMcpServer {
  name: string
  scope: 'user' | 'local' | 'project'
  entry: import('./types').McpServerEntry
  /** LocalClaude already has a server by that name */
  exists: boolean
}

/** A ready-made connector in Settings → Connectors. */
export interface ConnectorPreset {
  id: string
  name: string
  description: string
  entry: import('./types').McpServerEntry
  /** "oauth": sign in in the browser; "token": paste a key into a header or variable; "none": works as is */
  auth: 'oauth' | 'token' | 'none'
  /** for "token": where to get one, and the header or variable it goes in */
  tokenHelp?: string
  tokenHeader?: string
  tokenEnv?: string
}

export const CONNECTORS: ConnectorPreset[] = [
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search, read and write your Notion pages and databases',
    entry: { type: 'http', url: 'https://mcp.notion.com/mcp' },
    auth: 'oauth'
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Find, create and update issues and projects',
    entry: { type: 'http', url: 'https://mcp.linear.app/mcp' },
    auth: 'oauth'
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Look into errors and performance issues',
    entry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
    auth: 'oauth'
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    description: 'Jira issues and Confluence pages',
    entry: { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' },
    auth: 'oauth'
  },
  {
    id: 'asana',
    name: 'Asana',
    description: 'Tasks, projects and goals',
    entry: { type: 'sse', url: 'https://mcp.asana.com/sse' },
    auth: 'oauth'
  },
  {
    id: 'canva',
    name: 'Canva',
    description: 'Find, create and export designs',
    entry: { type: 'http', url: 'https://mcp.canva.com/mcp' },
    auth: 'oauth'
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Search models, datasets, papers and Spaces',
    entry: { type: 'http', url: 'https://huggingface.co/mcp' },
    auth: 'oauth'
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositories, issues and pull requests',
    entry: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    auth: 'token',
    tokenHelp: 'Paste a GitHub personal access token (github.com → Settings → Developer settings → Personal access tokens).',
    tokenHeader: 'Authorization'
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Up-to-date documentation for libraries and frameworks',
    entry: { type: 'http', url: 'https://mcp.context7.com/mcp' },
    auth: 'none'
  },
  {
    id: 'cloudflare-docs',
    name: 'Cloudflare docs',
    description: 'Search Cloudflare’s documentation',
    entry: { type: 'http', url: 'https://docs.mcp.cloudflare.com/mcp' },
    auth: 'none'
  },
  {
    id: 'playwright',
    name: 'Playwright browser',
    description: 'A browser Claude can drive on this computer (needs Node.js)',
    entry: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    auth: 'none'
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files in the chat’s folder (needs Node.js)',
    entry: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] },
    auth: 'none'
  }
]

/** Skill names Claude Code accepts: lowercase letters, digits and hyphens. */
export function skillNameError(name: string): string | undefined {
  if (!name) return 'Give the skill a name.'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return 'Use lowercase letters, numbers and hyphens, like “release-notes”.'
  if (name.length > 64) return 'Keep the name under 64 characters.'
  return undefined
}

/** Read a SKILL.md: its frontmatter (name, description) and the instructions after it. */
export function parseSkillMd(text: string): { name?: string; description?: string; body: string; meta: Record<string, string> } {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src)
  if (!m) return { body: src, meta: {} }
  const meta: Record<string, string> = {}
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let v = kv[2].trim()
    if (/^[>|][+-]?$/.test(v)) {
      // a block: the indented lines after it
      const block: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim())
      v = v.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim()
    } else if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
      try {
        v = JSON.parse(v)
      } catch {
        v = v.slice(1, -1)
      }
    } else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1).replace(/''/g, "'")
    meta[kv[1]] = v
  }
  return { name: meta.name, description: meta.description, body: m[2].replace(/^\n+/, ''), meta }
}

/** Write a SKILL.md, keeping frontmatter fields other than name and description. */
export function formatSkillMd(d: { name: string; description: string; body: string }, keep: Record<string, string> = {}): string {
  const extra = Object.entries(keep)
    .filter(([k]) => k !== 'name' && k !== 'description')
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  return ['---', `name: ${d.name}`, `description: ${JSON.stringify(d.description.replace(/\s+/g, ' ').trim())}`, ...extra, '---', '', d.body.trim(), ''].join('\n')
}
