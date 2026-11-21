// The browser version's side of the API: calls go to the server as HTTP requests, events come back
// as server-sent events. The server stands in for the desktop bits too: it asks the page to pick a
// folder or files (instead of a native dialog), to download a file it saved, or to open a link.
import { makeApi, type Api } from '../../../shared/api'
import { decodeWire, encodeWire } from '../../../shared/wire'

type Listener = (payload: unknown) => void
const listeners = new Map<string, Set<Listener>>()
/** this tab's id on the server, so picks and downloads come back to the tab that asked */
let clientId = ''

function toLogin(): void {
  if (!location.pathname.startsWith('/login')) location.href = '/login'
}

async function inv<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = await fetch('/api/invoke', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-localclaude': '1', 'x-localclaude-client': clientId },
    body: encodeWire({ ch: channel, args })
  })
  if (r.status === 401) {
    toLogin()
    throw new Error('Signed out')
  }
  const res = decodeWire(await r.text()) as { ok: boolean; value?: T; error?: string }
  if (!res.ok) throw new Error(res.error ?? 'Request failed')
  return res.value as T
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  let set = listeners.get(channel)
  if (!set) listeners.set(channel, (set = new Set()))
  const fn = cb as Listener
  set.add(fn)
  return () => set!.delete(fn)
}

function connect(): void {
  const es = new EventSource('/api/events')
  es.onmessage = (m) => {
    const { ch, payload } = decodeWire(m.data) as { ch: string; payload: unknown }
    if (ch === 'web:hello') clientId = (payload as { clientId: string }).clientId
    else if (ch.startsWith('web:')) void handleWebEvent(ch, payload)
    listeners.get(ch)?.forEach((cb) => cb(payload))
  }
  es.onerror = () => {
    // the browser reconnects by itself; only a lost sign-in needs the login page
    void fetch('/api/session', { credentials: 'same-origin' }).then((r) => {
      if (r.status === 401) {
        es.close()
        toLogin()
      }
    }, () => {})
  }
}

/** Upload files to the server; returns their paths there. */
async function upload(files: File[]): Promise<string[]> {
  const out: string[] = []
  for (const f of files) {
    const r = await fetch('/api/upload?name=' + encodeURIComponent(f.name), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream', 'x-localclaude': '1' },
      body: f
    })
    if (r.status === 401) toLogin()
    if (!r.ok) throw new Error(`Upload of ${f.name} failed (${r.status})`)
    out.push(((await r.json()) as { path: string }).path)
  }
  return out
}

// ---------------------------------------------------------------- small overlay UI (no React needed)
function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.setAttribute('style', style)
  if (text !== undefined) e.textContent = text
  return e
}

const BTN = 'padding:7px 14px;border-radius:8px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font:inherit;cursor:pointer'
const BTN_PRIMARY = 'padding:7px 14px;border-radius:8px;border:0;background:var(--accent,#c2603e);color:#fff;font:inherit;cursor:pointer'

