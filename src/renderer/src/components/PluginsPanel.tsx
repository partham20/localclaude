// Settings → Plugins: install plugins from Claude Code marketplaces (its own directory, or any you add), switch
// them on and off, update and remove them. Everything goes through Claude Code's `claude plugin` commands, so
// Claude Code in a terminal sees the same plugins.
import { useEffect, useMemo, useState } from 'react'
import type { AvailablePlugin, InstalledPlugin, PluginAction, PluginState } from '../../../shared/extensions'
import type { AppSettings } from '../../../shared/types'
import { api } from '../api'

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`

function contents(p: InstalledPlugin): string {
  const parts = [
    p.skills.length ? plural(p.skills.length, 'skill') : '',
    p.commands.length ? plural(p.commands.length, 'command') : '',
    p.agents.length ? plural(p.agents.length, 'agent') : '',
    p.mcpServers.length ? plural(p.mcpServers.length, 'MCP server') : '',
    p.hooks ? 'hooks' : ''
  ].filter(Boolean)
  return parts.join(' · ') || 'nothing LocalClaude can see'
}

export function PluginsPanel({ settings }: { settings: AppSettings }) {
  const [state, setState] = useState<PluginState | null>(null)
  const [available, setAvailable] = useState<AvailablePlugin[] | 'loading' | null>(null)
  const [availableError, setAvailableError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)
  const [source, setSource] = useState('')

  const reload = (): Promise<void> => api.pluginState().then(setState)
  const browse = async (): Promise<void> => {
    setAvailable('loading')
    setAvailableError(null)
    const r = await api.availablePlugins()
    setAvailable(r.plugins)
    if (r.error) setAvailableError(r.error)
  }
  useEffect(() => void reload(), [])

  const run = async (key: string, a: PluginAction, done?: string): Promise<boolean> => {
    setBusy(key)
    setNote(null)
    const r = await api.pluginAction(a)
    setBusy(null)
    setNote({ text: r.ok ? (done ?? r.message) : r.message, error: !r.ok })
    await reload()
    return r.ok
  }

  const installed = new Map((state?.installed ?? []).map((p) => [p.id, p]))
  const results = useMemo(() => {
    if (!Array.isArray(available)) return []
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return available.filter((p) => words.every((w) => `${p.name} ${p.description ?? ''} ${p.marketplace}`.toLowerCase().includes(w))).slice(0, 40)
  }, [available, query])

  return (
    <div className="plugins-panel">
      <h2>Plugins</h2>
      <p className="muted small">
        Plugins bundle skills, slash commands, agents, hooks and MCP servers for Claude Code. They’re installed with Claude Code’s own <code>claude plugin</code> commands, so Claude Code in a terminal
        has them too.
      </p>
      {!settings.loadUserSettings && (
        <div className="notice small">
          Chats only load plugins while <b>Load my Claude Code user settings</b> is on, in Tools &amp; computer.
        </div>
      )}
      {note && <pre className={'mcp-test small ' + (note.error ? 'danger-text' : 'ok-text')}>{note.text}</pre>}
      {state?.error && <div className="notice small">Claude Code couldn’t list your marketplaces: {state.error}</div>}

      <div className="field">
        <label>Installed</label>
        {state === null ? (
          <p className="muted small">Loading…</p>
        ) : state.installed.length === 0 ? (
          <p className="muted small">No plugins yet. Find some below.</p>
        ) : (
          <div className="mcp-list">
            {state.installed.map((p) => (
              <div key={p.id} className={'mcp-server plugin-row' + (p.enabled ? '' : ' off')} data-plugin={p.id}>
                <div className="mcp-server-main">
                  <label className="mcp-switch" title={p.enabled ? 'On (click to switch off)' : 'Off (click to switch on)'}>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      disabled={busy === p.id}
                      onChange={() => void run(p.id, { kind: p.enabled ? 'disable' : 'enable', id: p.id }, `${p.name} is ${p.enabled ? 'off' : 'on'}. New chats pick it up.`)}
                    />
                  </label>
                  <span className="mcp-server-name">{p.name}</span>
                  {p.version && <span className="muted small">v{p.version}</span>}
                  <span className="mcp-summary muted small" title={p.description}>
                    {contents(p)}
                  </span>
                  <span className="tag">{p.marketplace}</span>
                  <button className="btn ghost small" disabled={!!busy} onClick={() => void run(p.id, { kind: 'update', id: p.id })}>
                    {busy === p.id ? '…' : 'Update'}
                  </button>
                  <button
                    className="btn ghost small danger-text"
                    disabled={!!busy}
                    onClick={() => confirm(`Uninstall ${p.name}?`) && void run(p.id, { kind: 'uninstall', id: p.id }, `Uninstalled ${p.name}.`)}
                  >
                    Uninstall
                  </button>
                </div>
                {p.description && <div className="muted small plugin-desc">{p.description}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label>Find plugins</label>
        {available === null ? (
          <div className="row gap">
            <button className="btn" name="browsePlugins" onClick={() => void browse()}>
              Browse plugins
            </button>
            <span className="muted small">From Claude Code’s plugin directory and the marketplaces you add.</span>
          </div>
        ) : available === 'loading' ? (
          <p className="muted small">Getting the list from your marketplaces…</p>
        ) : (
          <>
            <input className="input" name="pluginSearch" placeholder={`Search ${available.length} plugins`} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            {availableError && <div className="danger-text small">{availableError}</div>}
            <div className="mcp-list plugin-results">
              {results.map((p) => {
                const have = installed.has(p.id)
                return (
                  <div key={p.id} className="mcp-server" data-available={p.id}>
                    <div className="mcp-server-main">
                      <span className="mcp-server-name">{p.name}</span>
                      <span className="mcp-summary muted small" title={p.description}>
                        {p.description}
                      </span>
                      <span className="tag">{p.marketplace}</span>
                      <button
                        className={'btn small ' + (have ? 'ghost' : 'primary')}
                        disabled={have || !!busy}
                        onClick={() => void run(p.id, { kind: 'install', id: p.id }, `Installed ${p.name}. New chats can use it.`)}
                      >
                        {have ? 'Installed' : busy === p.id ? 'Installing…' : 'Install'}
                      </button>
                    </div>
                  </div>
                )
              })}
              {results.length === 0 && <p className="muted small">Nothing matches.</p>}
            </div>
          </>
        )}
      </div>

      <div className="field">
        <label>Marketplaces</label>
        {(state?.marketplaces.length ?? 0) > 0 && (
          <div className="mcp-list">
            {state!.marketplaces.map((m) => (
              <div key={m.name} className="mcp-server" data-marketplace={m.name}>
                <div className="mcp-server-main">
                  <span className="mcp-server-name">{m.name}</span>
                  <span className="mcp-summary muted small mono" title={m.location}>
                    {m.location}
                  </span>
                  <button className="btn ghost small" disabled={!!busy} onClick={() => void run('m:' + m.name, { kind: 'updateMarketplace', name: m.name }, `Updated ${m.name}.`)}>
                    Update
                  </button>
                  <button
                    className="btn ghost small danger-text"
                    disabled={!!busy}
                    onClick={() => confirm(`Remove the ${m.name} marketplace? Plugins from it are uninstalled.`) && void run('m:' + m.name, { kind: 'removeMarketplace', name: m.name })}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="row gap">
          <input className="input grow mono" name="marketplaceSource" placeholder="owner/repo, a git URL, or a folder" value={source} onChange={(e) => setSource(e.target.value)} />
          <button
            className="btn"
            name="addMarketplace"
            disabled={!source.trim() || !!busy}
            onClick={async () => {
              if (await run('add', { kind: 'addMarketplace', source }, 'Marketplace added.')) {
                setSource('')
                if (available !== null) void browse()
              }
            }}
          >
            {busy === 'add' ? 'Adding…' : 'Add marketplace'}
          </button>
        </div>
      </div>
      <p className="muted small">
        In DeepSeek chats, a plugin’s skills and MCP servers work too. Its slash commands, agents and hooks are Claude Code features, so they only work in Claude Code chats.
      </p>
    </div>
  )
}
