// Settings → OpenCode, and the download card on the setup screen: OpenCode as a third engine.
// Provider keys go straight to the main process (encrypted vault) and only their names come back.
import { useEffect, useState } from 'react'
import { ENGINES } from '../../../shared/deepseek'
import { OPENCODE_MODELS, OPENCODE_PROVIDERS, OPENCODE_REPO, type OpenCodeDownloadEvent, type OpenCodeStatus } from '../../../shared/opencode'
import type { AppSettings } from '../../../shared/types'
import { api } from '../api'
import { Icon } from './Icon'

const VIA: Record<NonNullable<OpenCodeStatus['via']>, string> = {
  app: 'downloaded by LocalClaude',
  home: 'OpenCode’s own installer, ~/.opencode/bin',
  path: 'the opencode command on your PATH',
  custom: 'your own path',
  env: 'LOCALCLAUDE_OPENCODE'
}

const mb = (n: number): string => `${Math.round(n / 1e6)} MB`

function useOpenCodeStatus(): [OpenCodeStatus | null, () => void] {
  const [st, setSt] = useState<OpenCodeStatus | null>(null)
  const refresh = (): void => void api.opencodeStatus().then(setSt)
  useEffect(refresh, [])
  return [st, refresh]
}

/** Whether OpenCode is on this computer, and a button that downloads it into LocalClaude's own folder. */
export function OpenCodeDownload({ onChanged }: { onChanged?: (ok: boolean) => void }) {
  const [st, refresh] = useOpenCodeStatus()
  const [progress, setProgress] = useState<OpenCodeDownloadEvent | null>(null)
  const [result, setResult] = useState<{ ok: boolean; error?: string; version?: string } | null>(null)
  useEffect(
    () =>
      api.onOpenCodeDownload((e) => {
        if (e.type === 'progress') setProgress(e)
        else {
          setProgress(null)
          setResult({ ok: !!e.ok, error: e.error, version: e.version })
          refresh()
          onChanged?.(!!e.ok)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  if (!st) return null
  const busy = st.downloading || !!progress
  const start = (): void => {
    setResult(null)
    setProgress({ type: 'progress', phase: 'Starting…' })
    void api.downloadOpenCode()
  }
  return (
    <div className="opencode-download">
      {st.found ? (
        <p className="muted small opencode-found">
          <Icon name="check" size={14} /> OpenCode{st.version ? ` ${st.version}` : ''} is ready ({VIA[st.via ?? 'app']}).
        </p>
      ) : (
        <p className="muted small">
          OpenCode isn’t on this computer yet. LocalClaude downloads OpenCode’s official build for this computer{st.platform ? ` (${st.platform})` : ''} from
          the npm registry, about 120 MB, checks it, and keeps it in its own folder. Nothing is installed system-wide.
        </p>
      )}
      <div className="row gap">
        <button type="button" className={'btn opencode-download-btn' + (st.found ? '' : ' primary')} disabled={busy} onClick={start}>
          {busy ? 'Downloading…' : st.found ? (st.via === 'app' ? 'Update OpenCode' : 'Download OpenCode into LocalClaude') : 'Download OpenCode'}
        </button>
      </div>
      {progress && (
        <div className="opencode-progress">
          <p className="muted small">
            {progress.phase}
            {progress.received ? ` ${mb(progress.received)}${progress.total ? ' of ' + mb(progress.total) : ''}` : ''}
          </p>
          {progress.total ? (
            <div className="progress-bar">
              <div style={{ width: `${Math.min(100, Math.round(((progress.received ?? 0) / progress.total) * 100))}%` }} />
            </div>
          ) : null}
        </div>
      )}
      {result?.ok && <p className="muted small opencode-downloaded">OpenCode {result.version} downloaded.</p>}
      {result && !result.ok && <p className="danger-text small opencode-error">{result.error}</p>}
    </div>
  )
}

/** Your provider keys: which are saved (names only), remove one, add one. */
function ProviderKeys({ onAuthChanged }: { onAuthChanged: () => Promise<void> }) {
  const [st, refresh] = useOpenCodeStatus()
  const [provider, setProvider] = useState(OPENCODE_PROVIDERS[0].env)
  const [customEnv, setCustomEnv] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!st) return null
  const env = provider === 'other' ? customEnv : provider
  const known = OPENCODE_PROVIDERS.find((p) => p.env === provider)
  const nameOf = (e: string): string => OPENCODE_PROVIDERS.find((p) => p.env === e)?.name ?? e
  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const r = await api.saveOpenCodeKey(env, draft)
      if (r.ok) {
        setDraft('')
        setCustomEnv('')
        refresh()
        await onAuthChanged()
      } else setError(r.error ?? 'Couldn’t save it.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="opencode-keys">
      {st.keys.length > 0 && (
        <ul className="opencode-key-list">
          {st.keys.map((k) => (
            <li key={k} className="row gap opencode-key">
              <span className="grow">
                {nameOf(k)} <span className="muted small mono">{k}</span>
              </span>
              <button
                type="button"
                className="btn small danger opencode-key-remove"
                onClick={async () => {
                  await api.removeOpenCodeKey(k)
                  refresh()
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="opencode-key-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim() && env.trim() && !busy) void save()
        }}
      >
        <div className="row gap">
          <select className="select opencode-key-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {OPENCODE_PROVIDERS.map((p) => (
              <option key={p.env} value={p.env}>
                {p.name}
              </option>
            ))}
            <option value="other">Other (by variable name)…</option>
          </select>
          {provider === 'other' && (
            <input className="input mono" placeholder="PROVIDER_API_KEY" value={customEnv} onChange={(e) => setCustomEnv(e.target.value)} spellCheck={false} />
          )}
        </div>
        <div className="row gap">
          <input
            className="input grow mono opencode-key-input"
            type="password"
            placeholder="Paste the key"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!draft.trim() || !env.trim() || busy}>
            Save key
          </button>
        </div>
      </form>
      {known && (
        <p className="muted small">
          Get one at{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal(known.url))}>
            {known.url.replace(/^https:\/\//, '').replace(/\/.*$/, '')}
          </a>
          . OpenCode gets it as <code>{known.env}</code>.
        </p>
      )}
      {error && <p className="danger-text small opencode-key-error">{error}</p>}
    </div>
  )
}

export function OpenCodePanel(props: { settings: AppSettings; onChange: (p: Partial<AppSettings>) => Promise<void>; onAuthChanged: () => Promise<void> }) {
  const s = props.settings
  const [models, setModels] = useState(OPENCODE_MODELS)
  const [command, setCommand] = useState(s.opencodeCommand)
  const [downloadKey, setDownloadKey] = useState(0)
  useEffect(() => {
    void api.opencodeModels().then((m) => m.length && setModels([OPENCODE_MODELS[0], ...m]))
  }, [])
  const link = (url: string, text: string) => (
    <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal(url))}>
      {text}
    </a>
  )
  return (
    <>
      <h2>OpenCode</h2>
      <p className="muted">
        Run chats on {link(OPENCODE_REPO, 'OpenCode')}, the open-source coding agent, instead of Claude Code. It works with 75+ providers (OpenAI, Gemini,
        OpenRouter, Groq, xAI, Mistral, DeepSeek, Bedrock, Azure, GitHub Copilot and more), and with OpenCode Zen’s free models without any key. Each chat can
        switch harness from its model menu, and your earlier messages go along.
      </p>

      <div className="field">
        <label>New chats use</label>
        <div className="segmented engine-default" role="radiogroup" aria-label="New chats use">
          {ENGINES.map((e) => (
            <button
              key={e.value}
              role="radio"
              aria-checked={s.defaultEngine === e.value}
              className={'seg' + (s.defaultEngine === e.value ? ' on' : '')}
              data-engine={e.value}
              onClick={() => void props.onChange({ defaultEngine: e.value })}
            >
              {e.label}
            </button>
          ))}
        </div>
        <p className="muted small">Designs always use Claude Code. Ctrl+K → “Switch harness” moves the chat you’re in.</p>
      </div>

      <div className="field">
        <label>OpenCode</label>
        <OpenCodeDownload key={downloadKey} />
      </div>

      <div className="field">
        <label>Provider keys</label>
        <p className="muted small">
          Keys are stored encrypted on this machine, never in exports or backups, and handed to OpenCode when a chat starts. Your DeepSeek key from Settings →
          DeepSeek is passed on too. Accounts you’ve connected with <code>opencode auth login</code> in a terminal work as well, and so does your own{' '}
          <code>opencode.json</code> (local models through Ollama or LM Studio, custom providers).
        </p>
        <ProviderKeys onAuthChanged={props.onAuthChanged} />
      </div>

      <div className="field">
        <label>Model for new OpenCode chats</label>
        <select className="select opencode-model" value={s.opencodeModel} onChange={(e) => void props.onChange({ opencodeModel: e.target.value })}>
          {!models.some((m) => m.value === s.opencodeModel) && <option value={s.opencodeModel}>{s.opencodeModel}</option>}
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.displayName}
            </option>
          ))}
        </select>
        <p className="muted small">The list fills in once an OpenCode chat has started, with the models of the providers you’ve connected.</p>
      </div>

      <div className="field">
        <label>How LocalClaude starts OpenCode</label>
        <input
          className="input mono"
          placeholder="Automatic"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onBlur={() => {
            if (command.trim() !== s.opencodeCommand) void props.onChange({ opencodeCommand: command.trim() }).then(() => setDownloadKey((k) => k + 1))
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <p className="muted small">
          Leave empty to find it: LocalClaude’s own download, then OpenCode’s installer (<code>~/.opencode/bin</code>), then <code>opencode</code> on your
          PATH. Or give the path to an opencode binary. “Ask permissions” asks before commands, edits and web fetches; “Auto-accept edits” lets edits through;
          Plan mode uses OpenCode’s read-only plan agent; Full access allows everything.
        </p>
      </div>

      <p className="muted small opencode-credit">
        OpenCode is © 2025 opencode and released under the MIT License. LocalClaude runs OpenCode’s own builds unmodified; it isn’t made by, or affiliated
        with, the OpenCode team.
      </p>
    </>
  )
}
