// Settings → DeepSeek, and the install card on the setup screen: DeepSeek Harness (dsh) as a second
// engine. The key goes straight to the main process (encrypted vault) and is never sent back.
import { useEffect, useRef, useState } from 'react'
import { DEEPSEEK_EFFORTS, DEEPSEEK_MODELS, DSH_PACKAGE, ENGINES, type DeepSeekStatus } from '../../../shared/deepseek'
import type { AppSettings, AuthStatus } from '../../../shared/types'
import { api } from '../api'
import { Icon } from './Icon'

const VIA: Record<NonNullable<DeepSeekStatus['via']>, string> = {
  app: 'installed by LocalClaude',
  global: 'installed with npm',
  path: 'the dsh command on your PATH',
  custom: 'your own command',
  env: 'LOCALCLAUDE_DSH'
}

function useDeepSeekStatus(): [DeepSeekStatus | null, () => void] {
  const [st, setSt] = useState<DeepSeekStatus | null>(null)
  const refresh = (): void => void api.deepseekStatus().then(setSt)
  useEffect(refresh, [])
  return [st, refresh]
}

/** Whether dsh is there, and a button that installs it into LocalClaude's own folder. */
export function DeepSeekInstall({ onChanged }: { onChanged?: () => void }) {
  const [st, refresh] = useDeepSeekStatus()
  const [log, setLog] = useState('')
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(
    () =>
      api.onDeepSeekInstall((e) => {
        if (e.type === 'output') setLog((l) => (l + (e.text ?? '')).slice(-6000))
        else {
          setResult({ ok: !!e.ok, error: e.error })
          refresh()
          onChanged?.()
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [log])
  if (!st) return null
  const installing = st.installing || (!!log && !result)
  return (
    <div className="deepseek-install">
      {st.found ? (
        <p className="muted small deepseek-found">
          <Icon name="check" size={14} /> DeepSeek Harness{st.version ? ` ${st.version}` : ''} is ready ({VIA[st.via ?? 'app']}).
        </p>
      ) : (
        <>
          <p className="muted small">
            DeepSeek Harness isn’t installed yet. LocalClaude can install it into its own folder (about 1 GB, it needs npm from Node.js), and runs it on its
            own runtime. Or run <code>npm i -g {DSH_PACKAGE}</code> yourself.
          </p>
          <div className="row gap">
            <button
              type="button"
              className="btn deepseek-install-btn"
              disabled={installing || !st.canInstall}
              onClick={() => {
                setLog('')
                setResult(null)
                void api.installDeepSeek()
              }}
            >
              {installing ? 'Installing…' : 'Install DeepSeek Harness'}
            </button>
          </div>
          {!st.canInstall && <p className="warn-text small">npm wasn’t found. Install Node.js from nodejs.org first, then come back.</p>}
        </>
      )}
      {result && !result.ok && <p className="danger-text small">{result.error}</p>}
      {log && (
        <details className="login-details" open={installing}>
          <summary className="muted small">Install log</summary>
          <pre ref={logRef} className="login-log">
            {log}
          </pre>
        </details>
      )}
    </div>
  )
}

export function DeepSeekPanel(props: { settings: AppSettings; auth: AuthStatus; onChange: (p: Partial<AppSettings>) => Promise<void>; onAuthChanged: () => Promise<void> }) {
  const s = props.settings
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ error?: string; warning?: string } | null>(null)
  const [models, setModels] = useState(DEEPSEEK_MODELS)
  const [command, setCommand] = useState(s.deepseekCommand)
  const [installKey, setInstallKey] = useState(0)
  useEffect(() => {
    void api.deepseekModels().then((m) => m.length && setModels([DEEPSEEK_MODELS[0], ...m]))
  }, [])
  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.saveDeepSeekKey(draft)
      if (r.ok) {
        setDraft('')
        await props.onAuthChanged()
      }
      setMessage(r.error || r.warning ? { error: r.error, warning: r.warning } : null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h2>DeepSeek Harness</h2>
      <p className="muted">
        Run chats on{' '}
        <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal('https://github.com/deepseek-ai/deepseek-harness'))}>
          DeepSeek Harness
        </a>{' '}
        (dsh), DeepSeek’s open-source coding agent, instead of Claude Code. Each chat can switch between the two from its model menu, and your earlier
        messages go along.
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
        <p className="muted small">Designs always use Claude Code. Ctrl+K → “Switch harness” switches the chat you’re in.</p>
      </div>

      <div className="field deepseek-key">
        <label>DeepSeek API key</label>
        {props.auth.deepseekKey ? (
          <>
            <p className="muted small deepseek-key-status">
              {props.auth.deepseekKey === 'env' ? 'Set by DEEPSEEK_API_KEY when LocalClaude started.' : 'A key is saved, encrypted on this machine.'}
            </p>
            {props.auth.deepseekKey === 'saved' && (
              <div className="row gap">
                <button
                  type="button"
                  className="btn danger deepseek-key-remove"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    await api.removeDeepSeekKey()
                    await props.onAuthChanged()
                    setBusy(false)
                  }}
                >
                  Remove saved key
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <form
              className="row gap"
              onSubmit={(e) => {
                e.preventDefault()
                if (draft.trim() && !busy) void save()
              }}
            >
              <input
                className="input grow mono deepseek-key-input"
                type="password"
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="btn" disabled={!draft.trim() || busy}>
                {busy ? 'Checking…' : 'Save key'}
              </button>
            </form>
            <p className="muted small">
              Create one at{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal('https://platform.deepseek.com/api_keys'))}>
                platform.deepseek.com
              </a>
              . It’s stored encrypted on this machine and isn’t included in exports or backups. DeepSeek chats bill it, never your Claude plan.
            </p>
          </>
        )}
        {message?.error && <p className="danger-text small deepseek-key-error">{message.error}</p>}
        {message?.warning && <p className="warn-text small">{message.warning}</p>}
      </div>

      <div className="field">
        <label>DeepSeek Harness</label>
        <DeepSeekInstall key={installKey} />
      </div>

      <div className="field">
        <label>Model for new DeepSeek chats</label>
        <select className="select" value={s.deepseekModel} onChange={(e) => void props.onChange({ deepseekModel: e.target.value })}>
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.displayName}
            </option>
          ))}
        </select>
        <label>Reasoning effort</label>
        <select className="select" value={s.deepseekEffort} onChange={(e) => void props.onChange({ deepseekEffort: e.target.value as AppSettings['deepseekEffort'] })}>
          {DEEPSEEK_EFFORTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>How LocalClaude starts dsh</label>
        <input
          className="input mono"
          placeholder="Automatic"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onBlur={() => {
            if (command.trim() !== s.deepseekCommand) void props.onChange({ deepseekCommand: command.trim() }).then(() => setInstallKey((k) => k + 1))
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <p className="muted small">
          Leave empty to find it: LocalClaude’s own install, then npm’s global folder, then <code>dsh</code> on your PATH. Or give a command, or the path to
          dsh’s <code>lib/bin.js</code> to run it on LocalClaude’s runtime. Tools run in dsh’s sandbox: “Ask permissions” keeps writes inside the chat’s
          folder, Plan mode is read-only, and Full access lifts the sandbox.
        </p>
      </div>
    </>
  )
}
