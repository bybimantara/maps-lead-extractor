/**
 * Exporter Utility - CSV (UTF-8 BOM + Anti CSV-Injection RFC 4180) & JSON Generator
 */

((globalScope) => {
  const FORMULA_PREFIX_RE = /^[\t\r ]*[=+\-@]|^[\t\r]/;

  const Exporter = {
    /**
     * Unduh file CSV yang aman untuk Microsoft Excel, Google Sheets, & CRM
     * @param {Array<Object>} leads - Array of MapLead
     * @param {string} filename - Nama file tanpa ekstensi
     * @returns {{ ok: boolean, count?: number, error?: string }}
     */
    downloadCSV(leads, filename = 'maps_leads') {
      if (!leads || leads.length === 0) {
        return { ok: false, error: 'Belum ada data leads untuk diekspor!' };
      }

      const headers = [
        'Business Name',
        'Category',
        'Phone Number',
        'Address',
        'Website',
        'Rating',
        'Reviews Count',
        'Operating Hours',
        'Google Maps URL',
        'Scraped Date'
      ];

      const rows = leads.map(lead => {
        const ratingNum = lead.rating !== null && lead.rating !== undefined && lead.rating !== ''
          ? Number(lead.rating)
          : NaN;
        const reviewNum = Number(lead.reviewCount);

        return [
          this.escapeCSV(lead.title || ''),
          this.escapeCSV(lead.category || ''),
          this.escapeCSV(lead.phone ? String(lead.phone).trim() : ''),
          this.escapeCSV(lead.address || ''),
          this.escapeCSV(lead.website || ''),
          Number.isFinite(ratingNum) ? ratingNum : '',
          Number.isFinite(reviewNum) ? Math.trunc(reviewNum) : 0,
          this.escapeCSV(lead.operatingHours || ''),
          this.escapeCSV(lead.mapsUrl || ''),
          this.escapeCSV(lead.scrapedAt ? String(lead.scrapedAt).replace('T', ' ').substring(0, 19) : '')
        ];
      });

      // Gabungkan baris CSV sesuai RFC 4180 (CRLF)
      const csvContent = [
        headers.join(','),
        ...rows.map(r => r.join(','))
      ].join('\r\n');

      // Tambahkan UTF-8 Byte Order Mark (BOM) \uFEFF agar karakter dibaca sempurna di Excel
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      this.triggerDownload(blob, `${filename}_${this.getTimestamp()}.csv`);
      return { ok: true, count: leads.length };
    },

    /**
     * Unduh file JSON
     * @param {Array<Object>} leads
     * @param {string} filename
     * @returns {{ ok: boolean, count?: number, error?: string }}
     */
    downloadJSON(leads, filename = 'maps_leads') {
      if (!leads || leads.length === 0) {
        return { ok: false, error: 'Belum ada data leads untuk diekspor!' };
      }

      const jsonString = JSON.stringify(leads, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
      this.triggerDownload(blob, `${filename}_${this.getTimestamp()}.json`);
      return { ok: true, count: leads.length };
    },

    /**
     * Escape string untuk CSV standar RFC 4180 dan cegah CSV Formula Injection
     */
    escapeCSV(value) {
      let str = value === null || value === undefined ? '' : String(value);
      // Ganti newline dengan spasi agar baris tetap 1 baris di tabel
      str = str.replace(/\r?\n|\r/g, ' ');
      // Prefiks kutip tunggal pada awalan berbahaya agar tidak dieksekusi sebagai rumus
      if (FORMULA_PREFIX_RE.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    },

    /**
     * Sanitasi nomor telepon sebagai teks polos aman CSV (tanpa formula ="...")
     */
    formatPhoneForExcel(phone) {
      if (!phone) return '""';
      return this.escapeCSV(String(phone).trim());
    },

    triggerDownload(blob, fullFilename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fullFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    getTimestamp() {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    }
  };

  globalScope.Exporter = Exporter;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Exporter;
  }
})(typeof window !== 'undefined' ? window : globalThis);
