// First run: choose how to sign in (Claude subscription, a subscription token, or a Console API key),
// then pick a look. Secrets go straight to the main process and are kept in the encrypted vault.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ACCENT_SWATCHES, BUILTIN_THEMES, normalizeAppearance, type Appearance } from '../../../shared/customize'
import type { AppSettings, AuthStatus } from '../../../shared/types'
import { api } from '../api'
import { Icon } from './Icon'
import { Spark } from './Spark'

type Method = 'subscription' | 'token' | 'apiKey'
type Step = 'choose' | Method | 'personalize'

const METHODS: { id: Method; icon: string; title: string; body: string; badge?: string }[] = [
  {
    id: 'subscription',
    icon: 'sparkle',
    title: 'Claude subscription',
    body: 'Sign in with your Pro or Max plan in the browser. Chats use your plan’s limits, with no per-token billing.',
    badge: 'Recommended'
  },
  {
    id: 'token',
    icon: 'ticket',
    title: 'Auth token',
    body: 'Paste a long-lived subscription token from claude setup-token. Handy when this computer can’t open a browser.'
  },
  {
    id: 'apiKey',
    icon: 'key',
    title: 'Console API key',
    body: 'Pay as you go with a key from the Anthropic Console. No subscription needed.'
  }
]

function SecureNote() {
  return (
    <p className="setup-secure">
      <Icon name="shield" size={14} /> Stored encrypted on this computer and locked to your OS account by the system keychain. It’s never shown again, and isn’t
      included in exports or backups.
    </p>
  )
}

function SecretForm(props: { placeholder: string; submit: string; busy: boolean; onSubmit: (v: string) => void; autoFocus?: boolean; children?: ReactNode }) {
  const [v, setV] = useState('')
  const [show, setShow] = useState(false)
  return (
    <form
      className="setup-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (v.trim() && !props.busy) props.onSubmit(v)
      }}
    >
      <div className="secret-input">
        <input
          className="input mono"
          type={show ? 'text' : 'password'}
          placeholder={props.placeholder}
          autoComplete="off"
          spellCheck={false}
          autoFocus={props.autoFocus}
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
        <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} title={show ? 'Hide' : 'Show'}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
        </button>
      </div>
      {props.children}
      <button type="submit" className="btn primary big" disabled={!v.trim() || props.busy}>
        {props.busy ? 'Checking…' : props.submit}
      </button>
    </form>
  )
}

