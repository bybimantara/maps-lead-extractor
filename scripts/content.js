/**
 * Content Script - Google Maps Lead Extractor
 * Mengontrol auto-scroll, klik detail tempat, deduplikasi, dan komunikasi runtime
 */

(() => {
  if (window.__MAPS_LEAD_EXTRACTOR_CONTENT_INIT__) return;
  window.__MAPS_LEAD_EXTRACTOR_CONTENT_INIT__ = true;

  let isScraping = false;
  let isPaused = false;
  let currentRunToken = 0;
  let extractedMap = new Map(); // key: id / url -> MapLead
  let processedIds = new Set(); // melacak kartu yang sudah diperiksa (termasuk yang terfilter)
  let pendingStorageCount = 0;
  let storageWriteChain = Promise.resolve();

  let scrapeConfig = {
    maxLeads: 0,
    onlyWithPhone: false,
    onlyWithWebsite: false
  };
  let scrollAttempts = 0;
  const MAX_STAGNANT_ATTEMPTS = 5;
  const STORAGE_FLUSH_INTERVAL = 5;

  function beginNewRun() {
    currentRunToken += 1;
    return currentRunToken;
  }

  function invalidateRun() {
    currentRunToken += 1;
  }

  function isRunActive(token) {
    return isScraping && !isPaused && token === currentRunToken;
  }

  // Dengarkan pesan dari Extension (Popup / Side Panel / Background)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || !request.action) return false;

    switch (request.action) {
      case 'START_SCRAPING':
        handleStartScraping(request.payload)
          .then(result => sendResponse(result))
          .catch(err => sendResponse({ status: 'error', message: err && err.message ? err.message : 'Gagal memulai scraping.' }));
        return true;

      case 'PAUSE_SCRAPING':
        isPaused = true;
        invalidateRun();
        flushLeadsToStorage(true).catch(() => {});
        sendStatus('PAUSED', 'Scraping dijeda.');
        sendResponse({ status: 'paused' });
        return false;

      case 'RESUME_SCRAPING':
        if (!isScraping) {
          sendResponse({ status: 'ignored', reason: 'not_scraping' });
          return false;
        }
        if (isPaused) {
          isPaused = false;
          const token = beginNewRun();
          sendStatus('SCRAPING', 'Melanjutkan scraping...');
          runScrapingLoop(token);
        }
        sendResponse({ status: 'resumed' });
        return false;

      case 'STOP_SCRAPING':
        isScraping = false;
        isPaused = false;
        invalidateRun();
        flushLeadsToStorage(true).catch(() => {});
        sendStatus('IDLE', 'Scraping dihentikan.');
        sendResponse({ status: 'stopped' });
        return false;

      case 'CLEAR_DATA':
        isScraping = false;
        isPaused = false;
        invalidateRun();
        extractedMap.clear();
        processedIds.clear();
        pendingStorageCount = 0;
        sendStatus('IDLE', 'Data berhasil dikosongkan.');
        sendResponse({ status: 'cleared' });
        return false;

      case 'CHECK_MAPS_STATUS': {
        const feed = getFeedElement();
        sendResponse({
          isMaps: isGoogleMapsPage(),
          hasResults: !!feed,
          isScraping,
          isPaused,
          count: extractedMap.size,
          config: scrapeConfig
        });
        return false;
      }

      default:
        return false;
    }
  });

  function isGoogleMapsPage() {
    const host = window.location.hostname || '';
    const path = window.location.pathname || '';
    return (/^(www\.)?google\.com$/i.test(host) && path.startsWith('/maps')) || /^maps\.google\.com$/i.test(host);
  }

  function getFeedElement() {
    return document.querySelector('div[role="feed"]');
  }

  async function handleStartScraping(config = {}) {
    if (isScraping && !isPaused) {
      return { status: 'already_running' };
    }

    const feed = getFeedElement();
    if (!feed) {
      const msg = 'Tidak ada daftar hasil pencarian di Google Maps. Silakan ketik kata kunci pencarian terlebih dahulu.';
      sendStatus('ERROR', msg);
      return { status: 'error', reason: 'no_feed', message: msg };
    }

    // Muat konfigurasi dari payload atau fallback ke storage
    let resolvedConfig = config && Object.keys(config).length > 0 ? config : null;
    if (!resolvedConfig) {
      try {
        const storedCfg = await chrome.storage.local.get('scrape_config');
        resolvedConfig = storedCfg.scrape_config || {};
      } catch (e) {
        resolvedConfig = {};
      }
    }

    scrapeConfig = {
      maxLeads: Math.max(0, parseInt(resolvedConfig.maxLeads, 10) || 0),
      onlyWithPhone: Boolean(resolvedConfig.onlyWithPhone),
      onlyWithWebsite: Boolean(resolvedConfig.onlyWithWebsite)
    };

    // Muat data yang sudah tersimpan sebelumnya agar mode append bekerja
    extractedMap.clear();
    processedIds.clear();
    pendingStorageCount = 0;
    try {
      const stored = await chrome.storage.local.get('maps_leads_data');
      if (stored.maps_leads_data && Array.isArray(stored.maps_leads_data)) {
        stored.maps_leads_data.forEach(item => {
          if (item && item.id) {
            extractedMap.set(item.id, item);
            processedIds.add(item.id);
          }
        });
      }
    } catch (e) {
      console.warn('Gagal memuat cache storage:', e);
    }

    if (scrapeConfig.maxLeads > 0 && extractedMap.size >= scrapeConfig.maxLeads) {
      isScraping = false;
      isPaused = false;
      invalidateRun();
      const msg = `Target batas maksimal (${scrapeConfig.maxLeads} leads) sudah tercapai. Hapus data atau naikkan batas untuk lanjut.`;
      sendStatus('FINISHED', msg);
      return { status: 'finished', reason: 'max_reached', message: msg };
    }

    isScraping = true;
    isPaused = false;
    scrollAttempts = 0;

    const token = beginNewRun();
    sendStatus('SCRAPING', `Memulai ekstraksi... (${extractedMap.size} leads tersimpan)`);
    runScrapingLoop(token);
    return { status: 'started' };
  }

  async function fetchMatchedDetailPanel(expectedTitle, token) {
    const normExpected = (expectedTitle || '').trim().toLowerCase();
    await delay(400 + Math.random() * 200);

    let lastPanel = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!isRunActive(token)) break;
      const panelData = window.MapsExtractor ? window.MapsExtractor.extractFromDetailPanel(expectedTitle) : null;
      if (panelData) {
        lastPanel = panelData;
        const normPanel = (panelData.title || '').trim().toLowerCase();
        const titleMatches = !normExpected || (normPanel && (normPanel.includes(normExpected) || normExpected.includes(normPanel)));
        if (titleMatches && (panelData.phone || panelData.address)) {
          return panelData;
        }
      }
      await delay(300);
    }
    return lastPanel;
  }

  async function runScrapingLoop(token) {
    try {
      while (isRunActive(token)) {
        const feed = getFeedElement();
        if (!feed) {
          sendStatus('ERROR', 'Panel feed hasil pencarian hilang.');
          isScraping = false;
          invalidateRun();
          break;
        }

        if (scrapeConfig.maxLeads > 0 && extractedMap.size >= scrapeConfig.maxLeads) {
          await flushLeadsToStorage(true);
          sendStatus('FINISHED', `Selesai! Target ${scrapeConfig.maxLeads} leads tercapai.`);
          isScraping = false;
          invalidateRun();
          break;
        }

        // 1. Ekstrak kartu-kartu yang saat ini ada di DOM feed
        const cards = Array.from(feed.querySelectorAll('div[jsaction*="mouseover"], div.Nv2PK, div[role="article"]'));
        let newCardsInspectedInBatch = 0;

        for (const card of cards) {
          if (!isRunActive(token)) break;

          if (scrapeConfig.maxLeads > 0 && extractedMap.size >= scrapeConfig.maxLeads) {
            await flushLeadsToStorage(true);
            sendStatus('FINISHED', `Selesai! Target ${scrapeConfig.maxLeads} leads tercapai.`);
            isScraping = false;
            invalidateRun();
            break;
          }

          const summary = window.MapsExtractor ? window.MapsExtractor.extractFromCard(card) : null;
          if (!summary || !summary.id) continue;

          if (!processedIds.has(summary.id) && !extractedMap.has(summary.id)) {
            processedIds.add(summary.id);
            newCardsInspectedInBatch++;

            let detailedLead = summary;
            const clickable = card.querySelector('a[href*="/maps/place/"]') || card.querySelector('a.hfpxzc') || card;

            if (clickable) {
              try {
                clickable.click();
                const panelData = await fetchMatchedDetailPanel(summary.title, token);
                if (!isRunActive(token)) break;
                if (panelData && window.MapsExtractor) {
                  detailedLead = window.MapsExtractor.mergeLead(summary, panelData);
                }
              } catch (err) {
                console.warn('Gagal membuka detail item:', err);
              }
            }

            if (!isRunActive(token)) break;

            // Evaluasi filter cepat
            if (scrapeConfig.onlyWithPhone && !detailedLead.phone) {
              sendStatus('SCRAPING', `Melewati (tanpa telepon): ${detailedLead.title}`);
              await delay(400 + Math.random() * 300);
              continue;
            }

            if (scrapeConfig.onlyWithWebsite && !detailedLead.website) {
              sendStatus('SCRAPING', `Melewati (tanpa website): ${detailedLead.title}`);
              await delay(400 + Math.random() * 300);
              continue;
            }

            extractedMap.set(detailedLead.id, detailedLead);
            pendingStorageCount += 1;

            // Simpan bertahap per batch kecil untuk mencegah O(N^2) rewrite
            const isAtTarget = scrapeConfig.maxLeads > 0 && extractedMap.size >= scrapeConfig.maxLeads;
            await flushLeadsToStorage(isAtTarget);
            notifyNewLead(detailedLead);

            const progressLabel = scrapeConfig.maxLeads > 0
              ? ` (${extractedMap.size}/${scrapeConfig.maxLeads})`
              : '';
            sendStatus('SCRAPING', `Mengekstrak${progressLabel}: ${detailedLead.title}`);

            if (isAtTarget) {
              sendStatus('FINISHED', `Selesai! Target ${scrapeConfig.maxLeads} leads tercapai.`);
              isScraping = false;
              invalidateRun();
              break;
            }

            // Jitter delay ramah manusia per item
            await delay(900 + Math.random() * 600);
          }
        }

        if (!isRunActive(token)) break;

        // 2. Cek apakah sudah mencapai akhir feed
        const isEndReached = checkIfEndOfList(feed);
        if (isEndReached) {
          await flushLeadsToStorage(true);
          sendStatus('FINISHED', `Selesai! Mencapai akhir daftar (${extractedMap.size} leads).`);
          isScraping = false;
          invalidateRun();
          break;
        }

        // 3. Scroll ke bawah dengan smooth scroll
        const prevScrollTop = feed.scrollTop;
        feed.scrollBy({ top: 750, behavior: 'smooth' });
        await delay(1200 + Math.random() * 800);

        if (!isRunActive(token)) break;

        // Jika scroll tidak bertambah dan tidak ada kartu baru yang diperiksa
        if (Math.abs(feed.scrollTop - prevScrollTop) < 10 && newCardsInspectedInBatch === 0) {
          scrollAttempts++;
          if (scrollAttempts >= MAX_STAGNANT_ATTEMPTS) {
            await flushLeadsToStorage(true);
            sendStatus('FINISHED', `Selesai! Tidak ada data baru lagi (${extractedMap.size} leads).`);
            isScraping = false;
            invalidateRun();
            break;
          }
        } else {
          scrollAttempts = 0;
        }
      }
    } finally {
      await flushLeadsToStorage(true);
    }
  }

  function checkIfEndOfList(feed) {
    if (!feed) return false;
    // Periksa hanya elemen footer/penanda akhir daftar agar nama tempat tidak memicu false positive
    const endIndicators = [
      "you've reached the end of the list",
      "anda telah mencapai akhir daftar"
    ];
    const candidates = feed.querySelectorAll('div.PbZDve, span.HlvSq, p.fontBodyMedium, [role="feed"] > div:last-child');
    for (const el of candidates) {
      const text = (el.innerText || '').trim().toLowerCase();
      if (text && text.length <= 160 && endIndicators.some(ind => text.includes(ind))) {
        return true;
      }
    }
    return false;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function flushLeadsToStorage(force = false) {
    if (!force && pendingStorageCount < STORAGE_FLUSH_INTERVAL) return;
    if (pendingStorageCount === 0 && extractedMap.size === 0) return;

    const snapshot = Array.from(extractedMap.values());
    pendingStorageCount = 0;

    storageWriteChain = storageWriteChain
      .then(() => chrome.storage.local.set({ maps_leads_data: snapshot }))
      .catch(err => console.error('Error saat menyimpan ke storage:', err));
    await storageWriteChain;
  }

  function sendStatus(state, statusText) {
    chrome.runtime.sendMessage({
      action: 'STATUS_UPDATE',
      payload: {
        state,
        totalCount: extractedMap.size,
        statusText
      }
    }).catch(() => {}); // Abaikan jika listener belum siap
  }

  function notifyNewLead(lead) {
    chrome.runtime.sendMessage({
      action: 'NEW_LEAD_EXTRACTED',
      payload: lead
    }).catch(() => {});
  }
})();
