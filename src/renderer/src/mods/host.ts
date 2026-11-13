// Runs mods in the window: their CSS, themes and scripts, and the API their scripts get.
// The rest of the app reads what mods added (commands, sidebar buttons, status items, themes)
// from the snapshot, through useModHost().
import { useSyncExternalStore } from 'react'
import { parseTheme, type Appearance, type ModInfo, type ThemePreset } from '../../../shared/customize'
import type { AppSettings } from '../../../shared/types'

export interface Command {
  id: string
  title: string
  run: () => unknown
  /** e.g. 'Mod+Shift+H' */
  shortcut?: string
  /** shown beside it in the palette ('Mod: <name>' for mods) */
  group?: string
  /** words that also find it */
  keywords?: string
  modId?: string
}
export interface SidebarItem {
  modId: string
  id: string
  label: string
  icon?: string
  title?: string
  onClick: () => unknown
}
export interface StatusItem {
  modId: string
  id: string
  text: string
  title?: string
  onClick?: () => unknown
}

/** What happens in the app that mods can listen for. */
export type ModEvent = 'chat-opened' | 'turn-done' | 'message-sent' | 'theme-changed' | 'settings-changed'

/** What the app lets mods do (set by App once it's running). */
export interface AppBridge {
  newChat: () => Promise<unknown>
  openSettings: (tab?: string) => void
  send: (text: string) => Promise<void>
  activeChat: () => { id: string; title: string; cwd: string } | null
  settings: () => AppSettings
  setAppearance: (patch: Partial<Appearance>) => Promise<void>
  setTheme: (theme: AppSettings['theme']) => Promise<void>
  toast: (text: string, error?: boolean) => void
  open: (page: 'projects' | 'artifacts' | 'designs') => void
}

export interface Snapshot {
  commands: Command[]
  sidebar: SidebarItem[]
  status: StatusItem[]
  /** themes from mods (their mod.json, or registered by their scripts) */
  themes: ThemePreset[]
  /** mods that are running, and the ones whose script failed */
  running: string[]
  errors: Record<string, string>
}

const EMPTY: Snapshot = { commands: [], sidebar: [], status: [], themes: [], running: [], errors: {} }

const ICON_FALLBACK = 'sparkle'

