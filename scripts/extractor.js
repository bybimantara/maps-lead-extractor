/**
 * Extractor Module - Google Maps Business Profile
 * Menggunakan selektor semantik resilient (data-item-id, aria-label, role="feed")
 */

((globalScope) => {
  // Singleton guard mencegah SyntaxError jika skrip dimuat ulang di tab yang sama
  if (globalScope.MapsExtractor) return;

  const PHONE_CANDIDATE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,5}\)[\s.-]?)?(?:\d[\s.-]?){5,15}\d/;
  const NON_PHONE_CONTEXT_RE = /(?:^|[\s(])(?:Rp|USD|EUR|\$|€|£|¥)\s*$|^\s*(?:ulasan|reviews?|km|m\b)/i;

  const MapsExtractor = {
    extractPhoneFromText(line) {
      if (!line) return '';
      const match = String(line).match(PHONE_CANDIDATE_RE);
      if (!match) return '';

      const idx = match.index || 0;
      const before = line.slice(Math.max(0, idx - 6), idx);
      const after = line.slice(idx + match[0].length, idx + match[0].length + 12);
      if (/(?:Rp|\$|€|£|¥)\s*$/i.test(before) || NON_PHONE_CONTEXT_RE.test(after)) {
        return '';
      }

      const digits = match[0].replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return '';
      return match[0].trim();
    },

    /**
     * Ekstrak ringkas dari kartu di dalam list feed
     * @param {Element} card - Elemen kartu dalam feed
     */
    extractFromCard(card) {
      if (!card) return null;

      // Prioritaskan selektor atribut semantik sebelum class obfuscated
      const linkEl = card.querySelector('a[href*="/maps/place/"]') || card.querySelector('a.hfpxzc');
      const mapsUrl = linkEl ? (linkEl.href || '') : '';
      const title = linkEl ? (linkEl.getAttribute('aria-label') || linkEl.innerText || '').trim() : '';

      if (!title && !mapsUrl) return null;

      // Rating & Jumlah Review
      let rating = null;
      let reviewCount = 0;

      const ratingEl =
        card.querySelector('[role="img"][aria-label*="bintang" i], [role="img"][aria-label*="star" i]') ||
        card.querySelector('.MW4etd');
      if (ratingEl) {
        const ratingText = ratingEl.getAttribute('aria-label') || ratingEl.innerText || '';
        const match = ratingText.match(/([0-9]+[.,][0-9]+|[0-9]+)/);
        if (match) rating = parseFloat(match[1].replace(',', '.'));
      }

      const reviewsEl =
        card.querySelector('span[aria-label*="ulasan" i], span[aria-label*="review" i]') ||
        card.querySelector('.UY7F9');
      if (reviewsEl) {
        const revText = reviewsEl.getAttribute('aria-label') || reviewsEl.innerText || '';
        const match = revText.replace(/[^0-9]/g, '');
        if (match) reviewCount = parseInt(match, 10);
      }

      let category = '';
      let address = '';
      let phone = '';

      const seenLines = new Set();
      const textLines = Array.from(card.querySelectorAll('div.W4Efsd, div[class*="fontBodyMedium"]'))
        .map(el => (el.innerText || '').trim())
        .filter(line => {
          if (!line || seenLines.has(line)) return false;
          seenLines.add(line);
          return true;
        });

      textLines.forEach(line => {
        if (!phone) {
          const detectedPhone = this.extractPhoneFromText(line);
          if (detectedPhone) phone = detectedPhone;
        }

        // Deteksi kategori & fallback alamat (biasanya dipisahkan titik tengah · )
        if (line.includes('·')) {
          const parts = line.split('·').map(p => p.trim()).filter(Boolean);
          if (!category && parts[0]) category = parts[0];
          if (!address && parts.length > 1) {
            const candidate = parts.find((part, idx) =>
              idx > 0 &&
              !this.extractPhoneFromText(part) &&
              !/^[$€£¥Rp]+$/i.test(part) &&
              !/^(Buka|Tutup|Open|Closed)/i.test(part)
            );
            if (candidate) address = candidate;
          }
        }
      });

      return {
        id: mapsUrl ? (this.cleanPlaceId(mapsUrl) || this.slugify(title)) : this.slugify(title),
        title,
        category: category.trim(),
        rating,
        reviewCount,
        phone: phone.trim(),
        address: address.trim(),
        website: '',
        operatingHours: '',
        mapsUrl: mapsUrl.split('?')[0] || mapsUrl,
        scrapedAt: new Date().toISOString()
      };
    },

    /**
     * Ekstrak dari panel detail aktif (saat kartu diklik)
     * Menggunakan atribut semantik stabil data-item-id
     * @param {string} expectedTitle - Judul kartu yang diharapkan agar tidak membaca panel basi
     */
    extractFromDetailPanel(expectedTitle = '') {
      const panes = Array.from(document.querySelectorAll('[role="main"]'));
      if (panes.length === 0) return null;

      const normExpected = expectedTitle.trim().toLowerCase();
      let mainPane = null;

      if (normExpected) {
        mainPane = panes.find(pane => {
          const h1 = pane.querySelector('h1');
          const h1Text = (h1 ? h1.innerText : (pane.getAttribute('aria-label') || '')).trim().toLowerCase();
          return h1Text && (h1Text.includes(normExpected) || normExpected.includes(h1Text));
        });
      }

      if (!mainPane) {
        const detailCandidates = panes.filter(p =>
          p.querySelector('h1.DUwDvf') ||
          p.querySelector('[data-item-id="address"]') ||
          p.querySelector('h1')
        );
        mainPane = detailCandidates[detailCandidates.length - 1] || panes[panes.length - 1];
      }

      if (!mainPane) return null;

      // Nama bisnis
      const titleEl =
        mainPane.querySelector('h1.DUwDvf') ||
        mainPane.querySelector('h1[class*="fontHeadlineLarge"]') ||
        mainPane.querySelector('h1');
      const title = titleEl ? (titleEl.innerText || '').trim() : (mainPane.getAttribute('aria-label') || '').trim();

      if (!title) return null;

      // Alamat lengkap
      const addressEl =
        mainPane.querySelector('[data-item-id="address"]') ||
        mainPane.querySelector('button[data-tooltip*="address" i], [aria-label^="Alamat:"], [aria-label^="Address:"]');
      let address = '';
      if (addressEl) {
        address = (addressEl.innerText || '').replace(/^[^\n]*\n/, '').trim() || addressEl.getAttribute('aria-label') || '';
        address = address.replace(/^(Alamat|Address):\s*/i, '').trim();
      }

      // Nomor Telepon
      let phone = '';
      const phoneEl =
        mainPane.querySelector('[data-item-id^="phone:tel:"]') ||
        mainPane.querySelector('a[href^="tel:"]') ||
        mainPane.querySelector('[aria-label^="Telepon:"], [aria-label^="Phone:"]');
      if (phoneEl) {
        const dataId = phoneEl.getAttribute('data-item-id');
        const href = phoneEl.getAttribute('href');
        if (dataId && dataId.startsWith('phone:tel:')) {
          phone = dataId.replace('phone:tel:', '').trim();
        } else if (href && /^tel:/i.test(href)) {
          phone = href.replace(/^tel:/i, '').trim();
        } else {
          phone = (phoneEl.innerText || '').replace(/^[^\n]*\n/, '').trim() || phoneEl.getAttribute('aria-label') || '';
          phone = phone.replace(/^(Telepon|Phone):\s*/i, '').trim();
        }
      }

      // Website URL
      let website = '';
      const websiteEl =
        mainPane.querySelector('[data-item-id="authority"]') ||
        mainPane.querySelector('a[data-tooltip*="website" i], a[aria-label*="website" i]');
      if (websiteEl) {
        website = websiteEl.href || (websiteEl.innerText || '').trim();
      }

      // Rating & Review
      let rating = null;
      let reviewCount = 0;
      const ratingEl =
        mainPane.querySelector('div.F7nice span[aria-hidden="true"]') ||
        mainPane.querySelector('span.ceNzKf') ||
        mainPane.querySelector('[role="img"][aria-label*="bintang" i], [role="img"][aria-label*="star" i]');
      if (ratingEl) {
        const ratingRaw = ratingEl.innerText || ratingEl.getAttribute('aria-label') || '';
        const rMatch = ratingRaw.match(/([0-9]+[.,][0-9]+|[0-9]+)/);
        if (rMatch) rating = parseFloat(rMatch[1].replace(',', '.'));
      }
      const reviewEl = mainPane.querySelector('[aria-label*="ulasan" i], [aria-label*="review" i]');
      if (reviewEl) {
        const match = (reviewEl.getAttribute('aria-label') || reviewEl.innerText || '').replace(/[^0-9]/g, '');
        if (match) reviewCount = parseInt(match, 10);
      }

      // Kategori
      let category = '';
      const categoryBtn = mainPane.querySelector('button[jsaction*="category"], button[aria-label*="kategori" i]');
      if (categoryBtn) {
        category = (categoryBtn.innerText || '').trim();
      }

      // Jam Operasional
      let operatingHours = '';
      const hoursEl = mainPane.querySelector('[data-item-id*="oh"], [aria-label*="Jam operasional" i], [aria-label*="Hours" i]');
      if (hoursEl) {
        operatingHours = hoursEl.getAttribute('aria-label') || (hoursEl.innerText || '').replace(/\n/g, ' ').trim();
      }

      const currentUrl = typeof window !== 'undefined' && window.location ? window.location.href : '';
      const mapsUrl = currentUrl.includes('/maps/place/') ? currentUrl.split('?')[0] : '';

      return {
        id: this.cleanPlaceId(currentUrl) || this.slugify(title),
        title,
        category,
        rating,
        reviewCount,
        phone,
        address,
        website,
        operatingHours,
        mapsUrl,
        scrapedAt: new Date().toISOString()
      };
    },

    /**
     * Gabungkan ringkasan kartu dan panel detail secara aman tanpa menimpa nilai non-kosong atau panel yang tidak cocok
     */
    mergeLead(summary, panelData) {
      if (!summary) return panelData || null;
      if (!panelData) return summary;

      const sumTitle = (summary.title || '').trim().toLowerCase();
      const panTitle = (panelData.title || '').trim().toLowerCase();
      if (sumTitle && panTitle && !panTitle.includes(sumTitle) && !sumTitle.includes(panTitle)) {
        return summary;
      }

      return {
        id: summary.id || panelData.id,
        title: panelData.title || summary.title || '',
        category: panelData.category || summary.category || '',
        rating: panelData.rating !== null && panelData.rating !== undefined ? panelData.rating : summary.rating,
        reviewCount: panelData.reviewCount || summary.reviewCount || 0,
        phone: panelData.phone || summary.phone || '',
        address: panelData.address || summary.address || '',
        website: panelData.website || summary.website || '',
        operatingHours: panelData.operatingHours || summary.operatingHours || '',
        mapsUrl: summary.mapsUrl || panelData.mapsUrl || '',
        scrapedAt: new Date().toISOString()
      };
    },

    /**
     * Utility untuk membuat ID unik bersih dari URL Google Maps (prioritas Place CID / ChIJ)
     */
    cleanPlaceId(url) {
      if (!url) return '';
      const cidMatch = url.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+|ChIJ[a-zA-Z0-9_-]+)/);
      if (cidMatch) return cidMatch[1];

      const placeMatch = url.match(/\/place\/([^\/@?]+)/);
      return placeMatch ? decodeURIComponent(placeMatch[1]) : '';
    },

    slugify(text) {
      return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '') || 'place';
    }
  };

  globalScope.MapsExtractor = MapsExtractor;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapsExtractor;
  }
})(typeof window !== 'undefined' ? window : globalThis);
