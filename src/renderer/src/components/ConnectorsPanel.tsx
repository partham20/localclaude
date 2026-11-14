// Settings → Connectors: popular connectors in one click (signing in in the browser where they use OAuth),
// your MCP servers, and the ones Claude Code already has that LocalClaude can copy.
import { useEffect, useState } from 'react'
import { CONNECTORS, type ClaudeCodeMcpServer, type ConnectorPreset, type McpAuthInfo } from '../../../shared/extensions'
import type { AppSettings, McpServerEntry } from '../../../shared/types'
import { api } from '../api'
import { McpManager, RESERVED } from './McpManager'

const authKey = (url: string): string => {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.href
  } catch {
    return url
  }
}

const SCOPE: Record<ClaudeCodeMcpServer['scope'], string> = { user: 'yours', local: 'this folder, private', project: 'this folder’s .mcp.json' }

export function ConnectorsPanel({ settings, onChange }: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => Promise<void> }) {
  const [auth, setAuth] = useState<McpAuthInfo[]>([])
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const [token, setToken] = useState<{ preset: ConnectorPreset; value: string } | null>(null)
  const [fromClaude, setFromClaude] = useState<ClaudeCodeMcpServer[]>([])
  const servers = settings.mcpServers

  const reloadAuth = (): Promise<void> => api.mcpAuth().then(setAuth)
  useEffect(() => {
    void reloadAuth()
    void api.claudeCodeMcpServers().then(setFromClaude)
  }, [settings.mcpServers, settings.defaultCwd])

  const signIn = async (url: string, name?: string): Promise<void> => {
    setSigningIn(authKey(url))
    setNote({ text: 'Finish signing in in your browser, then come back here.' })
    const r = await api.signInMcp(url)
    setSigningIn(null)
    setNote(r.ok ? { text: `Signed in${name ? ` to ${name}` : ''}. New chats can use it.` } : { text: r.error ?? 'Not signed in.', error: true })
    void reloadAuth()
  }

  const freeName = (base: string): string => {
    let n = base
    for (let i = 2; servers[n] || RESERVED.includes(n); i++) n = `${base}-${i}`
    return n
  }

  const addPreset = async (p: ConnectorPreset, tokenValue?: string): Promise<void> => {
    let entry: McpServerEntry = { ...p.entry, enabled: true }
    if (tokenValue && p.tokenHeader) entry = { ...entry, headers: { [p.tokenHeader]: p.tokenHeader.toLowerCase() === 'authorization' ? `Bearer ${tokenValue}` : tokenValue } }
    if (tokenValue && p.tokenEnv) entry = { ...entry, env: { [p.tokenEnv]: tokenValue } }
    const name = freeName(p.id)
    await onChange({ mcpServers: { ...servers, [name]: entry } })
    if (p.auth === 'oauth' && entry.url) await signIn(entry.url, p.name)
    else setNote({ text: `Added ${p.name}. New chats can use it.` })
  }

  const added = (p: ConnectorPreset): boolean =>
    Object.values(servers).some((e) => (p.entry.url ? e.url === p.entry.url : e.command === p.entry.command && JSON.stringify(e.args) === JSON.stringify(p.entry.args)))

  return (
    <div className="connectors-panel">
      <h2>Connectors</h2>
      <p className="muted small">
        Connectors (MCP servers) give Claude tools and data from other apps. They work in Claude Code and DeepSeek chats alike, except remote (SSE) ones, which DeepSeek Harness doesn’t take.
      </p>
      {note && <div className={'small connectors-note ' + (note.error ? 'danger-text' : 'ok-text')}>{note.text}</div>}

      <div className="field">
        <label>Popular connectors</label>
        <div className="connector-grid">
          {CONNECTORS.map((p) => {
            const have = added(p)
            return (
              <div key={p.id} className={'connector-card' + (have ? ' added' : '')} data-connector={p.id}>
                <div className="connector-name">{p.name}</div>
                <div className="muted small connector-desc">{p.description}</div>
                <div className="row gap connector-foot">
                  <span className="muted small">{p.auth === 'oauth' ? 'Sign in' : p.auth === 'token' ? 'Needs a token' : p.entry.type === 'stdio' ? 'Runs here' : 'No sign-in'}</span>
                  <span className="grow" />
                  <button
                    className={'btn small ' + (have ? 'ghost' : '')}
                    disabled={have || !!signingIn}
                    onClick={() => (p.auth === 'token' ? setToken({ preset: p, value: '' }) : void addPreset(p))}
                  >
                    {have ? 'Added' : 'Add'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {token && (
          <div className="mcp-form">
            <div className="field">
              <label>{token.preset.name} token</label>
              <p className="muted small">{token.preset.tokenHelp}</p>
              <input className="input mono" type="password" name="connectorToken" autoFocus value={token.value} onChange={(e) => setToken({ ...token, value: e.target.value })} />
            </div>
            <div className="row gap end">
              <button className="btn ghost" onClick={() => setToken(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!token.value.trim()}
                onClick={() => {
                  void addPreset(token.preset, token.value.trim())
                  setToken(null)
                }}
              >
                Add {token.preset.name}
              </button>
            </div>
          </div>
        )}
      </div>

      <McpManager
        settings={settings}
        onChange={onChange}
        auth={auth}
        signingIn={signingIn}
        onSignIn={(url) => void signIn(url)}
        onSignOut={async (url) => {
          if (!confirm('Sign out of this connector? LocalClaude forgets its token.')) return
          await api.signOutMcp(url)
          void reloadAuth()
        }}
      />
      {signingIn && (
        <button className="link-btn small" onClick={() => void api.cancelMcpSignIn()}>
          Cancel sign-in
        </button>
      )}

      {fromClaude.length > 0 && (
        <div className="field">
          <label>In Claude Code</label>
          <p className="muted small">
            Servers in Claude Code’s own settings. Claude Code chats already load them when “user settings” is on; copy one here so DeepSeek chats get it too, and so you can switch it off or
            test it.
          </p>
          <div className="mcp-list">
            {fromClaude.map((x) => (
              <div key={x.scope + x.name} className="mcp-server" data-claude-server={x.name}>
                <div className="mcp-server-main">
                  <span className="mcp-server-name mono">{x.name}</span>
                  <span className="muted small">{SCOPE[x.scope]}</span>
                  <span className="mcp-summary muted small mono">{x.entry.url ?? [x.entry.command, ...(x.entry.args ?? [])].join(' ')}</span>
                  <button
                    className="btn ghost small"
                    disabled={x.exists}
                    onClick={() => void onChange({ mcpServers: { ...servers, [freeName(x.name)]: { ...x.entry, enabled: true } } }).then(() => setNote({ text: `Copied ${x.name}.` }))}
                  >
                    {x.exists ? 'Copied' : 'Copy to LocalClaude'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="muted small">Changes apply to each chat the next time you send a message.</p>
    </div>
  )
}
