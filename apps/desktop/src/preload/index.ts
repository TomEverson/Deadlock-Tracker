import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, EVENTS, type DesktopApi } from '../shared/api'

// Builds window.api from the channel list: api.players.overview(id) →
// ipcRenderer.invoke('players:overview', id). Nothing else is exposed.
const api: Record<string, unknown> = { platform: process.platform }
for (const [ns, methods] of Object.entries(CHANNELS)) {
  api[ns] = Object.fromEntries(methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`${ns}:${m}`, ...args)]))
}

// Main → renderer events (allowlisted channels only).
const allowed = new Set<string>(EVENTS)
api.on = (event: string, listener: (payload: unknown) => void) => {
  if (!allowed.has(event)) throw new Error(`Unknown event ${event}`)
  const handler = (_e: unknown, payload: unknown) => listener(payload)
  ipcRenderer.on(event, handler)
  return () => ipcRenderer.removeListener(event, handler)
}

contextBridge.exposeInMainWorld('api', api as unknown as DesktopApi)
