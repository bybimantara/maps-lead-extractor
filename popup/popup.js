/**
 * Popup / Side Panel UI Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusBadge = document.getElementById('statusBadge');
  const leadCountEl = document.getElementById('leadCount');
  const statusTextEl = document.getElementById('statusText');
  const btnReloadTab = document.getElementById('btnReloadTab');
  const inputMaxLeads = document.getElementById('inputMaxLeads');
  const chkOnlyPhone = document.getElementById('chkOnlyPhone');
  const chkOnlyWebsite = document.getElementById('chkOnlyWebsite');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnResume = document.getElementById('btnResume');
  const btnStop = document.getElementById('btnStop');
  const btnClear = document.getElementById('btnClear');
  const clearConfirmBar = document.getElementById('clearConfirmBar');
  const btnConfirmClear = document.getElementById('btnConfirmClear');
  const btnCancelClear = document.getElementById('btnCancelClear');
  const btnExportCSV = document.getElementById('btnExportCSV');
  const btnExportJSON = document.getElementById('btnExportJSON');
  const previewTitle = document.getElementById('previewTitle');
  const searchPreview = document.getElementById('searchPreview');
  const previewBody = document.getElementById('previewBody');
  const emptyState = document.getElementById('emptyState');

  const SCRAPING_TAB_SESSION_KEY = 'scraping_tab_id';
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

  btnReloadTab.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id || !isSupportedMapsUrl(tab.url)) {
      setUIState('ERROR', 'Buka tab Google Maps (google.com/maps) terlebih dahulu!');
      return;
    }

    btnReloadTab.disabled = true;
    statusTextEl.innerText = 'Memuat ulang tab Google Maps...';
    try {
      await chrome.tabs.reload(tab.id);
      btnReloadTab.style.display = 'none';
      setUIState('IDLE', 'Tab dimuat ulang. Tunggu peta siap lalu klik Start.');
    } catch (err) {
      setUIState('ERROR', 'Gagal memuat ulang tab Google Maps.');
    } finally {
      btnReloadTab.disabled = false;
    }
  });

  // 3. Event Listeners Kontrol
  btnStart.addEventListener('click', async () => {
    hideClearConfirm();
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;

    if (!isSupportedMapsUrl(tab.url)) {
      setUIState('ERROR', 'Buka tab Google Maps (google.com/maps) terlebih dahulu!');
      return;
    }

    const payload = getScrapeConfig();
    await saveScrapeConfig();

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPING', payload });
      btnReloadTab.style.display = 'none';

      if (response && response.status === 'error') {
        setUIState('ERROR', response.message || 'Gagal memulai scraping.');
        return;
      }
      if (response && response.status === 'finished') {
        setUIState('FINISHED', response.message || 'Target maksimal sudah tercapai.');
        return;
      }

      await setScrapingTabId(tab.id);
      setUIState('SCRAPING', 'Memulai pencarian...');
    } catch (err) {
      console.warn('Gagal mengirim start ke content script:', err);
      btnReloadTab.style.display = 'inline-flex';
      setUIState('ERROR', 'Koneksi ke tab Maps belum aktif. Klik "Muat Ulang Tab Google Maps" lalu coba Start.');
    }
  });

  btnPause.addEventListener('click', async () => {
    const tab = await getTargetMapsTab();
    if (!tab || !tab.id) {
      setUIState('ERROR', 'Tab Google Maps target tidak ditemukan.');
      return;
    }
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'PAUSE_SCRAPING' });
      setUIState('PAUSED', 'Scraping dijeda.');
    } catch (err) {
      await clearScrapingTabId();
      setUIState('ERROR', 'Tab Google Maps tidak merespons. Coba muat ulang tab.');
    }
  });

  btnResume.addEventListener('click', async () => {
    const tab = await getTargetMapsTab();
    if (!tab || !tab.id) {
      setUIState('ERROR', 'Tab Google Maps target tidak ditemukan.');
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'RESUME_SCRAPING' });
      if (response && response.status === 'ignored') {
        await clearScrapingTabId();
        setUIState('IDLE', 'Sesi sebelumnya sudah berakhir. Klik Start untuk mulai lagi.');
        return;
      }
      setUIState('SCRAPING', 'Melanjutkan scraping...');
    } catch (err) {
      await clearScrapingTabId();
      setUIState('ERROR', 'Tab Google Maps tidak merespons. Coba muat ulang tab.');
    }
  });

  btnStop.addEventListener('click', async () => {
    const tab = await getTargetMapsTab();
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPING' });
      } catch (err) {
        // Tab mungkin sudah ditutup atau direload
      }
    }
    await clearScrapingTabId();
    await refreshStoredData();
    setUIState('IDLE', 'Scraping dihentikan.');
  });

  btnClear.addEventListener('click', () => {
    if (btnClear.disabled) return;
    const isVisible = clearConfirmBar.style.display === 'flex';
    clearConfirmBar.style.display = isVisible ? 'none' : 'flex';
  });

  btnCancelClear.addEventListener('click', () => {
    hideClearConfirm();
  });

  btnConfirmClear.addEventListener('click', async () => {
    hideClearConfirm();
    await chrome.storage.local.remove('maps_leads_data');
    await clearScrapingTabId();
    currentLeads = [];
    searchPreview.value = '';
    updatePreviewTable([]);
    leadCountEl.innerText = '0';
    btnExportCSV.disabled = true;
    btnExportJSON.disabled = true;

    const tab = await getTargetMapsTab();
    if (tab && tab.id && isSupportedMapsUrl(tab.url)) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_DATA' });
      } catch (e) {
        // Abaikan jika content script belum aktif di tab
      }
    }

    setUIState('IDLE', 'Data berhasil dikosongkan.');
  });

  btnExportCSV.addEventListener('click', () => {
    if (!window.Exporter) return;
    const res = window.Exporter.downloadCSV(currentLeads);
    if (res && !res.ok && res.error) {
      setUIState('ERROR', res.error);
    }
  });

  btnExportJSON.addEventListener('click', () => {
    if (!window.Exporter) return;
    const res = window.Exporter.downloadJSON(currentLeads);
    if (res && !res.ok && res.error) {
      setUIState('ERROR', res.error);
    }
  });

  // 4. Listener pesan dari content script
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.action) return;

    if (message.action === 'STATUS_UPDATE') {
      const payload = message.payload || {};
      const nextState = (payload.state || 'IDLE').toUpperCase();
      setUIState(nextState, payload.statusText);
      if (typeof payload.totalCount === 'number') {
        leadCountEl.innerText = payload.totalCount;
      }
      if (nextState === 'FINISHED' || nextState === 'IDLE' || nextState === 'ERROR') {
        clearScrapingTabId();
        refreshStoredData();
      }
    } else if (message.action === 'NEW_LEAD_EXTRACTED') {
      const lead = message.payload;
      if (!lead || !lead.id) return;

      const existingIdx = currentLeads.findIndex(item => item.id === lead.id);
      if (existingIdx >= 0) {
        currentLeads[existingIdx] = lead;
      } else {
        currentLeads.push(lead);
      }
      leadCountEl.innerText = currentLeads.length;
      btnExportCSV.disabled = currentLeads.length === 0;
      btnExportJSON.disabled = currentLeads.length === 0;
      updatePreviewTable(currentLeads);
    }
  });

  // Helper functions
  function hideClearConfirm() {
    clearConfirmBar.style.display = 'none';
  }

  function isSupportedMapsUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
      const host = parsed.hostname.toLowerCase();
      if (host === 'maps.google.com') return true;
      return (host === 'www.google.com' || host === 'google.com') && parsed.pathname.startsWith('/maps');
    } catch {
      return false;
    }
  }

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
      currentLeads = Array.isArray(res.maps_leads_data) ? res.maps_leads_data : [];
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
    previewBody.textContent = '';
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

    const fragment = document.createDocumentFragment();
    recent.forEach(item => {
      const tr = document.createElement('tr');

      const tdTitle = document.createElement('td');
      tdTitle.textContent = item.title || '-';
      if (item.title) tdTitle.title = item.title;

      const tdCategory = document.createElement('td');
      tdCategory.textContent = item.category || '-';
      if (item.category) tdCategory.title = item.category;

      const tdPhone = document.createElement('td');
      tdPhone.textContent = item.phone || '-';
      if (item.phone) tdPhone.title = item.phone;

      const tdRating = document.createElement('td');
      tdRating.textContent = item.rating !== null && item.rating !== undefined && item.rating !== ''
        ? `⭐ ${item.rating}`
        : '-';

      tr.append(tdTitle, tdCategory, tdPhone, tdRating);
      fragment.appendChild(tr);
    });
    previewBody.appendChild(fragment);
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
    btnClear.disabled = isLocked;
    if (isLocked) hideClearConfirm();

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
    const tab = await getTargetMapsTab();
    if (!tab || !isSupportedMapsUrl(tab.url)) {
      statusTextEl.innerText = 'Buka Google Maps & cari tempat untuk memulai.';
      return;
    }

    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_MAPS_STATUS' });
      btnReloadTab.style.display = 'none';
      if (res && res.isScraping) {
        await setScrapingTabId(tab.id);
        setUIState(res.isPaused ? 'PAUSED' : 'SCRAPING');
      } else {
        await clearScrapingTabId();
      }
    } catch (e) {
      // Content script belum aktif pada tab Google Maps yang sudah terbuka sebelum ekstensi dimuat
      btnReloadTab.style.display = 'inline-flex';
    }
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function setScrapingTabId(tabId) {
    if (!chrome.storage.session || !tabId) return;
    try {
      await chrome.storage.session.set({ [SCRAPING_TAB_SESSION_KEY]: tabId });
    } catch (e) {}
  }

  async function clearScrapingTabId() {
    if (!chrome.storage.session) return;
    try {
      await chrome.storage.session.remove(SCRAPING_TAB_SESSION_KEY);
    } catch (e) {}
  }

  async function getTargetMapsTab() {
    if (chrome.storage.session) {
      try {
        const res = await chrome.storage.session.get(SCRAPING_TAB_SESSION_KEY);
        const savedId = res[SCRAPING_TAB_SESSION_KEY];
        if (savedId) {
          const savedTab = await chrome.tabs.get(savedId);
          if (savedTab && isSupportedMapsUrl(savedTab.url)) {
            return savedTab;
          }
          await clearScrapingTabId();
        }
      } catch (e) {
        await clearScrapingTabId();
      }
    }
    return getActiveTab();
  }
});
