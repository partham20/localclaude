// What chats and designs bill: your Claude subscription, or a Console API key (LOCALCLAUDE_API_KEY).
// Pure helpers shared by the UI and the tests. The key itself never reaches the renderer.
import type { AppSettings, AuthStatus } from './types'

export const CONSOLE_KEY_NOTE =
  'Chats and designs use your Console API key. Titles, usage checks, sign-in and remote control use your subscription.'

/** Chats and designs bill the Console key: it's set, and Settings haven't switched them to the subscription. */
export function billsConsoleKey(auth: Pick<AuthStatus, 'usingConsoleKey'>, settings: Pick<AppSettings, 'chatBilling'> | null | undefined): boolean {
  return !!auth.usingConsoleKey && settings?.chatBilling !== 'subscription'
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** The sidebar's label next to your name: "API key" when chats bill the key, else your plan ("Max"), or nothing. */
export function accountLabel(auth: Pick<AuthStatus, 'subscriptionType'>, consoleKey: boolean): string {
  if (consoleKey) return 'API key'
  return auth.subscriptionType ? cap(auth.subscriptionType) : ''
}

/**
 * Claude Code's apiKeySource (from the session's init message) names an API key, not the
 * claude.ai login. 'none' and 'oauth' are the login; anything else is a key of some kind.
 */
export function isKeySource(src: string | undefined): boolean {
  return !!src && src !== 'none' && src !== 'oauth' && src !== 'undefined'
}

export interface SessionBilling {
  /** what this session reports it is using */
  usesKey: boolean
  /** it disagrees with what the app expects */
  mismatch: boolean
  /** shown in the chat's status line; '' shows nothing (the subscription, as expected) */
  label: string
  /** tooltip / warning text */
  detail: string
}

/** Compare the session's real apiKeySource with what the app expects it to bill. */
export function sessionBilling(apiKeySource: string | undefined, expectKey: boolean): SessionBilling | null {
  // undefined: not started yet; '': restarting after the choice changed in Settings
  if (!apiKeySource) return null
  const usesKey = isKeySource(apiKeySource)
  const mismatch = usesKey !== expectKey
  if (!usesKey && !mismatch) return { usesKey, mismatch, label: '', detail: '' }
  if (!mismatch) return { usesKey, mismatch, label: 'API key', detail: `This chat bills your Console API key (Claude Code reports "${apiKeySource}").` }
  return usesKey
    ? {
        usesKey,
        mismatch,
        label: 'API key, not subscription',
        detail: `This chat is billing an API key (Claude Code reports "${apiKeySource}"), but it should be using your subscription.`
      }
    : {
        usesKey,
        mismatch,
        label: 'Subscription, not API key',
        detail: `This chat is using your subscription (Claude Code reports "${apiKeySource}"), but it should be billing your Console API key. It switches when the chat restarts.`
      }
}
