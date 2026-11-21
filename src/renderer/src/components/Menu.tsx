import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  key: string
  label: ReactNode
  hint?: ReactNode
  checked?: boolean
  danger?: boolean
  disabled?: boolean
  /** shown on hover, e.g. a folder's full path */
  title?: string
  onSelect: () => void
}
export type MenuEntry = MenuItem | { section: ReactNode } | 'divider'

/** A button that opens a Claude app-style popover menu. */
export function Menu(props: {
  trigger: ReactNode
  entries: MenuEntry[]
  title?: string
  className?: string
  align?: 'left' | 'right'
  direction?: 'up' | 'down'
  footer?: ReactNode
  /** a filter box at the top once there are more items than this (long lists, like OpenCode's models) */
  searchOver?: number
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const items = props.entries.filter((e): e is MenuItem => e !== 'divider' && !('section' in e))
  const searchable = props.searchOver !== undefined && items.length > props.searchOver
  const q = query.trim().toLowerCase()
  const text = (n: ReactNode): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : '')
  const shown: MenuEntry[] = searchable && q ? items.filter((e) => (text(e.label) + ' ' + text(e.hint) + ' ' + e.key).toLowerCase().includes(q)) : props.entries
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  return (
    <div className={'menu-wrap ' + (props.className ?? '')} ref={ref}>
      <button
        className={'menu-trigger' + (open ? ' open' : '')}
        onClick={() => {
          setOpen(!open)
          setQuery('')
        }}
        title={props.title}
      >
        {props.trigger}
      </button>
      {/* phones: the menu is a sheet from the bottom, over a dimmed screen */}
      {open && <div className="menu-scrim" onClick={() => setOpen(false)} />}
      {open && (
        <div className={`menu-pop ${props.align ?? 'left'} ${props.direction ?? 'down'}`} role="menu">
          {searchable && (
            <input
              className="input menu-search"
              autoFocus
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const first = shown.find((x): x is MenuItem => x !== 'divider' && !('section' in x) && !x.disabled)
                  if (first) {
                    setOpen(false)
                    first.onSelect()
                  }
                }
              }}
            />
          )}
          {searchable && q && !shown.length && <div className="menu-section">Nothing matches</div>}
          {shown.map((e, i) =>
            e === 'divider' ? (
              <div key={'d' + i} className="menu-divider" />
            ) : 'section' in e ? (
              <div key={'s' + i} className="menu-section">
                {e.section}
              </div>
            ) : (
              <button
                key={e.key}
                role="menuitem"
                className={'menu-item' + (e.danger ? ' danger' : '') + (e.checked ? ' checked' : '')}
                disabled={e.disabled}
                title={e.title}
                onClick={() => {
                  setOpen(false)
                  e.onSelect()
                }}
              >
                <span className="menu-label">
                  {e.label}
                  {e.hint && <span className="menu-hint">{e.hint}</span>}
                </span>
                {e.checked && <span className="menu-check">✓</span>}
              </button>
            )
          )}
          {props.footer && <div className="menu-footer">{props.footer}</div>}
        </div>
      )}
    </div>
  )
}
