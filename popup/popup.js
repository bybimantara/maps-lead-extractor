/**
 * Popup / Side Panel UI Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusBadge = document.getElementById('statusBadge');
  const leadCountEl = document.getElementById('leadCount');
  const statusTextEl = document.getElementById('statusText');
  const inputMaxLeads = document.getElementById('inputMaxLeads');
  const chkOnlyPhone = document.getElementById('chkOnlyPhone');
  const chkOnlyWebsite = document.getElementById('chkOnlyWebsite');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnResume = document.getElementById('btnResume');
  const btnStop = document.getElementById('btnStop');
  const btnClear = document.getElementById('btnClear');
  const btnExportCSV = document.getElementById('btnExportCSV');
  const btnExportJSON = document.getElementById('btnExportJSON');
  const previewTitle = document.getElementById('previewTitle');
  const searchPreview = document.getElementById('searchPreview');
  const previewBody = document.getElementById('previewBody');
  const emptyState = document.getElementById('emptyState');

  let currentLeads = [];

  // 1. Muat konfigurasi, data, & status aktif
  await loadScrapeConfig();
  await refreshStoredData();
  await checkActiveTabMapsStatus();

  // 2. Simpan konfigurasi saat user mengubah input/filter
  [inputMaxLeads, chkOnlyPhone, chkOnlyWebsite].forEach(el => {
    el.addEventListener('change', saveScrapeConfig);
  });

  searchPreview.addEventListener('input', () => {
    updatePreviewTable(currentLeads);
  });

  // 3. Event Listeners Kontrol
  btnStart.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    if (!tab.url || !tab.url.includes('google.') || !tab.url.includes('/maps')) {
      setUIState('ERROR', 'Buka tab Google Maps (google.com/maps) terlebih dahulu!');
      return;
    }

    const payload = getScrapeConfig();
    await saveScrapeConfig();

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING', payload });
      setUIState('SCRAPING', 'Memulai pencarian...');
    } catch (err) {
      console.warn('Gagal mengirim start ke content script:', err);
      // Injeksi content script bila belum terinjeksi otomatis
      await injectContentScripts(tab.id);
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING', payload });
          setUIState('SCRAPING', 'Memulai pencarian...');
        } catch (retryErr) {
          setUIState('ERROR', 'Muat ulang tab Google Maps lalu coba Start kembali.');
        }
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
      searchPreview.value = '';
      updatePreviewTable([]);
      leadCountEl.innerText = '0';
      btnExportCSV.disabled = true;
      btnExportJSON.disabled = true;

      const tab = await getActiveTab();
      if (tab && tab.id && tab.url && tab.url.includes('google.') && tab.url.includes('/maps')) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_DATA' });
        } catch (e) {
          // Abaikan jika content script belum aktif di tab
        }
      }

      setUIState('IDLE', 'Data berhasil dikosongkan.');
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

  // 4. Listener pesan dari content script
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
  function getScrapeConfig() {
    const rawLimit = parseInt(inputMaxLeads.value, 10);
    return {
      maxLeads: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 0,
      onlyWithPhone: chkOnlyPhone.checked,
      onlyWithWebsite: chkOnlyWebsite.checked
    };
  }

  async function loadScrapeConfig() {
    try {
      const res = await chrome.storage.local.get('scrape_config');
      const cfg = res.scrape_config;
      if (cfg) {
        inputMaxLeads.value = cfg.maxLeads > 0 ? String(cfg.maxLeads) : '';
        chkOnlyPhone.checked = Boolean(cfg.onlyWithPhone);
        chkOnlyWebsite.checked = Boolean(cfg.onlyWithWebsite);
      }
    } catch (e) {
      console.warn('Gagal memuat konfigurasi scraping:', e);
    }
  }

  async function saveScrapeConfig() {
    try {
      await chrome.storage.local.set({ scrape_config: getScrapeConfig() });
    } catch (e) {
      console.warn('Gagal menyimpan konfigurasi scraping:', e);
    }
  }

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
    const query = searchPreview.value.trim().toLowerCase();

    if (!leads || leads.length === 0) {
      previewTitle.innerText = 'Pratinjau Data';
      emptyState.innerText = 'Belum ada data. Buka Google Maps, cari tempat, lalu klik Start.';
      emptyState.style.display = 'block';
      return;
    }

    const filtered = query
      ? leads.filter(item =>
          (item.title || '').toLowerCase().includes(query) ||
          (item.category || '').toLowerCase().includes(query) ||
          (item.phone || '').toLowerCase().includes(query) ||
          (item.address || '').toLowerCase().includes(query)
        )
      : leads;

    if (filtered.length === 0) {
      previewTitle.innerText = 'Hasil Filter (0)';
      emptyState.innerText = `Tidak ada data yang cocok dengan "${searchPreview.value.trim()}".`;
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    const recent = filtered.slice(-25).reverse();
    previewTitle.innerText = query
      ? `Hasil Filter (${filtered.length})`
      : `Pratinjau Data (${Math.min(filtered.length, 25)} Terbaru)`;

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
    const normalized = (state || 'IDLE').toUpperCase();
    statusBadge.className = `badge ${normalized.toLowerCase()}`;
    statusBadge.innerText = normalized;
    if (text) statusTextEl.innerText = text;

    const isLocked = normalized === 'SCRAPING' || normalized === 'PAUSED';
    inputMaxLeads.disabled = isLocked;
    chkOnlyPhone.disabled = isLocked;
    chkOnlyWebsite.disabled = isLocked;

    if (normalized === 'SCRAPING') {
      btnStart.style.display = 'none';
      btnPause.style.display = 'inline-flex';
      btnResume.style.display = 'none';
      btnStop.disabled = false;
    } else if (normalized === 'PAUSED') {
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