function modal(title: string): { box: HTMLDivElement; close: () => void } {
  const backdrop = el('div', 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px')
  const box = el(
    'div',
    'background:var(--bg-elev,#fff);color:var(--text,#222);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);width:min(560px,100%);max-height:80vh;display:flex;flex-direction:column;gap:12px;padding:18px;font:14px/1.4 system-ui,sans-serif'
  )
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', title)
  box.append(el('div', 'font-weight:600;font-size:15px', title))
  backdrop.append(box)
  document.body.append(backdrop)
  return { box, close: () => backdrop.remove() }
}

function toast(text: string, link?: { href: string; label: string }): void {
  const t = el(
    'div',
    'position:fixed;right:16px;bottom:16px;z-index:100001;max-width:min(420px,calc(100vw - 32px));background:var(--bg-elev,#fff);color:var(--text,#222);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.3);padding:12px 14px;font:13px/1.4 system-ui,sans-serif;display:flex;gap:10px;align-items:center'
  )
  t.append(el('span', 'flex:1;word-break:break-word', text))
  if (link) {
    const a = el('a', 'color:var(--accent,#c2603e);font-weight:600;white-space:nowrap', link.label)
    a.href = link.href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.onclick = () => setTimeout(() => t.remove(), 200)
    t.append(a)
  }
  const x = el('button', 'border:0;background:none;color:inherit;cursor:pointer;font-size:16px', '×')
  x.setAttribute('aria-label', 'Close')
  x.onclick = () => t.remove()
  t.append(x)
  document.body.append(t)
  setTimeout(() => t.remove(), 60_000)
}

type Pick = { id: string; kind: 'folder' | 'files'; title?: string; multi?: boolean; start?: string }

/** Folder browser over the server's file system. */
function pickFolder(p: Pick): Promise<string[] | null> {
  return new Promise((resolve) => {
    const { box, close } = modal(p.title || 'Choose a folder')
    const pathRow = el('div', 'display:flex;gap:8px')
    const input = el('input', 'flex:1;padding:7px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;font:13px ui-monospace,monospace')
    input.setAttribute('aria-label', 'Folder path')
    const go = el('button', BTN, 'Go')
    pathRow.append(input, go)
    const list = el('div', 'overflow:auto;min-height:200px;max-height:45vh;border:1px solid rgba(128,128,128,.25);border-radius:8px;padding:4px')
    const err = el('div', 'color:#c0392b;font-size:12px;min-height:16px')
    const actions = el('div', 'display:flex;gap:8px;justify-content:space-between;align-items:center')
    const mk = el('button', BTN, 'New folder')
    const right = el('div', 'display:flex;gap:8px')
    const cancel = el('button', BTN, 'Cancel')
    const choose = el('button', BTN_PRIMARY, 'Choose this folder')
    right.append(cancel, choose)
    actions.append(mk, right)
    box.append(pathRow, list, err, actions)
    let current = ''
    const load = async (path: string): Promise<void> => {
      err.textContent = ''
      try {
        const r = await inv<{ path: string; parent: string | null; dirs: string[] }>('web:listDir', path)
        current = r.path
        input.value = r.path
        list.replaceChildren()
        const row = (label: string, target: string): void => {
          const b = el('button', 'display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;cursor:pointer', label)
          b.onmouseenter = () => (b.style.background = 'rgba(128,128,128,.15)')
          b.onmouseleave = () => (b.style.background = 'none')
          b.onclick = () => void load(target)
          list.append(b)
        }
        if (r.parent) row('↑ ..', r.parent)
        for (const d of r.dirs) row('📁 ' + d, r.path.replace(/\/$/, '') + '/' + d)
        if (!r.dirs.length) list.append(el('div', 'padding:8px;opacity:.6', 'No folders here'))
      } catch (e) {
        err.textContent = (e as Error).message
      }
    }
    const done = (v: string[] | null): void => {
      close()
      resolve(v)
    }
    go.onclick = () => void load(input.value)
    input.onkeydown = (e) => {
      if (e.key === 'Enter') void load(input.value)
      if (e.key === 'Escape') done(null)
    }
    mk.onclick = async () => {
      const name = prompt('New folder name')
      if (!name) return
      try {
        const made = await inv<string>('web:mkdir', current, name)
        await load(made)
      } catch (e) {
        err.textContent = (e as Error).message
      }
    }
    cancel.onclick = () => done(null)
    choose.onclick = () => done(current ? [current] : null)
    void load(p.start || '')
  })
}

/** Files from this computer, uploaded to the server. */
function pickFiles(p: Pick): Promise<string[] | null> {
  return new Promise((resolve) => {
    const { box, close } = modal(p.title || 'Choose files')
    const file = el('input', 'display:none')
    file.type = 'file'
    file.multiple = p.multi !== false
    const drop = el(
      'div',
      'border:2px dashed rgba(128,128,128,.4);border-radius:10px;padding:28px;text-align:center;cursor:pointer',
      'Click to choose files from this computer, or drop them here'
    )
    const status = el('div', 'font-size:12px;min-height:16px;opacity:.8')
    const actions = el('div', 'display:flex;justify-content:flex-end')
    const cancel = el('button', BTN, 'Cancel')
    actions.append(cancel)
    box.append(file, drop, status, actions)
    let busy = false
    const done = (v: string[] | null): void => {
      close()
      resolve(v)
    }
    const send = async (files: File[]): Promise<void> => {
      if (!files.length || busy) return
      busy = true
      status.textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`
      try {
        done(await upload(files))
      } catch (e) {
        busy = false
        status.textContent = (e as Error).message
      }
    }
    drop.onclick = () => file.click()
    drop.ondragover = (e) => e.preventDefault()
    drop.ondrop = (e) => {
      e.preventDefault()
      void send(Array.from(e.dataTransfer?.files ?? []))
    }
    file.onchange = () => void send(Array.from(file.files ?? []))
    cancel.onclick = () => !busy && done(null)
  })
}

async function handleWebEvent(ch: string, payload: unknown): Promise<void> {
  if (ch === 'web:open') {
    const { url } = payload as { url: string }
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    if (!w) toast('LocalClaude wants to open a page.', { href: url, label: 'Open' })
  } else if (ch === 'web:download') {
    const { url, name } = payload as { url: string; name: string }
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.append(a)
    a.click()
    a.remove()
    toast(`Downloading ${name}`)
  } else if (ch === 'web:notice') {
    toast((payload as { text: string }).text)
  } else if (ch === 'web:pick') {
    const p = payload as Pick
    let result: string[] | null = null
    try {
      result = p.kind === 'folder' ? await pickFolder(p) : await pickFiles(p)
    } finally {
      await inv('web:pickResult', p.id, result).catch(() => {})
    }
  }
}

/** The API for the browser version. */
export function createWebApi(): Api {
  // lets the styles drop desktop-only room (window buttons) and use touch-friendly sizes
  document.documentElement.dataset.web = 'on'
  connect()
  return makeApi({
    inv,
    on,
    pathForFile: () => '',
    filePaths: (files) => upload(files),
    setZoom: (factor) => {
      ;(document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(factor)
    },
    platform: 'web',
    web: true
  })
}

/** Desktop-only addresses (artifact://, lcimg://, lcmod://) as server routes. */
export function webUrl(url: string): string {
  const m = /^(artifact|lcimg|lcmod):\/\/(.*)$/.exec(url)
  return m ? `/proto/${m[1]}/${m[2]}` : url
}
