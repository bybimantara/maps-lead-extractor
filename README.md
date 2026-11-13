# Google Maps Lead Extractor

A lightweight, zero-dependency Chrome extension (Manifest V3) that extracts business profiles from Google Maps search results directly into Excel-ready CSV and JSON files.

Runs entirely inside your browser. No external servers, no account required, and no paid Google Places API keys needed.

## Features

- **Side Panel Interface**: Stays open beside your Google Maps tab using the Chrome Side Panel API without closing when you interact with the map.
- **In-Page Extraction**: Reads data directly from the active Google Maps DOM (`div[role="feed"]` and detail panels) without opening external tabs or third-party web scrapers.
- **Human-like Scroll Engine**: Scrolls search results smoothly with randomized delays (1.2s to 2.4s) to emulate natural browsing and prevent DOM flooding.
- **Deep Detail Parsing**: Clicks listings to parse full address, phone number, operating hours, and website URLs via resilient semantic selectors (`data-item-id`).
- **In-Memory Deduplication**: Tracks places by unique place URL and ID, preventing duplicate records across multiple searches in the same session.
- **Excel-Safe CSV Export**: Prepends a UTF-8 BOM (`\uFEFF`) and wraps phone numbers in formula strings (`="08..."`) so Microsoft Excel and Google Sheets do not drop leading zeros or misinterpret country codes.
- **JSON Export**: Provides structured data ready for developer pipelines, databases, or CRM ingestion.
- **Local Storage Persistence**: Saves progress to `chrome.storage.local` automatically so data is preserved if the panel is closed.

## Extracted Data Fields

| Field | Description | Example |
| :--- | :--- | :--- |
| `Business Name` | Name of the venue or company | `Blue Bottle Coffee` |
| `Category` | Business category listed on Maps | `Coffee shop` |
| `Phone Number` | Contact number formatted for Excel | `+1 510-653-3394` |
| `Address` | Physical address | `315 Linden St, San Francisco, CA 94102` |
| `Website` | Official website or profile link | `https://bluebottlecoffee.com` |
| `Rating` | Star rating (numeric) | `4.6` |
| `Reviews Count` | Total number of published reviews | `1420` |
| `Operating Hours` | Current open/closed status or hours | `Open ⋅ Closes 6 PM` |
| `Google Maps URL` | Direct URL to the listing | `https://www.google.com/maps/place/...` |
| `Scraped Date` | ISO timestamp of extraction | `2026-11-13 14:00:00` |

## Installation

This extension is built with pure Vanilla JavaScript and requires no build steps or package managers.

1. Clone or download this repository to your computer:
   ```bash
   git clone https://github.com/bybimantara/maps-lead-extractor.git
   ```
2. Open Google Chrome (or any Chromium browser such as Brave, Edge, or Arc).
3. Navigate to `chrome://extensions`.
4. Turn on **Developer mode** using the toggle in the top-right corner.
5. Click **Load unpacked** in the top-left corner.
6. Select the `maps-lead-extractor` project folder.
7. The extension icon will appear in your browser toolbar.

## How to Use

1. Go to [Google Maps](https://www.google.com/maps).
2. Enter a search query for local businesses (for example: `Bakeries in Austin` or `Dental clinics in Surabaya`).
3. Click the **Maps Lead Extractor** icon in your toolbar to open the side panel.
4. Click **Start Scraping**.
5. The extension will automatically scroll the results feed, load detail cards, update the live counter, and show recent entries in the preview table.
6. When scraping finishes or when you click **Stop**, click **Download CSV (Excel)** or **Download JSON** to save your dataset.
7. Use **Clear Data** when you want to start a fresh collection.

## Project Structure

```text
maps-lead-extractor/
├── manifest.json         # Manifest V3 declaration and permissions
├── icons/                # Extension icons (16px, 48px, 128px)
├── popup/
│   ├── popup.html        # Side panel and popup markup
│   ├── popup.css         # Dark Slate and Emerald styling
│   └── popup.js          # UI controller, event listeners, and storage sync
├── scripts/
│   ├── background.js     # Background service worker (side panel management)
│   ├── content.js        # Auto-scroll loop and runtime message handler
│   ├── extractor.js      # Semantic DOM parsing rules for Google Maps
│   └── exporter.js       # CSV (UTF-8 BOM + Excel formula) and JSON generator
├── LICENSE               # MIT License
└── README.md             # Project documentation
```

## Privacy and Compliance

- **No Remote Telemetry**: All data processing and storage happens locally in your browser session (`chrome.storage.local`).
- **No Third-Party Tracking**: The extension does not communicate with external analytics servers or third-party APIs.
- **In-Page Only**: Only accesses `google.com/maps` search results while active.

## License

Distributed under the [MIT License](LICENSE). See `LICENSE` for more information.
