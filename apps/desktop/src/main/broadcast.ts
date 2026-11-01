import { BrowserWindow } from 'electron'

/** Send an event to every open window (renderer listens via window.api.*.on…). */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
