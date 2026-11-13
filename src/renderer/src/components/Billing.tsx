// Shows what chats and designs bill (subscription or Console API key), and sets up the key.
// No `api` import, so the tests can render it.
import { useState } from 'react'
import type { AppSettings, AuthStatus } from '../../../shared/types'
import { CONSOLE_KEY_NOTE, accountLabel, sessionBilling } from '../../../shared/billing'

/** The label after your name in the sidebar: your plan, or "API key". */
export function AccountPlan({ auth, consoleKey }: { auth: AuthStatus; consoleKey: boolean }) {
  const label = accountLabel(auth, consoleKey)
  if (!label) return null
  return (
    <span className="account-plan" title={consoleKey ? CONSOLE_KEY_NOTE : undefined}>
      · {label}
    </span>
  )
}

export type SaveKeyResult = { ok: boolean; error?: string; warning?: string }

/**
 * Settings → Account: add or remove a Console API key, and once there is one, pick what chats
 * and designs bill and say what uses which. The key is typed here once and never shown again.
 */
export function ConsoleKeySettings({
  auth,
  settings,
  onChange,
  onSaveKey,
  onRemoveKey
}: {
  auth: AuthStatus
  settings: Pick<AppSettings, 'chatBilling'>
  onChange: (patch: Partial<AppSettings>) => void
  onSaveKey: (key: string) => Promise<SaveKeyResult>
  onRemoveKey: () => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ error?: string; warning?: string } | null>(null)
  const key = settings.chatBilling !== 'subscription'
  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await onSaveKey(draft)
      if (r.ok) setDraft('')
      setMessage(r.error || r.warning ? { error: r.error, warning: r.warning } : null)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      await onRemoveKey()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="field console-key">
      <label>Console API key</label>
      {!auth.usingConsoleKey ? (
        <>
          <p className="muted small">
            Optional. Add a key from the Anthropic Console to bill chats and designs to it instead of your subscription. Titles, usage checks, sign-in and
            remote control stay on your subscription.
          </p>
          <form
            className="row gap"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim() && !busy) void save()
            }}
          >
            <input
              className="input grow mono console-key-input"
              type="password"
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="btn" disabled={!draft.trim() || busy}>
              {busy ? 'Checking…' : 'Save key'}
            </button>
          </form>
          <p className="muted small">It’s stored encrypted on this machine, like your chats, and isn’t included in exports or backups.</p>
        </>
      ) : (
        <>
          <p className="muted small console-key-status">
            {auth.consoleKeySource === 'env'
              ? `Set by LOCALCLAUDE_API_KEY when LocalClaude started${auth.consoleKeySaved ? ', so it’s used instead of the key saved here' : ''}.`
              : 'A key is saved, encrypted on this machine.'}
          </p>
          {auth.consoleKeySaved && (
            <div className="row gap">
              <button type="button" className="btn danger console-key-remove" disabled={busy} onClick={() => void remove()}>
                Remove saved key
              </button>
            </div>
          )}
          {auth.apiKeyOnly ? (
            <p className="notice console-key-note">Everything bills this key: you signed in with a Console API key and no subscription.</p>
          ) : (
            <>
          <label>Chats and designs use</label>
          <select className="select" value={key ? 'apiKey' : 'subscription'} onChange={(e) => onChange({ chatBilling: e.target.value as AppSettings['chatBilling'] })}>
            <option value="apiKey">Console API key</option>
            <option value="subscription">Claude subscription</option>
          </select>
          <p className="notice console-key-note">
            {key ? CONSOLE_KEY_NOTE : 'You have a Console API key, but chats and designs use your subscription, like everything else. Switch above to bill the key.'}
          </p>
          <p className="muted small">Chats that are busy switch when they finish their turn.</p>
            </>
          )}
        </>
      )}
      {message?.error && <p className="danger-text small console-key-error">{message.error}</p>}
      {message?.warning && <p className="warn-text small">{message.warning}</p>}
    </div>
  )
}

