import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { closeDatabase, openDatabase } from './db'
import { registerIpc } from './ipc'
import { setOnConnected } from './steam/login'
import { refreshFriendsNow, runNow } from './sync/scheduler'

const isMac = process.platform === 'darwin'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Deadlock Tracker',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f11' : '#ffffff',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Links like "Steam profile ↗" open in the user's browser, never in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (!(devUrl && url.startsWith(devUrl)) && !url.startsWith('file://')) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.setName('Deadlock Tracker')

void app.whenReady().then(() => {
  openDatabase(join(app.getPath('userData'), 'deadlock.sqlite'))
  registerIpc()
  createWindow()
  // Friend list + names only; no match sync, no Game Coordinator requests.
  refreshFriendsNow()
  setOnConnected(() => runNow())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

app.on('will-quit', () => {
  void closeDatabase()
})
