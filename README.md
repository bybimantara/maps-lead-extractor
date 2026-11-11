# 📌 Google Maps Lead Extractor (Chrome Extension)

Ekstensi Google Chrome (Manifest V3 Vanilla JS) untuk mengekstrak data prospek/lead langsung dari hasil pencarian Google Maps secara otomatis dan mengekspornya ke format **CSV** (Excel-ready UTF-8 BOM) dan **JSON**.

---

## ✨ Fitur Utama
- **Auto-Scroll Pintar**: Menggulir feed Google Maps (`role="feed"`) secara otomatis dengan jeda manusiawi (jitter delay) untuk menghindari pembatasan.
- **Ekstraksi Data Lengkap**:
  - Nama Bisnis / Tempat
  - Kategori Usaha
  - Rating & Total Ulasan
  - Nomor Telepon
  - Alamat Lengkap
  - Website Resmi
  - Jam Operasional
  - Link Langsung Google Maps
  - Email & Media Sosial (bila terdeteksi di listing)
- **Ekspor Instan**:
  - **CSV**: Format rapi dengan UTF-8 BOM, langsung terbaca sempurna di Microsoft Excel & Google Sheets tanpa karakter rusak.
  - **JSON**: Struktur objek rapi untuk kebutuhan pengolahan developer / integrasi CRM.
- **Tanpa Instalasi/Build Rumit**: 100% Pure Vanilla JavaScript, tanpa `npm install` atau bundler.

---

## 🚀 Cara Pemasangan di Chrome (Load Unpacked)

1. Buka browser Google Chrome / Brave / Edge.
2. Buka URL: `chrome://extensions`.
3. Aktifkan toggle **Developer mode** di pojok kanan atas.
4. Klik tombol **Load unpacked** di pojok kiri atas.
5. Pilih folder direktori project ini (`maps-lead-extractor`).
6. Ekstensi **Maps Lead Extractor** siap digunakan!

---

## 📖 Dokumentasi Proyek
- [Product Requirements Document (PRD)](./docs/PRD.md)
- [Data Contract & Interface Spec](./docs/contract.md)
- [Implementation Plan](./docs/implementation_plan.md)
- [Design & UI Guidelines](./docs/DESIGN.md)
- [Task Hari Ini](./docs/task_today.md)
- [Progress Log](./docs/progress.md)