/** Usage page heading: plan limits, labelled as subscription usage while chats bill the key. */
export function UsageIntro({ subscription, consoleKey }: { subscription?: string | null; consoleKey: boolean }) {
  const plan = subscription ? ` (${subscription} plan)` : ''
  if (!consoleKey) return <>Your Claude plan’s limits, shared with the Claude app and Claude Code{plan}.</>
  return (
    <>
      <strong>Subscription usage</strong>: your Claude plan’s limits{plan}. Chats and designs bill your Console API key, so API spend isn’t counted
      here; check the Console for that.
    </>
  )
}

/**
 * In a chat's status line: which source this session really uses, from Claude Code's own report.
 * Nothing when it's the subscription as expected, so chats look as before without the key.
 */
export function SessionBillingTag({ apiKeySource, expectKey }: { apiKeySource?: string; expectKey: boolean }) {
  const b = sessionBilling(apiKeySource, expectKey)
  if (!b || !b.label) return null
  return (
    <span className={'billing-tag' + (b.mismatch ? ' mismatch warn-text' : ' muted')} title={b.detail} role={b.mismatch ? 'alert' : undefined}>
      {b.mismatch ? '⚠ ' : ''}
      {b.label}
    </span>
  )
}

/**
 * Settings → Account: the sign-out button, unless CLAUDE_CODE_OAUTH_TOKEN signs you in
 * (`claude auth logout` can't remove an environment variable, so the button would do nothing).
 */
export function SignOut({ auth, onLogout }: { auth: AuthStatus; onLogout: () => void }) {
  if (auth.apiKeyOnly)
    return (
      <>
        <button className="btn danger" onClick={onLogout}>
          Sign out
        </button>
        <p className="muted small">You’re signed in with a Console API key only. Signing out removes the key from this computer.</p>
      </>
    )
  if (auth.oauthTokenSaved && !auth.usingOAuthTokenEnv)
    return (
      <>
        <button className="btn danger" onClick={onLogout}>
          Sign out
        </button>
        <p className="muted small">Signing out removes the subscription token saved in LocalClaude. Claude Code in your terminal isn’t affected.</p>
      </>
    )
  if (auth.usingOAuthTokenEnv)
    return (
      <p className="muted small">
        You’re signed in with the CLAUDE_CODE_OAUTH_TOKEN environment variable. To sign out, remove that variable and restart LocalClaude.
      </p>
    )
  return (
    <>
      <button className="btn danger" onClick={onLogout}>
        Sign out
      </button>
      <p className="muted small">Signing out also signs out Claude Code in your terminal, since they share one login.</p>
    </>
  )
}

/**
 * Settings → Account: save a subscription token (from `claude setup-token`) instead of the browser
 * sign-in, or remove the one saved. Like the Console key, it's typed once and never shown again.
 */
export function OAuthTokenSettings({
  auth,
  onSave,
  onRemove
}: {
  auth: AuthStatus
  onSave: (token: string) => Promise<SaveKeyResult>
  onRemove: () => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="field oauth-token">
      <label>Subscription token</label>
      {auth.usingOAuthTokenEnv ? (
        <p className="muted small">Set by CLAUDE_CODE_OAUTH_TOKEN when LocalClaude started{auth.oauthTokenSaved ? ', so it’s used instead of the token saved here' : ''}.</p>
      ) : auth.oauthTokenSaved ? (
        <>
          <p className="muted small">A token from claude setup-token is saved, encrypted on this computer, and signs you in.</p>
          <div className="row gap">
            <button
              className="btn danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onRemove()
                } finally {
                  setBusy(false)
                }
              }}
            >
              Remove token
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Optional. Paste a token from <code>claude setup-token</code> to sign in with it instead of the browser sign-in. It uses your subscription the same way.
          </p>
          <form
            className="row gap"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!draft.trim() || busy) return
              setBusy(true)
              setError(null)
              try {
                const r = await onSave(draft)
                if (r.ok) setDraft('')
                else setError(r.error ?? 'That token didn’t work.')
              } finally {
                setBusy(false)
              }
            }}
          >
            <input
              className="input grow mono"
              type="password"
              placeholder="sk-ant-oat01-…"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="btn" disabled={!draft.trim() || busy}>
              {busy ? 'Checking…' : 'Save token'}
            </button>
          </form>
          {error && <p className="danger-text small">{error}</p>}
        </>
      )}
    </div>
  )
}
