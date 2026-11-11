/**
 * Exporter Utility - CSV (UTF-8 BOM + Excel Protection) & JSON Generator
 */

const Exporter = {
  /**
   * Unduh file CSV yang rapi untuk Microsoft Excel & Google Sheets
   * @param {Array<Object>} leads - Array of MapLead
   * @param {string} filename - Nama file tanpa ekstensi
   */
  downloadCSV(leads, filename = 'maps_leads') {
    if (!leads || leads.length === 0) {
      alert('Belum ada data leads untuk diekspor!');
      return;
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

    const rows = leads.map(lead => [
      this.escapeCSV(lead.title || ''),
      this.escapeCSV(lead.category || ''),
      this.formatPhoneForExcel(lead.phone || ''),
      this.escapeCSV(lead.address || ''),
      this.escapeCSV(lead.website || ''),
      lead.rating !== null && lead.rating !== undefined ? lead.rating : '',
      lead.reviewCount !== undefined ? lead.reviewCount : 0,
      this.escapeCSV(lead.operatingHours || ''),
      this.escapeCSV(lead.mapsUrl || ''),
      this.escapeCSV(lead.scrapedAt ? lead.scrapedAt.replace('T', ' ').substring(0, 19) : '')
    ]);

    // Gabungkan baris CSV
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\r\n');

    // Tambahkan UTF-8 Byte Order Mark (BOM) \uFEFF agar karakter dibaca sempurna di Excel
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    this.triggerDownload(blob, `${filename}_${this.getTimestamp()}.csv`);
  },

  /**
   * Unduh file JSON
   * @param {Array<Object>} leads
   * @param {string} filename
   */
  downloadJSON(leads, filename = 'maps_leads') {
    if (!leads || leads.length === 0) {
      alert('Belum ada data leads untuk diekspor!');
      return;
    }

    const jsonString = JSON.stringify(leads, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    this.triggerDownload(blob, `${filename}_${this.getTimestamp()}.json`);
  },

  /**
   * Escape string untuk CSV standard RFC 4180
   */
  escapeCSV(value) {
    if (typeof value !== 'string') value = String(value);
    // Ganti newline dengan spasi agar baris tetap 1 baris di tabel
    value = value.replace(/\r?\n|\r/g, ' ');
    if (value.includes('"') || value.includes(',') || value.includes(';')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return `"${value}"`;
  },

  /**
   * Lindungi nomor telepon agar angka nol awal (08...) tidak dipotong oleh Excel
   */
  formatPhoneForExcel(phone) {
    if (!phone) return '""';
    const clean = phone.trim().replace(/\r?\n|\r/g, ' ');
    // Gunakan sintaks string formula ="0812..." untuk Excel
    return `="""${clean.replace(/"/g, '')}"""`;
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

window.Exporter = Exporter;
