import type { Api } from '../../shared/api'
import { createWebApi, webUrl } from './web/client'

declare global {
  interface Window {
    api: Api
  }
}

// In the desktop app the preload script provides window.api; in a browser (server mode) it's built here.
if (!window.api) window.api = createWebApi()

export const api = window.api

/** An app-internal address (artifact://, lcimg://, lcmod://) as this version loads it. */
export const appUrl = (url: string): string => (api.isWeb ? webUrl(url) : url)
