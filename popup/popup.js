/**
 * Popup / Side Panel UI Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusBadge = document.getElementById('statusBadge');
  const leadCountEl = document.getElementById('leadCount');
  const statusTextEl = document.getElementById('statusText');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnResume = document.getElementById('btnResume');
  const btnStop = document.getElementById('btnStop');
  const btnClear = document.getElementById('btnClear');
  const btnExportCSV = document.getElementById('btnExportCSV');
  const btnExportJSON = document.getElementById('btnExportJSON');
  const previewBody = document.getElementById('previewBody');
  const emptyState = document.getElementById('emptyState');

  let currentLeads = [];

  // 1. Muat state & data awal dari storage
  await refreshStoredData();
  await checkActiveTabMapsStatus();

  // 2. Event Listeners Kontrol
  btnStart.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    if (!tab.url || !tab.url.includes('google.') || !tab.url.includes('/maps')) {
      alert('Silakan buka tab Google Maps (google.com/maps) terlebih dahulu!');
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING' });
      setUIState('SCRAPING', 'Memulai pencarian...');
    } catch (err) {
      console.warn('Gagal mengirim start ke content script:', err);
      // Injeksi content script bila belum terinjeksi otomatis
      await injectContentScripts(tab.id);
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING' });
        setUIState('SCRAPING', 'Memulai pencarian...');
      }, 500);
    }
  });

  btnPause.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (tab && tab.id) {
      await chrome.tabs.sendMessage(tab.id, { action: 'PAUSE_SCRAPING' });
      setUIState('PAUSED', 'Scraping dijeda.');
    }
  });

  btnResume.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (tab && tab.id) {
      await chrome.tabs.sendMessage(tab.id, { action: 'RESUME_SCRAPING' });
      setUIState('SCRAPING', 'Melanjutkan scraping...');
    }
  });

  btnStop.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (tab && tab.id) {
      await chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPING' });
      setUIState('IDLE', 'Scraping dihentikan.');
    }
  });

  btnClear.addEventListener('click', async () => {
    if (confirm('Yakin ingin menghapus seluruh data leads yang tersimpan?')) {
      await chrome.storage.local.remove('maps_leads_data');
      currentLeads = [];
      updatePreviewTable([]);
      leadCountEl.innerText = '0';
      btnExportCSV.disabled = true;
      btnExportJSON.disabled = true;
      statusTextEl.innerText = 'Data berhasil dikosongkan.';
    }
  });

  btnExportCSV.addEventListener('click', () => {
    if (window.Exporter) {
      window.Exporter.downloadCSV(currentLeads);
    }
  });

  btnExportJSON.addEventListener('click', () => {
    if (window.Exporter) {
      window.Exporter.downloadJSON(currentLeads);
    }
  });

  // 3. Listener pesan dari content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'STATUS_UPDATE') {
      const payload = message.payload || {};
      setUIState(payload.state, payload.statusText);
      if (typeof payload.totalCount === 'number') {
        leadCountEl.innerText = payload.totalCount;
      }
    } else if (message.action === 'NEW_LEAD_EXTRACTED') {
      refreshStoredData();
    }
  });

  // Helper functions
  async function refreshStoredData() {
    try {
      const res = await chrome.storage.local.get('maps_leads_data');
      currentLeads = res.maps_leads_data || [];
      leadCountEl.innerText = currentLeads.length;
      updatePreviewTable(currentLeads);

      const hasData = currentLeads.length > 0;
      btnExportCSV.disabled = !hasData;
      btnExportJSON.disabled = !hasData;
    } catch (e) {
      console.warn('Gagal membaca storage:', e);
    }
  }

  function updatePreviewTable(leads) {
    previewBody.innerHTML = '';
    if (!leads || leads.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    // Ambil 5 data paling baru
    const recent = leads.slice(-5).reverse();

    recent.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td title="${escapeHtml(item.title)}">${escapeHtml(item.title || '-')}</td>
        <td title="${escapeHtml(item.category)}">${escapeHtml(item.category || '-')}</td>
        <td>${escapeHtml(item.phone || '-')}</td>
        <td>${item.rating ? '⭐ ' + item.rating : '-'}</td>
      `;
      previewBody.appendChild(tr);
    });
  }

  function setUIState(state, text) {
    statusBadge.className = `badge ${state.toLowerCase()}`;
    statusBadge.innerText = state;
    if (text) statusTextEl.innerText = text;

    if (state === 'SCRAPING') {
      btnStart.style.display = 'none';
      btnPause.style.display = 'inline-flex';
      btnResume.style.display = 'none';
      btnStop.disabled = false;
    } else if (state === 'PAUSED') {
      btnStart.style.display = 'none';
      btnPause.style.display = 'none';
      btnResume.style.display = 'inline-flex';
      btnStop.disabled = false;
    } else {
      // IDLE / FINISHED / ERROR
      btnStart.style.display = 'inline-flex';
      btnPause.style.display = 'none';
      btnResume.style.display = 'none';
      btnStop.disabled = true;
    }
  }

  async function checkActiveTabMapsStatus() {
    const tab = await getActiveTab();
    if (!tab || !tab.url || !tab.url.includes('google.') || !tab.url.includes('/maps')) {
      statusTextEl.innerText = 'Buka Google Maps & cari tempat untuk memulai.';
      return;
    }

    try {
      chrome.tabs.sendMessage(tab.id, { action: 'CHECK_MAPS_STATUS' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        if (res.isScraping) {
          setUIState(res.isPaused ? 'PAUSED' : 'SCRAPING');
        }
      });
    } catch (e) {}
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function injectContentScripts(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['scripts/extractor.js', 'scripts/content.js']
      });
    } catch (e) {
      console.warn('Injeksi script manual gagal/tidak diperlukan:', e);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
