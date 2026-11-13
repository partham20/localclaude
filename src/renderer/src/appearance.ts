// Puts Settings → Appearance on the page: the theme's colors, your accent and colors, light or
// dark, sizes, density, corners, effects, zoom and your own CSS.
import { useEffect, useRef } from 'react'
import { BUILTIN_THEMES, effectiveDark, normalizeAppearance, themeVars, type ThemePreset } from '../../shared/customize'
import type { AppSettings } from '../../shared/types'
import { api } from './api'

/** Every theme you can pick: the built-in ones, then those mods add. */
export function allThemes(modThemes: ThemePreset[]): ThemePreset[] {
  return [...BUILTIN_THEMES, ...modThemes.filter((t) => !BUILTIN_THEMES.some((b) => b.id === t.id))]
}

/** The page's background and text colors as the browser resolved them, for the window buttons. */
function resolvedColors(): { color?: string; symbolColor?: string } {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;background:var(--bg);color:var(--text)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const out = { color: cs.backgroundColor, symbolColor: cs.color }
  probe.remove()
  return out
}

export function useAppearance(settings: AppSettings | null, modThemes: ThemePreset[], onDarkChange?: (dark: boolean) => void): void {
  const setVars = useRef<string[]>([])
  const theme = settings?.theme
  const a = settings ? normalizeAppearance(settings.appearance) : null
  const key = JSON.stringify(a) + theme + JSON.stringify(modThemes.map((t) => [t.id, t.light, t.dark]))
  const darkCb = useRef(onDarkChange)
  darkCb.current = onDarkChange

  useEffect(() => {
    if (!a || !theme) return
    const themes = allThemes(modThemes)
    const preset = themes.find((t) => t.id === a.preset)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const root = document.documentElement
    const apply = (): void => {
      const dark = effectiveDark(theme, mq.matches, preset)
      root.dataset.theme = dark ? 'dark' : 'light'
      for (const k of setVars.current) root.style.removeProperty(`--${k}`)
      const vars = themeVars(a, dark, themes)
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v)
      setVars.current = Object.keys(vars)
      void api.setWindowTheme(dark, resolvedColors())
      darkCb.current?.(dark)
    }
    root.dataset.density = a.density
    root.dataset.corners = a.corners
    root.dataset.glass = a.glass ? 'on' : 'off'
    root.dataset.motion = a.animations ? 'on' : 'off'
    root.dataset.bubbles = a.userBubbles ? 'on' : 'off'
    root.dataset.backdrop = a.backdrop ? 'on' : 'off'
    root.dataset.preset = a.preset.replace(/[^a-z0-9_-]/gi, '-')
    root.style.setProperty('--reply-size', `${a.replySize}px`)
    root.style.setProperty('--chat-width', `${a.chatWidth}px`)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // zoom applies to the whole window
  useEffect(() => {
    if (a) api.setZoom(a.zoom)
  }, [a?.zoom])

  // your own CSS goes last, so it wins over everything (mods included)
  useEffect(() => {
    let el = document.getElementById('lc-custom-css') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'lc-custom-css'
      document.head.appendChild(el)
    }
    el.textContent = a?.customCss ?? ''
  }, [a?.customCss])
}
