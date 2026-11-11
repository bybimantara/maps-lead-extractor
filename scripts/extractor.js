/**
 * Extractor Module - Google Maps Business Profile
 * Menggunakan selektor semantik resilient (data-item-id, aria-label, role="feed")
 */

const MapsExtractor = {
  /**
   * Ekstrak ringkas dari kartu di dalam list feed
   * @param {Element} card - Elemen kartu dalam feed
   */
  extractFromCard(card) {
    if (!card) return null;

    // Direct link ke tempat di Maps
    const linkEl = card.querySelector('a.hfpxzc') || card.querySelector('a[href*="/maps/place/"]');
    const mapsUrl = linkEl ? linkEl.href : '';
    const title = linkEl ? (linkEl.getAttribute('aria-label') || linkEl.innerText.trim()) : '';

    if (!title && !mapsUrl) return null;

    // Rating & Jumlah Review
    let rating = null;
    let reviewCount = 0;

    const ratingEl = card.querySelector('.MW4etd') || card.querySelector('[role="img"][aria-label*="bintang"], [role="img"][aria-label*="star"]');
    if (ratingEl) {
      const ratingText = ratingEl.getAttribute('aria-label') || ratingEl.innerText;
      const match = ratingText.match(/([0-9]+[.,][0-9]+|[0-9]+)/);
      if (match) rating = parseFloat(match[1].replace(',', '.'));
    }

    const reviewsEl = card.querySelector('.UY7F9') || card.querySelector('span[aria-label*="ulasan"], span[aria-label*="review"]');
    if (reviewsEl) {
      const revText = reviewsEl.getAttribute('aria-label') || reviewsEl.innerText;
      const match = revText.replace(/[^0-9]/g, '');
      if (match) reviewCount = parseInt(match, 10);
    }

    // Kategori & Alamat pendek dari baris teks kartu
    let category = '';
    let address = '';
    let phone = '';

    // Ambil semua elemen teks di kartu
    const textLines = Array.from(card.querySelectorAll('div.W4Efsd, div[class*="fontBodyMedium"]'))
      .map(el => el.innerText.trim())
      .filter(Boolean);

    textLines.forEach(line => {
      // Deteksi nomor telepon (+62 / 08 / (021))
      const phoneMatch = line.match(/(?:\+62|08|02[1-9]|\(0[1-9]+\))\s?[0-9\-\s.]{6,15}/);
      if (phoneMatch && !phone) {
        phone = phoneMatch[0].trim();
      }

      // Deteksi kategori (biasanya sebelum titik tengah · )
      if (line.includes('·')) {
        const parts = line.split('·').map(p => p.trim());
        if (!category && parts[0]) category = parts[0];
      }
    });

    return {
      id: mapsUrl ? this.cleanPlaceId(mapsUrl) : this.slugify(title),
      title: title.trim(),
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
   */
  extractFromDetailPanel() {
    const mainPane = document.querySelector('[role="main"]');
    if (!mainPane) return null;

    // Nama bisnis
    const titleEl = mainPane.querySelector('h1') || mainPane.querySelector('[role="main"] h1');
    const title = titleEl ? titleEl.innerText.trim() : (mainPane.getAttribute('aria-label') || '');

    if (!title) return null;

    // Alamat lengkap
    const addressEl = mainPane.querySelector('[data-item-id="address"]') || mainPane.querySelector('[aria-label^="Alamat:"], [aria-label^="Address:"]');
    let address = '';
    if (addressEl) {
      address = addressEl.innerText.replace(/^[^\n]*\n/, '').trim() || addressEl.getAttribute('aria-label') || '';
      address = address.replace(/^(Alamat|Address):\s*/i, '').trim();
    }

    // Nomor Telepon
    let phone = '';
    const phoneEl = mainPane.querySelector('[data-item-id^="phone:tel:"]') || mainPane.querySelector('[aria-label^="Telepon:"], [aria-label^="Phone:"]');
    if (phoneEl) {
      const dataId = phoneEl.getAttribute('data-item-id');
      if (dataId && dataId.startsWith('phone:tel:')) {
        phone = dataId.replace('phone:tel:', '').trim();
      } else {
        phone = phoneEl.innerText.replace(/^[^\n]*\n/, '').trim() || phoneEl.getAttribute('aria-label') || '';
        phone = phone.replace(/^(Telepon|Phone):\s*/i, '').trim();
      }
    }

    // Website URL
    let website = '';
    const websiteEl = mainPane.querySelector('[data-item-id="authority"]') || mainPane.querySelector('a[data-tooltip*="website" i], a[aria-label*="website" i]');
    if (websiteEl) {
      website = websiteEl.href || websiteEl.innerText.trim();
    }

    // Rating & Review
    let rating = null;
    let reviewCount = 0;
    const ratingEl = mainPane.querySelector('span.ceNzKf') || mainPane.querySelector('div.F7nice span[aria-hidden="true"]');
    if (ratingEl) {
      const rMatch = ratingEl.innerText.match(/([0-9]+[.,][0-9]+|[0-9]+)/);
      if (rMatch) rating = parseFloat(rMatch[1].replace(',', '.'));
    }
    const reviewEl = mainPane.querySelector('span[aria-label*="ulasan"], span[aria-label*="review"]');
    if (reviewEl) {
      const match = (reviewEl.getAttribute('aria-label') || reviewEl.innerText).replace(/[^0-9]/g, '');
      if (match) reviewCount = parseInt(match, 10);
    }

    // Kategori
    let category = '';
    const categoryBtn = mainPane.querySelector('button[jsaction*="category"]');
    if (categoryBtn) {
      category = categoryBtn.innerText.trim();
    }

    // Jam Operasional
    let operatingHours = '';
    const hoursEl = mainPane.querySelector('[data-item-id*="oh"], [aria-label*="Jam operasional" i], [aria-label*="Hours" i]');
    if (hoursEl) {
      operatingHours = hoursEl.getAttribute('aria-label') || hoursEl.innerText.replace(/\n/g, ' ').trim();
    }

    return {
      id: this.cleanPlaceId(window.location.href) || this.slugify(title),
      title,
      category,
      rating,
      reviewCount,
      phone,
      address,
      website,
      operatingHours,
      mapsUrl: window.location.href.split('?')[0],
      scrapedAt: new Date().toISOString()
    };
  },

  /**
   * Utility untuk membuat ID bersih dari URL
   */
  cleanPlaceId(url) {
    if (!url) return '';
    const match = url.match(/\/place\/([^\/@?]+)/);
    return match ? decodeURIComponent(match[1]) : url;
  },

  slugify(text) {
    return text.toString().toLowerCase().trim().replace(/[\s\W-]+/g, '-');
  }
};

// Ekspos ke global scope content script
window.MapsExtractor = MapsExtractor;
