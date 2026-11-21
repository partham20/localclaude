// In server mode there's no desktop to show dialogs on or open things with. These stand-ins send that
// work to the browser instead: a folder or file picker in the page, a download, or a link to open.
import { dialog, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { mkdirSync, renameSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { log } from '../log'
import type { WebServer } from './index'

type Patchable = Record<string, unknown>

function optsOf<T>(a: unknown, b: unknown): T {
  // dialog.showXDialog(window, options) or dialog.showXDialog(options)
  return ((b ?? a) ?? {}) as T
}

export function installDesktopStandIns(web: WebServer, dataDir: string): void {
  const d = dialog as unknown as Patchable
  const s = shell as unknown as Patchable

  d.showOpenDialog = async (a: unknown, b?: unknown) => {
    const o = optsOf<OpenDialogOptions>(a, b)
    const props = o.properties ?? []
    const folder = props.includes('openDirectory')
    const paths = await web.pick(folder ? 'folder' : 'files', { title: o.title, multi: props.includes('multiSelections'), start: o.defaultPath })
    return { canceled: !paths?.length, filePaths: paths ?? [] }
  }

  d.showSaveDialog = async (a: unknown, b?: unknown) => {
    const o = optsOf<SaveDialogOptions>(a, b)
    return { canceled: false, filePath: web.saveTarget(basename(o.defaultPath || 'download')) }
  }

  d.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  d.showErrorBox = (title: string, content: string) => log('error', `${title}: ${content}`)

  s.openExternal = async (url: string) => {
    if (/^https?:\/\//i.test(url)) web.open(url)
    else if (/^file:/i.test(url)) offerPath(web, decodeURIComponent(new URL(url).pathname))
    else web.notice(`That opens a desktop app (${url.split(':')[0]}), which isn't available in the browser version.`)
  }

  s.openPath = async (p: string) => {
    offerPath(web, p)
    return ''
  }

  s.showItemInFolder = (p: string) => offerPath(web, p)

  // no desktop trash in a container: move it to a trash folder in the data folder instead
  s.trashItem = async (p: string) => {
    const dir = join(dataDir, 'web', 'trash', String(Date.now()))
    mkdirSync(dir, { recursive: true })
    renameSync(p, join(dir, basename(p)))
  }

  s.beep = () => {}
}

/** A file is offered as a download; a folder can't be opened, so say where it is. */
function offerPath(web: WebServer, p: string): void {
  try {
    if (statSync(p).isFile()) return web.offerDownload(p)
  } catch {
    /* fall through */
  }
  web.notice(`On the server: ${p}`)
}
