/**
 * Electron shell for react-vrm-app.
 * Opens two windows: chat (`?window=chat`) and VRM stage (`?window=stage`).
 * Lip-sync is synced via BroadcastChannel in the renderer.
 */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  shell,
  ipcMain,
} = require('electron');
const fs = require('fs');
const path = require('path');
const net = require('net');

/** @type {BrowserWindow | null} */
let chatWindow = null;
/** @type {BrowserWindow | null} */
let stageWindow = null;
/** @type {Tray | null} */
let tray = null;

/** When false, the main window "close" only hides (tray background). */
let allowQuit = false;

const isDev = process.env.ELECTRON_DEV === '1';

/** In dev, open renderer DevTools in a separate window at load (set ELECTRON_DEVTOOLS=0 to skip). */
const openDetachedDevToolsAtLaunch = isDev && process.env.ELECTRON_DEVTOOLS !== '0';

/** Keep in sync with `getWindowTitleForMode` in `src/windowMode.ts`. */
const WIN_TITLE_CHAT = 'AITuber | チャット（操作・設定）';
const WIN_TITLE_STAGE = 'AITuber | VRM';

const WINDOW_BOUNDS_FILE = 'aituber-react-vrm-window-bounds.json';
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');

const jikkyoState = {
  enabled: false,
  listenPort: 50000,
  bouyomiPort: 50001,
  forwardToBouyomi: false,
};
let jikkyoServer = null;
const jikkyoConnections = new Set();

function normalizePort(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(65535, Math.max(1, Math.floor(n)));
}

function sanitizeJikkyoText(raw) {
  let text = String(raw ?? '').replace(/\r/g, '').trim();
  if (!text) return '';
  // Remove common transport/thread prefixes while preserving body.
  text = text
    .replace(/^\s*(?:\[[^\]]+\]|\([^)]+\)|<[^>]+>|#[0-9]+)\s*/g, '')
    .replace(/^\s*(?:[A-Za-z_]+\s*:\s*)+/g, '')
    .replace(/^\s*[0-9]{1,3}(?:\.[0-9]{1,3}){3}:\d+\s*/g, '')
    .trim();
  return text;
}

function extractTextsFromBuffer(buf) {
  const texts = [];
  let offset = 0;

  // Bouyomi-chan TCP packet format:
  // short command, short speed, short tone, short volume, short voice,
  // byte code, int length, message bytes (usually UTF-8)
  while (buf.length - offset >= 15) {
    const bodyLen = buf.readInt32LE(offset + 11);
    if (bodyLen < 0) {
      break;
    }
    const packetLen = 15 + bodyLen;
    if (buf.length - offset < packetLen) {
      break;
    }
    const body = buf.subarray(offset + 15, offset + packetLen);
    const text = body.toString('utf8').replace(/\0/g, '').trim();
    if (text) {
      texts.push(text);
    }
    offset += packetLen;
  }

  return {
    texts,
    rest: buf.subarray(offset),
  };
}

function broadcastJikkyoStatus(status) {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('jikkyo:status', status);
  }
}

function forwardToBouyomiRaw(rawBuffer) {
  if (!jikkyoState.forwardToBouyomi) return;
  const buf = Buffer.isBuffer(rawBuffer)
    ? rawBuffer
    : Buffer.from(String(rawBuffer ?? ''), 'utf8');
  if (!buf.length) return;
  const socket = net.createConnection(
    { host: '127.0.0.1', port: jikkyoState.bouyomiPort },
    () => {
      // Forward exactly as received (no extra processing).
      socket.write(buf);
      socket.end();
    },
  );
  socket.on('error', (err) => {
    console.warn('[jikkyo] bouyomi forward failed:', err.message);
  });
}

function emitJikkyoMessage(rawText) {
  const raw = String(rawText ?? '').trim();
  if (!raw) return;
  const cleaned = sanitizeJikkyoText(raw);
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('jikkyo:message', { raw, cleaned });
  }
}

function stopJikkyoServer() {
  for (const conn of jikkyoConnections) {
    try {
      conn.destroy();
    } catch {
      // ignore
    }
  }
  jikkyoConnections.clear();
  if (jikkyoServer) {
    try {
      jikkyoServer.close();
    } catch {
      // ignore
    }
    jikkyoServer = null;
  }
  broadcastJikkyoStatus({ listening: false, port: jikkyoState.listenPort });
}

