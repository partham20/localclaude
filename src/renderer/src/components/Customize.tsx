// Settings → Appearance, Keyboard and Mods: change how LocalClaude looks and works.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ACCENT_SWATCHES,
  COLOR_TOKENS,
  DEFAULT_APPEARANCE,
  KEY_ACTIONS,
  LIMITS,
  comboFromEvent,
  conflicts,
  displayCombo,
  isColor,
  normalizeAppearance,
  previewVars,
  resolveBindings,
  type Appearance,
  type ModInfo,
  type ThemePreset
} from '../../../shared/customize'
import type { AppSettings } from '../../../shared/types'
import { api } from '../api'
import { allThemes } from '../appearance'
import { MONO_FONTS, REPLY_FONTS, UI_FONTS } from '../fonts'
import { modHost, useModHost } from '../mods/host'
import { Icon } from './Icon'

const isMac = navigator.platform.toLowerCase().includes('mac')

type Change = (p: Partial<AppSettings>) => Promise<void> | void

function Segmented<T extends string>({ value, options, onChange, name }: { value: T; options: [T, string][]; onChange: (v: T) => void; name: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} className={'seg' + (value === v ? ' on' : '')} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; onReset: () => void }) {
  const [v, setV] = useState(props.value)
  useEffect(() => setV(props.value), [props.value])
  return (
    <div className="slider-row">
      <span className="slider-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onMouseUp={() => props.onChange(v)}
        onKeyUp={() => props.onChange(v)}
        onBlur={() => v !== props.value && props.onChange(v)}
      />
      <button className="slider-value" title="Reset" onClick={props.onReset}>
        {props.format(v)}
      </button>
    </div>
  )
}

/** A little picture of a theme: sidebar, page, a message and the accent. */
function ThemeCard({ theme, dark, active, onPick }: { theme: ThemePreset; dark: boolean; active: boolean; onPick: () => void }) {
  const d = theme.mode ? theme.mode === 'dark' : dark
  const vars = previewVars(theme, d)
  const style = Object.fromEntries(Object.entries(vars).map(([k, v]) => [`--${k}`, v])) as React.CSSProperties
  return (
    <button className={'theme-card' + (active ? ' active' : '')} onClick={onPick} title={theme.description} data-theme-id={theme.id}>
      <span className={'theme-preview' + (d ? ' dark' : ' light')} style={style}>
        <span className="tp-side">
          <i />
          <i />
          <i />
        </span>
        <span className="tp-main">
          <span className="tp-bubble" />
          <span className="tp-line" />
          <span className="tp-line short" />
          <span className="tp-input">
            <span className="tp-send" />
          </span>
        </span>
      </span>
      <span className="theme-name">
        {theme.name}
        {theme.mode && <span className="muted small"> · {theme.mode} only</span>}
        {theme.source && <span className="theme-source">{theme.source.replace(/^script:/, '')}</span>}
      </span>
    </button>
  )
}

