// Ctrl+K: every action in the app, your chats, themes, settings pages, and commands mods add, in one search.
import { useEffect, useMemo, useRef, useState } from 'react'
import { displayCombo } from '../../../shared/customize'
import type { Command } from '../mods/host'
import { Icon } from './Icon'

export interface PaletteItem extends Command {
  icon?: string
  /** right-hand hint, e.g. "Chat" */
  hint?: string
}

const isMac = navigator.platform.toLowerCase().includes('mac')

/** Score how well the query matches: every word must appear; earlier and word-start matches rank higher. */
export function score(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const t = text.toLowerCase()
  let total = 0
  for (const w of q.split(/\s+/)) {
    const i = t.indexOf(w)
    if (i < 0) return 0
    total += (i === 0 ? 3 : /[\s:/(-]/.test(t[i - 1] ?? '') ? 2 : 1) - i / 1000
  }
  return total
}

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const scored = items
      .map((it) => ({ it, s: score(query, `${it.title} ${it.group ?? ''} ${it.keywords ?? ''}`) }))
      .filter((x) => x.s > 0)
    if (query.trim()) scored.sort((a, b) => b.s - a.s)
    return scored.slice(0, 60).map((x) => x.it)
  }, [items, query])

  useEffect(() => setSel(0), [query])
  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const run = (it: PaletteItem | undefined): void => {
    if (!it) return
    onClose()
    // after the palette closes, so a command that opens a dialog gets focus
    setTimeout(() => void Promise.resolve(it.run()).catch((e) => console.error(e)), 0)
  }

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-search">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search commands, chats, themes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(results.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(results[sel])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onClose()
              }
            }}
          />
          <kbd className="palette-esc">Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty muted">Nothing matches “{query}”.</div>}
          {results.map((it, i) => (
            <button
              key={it.id}
              className={'palette-item' + (i === sel ? ' selected' : '')}
              onMouseMove={() => i !== sel && setSel(i)}
              onClick={() => run(it)}
            >
              <span className="palette-icon">
                <Icon name={it.icon ?? 'command'} size={15} />
              </span>
              <span className="palette-title">{it.title}</span>
              {it.group && <span className="palette-group">{it.group}</span>}
              {it.shortcut && <kbd className="palette-kbd">{displayCombo(it.shortcut, isMac)}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
