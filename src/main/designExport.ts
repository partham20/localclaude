// Exports designs as PDF or PNG: pages are rendered in a hidden, sandboxed window
// (no preload, no access to the app) from a temporary file, then printed or captured.
import { BrowserWindow, app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Chromium can't capture taller images than this in one go. */
const MAX_PNG_PX = 16000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Load the page and wait for its scripts, images and web fonts (also in its frames), but not forever. */
async function load(win: BrowserWindow, file: string): Promise<void> {
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e) => e.preventDefault())
  await Promise.race([win.loadFile(file), sleep(20_000)])
  const fonts = `Promise.all([document, ...[...document.querySelectorAll('iframe')].map((f) => f.contentDocument)].filter(Boolean).map((d) => d.fonts.ready)).then(() => true)`
  await Promise.race([wc.executeJavaScript(fonts), sleep(5_000)]).catch(() => {})
  // animations and late layout settle
  await sleep(400)
}

/** Render a page in a hidden window of this size, then hand the window to `use`. */
async function rendered<T>(page: string, size: { width: number; height: number; offscreen: boolean }, use: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const dir = join(app.getPath('temp'), 'localclaude-design-export')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, randomUUID() + '.html')
  writeFileSync(file, page)
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: size.offscreen }
  })
  try {
    // Windows fits a new window's size to the screen; setting it again isn't limited that way
    win.setContentSize(size.width, size.height)
    await load(win, file)
    return await use(win)
  } finally {
    win.destroy()
    rmSync(file, { force: true })
  }
}

/**
 * One page as PDF or PNG. `exact`: a frame with a fixed size (a phone screen, a slide), exported at exactly
 * width × height; otherwise a PNG is the whole page (at least `height` tall) and a PDF follows the page's own print size.
 */
export async function exportDesign(page: string, opts: { format: 'pdf' | 'png'; width: number; height?: number; slides?: boolean; exact?: boolean }): Promise<Buffer> {
  if (opts.format === 'pdf' && opts.exact && opts.height) return exportFramesPdf([{ html: page, width: opts.width, height: opts.height }])
  return rendered(page, { width: opts.width, height: opts.height || 900, offscreen: opts.format === 'png' }, async (win) => {
    const wc = win.webContents
    if (opts.format === 'pdf') {
      return wc.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        // slides are 1920×1080 px; other pages say their size in CSS, or get A4
        pageSize: opts.slides ? { width: 20, height: 11.25 } : 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      })
    }
    let height = opts.height || 900
    if (!opts.exact) {
      // the whole page (or the screen, when the page is shorter)
      const [pageH, screenH] = (await wc.executeJavaScript('[Math.ceil(document.documentElement.scrollHeight), innerHeight]')) as number[]
      height = pageH > screenH + 1 ? pageH : height
    }
    height = Math.max(64, Math.min(MAX_PNG_PX, height))
    // twice the pixels when it fits
    const scale = height * 2 <= MAX_PNG_PX ? 2 : 1
    win.setContentSize(opts.width * scale, height * scale)
    wc.setZoomFactor(scale)
    await sleep(500)
    // exactly the page (the window can come out a pixel larger)
    return (await wc.capturePage({ x: 0, y: 0, width: opts.width * scale, height: height * scale })).toPNG()
  })
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** Several frames as one PDF, a page per frame at the frame's size (a deck's slides, a set of screens). */
export async function exportFramesPdf(pages: { html: string; width: number; height: number }[]): Promise<Buffer> {
  const css = pages.map((p, i) => `@page f${i}{size:${p.width}px ${p.height}px;margin:0}`).join('')
  const doc =
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}html,body{margin:0}iframe{display:block;border:0}iframe:not(:last-child){break-after:page}</style></head><body>` +
    pages.map((p, i) => `<iframe style="width:${p.width}px;height:${p.height}px;page:f${i}" srcdoc="${attr(p.html)}"></iframe>`).join('') +
    '</body></html>'
  const width = Math.max(...pages.map((p) => p.width))
  return rendered(doc, { width, height: 900, offscreen: false }, (win) =>
    win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
  )
}
