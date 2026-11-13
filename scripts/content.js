/**
 * Content Script - Google Maps Lead Extractor
 * Mengontrol auto-scroll, klik detail tempat, deduplikasi, dan komunikasi runtime
 */

(() => {
  let isScraping = false;
  let isPaused = false;
  let extractedMap = new Map(); // key: id / url -> MapLead
  let processedIds = new Set(); // melacak kartu yang sudah diperiksa (termasuk yang terfilter)
  let scrapeConfig = {
    maxLeads: 0,
    onlyWithPhone: false,
    onlyWithWebsite: false
  };
  let scrollAttempts = 0;
  const MAX_STAGNANT_ATTEMPTS = 5;

  // Dengarkan pesan dari Extension (Popup / Side Panel / Background)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'START_SCRAPING':
        handleStartScraping(request.payload);
        sendResponse({ status: 'started' });
        break;

      case 'PAUSE_SCRAPING':
        isPaused = true;
        sendStatus('PAUSED', 'Scraping dijeda.');
        sendResponse({ status: 'paused' });
        break;

      case 'RESUME_SCRAPING':
        isPaused = false;
        sendStatus('SCRAPING', 'Melanjutkan scraping...');
        runScrapingLoop();
        sendResponse({ status: 'resumed' });
        break;

      case 'STOP_SCRAPING':
        isScraping = false;
        isPaused = false;
        sendStatus('IDLE', 'Scraping dihentikan.');
        sendResponse({ status: 'stopped' });
        break;

      case 'CLEAR_DATA':
        isScraping = false;
        isPaused = false;
        extractedMap.clear();
        processedIds.clear();
        sendStatus('IDLE', 'Data berhasil dikosongkan.');
        sendResponse({ status: 'cleared' });
        break;

      case 'CHECK_MAPS_STATUS':
        const feed = getFeedElement();
        sendResponse({
          isMaps: isGoogleMapsPage(),
          hasResults: !!feed,
          isScraping,
          isPaused,
          count: extractedMap.size,
          config: scrapeConfig
        });
        break;
    }
    return true; // Keep channel open for async response
  });

  function isGoogleMapsPage() {
    return window.location.hostname.includes('google.') && window.location.pathname.includes('/maps');
  }

  function getFeedElement() {
    return document.querySelector('div[role="feed"]');
  }

  async function handleStartScraping(config = {}) {
    if (isScraping && !isPaused) return;

    const feed = getFeedElement();
    if (!feed) {
      sendStatus('ERROR', 'Tidak ada daftar hasil pencarian di Google Maps. Silakan ketik kata kunci pencarian terlebih dahulu.');
      return;
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
      sendStatus('FINISHED', `Target batas maksimal (${scrapeConfig.maxLeads} leads) sudah tercapai. Hapus data atau naikkan batas untuk lanjut.`);
      return;
    }

    isScraping = true;
    isPaused = false;
    scrollAttempts = 0;

    sendStatus('SCRAPING', `Memulai ekstraksi... (${extractedMap.size} leads tersimpan)`);
    runScrapingLoop();
  }

  async function fetchMatchedDetailPanel(expectedTitle) {
    const normExpected = (expectedTitle || '').trim().toLowerCase();
    await delay(400 + Math.random() * 200);

    let lastPanel = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!isScraping || isPaused) break;
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

  async function runScrapingLoop() {
    while (isScraping && !isPaused) {
      const feed = getFeedElement();
      if (!feed) {
        sendStatus('ERROR', 'Panel feed hasil pencarian hilang.');
        isScraping = false;
        break;
      }

      if (scrapeConfig.maxLeads > 0 && extractedMap.size >= scrapeConfig.maxLeads) {
        sendStatus('FINISHED', `Selesai! Target ${scrapeConfig.maxLeads} leads tercapai.`);
        isScraping = false;
        break;
      }

      // 1. Ekstrak kartu-kartu yang saat ini ada di DOM feed
      const cards = Array.from(feed.querySelectorAll('div[jsaction*="mouseover"], div.Nv2PK, div[role="article"]'));
      let newCardsInspectedInBatch = 0;

      for (const card of cards) {
        if (!isScraping || isPaused) break;

        if (scrapeConfig.maxLeads > 0 && extractedMap.size >= scrapeConfig.maxLeads) {
          sendStatus('FINISHED', `Selesai! Target ${scrapeConfig.maxLeads} leads tercapai.`);
          isScraping = false;
          break;
        }

        const summary = window.MapsExtractor ? window.MapsExtractor.extractFromCard(card) : null;
        if (!summary || !summary.id) continue;

        if (!processedIds.has(summary.id) && !extractedMap.has(summary.id)) {
          processedIds.add(summary.id);
          newCardsInspectedInBatch++;

          let detailedLead = summary;
          const clickable = card.querySelector('a.hfpxzc') || card;

          if (clickable) {
            try {
              clickable.click();
              const panelData = await fetchMatchedDetailPanel(summary.title);
              if (panelData && window.MapsExtractor) {
                detailedLead = window.MapsExtractor.mergeLead(summary, panelData);
              }
            } catch (err) {
              console.warn('Gagal membuka detail item:', err);
            }
          }

          if (!isScraping || isPaused) break;

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

          // Simpan ke storage dan kirim event update
          await saveLeadsToStorage(Array.from(extractedMap.values()));
          notifyNewLead(detailedLead);

          const progressLabel = scrapeConfig.maxLeads > 0
            ? ` (${extractedMap.size}/${scrapeConfig.maxLeads})`
            : '';
          sendStatus('SCRAPING', `Mengekstrak${progressLabel}: ${detailedLead.title}`);

          if (scrapeConfig.maxLeads > 0 && extractedMap.size >= scrapeConfig.maxLeads) {
            sendStatus('FINISHED', `Selesai! Target ${scrapeConfig.maxLeads} leads tercapai.`);
            isScraping = false;
            break;
          }

          // Jitter delay ramah manusia per item
          await delay(900 + Math.random() * 600);
        }
      }

      if (!isScraping || isPaused) break;

      // 2. Cek apakah sudah mencapai akhir feed
      const isEndReached = checkIfEndOfList(feed);
      if (isEndReached) {
        sendStatus('FINISHED', `Selesai! Mencapai akhir daftar (${extractedMap.size} leads).`);
        isScraping = false;
        break;
      }

      // 3. Scroll ke bawah dengan smooth scroll
      const prevScrollTop = feed.scrollTop;
      feed.scrollBy({ top: 750, behavior: 'smooth' });
      await delay(1200 + Math.random() * 800);

      // Jika scroll tidak bertambah dan tidak ada kartu baru yang diperiksa
      if (Math.abs(feed.scrollTop - prevScrollTop) < 10 && newCardsInspectedInBatch === 0) {
        scrollAttempts++;
        if (scrollAttempts >= MAX_STAGNANT_ATTEMPTS) {
          sendStatus('FINISHED', `Selesai! Tidak ada data baru lagi (${extractedMap.size} leads).`);
          isScraping = false;
          break;
        }
      } else {
        scrollAttempts = 0;
      }
    }
  }

  function checkIfEndOfList(feed) {
    // Periksa apakah ada teks akhir daftar dalam bahasa Inggris/Indonesia
    const endIndicators = [
      "You've reached the end of the list",
      "Anda telah mencapai akhir daftar",
      "akhir daftar"
    ];
    const textContent = feed.innerText || '';
    return endIndicators.some(indicator => textContent.toLowerCase().includes(indicator.toLowerCase()));
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function saveLeadsToStorage(leadsArray) {
    try {
      await chrome.storage.local.set({ maps_leads_data: leadsArray });
    } catch (err) {
      console.error('Error saat menyimpan ke storage:', err);
    }
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
