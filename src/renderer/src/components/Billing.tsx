// Shows what chats and designs bill (subscription or Console API key). No `api` import, so the tests can render it.
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

/**
 * Settings → Account, only when LOCALCLAUDE_API_KEY is set: pick what chats and designs bill,
 * and say what uses which. Renders nothing without the variable, so that page looks as before.
 */
export function ConsoleKeySettings({
  auth,
  settings,
  onChange
}: {
  auth: AuthStatus
  settings: Pick<AppSettings, 'chatBilling'>
  onChange: (patch: Partial<AppSettings>) => void
}) {
  if (!auth.usingConsoleKey) return null
  const key = settings.chatBilling !== 'subscription'
  return (
    <div className="field console-key">
      <label>Chats and designs use</label>
      <select className="select" value={key ? 'apiKey' : 'subscription'} onChange={(e) => onChange({ chatBilling: e.target.value as AppSettings['chatBilling'] })}>
        <option value="apiKey">Console API key</option>
        <option value="subscription">Claude subscription</option>
      </select>
      <p className="notice console-key-note">
        {key
          ? CONSOLE_KEY_NOTE
          : 'LOCALCLAUDE_API_KEY is set, but chats and designs use your subscription, like everything else. Switch above to bill the key.'}
      </p>
      <p className="muted small">Chats that are busy switch when they finish their turn.</p>
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
