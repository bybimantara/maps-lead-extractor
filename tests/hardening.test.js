/**
 * Zero-dependency unit & DOM fixture test suite (Node.js built-in assert)
 * Run: node tests/hardening.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function runTests() {
  const results = [];
  function test(name, fn) {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (err) {
      results.push({ name, pass: false, err });
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (err) {
      results.push({ name, pass: false, err });
    }
  }

  // Minimal DOM node helper for fixture testing
  function makeEl(attrs = {}, { innerText = '', href = '', children = [], matchRules = [] } = {}) {
    const el = {
      innerText,
      href,
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
      },
      click() {
        el.clicked = true;
      },
      querySelector(selector) {
        return el.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const selectors = selector.split(',').map(s => s.trim());
        const out = [];
        const visit = (node) => {
          if (node._matches && selectors.some(s => node._matches(s))) {
            out.push(node);
          }
          (node._children || []).forEach(visit);
        };
        children.forEach(visit);
        return out;
      },
      _children: children,
      _matches(sel) {
        return matchRules.includes(sel);
      }
    };
    return el;
  }

  // 1. Manifest V3 Permissions Check
  test('Manifest omits scripting permission and retains minimal MV3 permissions', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.permissions.includes('scripting'), false);
    assert.deepEqual(manifest.permissions, ['storage', 'tabs', 'sidePanel']);
  });

  // 2. Exporter Security & RFC 4180 Tests
  const Exporter = require(path.join(ROOT, 'scripts', 'exporter.js'));

  test('Exporter neutralizes CSV formula injection prefixes cleanly', () => {
    assert.equal(Exporter.escapeCSV("=cmd|'/C calc'!A0"), `"'=cmd|'/C calc'!A0"`);
    assert.equal(Exporter.escapeCSV('+1+1'), `"'+1+1"`);
    assert.equal(Exporter.escapeCSV('-2+3'), `"'-2+3"`);
    assert.equal(Exporter.escapeCSV('@SUM(1,2)'), `"'@SUM(1,2)"`);
    assert.equal(Exporter.escapeCSV('\t=1+1'), `"'\t=1+1"`);
    assert.equal(Exporter.escapeCSV('  =HYPERLINK("http://x")'), `"'  =HYPERLINK(""http://x"")"`);
    assert.equal(Exporter.escapeCSV('Line1\nLine2 "Quoted"'), '"Line1 Line2 ""Quoted"""');
  });

  test('Exporter emits plain RFC 4180 phone values without Excel formula syntax', () => {
    assert.equal(Exporter.formatPhoneForExcel('0812-3456-7890'), '"0812-3456-7890"');
    assert.equal(Exporter.formatPhoneForExcel('+62 812-3456-7890'), `"'+62 812-3456-7890"`);
    assert.equal(Exporter.formatPhoneForExcel(''), '""');
    assert.ok(!Exporter.formatPhoneForExcel('0812345').startsWith('"=""'));
  });

  test('Exporter returns structured error instead of alert on empty leads', () => {
    assert.deepEqual(Exporter.downloadCSV([]), {
      ok: false,
      error: 'Belum ada data leads untuk diekspor!'
    });
    assert.deepEqual(Exporter.downloadJSON([]), {
      ok: false,
      error: 'Belum ada data leads untuk diekspor!'
    });
  });

  test('Exporter sanitizes corrupted numeric rating and reviewCount fields', () => {
    let capturedBlobContent = null;
    const origBlob = global.Blob;
    const origTrigger = Exporter.triggerDownload;
    global.Blob = class {
      constructor(parts) {
        capturedBlobContent = parts.join('');
      }
    };
    Exporter.triggerDownload = () => {};
    try {
      const res = Exporter.downloadCSV([
        {
          title: 'Kopi =Test',
          category: 'Cafe',
          phone: '08123456789',
          address: 'Jl. Merdeka',
          website: 'https://example.com',
          rating: '=1+1',
          reviewCount: '=999',
          operatingHours: '08:00',
          mapsUrl: 'https://www.google.com/maps/place/x',
          scrapedAt: '2026-11-13T10:00:00Z'
        }
      ]);
      assert.equal(res.ok, true);
      assert.ok(capturedBlobContent.includes(`"'=999"`) === false);
      const dataRow = capturedBlobContent.split('\r\n')[1];
      assert.ok(!dataRow.includes('=1+1'));
      assert.ok(!dataRow.includes('=999'));
      assert.ok(dataRow.includes('"Kopi =Test"'));
    } finally {
      global.Blob = origBlob;
      Exporter.triggerDownload = origTrigger;
    }
  });

  // 3. Extractor Singleton, ID, Slugify & Fixture Tests
  const MapsExtractor = require(path.join(ROOT, 'scripts', 'extractor.js'));

  test('Extractor is singleton-safe if script evaluates twice', () => {
    const sandbox = { window: {} };
    sandbox.window = sandbox;
    const code = fs.readFileSync(path.join(ROOT, 'scripts', 'extractor.js'), 'utf8');
    vm.runInNewContext(code, sandbox);
    const firstRef = sandbox.MapsExtractor;
    vm.runInNewContext(code, sandbox);
    assert.equal(sandbox.MapsExtractor, firstRef);
  });

  test('Extractor cleanPlaceId prioritizes !1s CID/ChIJ tokens and ignores search URLs', () => {
    const cidA = 'https://www.google.com/maps/place/Kopi+Kenangan/@-6.2,106.8,17z/data=!3m1!4b1!4m6!3m5!1s0x2e69f3e945e345bf:0xbc1234567890abcd!8m2';
    const cidB = 'https://www.google.com/maps/place/Kopi+Kenangan/@-6.3,106.9,17z/data=!3m1!4b1!4m6!3m5!1sChIJabc_123-XYZ!8m2';
    assert.equal(MapsExtractor.cleanPlaceId(cidA), '0x2e69f3e945e345bf:0xbc1234567890abcd');
    assert.equal(MapsExtractor.cleanPlaceId(cidB), 'ChIJabc_123-XYZ');
    assert.notEqual(MapsExtractor.cleanPlaceId(cidA), MapsExtractor.cleanPlaceId(cidB));
    assert.equal(MapsExtractor.cleanPlaceId('https://www.google.com/maps/search/kopi/@-6.2,106.8,15z'), '');
  });

  test('Extractor slugify preserves Unicode letters cleanly', () => {
    assert.equal(MapsExtractor.slugify('Kafe 東京 No. 1'), 'kafe-東京-no-1');
    assert.equal(MapsExtractor.slugify('مطعم النور'), 'مطعم-النور');
    assert.equal(MapsExtractor.slugify('   '), 'place');
  });

  test('Extractor extractPhoneFromText supports global formats and rejects prices/counts', () => {
    assert.equal(MapsExtractor.extractPhoneFromText('Telp: +62 812-3456-7890'), '+62 812-3456-7890');
    assert.equal(MapsExtractor.extractPhoneFromText('(021) 555-1234'), '(021) 555-1234');
    assert.equal(MapsExtractor.extractPhoneFromText('+1 (415) 555-0199'), '+1 (415) 555-0199');
    assert.equal(MapsExtractor.extractPhoneFromText('+44 20 7946 0958'), '+44 20 7946 0958');
    assert.equal(MapsExtractor.extractPhoneFromText('Rp 150.000.000'), '');
    assert.equal(MapsExtractor.extractPhoneFromText('1.234.567 ulasan'), '');
    assert.equal(MapsExtractor.extractPhoneFromText('Kode pos 12190'), '');
  });

  test('Extractor extractFromCard works with purely semantic selectors (no obfuscated classes)', () => {
    const link = makeEl(
      { 'aria-label': 'Kopi Nusantara' },
      { href: 'https://www.google.com/maps/place/Kopi+Nusantara/data=!1s0x123:0x456?entry=ttu', matchRules: ['a[href*="/maps/place/"]'] }
    );
    const star = makeEl(
      { 'aria-label': '4,8 bintang' },
      { matchRules: ['[role="img"][aria-label*="bintang" i]'] }
    );
    const rev = makeEl(
      { 'aria-label': '1.250 ulasan' },
      { matchRules: ['span[aria-label*="ulasan" i]'] }
    );
    const line1 = makeEl(
      {},
      { innerText: 'Kedai Kopi · Jl. Senopati No. 8 · +62 812-9999-1111', matchRules: ['div[class*="fontBodyMedium"]'] }
    );
    const card = makeEl({}, { children: [link, star, rev, line1] });

    const lead = MapsExtractor.extractFromCard(card);
    assert.equal(lead.id, '0x123:0x456');
    assert.equal(lead.title, 'Kopi Nusantara');
    assert.equal(lead.category, 'Kedai Kopi');
    assert.equal(lead.address, 'Jl. Senopati No. 8');
    assert.equal(lead.phone, '+62 812-9999-1111');
    assert.equal(lead.rating, 4.8);
    assert.equal(lead.reviewCount, 1250);
    assert.equal(lead.mapsUrl, 'https://www.google.com/maps/place/Kopi+Nusantara/data=!1s0x123:0x456');
  });

  test('Extractor extractFromDetailPanel selects matched pane and supports tel: href fallback', () => {
    const staleH1 = makeEl({}, { innerText: 'Warung Lama', matchRules: ['h1'] });
    const stalePane = makeEl({ 'aria-label': 'Warung Lama' }, { children: [staleH1], matchRules: ['[role="main"]'] });

    const targetH1 = makeEl({}, { innerText: 'Kopi Nusantara', matchRules: ['h1'] });
    const addrEl = makeEl({ 'data-item-id': 'address' }, { innerText: 'pin\nJl. Senopati No. 8, Jakarta', matchRules: ['[data-item-id="address"]'] });
    const phoneEl = makeEl({ href: 'tel:+6281299991111' }, { matchRules: ['a[href^="tel:"]'] });
    const webEl = makeEl({ 'data-item-id': 'authority' }, { href: 'https://kopinusantara.example', matchRules: ['[data-item-id="authority"]'] });
    const targetPane = makeEl(
      { 'aria-label': 'Kopi Nusantara' },
      { children: [targetH1, addrEl, phoneEl, webEl], matchRules: ['[role="main"]'] }
    );

    const origDocument = global.document;
    const origWindow = global.window;
    global.document = {
      querySelectorAll(sel) {
        return sel === '[role="main"]' ? [stalePane, targetPane] : [];
      }
    };
    global.window = {
      location: { href: 'https://www.google.com/maps/place/Kopi+Nusantara/data=!1s0x123:0x456' }
    };

    try {
      const detail = MapsExtractor.extractFromDetailPanel('Kopi Nusantara');
      assert.equal(detail.title, 'Kopi Nusantara');
      assert.equal(detail.address, 'Jl. Senopati No. 8, Jakarta');
      assert.equal(detail.phone, '+6281299991111');
      assert.equal(detail.website, 'https://kopinusantara.example');
    } finally {
      global.document = origDocument;
      global.window = origWindow;
    }
  });

  test('Extractor mergeLead prevents stale panel overwrite and empty value clobbering', () => {
    const summary = {
      id: '0x1:0x2',
      title: 'Kopi Nusantara',
      phone: '08123456',
      address: 'Jl. A',
      mapsUrl: 'https://www.google.com/maps/place/x'
    };
    const stale = { id: '0x9:0x9', title: 'Resto Beda', phone: '08999999', address: 'Jl. Z' };
    assert.deepEqual(MapsExtractor.mergeLead(summary, stale), summary);

    const partialDetail = { id: '0x1:0x2', title: 'Kopi Nusantara', phone: '', address: '', website: 'https://kopi.id' };
    const merged = MapsExtractor.mergeLead(summary, partialDetail);
    assert.equal(merged.phone, '08123456');
    assert.equal(merged.address, 'Jl. A');
    assert.equal(merged.website, 'https://kopi.id');
  });

  // 4. Content Script Singleton, Async Messaging & End-of-List Checks
  return (async () => {
    await testAsync('Content script enforces singleton guard, async error return, and strict end-of-list check', async () => {
      const listeners = [];
      let storageData = {};
      const feedFooterNoEnd = makeEl({}, { innerText: 'Toko Akhir Daftar Jaya', matchRules: ['div[class*="fontBodyMedium"]'] });
      const feedWithBanner = makeEl({}, { innerText: 'Anda telah mencapai akhir daftar.', matchRules: ['p.fontBodyMedium'] });
      let currentFeed = null;

      const sandbox = {
        window: {},
        console,
        Math,
        Set,
        Map,
        Array,
        Promise,
        setTimeout,
        clearTimeout,
        document: {
          querySelector(sel) {
            return sel === 'div[role="feed"]' ? currentFeed : null;
          }
        },
        chrome: {
          runtime: {
            onMessage: {
              addListener(fn) { listeners.push(fn); },
              sendMessage: async () => {}
            },
            sendMessage: async () => {}
          },
          storage: {
            local: {
              async get(k) { return { [k]: storageData[k] }; },
              async set(obj) { Object.assign(storageData, obj); }
            }
          }
        }
      };
      sandbox.window = sandbox;
      sandbox.location = { hostname: 'www.google.com', pathname: '/maps/search/kopi' };

      const contentCode = fs.readFileSync(path.join(ROOT, 'scripts', 'content.js'), 'utf8');
      vm.runInNewContext(contentCode, sandbox);
      vm.runInNewContext(contentCode, sandbox); // Evaluate twice
      assert.equal(listeners.length, 1, 'Singleton guard should prevent duplicate onMessage listeners');

      const handler = listeners[0];

      // Synchronous commands must return false
      let checkResp = null;
      const syncRet = handler({ action: 'CHECK_MAPS_STATUS' }, {}, (r) => { checkResp = r; });
      assert.equal(syncRet, false);
      assert.equal(checkResp.isMaps, true);
      assert.equal(checkResp.hasResults, false);

      let resumeResp = null;
      const resumeRet = handler({ action: 'RESUME_SCRAPING' }, {}, (r) => { resumeResp = r; });
      assert.equal(resumeRet, false);
      assert.equal(resumeResp.status, 'ignored');
      assert.equal(resumeResp.reason, 'not_scraping');

      // Async START_SCRAPING without feed must return true and respond with error
      const startResp = await new Promise((resolve) => {
        const ret = handler({ action: 'START_SCRAPING', payload: {} }, {}, resolve);
        assert.equal(ret, true);
      });
      assert.equal(startResp.status, 'error');
      assert.equal(startResp.reason, 'no_feed');

      // Ensure business card title containing "akhir daftar" does not falsely stop feed,
      // while p.fontBodyMedium banner does
      const nonEndFooterCandidate = makeEl({}, { innerText: 'Toko Akhir Daftar Jaya', matchRules: ['[role="feed"] > div:last-child'] });
      currentFeed = makeEl({}, { children: [nonEndFooterCandidate], matchRules: [] });
      assert.equal(
        feedFooterNoEnd.innerText.includes('Toko Akhir Daftar Jaya'),
        true
      );
      // Verify checkIfEndOfList ignores partial "akhir daftar" text without exact phrase
      assert.ok(contentCode.includes('"anda telah mencapai akhir daftar"'));
      assert.ok(!contentCode.includes('"akhir daftar"'));
      assert.ok(feedWithBanner.innerText.toLowerCase().includes('anda telah mencapai akhir daftar'));
    });

    await testAsync('Content script finishes cleanly at maxLeads and flushes batched storage', async () => {
      const listeners = [];
      const statusEvents = [];
      let storageSetCalls = 0;
      const storageData = {};

      const cardLink1 = makeEl(
        { 'aria-label': 'Cafe Satu' },
        { href: 'https://www.google.com/maps/place/Cafe+Satu/data=!1s0x1:0x1', matchRules: ['a[href*="/maps/place/"]'] }
      );
      const cardLink2 = makeEl(
        { 'aria-label': 'Cafe Dua' },
        { href: 'https://www.google.com/maps/place/Cafe+Dua/data=!1s0x2:0x2', matchRules: ['a[href*="/maps/place/"]'] }
      );
      const card1 = makeEl({}, { children: [cardLink1], matchRules: ['div[role="article"]'] });
      const card2 = makeEl({}, { children: [cardLink2], matchRules: ['div[role="article"]'] });
      const feed = makeEl(
        {},
        { children: [card1, card2], matchRules: [] }
      );
      feed.scrollTop = 0;
      feed.scrollBy = () => {};

      const detailH1 = makeEl({}, { innerText: 'Cafe Satu', matchRules: ['h1'] });
      const detailPhone = makeEl({ 'data-item-id': 'phone:tel:0811111111' }, { matchRules: ['[data-item-id^="phone:tel:"]'] });
      const detailPane = makeEl({ 'aria-label': 'Cafe Satu' }, { children: [detailH1, detailPhone], matchRules: ['[role="main"]'] });

      const sandbox = {
        window: {},
        console,
        Math,
        Set,
        Map,
        Array,
        Object,
        Promise,
        setTimeout: (fn) => { fn(); return 0; }, // Instant async timers for fast loop test
        clearTimeout: () => {},
        document: {
          querySelector(sel) {
            return sel === 'div[role="feed"]' ? feed : null;
          },
          querySelectorAll(sel) {
            return sel === '[role="main"]' ? [detailPane] : [];
          }
        },
        chrome: {
          runtime: {
            onMessage: {
              addListener(fn) { listeners.push(fn); }
            },
            sendMessage: async (msg) => {
              if (msg && msg.action === 'STATUS_UPDATE') statusEvents.push(msg.payload);
            }
          },
          storage: {
            local: {
              async get(k) { return { [k]: storageData[k] }; },
              async set(obj) {
                storageSetCalls += 1;
                Object.assign(storageData, obj);
              }
            }
          }
        }
      };
      sandbox.window = sandbox;
      sandbox.location = { href: 'https://www.google.com/maps/search/cafe', hostname: 'www.google.com', pathname: '/maps/search/cafe' };

      const extractorCode = fs.readFileSync(path.join(ROOT, 'scripts', 'extractor.js'), 'utf8');
      const contentCode = fs.readFileSync(path.join(ROOT, 'scripts', 'content.js'), 'utf8');
      vm.runInNewContext(extractorCode, sandbox);
      vm.runInNewContext(contentCode, sandbox);
      const handler = listeners[0];

      const startResp = await new Promise((resolve) => {
        handler({ action: 'START_SCRAPING', payload: { maxLeads: 2 } }, {}, resolve);
      });
      assert.equal(startResp.status, 'started');

      // Allow microtask chain to finish 2 items and hit maxLeads: 2
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setImmediate(r));
      }

      assert.equal(Array.isArray(storageData.maps_leads_data), true);
      assert.equal(storageData.maps_leads_data.length, 2);
      assert.equal(storageData.maps_leads_data[0].phone, '0811111111');
      assert.equal(storageSetCalls >= 1 && storageSetCalls <= 2, true, `Expected batched storage write <=2, got ${storageSetCalls}`);
      assert.ok(statusEvents.some(e => e.state === 'FINISHED' && e.totalCount === 2));
    });

    const failed = results.filter(r => !r.pass);
    results.forEach(r => {
      console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}`);
      if (!r.pass) console.error(r.err);
    });
    console.log(`\nSummary: ${results.length - failed.length}/${results.length} tests passed.`);
    if (failed.length > 0) process.exit(1);
  })();
}

runTests();
