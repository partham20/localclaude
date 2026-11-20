import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import { makeApi } from '../shared/api'

const inv = <T>(ch: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(ch, ...args) as Promise<T>

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const fn = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const api = makeApi({
  inv,
  on,
  pathForFile: (f) => webUtils.getPathForFile(f),
  filePaths: async (files) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  setZoom: (factor) => webFrame.setZoomFactor(factor),
  platform: process.platform,
  web: false
})

export type { Api } from '../shared/api'
contextBridge.exposeInMainWorld('api', api)
