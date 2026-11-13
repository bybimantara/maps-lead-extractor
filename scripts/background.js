/**
 * Background Service Worker - Manifest V3
 * Mengelola pembukaan Side Panel, navigasi, dan relay pesan
 */

// Buka Chrome Side Panel saat icon ekstensi diklik
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (err) {
      console.warn('Tidak dapat membuka side panel:', err);
    }
  }
});

// Listener pesan runtime untuk background logging & event forwarder
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === 'PING') {
    sendResponse({ status: 'PONG' });
  }
  return false;
});