function startJikkyoServer() {
  if (!jikkyoState.enabled) {
    stopJikkyoServer();
    return;
  }
  stopJikkyoServer();
  jikkyoServer = net.createServer((socket) => {
    jikkyoConnections.add(socket);
    let rawBuf = Buffer.alloc(0);
    let lineBuf = '';
    socket.on('data', (chunk) => {
      // Keep bouyomi forwarding unmodified.
      forwardToBouyomiRaw(chunk);

      // Try parsing bouyomi TCP packets for AI text extraction.
      rawBuf = Buffer.concat([rawBuf, chunk]);
      const parsed = extractTextsFromBuffer(rawBuf);
      rawBuf = parsed.rest;
      for (const text of parsed.texts) {
        emitJikkyoMessage(text);
      }

      // If packet parsing succeeded, do not also parse this chunk as plain text.
      // Otherwise headers/control bytes can appear as a second garbled message.
      if (parsed.texts.length > 0) {
        lineBuf = '';
        return;
      }

      // Also support plain text TCP lines.
      lineBuf += chunk.toString('utf8');
      let idx = lineBuf.indexOf('\n');
      while (idx >= 0) {
        const line = lineBuf.slice(0, idx);
        lineBuf = lineBuf.slice(idx + 1);
        emitJikkyoMessage(line);
        idx = lineBuf.indexOf('\n');
      }
    });
    socket.on('end', () => {
      if (lineBuf.trim()) emitJikkyoMessage(lineBuf);
      lineBuf = '';
      rawBuf = Buffer.alloc(0);
    });
    socket.on('close', () => jikkyoConnections.delete(socket));
    socket.on('error', () => jikkyoConnections.delete(socket));
  });
  jikkyoServer.on('error', (err) => {
    console.error('[jikkyo] server error:', err);
    broadcastJikkyoStatus({
      listening: false,
      port: jikkyoState.listenPort,
      error: String(err?.message || err),
    });
  });
  jikkyoServer.listen(jikkyoState.listenPort, '127.0.0.1', () => {
    broadcastJikkyoStatus({ listening: true, port: jikkyoState.listenPort });
  });
}

ipcMain.handle('jikkyo:updateConfig', (_event, next) => {
  const prevListenPort = jikkyoState.listenPort;
  jikkyoState.enabled = !!next?.enabled;
  jikkyoState.listenPort = normalizePort(next?.listenPort, 50000);
  jikkyoState.bouyomiPort = normalizePort(next?.bouyomiPort, 50001);
  jikkyoState.forwardToBouyomi = !!next?.forwardToBouyomi;
  const needRestart =
    !jikkyoServer ||
    !jikkyoState.enabled ||
    jikkyoState.listenPort !== prevListenPort;
  if (needRestart) {
    startJikkyoServer();
  }
  return {
    ok: true,
    listening: !!jikkyoServer && jikkyoState.enabled,
    listenPort: jikkyoState.listenPort,
    bouyomiPort: jikkyoState.bouyomiPort,
    forwardToBouyomi: jikkyoState.forwardToBouyomi,
  };
});

function windowBoundsFilePath() {
  return path.join(app.getPath('userData'), WINDOW_BOUNDS_FILE);
}

function loadWindowBoundsState() {
  try {
    const p = windowBoundsFilePath();
    if (!fs.existsSync(p)) {
      return null;
    }
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (data?.version !== 1) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function isSaneWindowBounds(b) {
  return (
    b &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height) &&
    b.width >= 320 &&
    b.height >= 240 &&
    b.width <= 7680 &&
    b.height <= 4320
  );
}

function saveWindowBoundsState() {
  try {
    const p = windowBoundsFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const payload = {
      version: 1,
      chat:
        chatWindow && !chatWindow.isDestroyed()
          ? chatWindow.getBounds()
          : undefined,
      stage:
        stageWindow && !stageWindow.isDestroyed()
          ? stageWindow.getBounds()
          : undefined,
    };
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.error('[electron] saveWindowBoundsState', e);
  }
}

let windowBoundsSaveTimer = null;

function scheduleSaveWindowBounds() {
  if (windowBoundsSaveTimer) {
    clearTimeout(windowBoundsSaveTimer);
  }
  windowBoundsSaveTimer = setTimeout(() => {
    windowBoundsSaveTimer = null;
    saveWindowBoundsState();
  }, 450);
}

function wireWindowBoundsPersistence(win) {
  if (!win) {
    return;
  }
  win.on('resize', scheduleSaveWindowBounds);
  win.on('move', scheduleSaveWindowBounds);
}

function createTrayIcon() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVQ4T2NkYGD4z0ABYBw1xv///38GEmCAAQCnBQVf5a0Q6QAAAABJRU5ErkJggg==',
    'base64',
  );
  return nativeImage.createFromBuffer(png);
}

function bringWindowForward(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
  try {
    app.focus({ steal: true });
  } catch {
    // Older Electron: ignore
  }
}

