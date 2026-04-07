const HTTP_SERVER_URL = 'http://127.0.0.1:8766';
const ext = typeof browser !== 'undefined' ? browser : chrome;

let isConnected = false;
let currentMusicInfo = null;
let reconnectTimeout = null;

async function getConfig() {
  try {
    const response = await fetch(ext.runtime.getURL('config.json'));
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error('[YTM-RPC] Failed to read config:', e);
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function connect() {
  if (isConnected) return;

  try {
    const response = await fetchWithTimeout(`${HTTP_SERVER_URL}/status`, {
      method: 'GET'
    }, 2000);

    if (response.ok) {
      console.log('[YTM-RPC] Connected to Vencord plugin');
      isConnected = true;
      broadcastStatus();

      if (currentMusicInfo) {
        sendUpdate(currentMusicInfo);
      }
      return;
    }
  } catch (e) {
    console.log('[YTM-RPC] Vencord not available:', e.message);
  }

  isConnected = false;
  broadcastStatus();
  scheduleReconnect();
}

function scheduleReconnect() {
  if (!reconnectTimeout) {
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connect();
    }, 5000);
  }
}

async function sendUpdate(musicInfo) {
  if (!isConnected) return;

  try {
    await fetch(`${HTTP_SERVER_URL}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(musicInfo)
    });
    console.log('[YTM-RPC] Sent update:', musicInfo.title);
  } catch (e) {
    console.error('[YTM-RPC] Update failed:', e);
    isConnected = false;
    broadcastStatus();
    scheduleReconnect();
  }
}

async function clearPresence() {
  if (!isConnected) return;

  try {
    await fetch(`${HTTP_SERVER_URL}/clear`, { method: 'POST' });
    console.log('[YTM-RPC] Cleared presence');
  } catch (e) {
    console.error('[YTM-RPC] Clear failed:', e);
  }
}

function broadcastStatus() {
  const status = getStatus();
  ext.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    data: status
  }).catch(() => {});
}

function getStatus() {
  return {
    isConnected,
    currentMusic: currentMusicInfo
  };
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'MUSIC_UPDATE':
      currentMusicInfo = message.data;
      if (isConnected) {
        sendUpdate(message.data);
      }
      broadcastStatus();
      sendResponse({ success: true });
      break;

    case 'MUSIC_STOPPED':
      currentMusicInfo = null;
      clearPresence();
      broadcastStatus();
      sendResponse({ success: true });
      break;

    case 'GET_STATUS':
      sendResponse(getStatus());
      break;

    case 'GET_CONFIG':
      getConfig().then((config) => {
        sendResponse({
          clientId: config?.client_id || null
        });
      });
      return true;

    case 'CONNECT':
      connect().then(() => {
        sendResponse({ success: isConnected });
      });
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
  }
});

ext.runtime.onStartup.addListener(() => {
  console.log('[YTM-RPC] Extension started');
  connect();
});

ext.runtime.onInstalled.addListener(() => {
  console.log('[YTM-RPC] Extension installed/updated');
  connect();
});

connect();

setInterval(() => {
  if (!isConnected && !reconnectTimeout) {
    connect();
  }
}, 30000);

console.log('[YTM-RPC] Background script loaded');