class ModHost {
  private snap: Snapshot = EMPTY
  private listeners = new Set<() => void>()
  private handlers = new Map<ModEvent, Set<{ modId: string; cb: (payload: unknown) => void }>>()
  private disposers = new Map<string, (() => void)[]>()
  private styleEls = new Map<string, HTMLStyleElement>()
  private fileThemes = new Map<string, ThemePreset[]>()
  bridge: AppBridge | null = null

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = (): Snapshot => this.snap

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const fn of this.listeners) fn()
  }

  emit(event: ModEvent, payload?: unknown): void {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        h.cb(payload)
      } catch (e) {
        console.error(`mod ${h.modId}: ${event} handler failed`, e)
      }
    }
  }

  /** Bring the window in line with the mods that are switched on: add new ones, remove switched-off ones. */
  async sync(mods: ModInfo[], enabled: Record<string, boolean>, reload = false): Promise<void> {
    const on = mods.filter((m) => enabled[m.id] && !m.error)
    const onIds = new Set(on.map((m) => m.id))
    for (const id of [...new Set([...this.styleEls.keys(), ...this.fileThemes.keys(), ...this.snap.running])])
      if (!onIds.has(id) || reload) this.stop(id)
    for (const m of on) {
      if (!this.styleEls.has(m.id) && m.css) {
        const el = document.createElement('style')
        el.dataset.mod = m.id
        el.textContent = m.css
        // before your own CSS, so it still wins
        const custom = document.getElementById('lc-custom-css')
        document.head.insertBefore(el, custom)
        this.styleEls.set(m.id, el)
      }
      if (!this.fileThemes.has(m.id)) this.fileThemes.set(m.id, m.themes)
    }
    this.refreshThemes()
    for (const m of on) if (m.main && !this.snap.running.includes(m.id) && !this.snap.errors[m.id]) await this.start(m)
  }

  private refreshThemes(extra: ThemePreset[] = []): void {
    const fromFiles = [...this.fileThemes.values()].flat()
    const fromScripts = this.snap.themes.filter((t) => t.source?.startsWith('script:') && this.snap.running.includes(t.source.slice(7)))
    const all = [...fromFiles, ...fromScripts, ...extra]
    this.set({ themes: all.filter((t, i) => all.findIndex((x) => x.id === t.id) === i) })
  }

  private async start(m: ModInfo): Promise<void> {
    this.set({ running: [...this.snap.running, m.id] })
    try {
      const url = `lcmod://${m.id}/${m.main}?v=${Date.now()}`
      const mod = (await import(/* @vite-ignore */ url)) as { default?: (api: unknown) => unknown }
      if (typeof mod.default !== 'function') throw new Error('The script has no default export (export default function activate(lc) { … }).')
      const r = await mod.default(this.apiFor(m))
      if (typeof r === 'function') this.track(m.id, r as () => void)
    } catch (e) {
      console.error(`mod ${m.id} failed to start`, e)
      // its styles and themes stay; only what the script added goes
      this.stop(m.id, true)
      this.set({ errors: { ...this.snap.errors, [m.id]: e instanceof Error ? e.message : String(e) } })
    }
  }

  /** Switch a mod off: run its clean-ups and take away everything it added. */
  stop(id: string, scriptOnly = false): void {
    for (const d of (this.disposers.get(id) ?? []).reverse()) {
      try {
        d()
      } catch (e) {
        console.error(`mod ${id}: clean-up failed`, e)
      }
    }
    this.disposers.delete(id)
    if (!scriptOnly) {
      this.styleEls.get(id)?.remove()
      this.styleEls.delete(id)
      this.fileThemes.delete(id)
    }
    for (const set of this.handlers.values()) for (const h of [...set]) if (h.modId === id) set.delete(h)
    const errors = { ...this.snap.errors }
    delete errors[id]
    this.set({
      commands: this.snap.commands.filter((c) => c.modId !== id),
      sidebar: this.snap.sidebar.filter((c) => c.modId !== id),
      status: this.snap.status.filter((c) => c.modId !== id),
      themes: this.snap.themes.filter((t) => t.source !== `script:${id}`),
      running: this.snap.running.filter((x) => x !== id),
      errors
    })
    this.refreshThemes()
  }

  private track(id: string, fn: () => void): () => void {
    const list = this.disposers.get(id) ?? []
    list.push(fn)
    this.disposers.set(id, list)
    return fn
  }

  /** The API a mod's script gets: everything it adds is taken away again when it's switched off. */
  private apiFor(m: ModInfo): unknown {
    const id = m.id
    const bridge = (): AppBridge => {
      if (!this.bridge) throw new Error('LocalClaude isn’t ready yet')
      return this.bridge
    }
    const key = (k: string): string => `mod:${id}:${k}`
    return Object.freeze({
      id,
      appVersion: '1.4.0',
      commands: {
        register: (c: Omit<Command, 'modId' | 'group'>) => {
          if (!c?.id || !c.title || typeof c.run !== 'function') throw new Error('commands.register needs an id, a title and run()')
          const cmd: Command = { id: `${id}:${c.id}`, title: String(c.title), run: c.run, shortcut: c.shortcut, keywords: c.keywords, group: m.name, modId: id }
          this.set({ commands: [...this.snap.commands.filter((x) => x.id !== cmd.id), cmd] })
          return this.track(id, () => this.set({ commands: this.snap.commands.filter((x) => x.id !== cmd.id) }))
        },
        run: (commandId: string) => {
          const c = this.snap.commands.find((x) => x.id === commandId || x.id === `${id}:${commandId}`)
          if (!c) throw new Error(`No command “${commandId}”`)
          return c.run()
        }
      },
      themes: {
        register: (theme: unknown) => {
          const t = parseTheme(theme, `script:${id}`)
          if (!t) throw new Error('themes.register needs an id, a name, and light or dark colors')
          const full = { ...t, id: `${id}/${t.id}`, source: `script:${id}` }
          this.set({ themes: [...this.snap.themes.filter((x) => x.id !== full.id), full] })
          return this.track(id, () => this.set({ themes: this.snap.themes.filter((x) => x.id !== full.id) }))
        }
      },
      ui: {
        toast: (text: string, opts?: { error?: boolean }) => bridge().toast(String(text), !!opts?.error),
        addStyle: (css: string) => {
          const el = document.createElement('style')
          el.dataset.mod = id
          el.textContent = String(css)
          document.head.insertBefore(el, document.getElementById('lc-custom-css'))
          return this.track(id, () => el.remove())
        },
        setCssVar: (name: string, value: string) => {
          const n = name.startsWith('--') ? name : `--${name}`
          document.documentElement.style.setProperty(n, String(value))
          return this.track(id, () => document.documentElement.style.removeProperty(n))
        },
        addSidebarItem: (item: Omit<SidebarItem, 'modId'>) => {
          if (!item?.id || !item.label || typeof item.onClick !== 'function') throw new Error('ui.addSidebarItem needs an id, a label and onClick()')
          const it: SidebarItem = { ...item, icon: item.icon ?? ICON_FALLBACK, modId: id }
          this.set({ sidebar: [...this.snap.sidebar.filter((x) => !(x.modId === id && x.id === it.id)), it] })
          return this.track(id, () => this.set({ sidebar: this.snap.sidebar.filter((x) => !(x.modId === id && x.id === it.id)) }))
        },
        addStatusItem: (item: Omit<StatusItem, 'modId'>) => {
          if (!item?.id) throw new Error('ui.addStatusItem needs an id')
          const match = (x: StatusItem): boolean => x.modId === id && x.id === item.id
          this.set({ status: [...this.snap.status.filter((x) => !match(x)), { ...item, text: String(item.text ?? ''), modId: id }] })
          const dispose = this.track(id, () => this.set({ status: this.snap.status.filter((x) => !match(x)) }))
          return {
            update: (patch: Partial<Omit<StatusItem, 'modId' | 'id'>>) =>
              this.set({ status: this.snap.status.map((x) => (match(x) ? { ...x, ...patch, text: String(patch.text ?? x.text) } : x)) }),
            dispose
          }
        }
      },
      events: {
        on: (event: ModEvent, cb: (payload: unknown) => void) => {
          const set = this.handlers.get(event) ?? new Set()
          const h = { modId: id, cb }
          set.add(h)
          this.handlers.set(event, set)
          return this.track(id, () => set.delete(h))
        }
      },
      app: {
        newChat: () => bridge().newChat(),
        openSettings: (tab?: string) => bridge().openSettings(tab),
        open: (page: 'projects' | 'artifacts' | 'designs') => bridge().open(page),
        send: (text: string) => bridge().send(String(text)),
        activeChat: () => bridge().activeChat(),
        appearance: () => ({ ...bridge().settings().appearance }),
        setAppearance: (patch: Partial<Appearance>) => bridge().setAppearance(patch),
        setTheme: (theme: AppSettings['theme']) => bridge().setTheme(theme)
      },
      storage: {
        get: (k: string) => {
          try {
            const v = localStorage.getItem(key(k))
            return v === null ? undefined : JSON.parse(v)
          } catch {
            return undefined
          }
        },
        set: (k: string, v: unknown) => {
          try {
            localStorage.setItem(key(k), JSON.stringify(v))
          } catch {
            /* storage full or blocked */
          }
        },
        remove: (k: string) => {
          try {
            localStorage.removeItem(key(k))
          } catch {
            /* blocked */
          }
        }
      }
    })
  }
}

export const modHost = new ModHost()

export function useModHost(): Snapshot {
  return useSyncExternalStore(modHost.subscribe, modHost.getSnapshot)
}