/**
 * Opens Chromium DevTools in a detached window once the page has finished loading.
 * @param {BrowserWindow} win
 * @param {string} label Log label (e.g. chat / stage)
 */
function openDetachedDevToolsWhenReady(win, label) {
  if (!openDetachedDevToolsAtLaunch || !win) return;
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    try {
      win.webContents.openDevTools({ mode: 'detach' });
    } catch (err) {
      console.warn(`[electron] openDevTools failed (${label}):`, err);
    }
  });
}

function attachWindowChrome(win, fixedTitle) {
  win.once('ready-to-show', () => bringWindowForward(win));

  win.webContents.once('did-finish-load', () => {
    if (fixedTitle && !win.isDestroyed()) {
      win.setTitle(fixedTitle);
    }
    bringWindowForward(win);
  });

  if (fixedTitle) {
    win.webContents.on('page-title-updated', (e) => {
      e.preventDefault();
      if (!win.isDestroyed()) {
        win.setTitle(fixedTitle);
      }
    });
  }

  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      bringWindowForward(win);
    }
  }, 2500);

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[electron] did-fail-load', { code, desc, url });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      // Allow opening the internal vision window via `window.open(...)`
      // while still denying external popups.
      const u = new URL(url);
      const isLocalDev =
        u.origin === 'http://127.0.0.1:5173' &&
        u.searchParams.get('window') === 'vision';
      if (isLocalDev) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 560,
            height: 820,
            title: 'AITuber | ビジョン（プレビュー）',
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              preload: PRELOAD_PATH,
            },
          },
        };
      }
    } catch {
      // ignore parse failures
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (event) => {
    if (allowQuit) {
      return;
    }
    event.preventDefault();
    win.hide();
  });
}

function createChatWindow(savedBounds) {
  chatWindow = new BrowserWindow({
    width: 520,
    height: 780,
    show: true,
    center: true,
    title: WIN_TITLE_CHAT,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });
  if (savedBounds && isSaneWindowBounds(savedBounds)) {
    chatWindow.setBounds(savedBounds);
  }
  attachWindowChrome(chatWindow, WIN_TITLE_CHAT);
  wireWindowBoundsPersistence(chatWindow);

  if (isDev) {
    chatWindow.loadURL('http://127.0.0.1:5173/?window=chat');
  } else {
    chatWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: { window: 'chat' },
    });
  }
  openDetachedDevToolsWhenReady(chatWindow, 'chat');
}

function createStageWindow(savedBounds) {
  stageWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    center: true,
    title: WIN_TITLE_STAGE,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });
  if (savedBounds && isSaneWindowBounds(savedBounds)) {
    stageWindow.setBounds(savedBounds);
  }
  attachWindowChrome(stageWindow, WIN_TITLE_STAGE);
  wireWindowBoundsPersistence(stageWindow);

  if (isDev) {
    stageWindow.loadURL('http://127.0.0.1:5173/?window=stage');
  } else {
    stageWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: { window: 'stage' },
    });
  }
  openDetachedDevToolsWhenReady(stageWindow, 'stage');
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('AITuber VRM');

  const menu = Menu.buildFromTemplate([
    {
      label: 'チャットを表示',
      click: () => {
        if (chatWindow && !chatWindow.isDestroyed()) {
          bringWindowForward(chatWindow);
        }
      },
    },
    {
      label: 'VRM を表示',
      click: () => {
        if (stageWindow && !stageWindow.isDestroyed()) {
          bringWindowForward(stageWindow);
        }
      },
    },
    { type: 'separator' },
    {
      label: '両方表示',
      click: () => {
        if (chatWindow && !chatWindow.isDestroyed()) {
          bringWindowForward(chatWindow);
        }
        if (stageWindow && !stageWindow.isDestroyed()) {
          bringWindowForward(stageWindow);
        }
      },
    },
    { type: 'separator' },
    {
      label: '終了',
      click: () => {
        allowQuit = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      bringWindowForward(chatWindow);
    }
    if (stageWindow && !stageWindow.isDestroyed()) {
      bringWindowForward(stageWindow);
    }
  });
}

app.whenReady().then(() => {
  const boundsState = loadWindowBoundsState();
  createChatWindow(boundsState?.chat);
  createStageWindow(boundsState?.stage);
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const st = loadWindowBoundsState();
      createChatWindow(st?.chat);
      createStageWindow(st?.stage);
    } else {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.show();
      }
      if (stageWindow && !stageWindow.isDestroyed()) {
        stageWindow.show();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running in tray; do not quit.
  }
});

app.on('before-quit', () => {
  allowQuit = true;
  stopJikkyoServer();
  saveWindowBoundsState();
});