export function SetupScreen(props: {
  auth: AuthStatus
  settings: AppSettings
  onAuthChanged: () => Promise<void>
  onChange: (p: Partial<AppSettings>) => Promise<void>
  onFinish: () => void
}) {
  const signedIn = props.auth.loggedIn
  const [step, setStep] = useState<Step>(signedIn ? 'personalize' : 'choose')
  const [method, setMethod] = useState<Method>('subscription')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  // browser sign-in
  const [log, setLog] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const logRef = useRef<HTMLPreElement>(null)

  // once signed in by any method, go on to pick a look
  useEffect(() => {
    if (signedIn && step !== 'personalize') {
      setBusy(false)
      setStep('personalize')
    }
  }, [signedIn, step])

  useEffect(
    () =>
      api.onLogin((e) => {
        if (e.type === 'output') {
          setLog((l) => (l + (e.text ?? '')).slice(-6000))
          if (e.url) setUrl(e.url)
        } else {
          setBusy(false)
          void props.onAuthChanged()
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [log])

  const go = (s: Step): void => {
    setError(null)
    setWarning(null)
    setStep(s)
  }

  const startBrowser = async (): Promise<void> => {
    setLog('')
    setUrl(null)
    setError(null)
    setBusy(true)
    await api.login()
  }

  const saveToken = async (token: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.saveOAuthToken(token)
      if (!r.ok) return setError(r.error ?? 'That token didn’t work.')
      await props.onAuthChanged()
    } finally {
      setBusy(false)
    }
  }

  const saveKey = async (key: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.useApiKey(key)
      if (!r.ok) return setError(r.error ?? 'That key didn’t work.')
      if (r.warning) setWarning(r.warning)
      await props.onAuthChanged()
    } finally {
      setBusy(false)
    }
  }

  const a = normalizeAppearance(props.settings.appearance)
  const setLook = (patch: Partial<Appearance>): void => void props.onChange({ appearance: { ...a, ...patch } })

  return (
    <div className="setup-screen">
      <div className="setup-glow" aria-hidden />
      <div className="titlebar setup-drag" />
      <div className={'setup-card step-' + step} key={step}>
        {step === 'choose' && (
          <>
            <div className="setup-hero">
              <Spark size={46} className="setup-spark" />
              <h1>Welcome to LocalClaude</h1>
              <p className="muted">Claude on your desktop, with your files, tools and chats kept on this computer. How would you like to sign in?</p>
            </div>
            <div className="method-list" role="radiogroup" aria-label="How to sign in">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={method === m.id}
                  className={'method' + (method === m.id ? ' on' : '')}
                  data-method={m.id}
                  onClick={() => setMethod(m.id)}
                  onDoubleClick={() => go(m.id)}
                >
                  <span className="method-icon">
                    <Icon name={m.icon} size={20} />
                  </span>
                  <span className="method-text">
                    <b>
                      {m.title}
                      {m.badge && <span className="method-badge">{m.badge}</span>}
                    </b>
                    <span className="muted small">{m.body}</span>
                  </span>
                  <span className="method-radio" />
                </button>
              ))}
            </div>
            {props.auth.usingApiKeyEnv && (
              <p className="notice small">
                An ANTHROPIC_API_KEY (or similar) is set in your environment. LocalClaude ignores it; choose Console API key to use a key on purpose.
              </p>
            )}
            {props.auth.error && <p className="notice error small">{props.auth.error}</p>}
            <button className="btn primary big setup-continue" onClick={() => go(method)}>
              Continue <Icon name="forward" size={16} />
            </button>
          </>
        )}

        {step === 'subscription' && (
          <>
            <StepHead icon="sparkle" title="Sign in with your Claude subscription" onBack={() => (void api.cancelLogin(), setBusy(false), go('choose'))} />
            <p className="muted">
              LocalClaude runs Claude Code on this computer and signs in through it, so your Pro or Max plan is used. A browser window opens; approve access there and come back.
            </p>
            {!busy ? (
              <div className="setup-actions">
                <button className="btn primary big" onClick={() => void startBrowser()}>
                  Open the browser to sign in
                </button>
                <button className="btn ghost" onClick={() => void props.onAuthChanged()}>
                  I’ve signed in already, check again
                </button>
              </div>
            ) : (
              <>
                <div className="setup-waiting">
                  <Spark size={22} animate className="working-spark" />
                  <span>
                    Waiting for you to approve in the browser…
                    {url && (
                      <>
                        {' '}
                        <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal(url))}>
                          Open the page again
                        </a>
                      </>
                    )}
                  </span>
                </div>
                <div className="row gap">
                  <input
                    className="input grow"
                    placeholder="If the page shows a code, paste it here"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && code.trim()) {
                        void api.loginInput(code)
                        setCode('')
                      }
                    }}
                  />
                  <button
                    className="btn"
                    disabled={!code.trim()}
                    onClick={() => {
                      void api.loginInput(code)
                      setCode('')
                    }}
                  >
                    Submit code
                  </button>
                </div>
              </>
            )}
            {log && (
              <details className="login-details">
                <summary className="muted small">Details</summary>
                <pre ref={logRef} className="login-log">
                  {log}
                </pre>
              </details>
            )}
            <p className="muted small">Already use Claude Code in a terminal? Its sign-in is shared, so if claude works there, choose “check again”.</p>
          </>
        )}

        {step === 'token' && (
          <>
            <StepHead icon="ticket" title="Paste an auth token" onBack={() => go('choose')} />
            <ol className="setup-steps">
              <li>
                In a terminal with Claude Code installed, run <code>claude setup-token</code> and sign in.
              </li>
              <li>
                Copy the token it prints (it starts with <code>sk-ant-oat</code>) and paste it below.
              </li>
            </ol>
            <SecretForm placeholder="sk-ant-oat01-…" submit="Sign in with this token" busy={busy} onSubmit={(v) => void saveToken(v)} autoFocus>
              {error && <p className="danger-text small setup-error">{error}</p>}
            </SecretForm>
            <SecureNote />
            <p className="muted small">The token uses your subscription like the browser sign-in. Keep it to yourself and use one per computer.</p>
          </>
        )}

        {step === 'apiKey' && (
          <>
            <StepHead icon="key" title="Use a Console API key" onBack={() => go('choose')} />
            <p className="muted">
              Create a key at{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), void api.openExternal('https://console.anthropic.com/settings/keys'))}>
                console.anthropic.com
              </a>{' '}
              and paste it here. Every chat, design and title is billed to that key at API prices.
            </p>
            <SecretForm placeholder="sk-ant-api03-…" submit="Use this key" busy={busy} onSubmit={(v) => void saveKey(v)} autoFocus>
              {error && <p className="danger-text small setup-error">{error}</p>}
            </SecretForm>
            <SecureNote />
            <p className="muted small">Remote Control and plan usage need a Claude subscription, so they’re off with a key only. You can add a subscription later in Settings.</p>
          </>
        )}

        {step === 'personalize' && (
          <>
            <div className="setup-hero compact">
              <span className="setup-check">
                <Icon name="check" size={22} />
              </span>
              <h1>You’re in. Make it yours.</h1>
              {warning && <p className="warn-text small">{warning}</p>}
              <p className="muted">Pick a look to start with. Everything, down to each color, font and shortcut, can be changed later in Settings or with Ctrl+K.</p>
            </div>
            <div className="setup-section">
              <span className="setup-label">Mode</span>
              <div className="segmented" role="radiogroup" aria-label="Mode">
                {(
                  [
                    ['system', 'Match system', 'monitor'],
                    ['light', 'Light', 'sun'],
                    ['dark', 'Dark', 'moon']
                  ] as const
                ).map(([v, label, icon]) => (
                  <button key={v} role="radio" aria-checked={props.settings.theme === v} className={'seg' + (props.settings.theme === v ? ' on' : '')} onClick={() => void props.onChange({ theme: v })}>
                    <Icon name={icon} size={14} /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setup-section">
              <span className="setup-label">Theme</span>
              <div className="setup-themes">
                {BUILTIN_THEMES.slice(0, 8).map((t) => (
                  <button key={t.id} className={'setup-theme' + (a.preset === t.id ? ' on' : '')} onClick={() => setLook({ preset: t.id })} title={t.description}>
                    <span
                      className="setup-theme-dot"
                      style={{
                        background: `linear-gradient(135deg, ${(t.dark ?? t.light)?.bg ?? '#151515'} 0 50%, ${(t.dark ?? t.light)?.accent ?? '#d97757'} 50% 100%)`
                      }}
                    />
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="setup-section">
              <span className="setup-label">Accent</span>
              <div className="swatches">
                <button className={'swatch theme-own' + (!a.accent ? ' on' : '')} onClick={() => setLook({ accent: '' })} title="The theme’s own">
                  <Icon name="sparkle" size={14} />
                </button>
                {ACCENT_SWATCHES.map((c) => (
                  <button key={c} className={'swatch' + (a.accent === c ? ' on' : '')} style={{ background: c }} onClick={() => setLook({ accent: c })} aria-label={`Accent ${c}`} />
                ))}
              </div>
            </div>
            <button className="btn primary big setup-continue" onClick={props.onFinish}>
              Start chatting <Icon name="forward" size={16} />
            </button>
          </>
        )}
      </div>
      <p className="setup-foot muted small">Your chats, files and settings stay on this computer, encrypted.</p>
    </div>
  )
}

function StepHead({ icon, title, onBack }: { icon: string; title: string; onBack: () => void }) {
  return (
    <div className="step-head">
      <button className="icon-btn" onClick={onBack} title="Back" aria-label="Back">
        <Icon name="back" size={18} />
      </button>
      <span className="method-icon">
        <Icon name={icon} size={18} />
      </span>
      <h2>{title}</h2>
    </div>
  )
}