function toHex(color: string): string {
  const probe = document.createElement('div')
  probe.style.color = color
  document.body.appendChild(probe)
  const rgb = getComputedStyle(probe).color
  probe.remove()
  const unit = rgb.startsWith('color(') ? 255 : 1
  const m = rgb.replace(/^color\(srgb/, '').match(/[\d.]+/g)
  if (!m) return '#000000'
  return '#' + m.slice(0, 3).map((x) => Math.min(255, Math.round(Number(x) * unit)).toString(16).padStart(2, '0')).join('')
}

/** A theme token's color right now, as #rrggbb for a color picker. */
function currentToken(token: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim()
  return v ? toHex(v) : '#000000'
}

export function AppearancePanel({ settings, onChange }: { settings: AppSettings; onChange: Change }) {
  const a = normalizeAppearance(settings.appearance)
  const mods = useModHost()
  const themes = allThemes(mods.themes)
  // A change is built on the one before it, also while that one is still being saved or the saved
  // settings haven't reached this panel yet: two quick changes (Compact, then Round) used to both
  // start from this render's settings, so the first was lost.
  const pending = useRef<Appearance | null>(null)
  const saving = useRef(0)
  const set = (patch: Partial<Appearance>): void => {
    const next = { ...(pending.current ?? a), ...patch }
    pending.current = next
    saving.current++
    void Promise.resolve(onChange({ appearance: next }))
      .catch(() => {
        pending.current = null
      })
      .finally(() => {
        saving.current--
      })
  }
  // the saved settings are here: later changes can start from them again
  useEffect(() => {
    if (!saving.current) pending.current = null
  }, [settings.appearance])
  const dark = document.documentElement.dataset.theme === 'dark'
  const [css, setCss] = useState(a.customCss)
  useEffect(() => setCss(a.customCss), [a.customCss])
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const [showColors, setShowColors] = useState(Object.keys(a.colors).length > 0)
  // colors read from the page, so they show what the theme really looks like now
  const [, bump] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => bump((x) => x + 1), 30)
    return () => clearTimeout(t)
  }, [settings.appearance, settings.theme])

  return (
    <>
      <h2>Appearance</h2>
      <div className="field">
        <label>Mode</label>
        <Segmented
          name="Mode"
          value={settings.theme}
          options={[
            ['system', 'Match system'],
            ['light', 'Light'],
            ['dark', 'Dark']
          ]}
          onChange={(theme) => void onChange({ theme })}
        />
      </div>

      <div className="field">
        <label>Theme</label>
        <div className="theme-grid">
          {themes.map((t) => (
            <ThemeCard key={t.id} theme={t} dark={dark} active={a.preset === t.id} onPick={() => set({ preset: t.id })} />
          ))}
        </div>
        <p className="muted small">Mods can add more themes. Every color can also be changed below.</p>
      </div>

      <div className="field">
        <label>Accent color</label>
        <div className="swatches">
          <button className={'swatch theme-own' + (!a.accent ? ' on' : '')} onClick={() => set({ accent: '' })} title="The theme’s own accent">
            <Icon name="sparkle" size={14} />
          </button>
          {ACCENT_SWATCHES.map((c) => (
            <button key={c} className={'swatch' + (a.accent.toLowerCase() === c ? ' on' : '')} style={{ background: c }} onClick={() => set({ accent: c })} title={c} aria-label={`Accent ${c}`} />
          ))}
          <label className="swatch custom" title="Any color">
            <input type="color" value={a.accent || currentToken('accent')} onChange={(e) => set({ accent: e.target.value })} />
            <Icon name="plus" size={14} />
          </label>
        </div>
      </div>

      <div className="field">
        <label>Fonts</label>
        <div className="font-grid">
          <span className="muted small">Interface and your messages</span>
          <select className="select" value={settings.uiFont} onChange={(e) => void onChange({ uiFont: e.target.value as AppSettings['uiFont'] })}>
            {UI_FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="muted small">Claude’s replies</span>
          <select className="select" value={settings.replyFont} onChange={(e) => void onChange({ replyFont: e.target.value as AppSettings['replyFont'] })}>
            {REPLY_FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="muted small">Code</span>
          <select className="select" value={a.monoFont} onChange={(e) => set({ monoFont: e.target.value as Appearance['monoFont'] })}>
            {MONO_FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="muted small">Or any installed font</span>
          <div className="row gap custom-fonts">
            <input
              className="input grow"
              placeholder="Interface, e.g. Segoe UI Variable"
              defaultValue={a.customUiFont}
              onBlur={(e) => e.target.value !== a.customUiFont && set({ customUiFont: e.target.value })}
            />
            <input
              className="input grow"
              placeholder="Replies, e.g. Charter"
              defaultValue={a.customReplyFont}
              onBlur={(e) => e.target.value !== a.customReplyFont && set({ customReplyFont: e.target.value })}
            />
          </div>
        </div>
        <div className="font-preview">
          <div className="font-preview-user">Can you explain what this function does?</div>
          <div className="font-preview-reply">
            It reads the config file, checks each entry, and returns the <b>first valid server</b> it finds, or <code>null</code> if none match.
          </div>
        </div>
      </div>

      <div className="field">
        <label>Sizes</label>
        <Slider
          label="Zoom"
          {...LIMITS.zoom}
          value={a.zoom}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(zoom) => set({ zoom })}
          onReset={() => set({ zoom: DEFAULT_APPEARANCE.zoom })}
        />
        <Slider
          label="Reply text"
          {...LIMITS.replySize}
          value={a.replySize}
          format={(v) => `${v}px`}
          onChange={(replySize) => set({ replySize })}
          onReset={() => set({ replySize: DEFAULT_APPEARANCE.replySize })}
        />
        <Slider
          label="Chat width"
          {...LIMITS.chatWidth}
          value={a.chatWidth}
          format={(v) => `${v}px`}
          onChange={(chatWidth) => set({ chatWidth })}
          onReset={() => set({ chatWidth: DEFAULT_APPEARANCE.chatWidth })}
        />
      </div>

      <div className="field">
        <label>Layout</label>
        <div className="layout-grid">
          <span className="muted small">Density</span>
          <Segmented
            name="Density"
            value={a.density}
            options={[
              ['compact', 'Compact'],
              ['comfortable', 'Comfortable'],
              ['spacious', 'Spacious']
            ]}
            onChange={(density) => set({ density })}
          />
          <span className="muted small">Corners</span>
          <Segmented
            name="Corners"
            value={a.corners}
            options={[
              ['sharp', 'Sharp'],
              ['soft', 'Soft'],
              ['round', 'Round']
            ]}
            onChange={(corners) => set({ corners })}
          />
        </div>
        <label className="toggle">
          <input type="checkbox" checked={a.glass} onChange={(e) => set({ glass: e.target.checked })} />
          <span>
            <b>Frosted glass</b>
            <span className="muted small">Translucent menus, dialogs and the reply box, with the page blurred behind them.</span>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={a.backdrop} onChange={(e) => set({ backdrop: e.target.checked })} />
          <span>
            <b>Glow</b>
            <span className="muted small">A soft wash of the accent color behind new chats and the sign-in screen.</span>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={a.animations} onChange={(e) => set({ animations: e.target.checked })} />
          <span>
            <b>Animations</b>
            <span className="muted small">Messages, menus and dialogs fade and slide in.</span>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={a.userBubbles} onChange={(e) => set({ userBubbles: e.target.checked })} />
          <span>
            <b>Your messages in bubbles</b>
            <span className="muted small">Off shows them as plain text with an accent bar, like a document.</span>
          </span>
        </label>
      </div>

      <div className="field">
        <div className="row gap field-head">
          <label>Colors</label>
          <button className="btn ghost small-btn" onClick={() => setShowColors((s) => !s)}>
            {showColors ? 'Hide' : 'Change any color…'}
          </button>
          {Object.keys(a.colors).length > 0 && (
            <button className="btn ghost small-btn" onClick={() => set({ colors: {} })}>
              Reset colors
            </button>
          )}
        </div>
        {showColors && (
          <div className="color-tokens">
            {COLOR_TOKENS.map((t) => (
              <label key={t.token} className={'color-token' + (a.colors[t.token] ? ' changed' : '')} title={`--${t.token}`}>
                <input
                  type="color"
                  value={a.colors[t.token] && isColor(a.colors[t.token]) && a.colors[t.token].startsWith('#') ? a.colors[t.token].slice(0, 7) : currentToken(t.token)}
                  onChange={(e) => set({ colors: { ...a.colors, [t.token]: e.target.value } })}
                />
                <span>{t.label}</span>
                {a.colors[t.token] && (
                  <button
                    className="icon-btn tiny"
                    title="Back to the theme’s color"
                    onClick={(e) => {
                      e.preventDefault()
                      const colors = { ...a.colors }
                      delete colors[t.token]
                      set({ colors })
                    }}
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label>Your own CSS</label>
        <p className="muted small">
          Added last, so it wins over themes and mods. Colors are variables like <code>--bg</code>, <code>--text</code> and <code>--accent</code>.
        </p>
        <textarea
          className="input mono custom-css"
          rows={6}
          spellCheck={false}
          placeholder={'.sidebar { border-right: 2px solid var(--accent); }\n.turn > .md { letter-spacing: 0.01em; }'}
          value={css}
          onChange={(e) => setCss(e.target.value)}
          onBlur={() => css !== a.customCss && set({ customCss: css })}
        />
      </div>

      <div className="field">
        <label>Share or reset</label>
        <div className="row gap">
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(JSON.stringify({ localclaudeAppearance: 1, theme: settings.theme, uiFont: settings.uiFont, replyFont: settings.replyFont, appearance: a }, null, 2))
              setShareMsg('Copied. Paste it into LocalClaude on another computer, or send it to a friend.')
            }}
          >
            Copy my look
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              try {
                const j = JSON.parse(await navigator.clipboard.readText())
                if (!j?.appearance) throw new Error()
                await onChange({
                  appearance: normalizeAppearance(j.appearance),
                  ...(['system', 'light', 'dark'].includes(j.theme) ? { theme: j.theme } : {}),
                  ...(UI_FONTS.some((f) => f.value === j.uiFont) ? { uiFont: j.uiFont } : {}),
                  ...(REPLY_FONTS.some((f) => f.value === j.replyFont) ? { replyFont: j.replyFont } : {})
                })
                setShareMsg('Pasted.')
              } catch {
                setShareMsg('The clipboard doesn’t have a look copied from LocalClaude.')
              }
            }}
          >
            Paste a look
          </button>
          <button className="btn ghost" onClick={() => void onChange({ appearance: DEFAULT_APPEARANCE, uiFont: 'dm-sans', replyFont: 'source-serif' })}>
            Reset everything
          </button>
        </div>
        {shareMsg && <p className="muted small">{shareMsg}</p>}
      </div>
    </>
  )
}

export function KeyboardPanel({ settings, onChange }: { settings: AppSettings; onChange: Change }) {
  const bindings = resolveBindings(settings.keybindings)
  const clash = conflicts(bindings)
  const [recording, setRecording] = useState<string | null>(null)
  const mods = useModHost()
  const modCommands = mods.commands.filter((c) => c.shortcut)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      // the keys you press here set the shortcut; nothing else in the app sees them
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return setRecording(null)
      if (e.key === 'Backspace' || e.key === 'Delete') {
        void onChange({ keybindings: { ...settings.keybindings, [recording]: '' } })
        return setRecording(null)
      }
      const combo = comboFromEvent(e, isMac)
      if (!combo) return
      void onChange({ keybindings: { ...settings.keybindings, [recording]: combo } })
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, settings.keybindings, onChange])

  return (
    <>
      <h2>Keyboard shortcuts</h2>
      <p className="muted small">Click a shortcut, then press the keys you want. Backspace removes it, Esc cancels.</p>
      <div className="keys-table">
        {KEY_ACTIONS.map((act) => {
          const combo = bindings[act.id]
          const changed = combo !== act.default
          const clashing = combo && clash[combo]
          return (
            <div key={act.id} className={'key-row' + (clashing ? ' clash' : '')} data-action={act.id}>
              <span className="key-label">{act.label}</span>
              <button className={'key-chip' + (recording === act.id ? ' recording' : '') + (!combo ? ' empty' : '')} onClick={() => setRecording(recording === act.id ? null : act.id)}>
                {recording === act.id ? 'Press keys…' : combo ? displayCombo(combo, isMac) : 'Not set'}
              </button>
              {changed ? (
                <button
                  className="icon-btn tiny"
                  title={`Back to ${act.default ? displayCombo(act.default, isMac) : 'none'}`}
                  onClick={() => {
                    const kb = { ...settings.keybindings }
                    delete kb[act.id]
                    void onChange({ keybindings: kb })
                  }}
                >
                  <Icon name="rewind" size={13} />
                </button>
              ) : (
                <span />
              )}
              {clashing && <span className="warn-text small key-clash">Also used by {clashing.filter((x) => x !== act.id).map((x) => KEY_ACTIONS.find((k) => k.id === x)?.label).join(', ')}</span>}
            </div>
          )
        })}
      </div>
      {modCommands.length > 0 && (
        <div className="field">
          <label>From mods</label>
          <div className="keys-table">
            {modCommands.map((c) => (
              <div key={c.id} className="key-row">
                <span className="key-label">
                  {c.title} <span className="muted small">· {c.group}</span>
                </span>
                <span className="key-chip readonly">{displayCombo(c.shortcut ?? '', isMac)}</span>
                <span />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="row gap">
        <button className="btn ghost" onClick={() => void onChange({ keybindings: {} })} disabled={!Object.keys(settings.keybindings ?? {}).length}>
          Reset all shortcuts
        </button>
      </div>
      <p className="muted small">In the reply box, Enter sends and Shift+Enter starts a new line; Shift+Tab switches modes.</p>
    </>
  )
}

export function ModsPanel({ settings, onChange, mods, onReload }: { settings: AppSettings; onChange: Change; mods: ModInfo[]; onReload: () => Promise<void> }) {
  const host = useModHost()
  const [busy, setBusy] = useState(false)
  const enabled = settings.mods ?? {}
  const sorted = useMemo(() => [...mods].sort((x, y) => x.name.localeCompare(y.name)), [mods])
  const reload = async (): Promise<void> => {
    setBusy(true)
    try {
      await onReload()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h2>Mods</h2>
      <p className="muted small">
        A mod is a folder in your mods folder with a <code>mod.json</code>. It can restyle anything with CSS, add themes, and with a script add commands, sidebar buttons and
        status items, react to what happens in chats, and change settings. See <b>MODS.md</b> in the app’s repository for the full guide.
      </p>
      <div className="row gap">
        <button className="btn" onClick={() => void api.openModsFolder()}>
          <Icon name="folder" size={15} /> Open mods folder
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => void reload()}>
          <Icon name="retry" size={15} /> {busy ? 'Reloading…' : 'Reload mods'}
        </button>
        {!mods.some((m) => m.id === 'example-mod') && (
          <button
            className="btn ghost"
            onClick={async () => {
              await api.createExampleMod()
              await reload()
            }}
          >
            <Icon name="plus" size={15} /> Add the example mod
          </button>
        )}
      </div>
      {sorted.length === 0 ? (
        <div className="mods-empty">
          <Icon name="puzzle" size={28} />
          <p>No mods yet. Add the example mod to see how one is made, or drop a mod’s folder into the mods folder and reload.</p>
        </div>
      ) : (
        <div className="mod-list">
          {sorted.map((m) => {
            const on = !!enabled[m.id]
            const err = m.error ?? host.errors[m.id]
            return (
              <div key={m.dir} className={'mod-card' + (on ? ' on' : '') + (err ? ' broken' : '')} data-mod={m.id}>
                <div className="mod-head">
                  <span className="mod-icon">
                    <Icon name="puzzle" size={18} />
                  </span>
                  <div className="mod-title">
                    <b>{m.name}</b>
                    <span className="muted small">
                      {[m.version && `v${m.version}`, m.author && `by ${m.author}`].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <label className="switch" title={on ? 'Switch off' : 'Switch on'}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!!m.error}
                      onChange={(e) => {
                        if (e.target.checked && m.main && !confirm(`“${m.name}” runs a script inside LocalClaude. Scripts can do anything the app can, including reading your chats. Only switch on mods you trust. Switch it on?`))
                          return
                        if (!e.target.checked) modHost.stop(m.id)
                        void onChange({ mods: { ...enabled, [m.id]: e.target.checked } })
                      }}
                    />
                    <span />
                  </label>
                </div>
                {m.description && <p className="mod-desc">{m.description}</p>}
                <div className="mod-tags">
                  {m.css && <span className="tag">Styles</span>}
                  {m.themes.length > 0 && <span className="tag">{m.themes.length === 1 ? '1 theme' : `${m.themes.length} themes`}</span>}
                  {m.main && <span className="tag script">Script</span>}
                  {on && host.running.includes(m.id) && <span className="tag ok">Running</span>}
                  {m.homepage && (
                    <a href="#" className="small" onClick={(e) => (e.preventDefault(), void api.openExternal(m.homepage!))}>
                      Homepage
                    </a>
                  )}
                </div>
                {err && <p className="danger-text small mod-error">{err}</p>}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
