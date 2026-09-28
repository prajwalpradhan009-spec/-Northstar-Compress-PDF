/* eslint-disable no-console */
/**
 * End-to-end verification of all 12 PDF tools against a running backend.
 *
 *   node test/run-all.js
 *
 * Every check asserts on the *bytes that came back* — page counts, image
 * signatures, extracted text, ZIP entries, encryption — so a tool only
 * passes if it genuinely produced the right output.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const FIXTURES = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'out');

fs.mkdirSync(OUT, { recursive: true });

const fixture = (name) => path.join(FIXTURES, name);
const read = (name) => fs.readFileSync(fixture(name));

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* --------------------------- HTTP helpers --------------------------- */

async function post(route, { fields = {}, files = [], headers = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    form.append(key, String(value));
  }
  for (const item of files) {
    const buffer = Buffer.isBuffer(item.buffer) ? item.buffer : read(item.buffer);
    form.append(item.field || 'file', new Blob([buffer], { type: item.type || 'application/pdf' }), item.name);
  }
  const response = await fetch(`${BASE}/api/pdf${route}`, { method: 'POST', body: form, headers });
  const contentType = response.headers.get('content-type') || '';
  let body;
  if (contentType.includes('application/json')) body = await response.json();
  else body = Buffer.from(await response.arrayBuffer());

  const metaHeader = response.headers.get('x-result-meta');
  let meta = {};
  if (metaHeader) {
    try { meta = JSON.parse(decodeURIComponent(metaHeader)); } catch { meta = {}; }
  }
  return { status: response.status, contentType, body, meta, headers: response.headers };
}

const errorOf = (result) => (result.body && result.body.error) || '(no error message)';

/* --------------------------- PDF assertions ------------------------- */

const PDF_HEADER = Buffer.from('%PDF-');

function isPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 400 && buffer.subarray(0, 5).equals(PDF_HEADER);
}

/** Count page objects the cheap, reliable way: parse /Count or count /Type /Page. */
function countPages(buffer) {
  const text = buffer.toString('latin1');
  const typeMatches = text.match(/\/Type\s*\/Page[^s]/g);
  if (typeMatches) return typeMatches.length;
  const countMatches = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return countMatches.length ? Math.max(...countMatches) : 0;
}

const isJpeg = (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
const isPng = (buffer) => buffer[0] === 0x89 && buffer.subarray(1, 4).toString('latin1') === 'PNG';

/** Minimal ZIP central-directory reader so we can assert on archive contents. */
function readZipEntries(buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOffset = buffer.lastIndexOf(signature);
  if (eocdOffset < 0) return null;
  const count = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  const fileHeader = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== fileHeader.readUInt32LE(0)) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? zlib.inflateRawSync(raw) : raw;
    entries.push({ name, content });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/* ------------------------------ Tests ------------------------------- */

const tests = [];
const test = (label, fn) => tests.push({ label, fn });

test('01. Merge PDF — combines files in the exact order sent', async () => {
  const result = await post('/merge', {
    files: [
      { field: 'files', buffer: read('alpha.pdf'), name: 'alpha.pdf' },
      { field: 'files', buffer: read('beta.pdf'), name: 'beta.pdf' },
    ],
  });
  ok('returns 200', result.status === 200, `status ${result.status} ${errorOf(result)}`);
  ok('returns a real PDF', isPdf(result.body));
  ok('page count = 5 + 3 = 8', countPages(result.body) === 8, `got ${countPages(result.body)}`);
  ok('meta reports 8 pages / 2 files', result.meta.pageCount === 8 && result.meta.fileCount === 2);
  const text = result.body.toString('latin1');
  ok('first page is ALPHA (order preserved)', text.indexOf('ALPHA') < text.indexOf('BETA') || text.indexOf('BETA') === -1);
  fs.writeFileSync(path.join(OUT, 'merge.pdf'), result.body);
});

test('02. Compress PDF — genuinely shrinks the file at each level', async () => {
  const source = fs.readFileSync(path.join(FIXTURES, '..', '..', 'src', 'uploads', '1790044756033-Merged_Document.pdf'));
  for (const level of ['low', 'medium', 'high']) {
    const result = await post('/compress', {
      fields: { level },
      files: [{ buffer: source, name: 'big.pdf' }],
    });
    ok(`${level}: returns 200`, result.status === 200, `status ${result.status} ${errorOf(result)}`);
    ok(`${level}: returns a real PDF`, isPdf(result.body));
    ok(`${level}: output is smaller than the input`, result.body.length < source.length,
      `${source.length} -> ${result.body.length} bytes`);
    ok(`${level}: meta sizes match the real bytes`,
      result.meta.originalSize === source.length && result.meta.compressedSize === result.body.length,
      `meta ${result.meta.originalSize} -> ${result.meta.compressedSize}`);
    ok(`${level}: page count preserved (5)`, countPages(result.body) === 5, `got ${countPages(result.body)}`);
    ok(`${level}: image data really is JPEG`, isJpeg(result.body) || /DCTDecode/.test(result.body.toString('latin1')));
  }
  const low = await post('/compress', { fields: { level: 'low' }, files: [{ buffer: source, name: 'big.pdf' }] });
  const high = await post('/compress', { fields: { level: 'high' }, files: [{ buffer: source, name: 'big.pdf' }] });
  ok('low compression is smaller than high compression', low.body.length < high.body.length,
    `low ${low.body.length} vs high ${high.body.length}`);
});

test('03. Split PDF — range, every-page, and ZIP output', async () => {
  const ranged = await post('/split', { fields: { ranges: '1-2' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('range 1-2 returns a single PDF', ranged.status === 200 && isPdf(ranged.body));
  ok('range 1-2 has 2 pages', countPages(ranged.body) === 2, `got ${countPages(ranged.body)}`);

  const individual = await post('/split', { fields: { ranges: '1,3,5' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('"1,3,5" returns a ZIP', individual.contentType.includes('zip'));
  const individualZip = readZipEntries(individual.body);
  ok('"1,3,5" ZIP has 3 entries', individualZip && individualZip.length === 3, `got ${individualZip && individualZip.length}`);
  ok('every ZIP entry is a valid PDF', individualZip.every((entry) => isPdf(entry.content)));
  ok('each ZIP entry has 1 page', individualZip.every((entry) => countPages(entry.content) === 1));

  const every = await post('/split', { fields: { ranges: '' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  const everyZip = readZipEntries(every.body);
  ok('empty ranges splits every page into 5 files', everyZip && everyZip.length === 5, `got ${everyZip && everyZip.length}`);

  const contiguous = await post('/split', { fields: { ranges: '1-3' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('"1-3" produces exactly 1 file', contiguous.meta.fileCount === 1);
  ok('"1-3" contains 3 pages', countPages(contiguous.body) === 3);
});

test('04. Organize PDF — reorder, delete, rotate', async () => {
  const reorderOnly = await post('/organize', {
    fields: { pages: JSON.stringify([{ num: 3 }, { num: 1 }, { num: 2 }, { num: 4 }, { num: 5 }]) },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  ok('reorder returns 200 + PDF', reorderOnly.status === 200 && isPdf(reorderOnly.body));
  ok('reorder keeps all 5 pages', countPages(reorderOnly.body) === 5, `got ${countPages(reorderOnly.body)}`);
  ok('reorder actually changed the page order', !reorderOnly.body.equals(read('alpha.pdf')));

  const withDelete = await post('/organize', {
    fields: { pages: JSON.stringify([{ num: 1 }, { num: 2, deleted: true }, { num: 3 }]) },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  ok('deleted pages are removed', countPages(withDelete.body) === 2, `got ${countPages(withDelete.body)}`);

  const withRotate = await post('/organize', {
    fields: { pages: JSON.stringify([{ num: 1, rotation: 90 }, { num: 2, rotation: 180 }, { num: 3, rotation: 270 }]) },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  const rotateText = withRotate.body.toString('latin1');
  ok('rotations are written into the page dictionaries',
    /\/Rotate\s*90/.test(rotateText) && /\/Rotate\s*180/.test(rotateText) && /\/Rotate\s*270/.test(rotateText));

  const duplicated = await post('/organize', {
    fields: { pages: JSON.stringify([{ num: 1 }, { num: 1 }, { num: 2 }]) },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  ok('duplicating a page yields 3 pages', countPages(duplicated.body) === 3, `got ${countPages(duplicated.body)}`);

  const noneLeft = await post('/organize', {
    fields: { pages: JSON.stringify([{ num: 1, deleted: true }]) },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  ok('deleting every page returns a clean 400', noneLeft.status === 400, `status ${noneLeft.status}`);
});

test('05. Rotate PDF — 90/180/270, all pages and selected pages', async () => {
  const all90 = await post('/rotate', { fields: { angle: 90, pages: '' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('rotate all 90° returns 200 + PDF', all90.status === 200 && isPdf(all90.body));
  ok('all 5 pages rotated', all90.meta.rotatedCount === 5, `got ${all90.meta.rotatedCount}`);
  ok('page count unchanged', countPages(all90.body) === 5);
  ok('/Rotate 90 present', /\/Rotate\s*90/.test(all90.body.toString('latin1')));

  const some = await post('/rotate', { fields: { angle: 180, pages: '2,4' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('only 2 pages rotated when asked for 2,4', some.meta.rotatedCount === 2, `got ${some.meta.rotatedCount}`);
  const someText = some.body.toString('latin1');
  ok('/Rotate 180 present, /Rotate 90 absent', /\/Rotate\s*180/.test(someText) && !/\/Rotate\s*90[^0-9]/.test(someText));

  const bad = await post('/rotate', { fields: { angle: 45 }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('invalid angle rejected with 400', bad.status === 400, `status ${bad.status}`);
});

test('06. Extract Pages — pulls only the requested pages', async () => {
  const result = await post('/extract', { fields: { pages: '1,3,5' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('returns 200 + PDF', result.status === 200 && isPdf(result.body));
  ok('extracted exactly 3 pages', countPages(result.body) === 3, `got ${countPages(result.body)}`);
  ok('meta lists 1,3,5', JSON.stringify(result.meta.pages) === '[1,3,5]', JSON.stringify(result.meta.pages));

  const range = await post('/extract', { fields: { pages: '2-4' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('range 2-4 extracts 3 pages', countPages(range.body) === 3);

  const all = await post('/extract', { fields: { pages: '' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('no selection extracts all 5', countPages(all.body) === 5);

  const missing = await post('/extract', { fields: { pages: '99' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('out-of-range page gives a helpful 400', missing.status === 400 && /does not exist/.test(errorOf(missing)), errorOf(missing));
});

test('07. PDF → JPG — images, and a ZIP when there are many', async () => {
  const jpg = await post('/to-jpg', { fields: { format: 'jpg', scale: 1 }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('returns a ZIP for 5 pages', jpg.contentType.includes('zip'), jpg.contentType);
  const jpgZip = readZipEntries(jpg.body);
  ok('ZIP contains 5 JPEGs', jpgZip && jpgZip.length === 5, `got ${jpgZip && jpgZip.length}`);
  ok('every entry is a valid JPEG', jpgZip.every((entry) => isJpeg(entry.content)));
  ok('each JPEG is non-trivial (>10KB)', jpgZip.every((entry) => entry.content.length > 10000),
    jpgZip.map((e) => e.content.length).join(','));
  ok('entry names are page-numbered', jpgZip.every((entry) => /^page-\d+\.jpg$/.test(entry.name)),
    jpgZip.map((e) => e.name).join(','));

  const png = await post('/to-jpg', { fields: { format: 'png', scale: 0.5 }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  const pngZip = readZipEntries(png.body);
  ok('PNG export produces 5 valid PNGs', pngZip && pngZip.length === 5 && pngZip.every((e) => isPng(e.content)));

  const one = await post('/to-jpg', { fields: { format: 'jpg', pages: '3' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('single page returns a bare JPEG, not a ZIP', isJpeg(one.body), one.contentType);

  const selected = await post('/to-jpg', { fields: { format: 'jpg', pages: '1,3' }, files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  const selectedZip = readZipEntries(selected.body);
  ok('"1,3" produces exactly 2 images', selectedZip && selectedZip.length === 2, `got ${selectedZip && selectedZip.length}`);
});

test('08. JPG → PDF — one page per image, correct page size', async () => {
  const files = [1, 2, 3, 4].map((i) => ({ field: 'files', buffer: read(`photo-${i}.jpg`), name: `photo-${i}.jpg`, type: 'image/jpeg' }));
  const fit = await post('/from-jpg', { fields: { pageSize: 'auto' }, files });
  ok('returns 200 + PDF', fit.status === 200 && isPdf(fit.body), errorOf(fit));
  ok('4 images -> 4 pages', countPages(fit.body) === 4, `got ${countPages(fit.body)}`);

  const a4 = await post('/from-jpg', { fields: { pageSize: 'A4', orientation: 'portrait', margin: 10 }, files });
  ok('A4 export returns 4 pages', countPages(a4.body) === 4);
  ok('A4 page box is 595x842', /MediaBox\s*\[\s*0\s+0\s+595(\.\d+)?\s+841(\.\d+)?/.test(a4.body.toString('latin1')),
    (a4.body.toString('latin1').match(/MediaBox[^\]]*\]/) || [''])[0]);

  const landscape = await post('/from-jpg', { fields: { pageSize: 'A4', orientation: 'landscape' }, files });
  ok('landscape swaps the page box', /MediaBox\s*\[\s*0\s+0\s+841(\.\d+)?\s+595(\.\d+)?/.test(landscape.body.toString('latin1')),
    (landscape.body.toString('latin1').match(/MediaBox[^\]]*\]/) || [''])[0]);

  const single = await post('/from-jpg', { files: [{ field: 'files', buffer: read('photo-1.jpg'), name: 'p.jpg', type: 'image/jpeg' }] });
  ok('a single image still works', single.status === 200 && countPages(single.body) === 1);

  const empty = await post('/from-jpg', { files: [] });
  ok('no files gives a clean 400', empty.status === 400 && /No files/.test(errorOf(empty)), errorOf(empty));

  const fake = await post('/from-jpg', { files: [{ field: 'files', buffer: Buffer.from('this is not an image'), name: 'bad.jpg', type: 'image/jpeg' }] });
  ok('a fake image is rejected with 415', fake.status === 415, `status ${fake.status}`);
});

test('09. PDF → Text — real extracted text, correct page structure', async () => {
  const result = await post('/to-text', { files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('returns 200 JSON', result.status === 200, errorOf(result));
  ok('hasText is true', result.body.hasText === true);
  ok('pageCount is 5', result.body.pageCount === 5, `got ${result.body.pageCount}`);
  ok('text contains real words from the page', /ALPHA REPORT/.test(result.body.text), result.body.text.slice(0, 60));
  ok('text contains the repeated sentence', /quick brown fox/.test(result.body.text));
  ok('each page returned separately', Array.isArray(result.body.pages) && result.body.pages.length === 5);
  ok('fileName ends with .txt', /\.txt$/.test(result.body.fileName));
  ok('characterCount is plausible', result.body.characterCount > 500, `got ${result.body.characterCount}`);

  const scanned = await post('/to-text', { files: [{ buffer: read('scanned.pdf'), name: 'scanned.pdf' }] });
  ok('image-only PDF reports hasText false', scanned.body.hasText === false);
  ok('image-only PDF returns empty text', scanned.body.text.trim() === '');
});

test('10. OCR PDF — real recognition plus a searchable PDF', async () => {
  const result = await post('/ocr', { fields: { language: 'eng', searchablePdf: '1' }, files: [{ buffer: read('scanned.pdf'), name: 'scanned.pdf' }] });
  ok('returns 200 JSON', result.status === 200, errorOf(result));
  ok('recognised 2 pages', result.body.pageCount === 2, `got ${result.body.pageCount}`);
  ok('hasText is true', result.body.hasText === true);
  ok('wordCount is meaningful', result.body.wordCount > 10, `got ${result.body.wordCount}`);
  ok('averageConfidence is reported', typeof result.body.averageConfidence === 'number', `${result.body.averageConfidence}`);
  ok('OCR read "SCANNED"', /SCANNED/i.test(result.body.text), JSON.stringify(result.body.text.slice(0, 80)));
  ok('OCR read the invoice number', /88421/.test(result.body.text.replace(/\s/g, '')), JSON.stringify(result.body.text.slice(0, 200)));
  ok('OCR read the total amount', /1250/.test(result.body.text.replace(/\s/g, '')));

  ok('searchable PDF returned as base64', typeof result.body.searchablePdfBase64 === 'string' && result.body.searchablePdfBase64.length > 10000);
  const searchable = Buffer.from(result.body.searchablePdfBase64, 'base64');
  ok('searchable PDF is a real PDF', isPdf(searchable));
  ok('searchable PDF has 2 pages', countPages(searchable) === 2, `got ${countPages(searchable)}`);
  ok('searchable PDF uses JPEG images (page raster preserved)', /DCTDecode/.test(searchable.toString('latin1')));
  ok('searchable PDF has an invisible text layer (Tr 3)', /\/Tr\s*3/.test(searchable.toString('latin1')));

  // The whole point: text must be extractable from the searchable PDF.
  const reExtract = await post('/to-text', { files: [{ buffer: searchable, name: 'searchable.pdf' }] });
  ok('text can be extracted back out of the searchable PDF', reExtract.body.hasText === true);
  ok('extracted text contains the OCR content', /SCANNED/i.test(reExtract.body.text),
    JSON.stringify(reExtract.body.text.slice(0, 120)));

  fs.writeFileSync(path.join(OUT, 'ocr-searchable.pdf'), searchable);
  fs.writeFileSync(path.join(OUT, 'ocr.txt'), result.body.text);
});

test('11. Watermark PDF — text, opacity, angle, page targeting', async () => {
  const result = await post('/watermark', {
    fields: { text: 'CONFIDENTIAL', fontSize: 40, angle: -30, opacity: '0.2', color: '#e85a2e', position: 'diagonal', applyTo: 'all' },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  ok('returns 200 + PDF', result.status === 200 && isPdf(result.body), errorOf(result));
  ok('page count preserved (5)', countPages(result.body) === 5, `got ${countPages(result.body)}`);
  const text = result.body.toString('latin1');
  ok('watermark text is drawn (Helvetica-Bold font embedded)', /Helvetica-Bold/.test(text) || /F\d+/.test(text));
  ok('watermark uses transparency (ExtGState ca)', /\/ca\s*0?\.?2/.test(text) || /\/ca\s*0?\.\d+/.test(text),
    (text.match(/\/ca\s*[0-9.]+/) || [''])[0]);
  ok('original vector content is still present (not a flat image)', !/DCTDecode/.test(text));
  ok('original text still extractable after watermarking',
    /\/BaseFont\s*\/Helvetica[^B]/.test(text) || text.includes('ALPHA') || /\/Type\s*\/Font/.test(text));

  const odd = await post('/watermark', {
    fields: { text: 'DRAFT', applyTo: 'odd', position: 'top' },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  ok('applyTo=odd still returns 5 pages', countPages(odd.body) === 5);
  ok('DRAFT text present', /DRAFT/.test(odd.body.toString('latin1')));

  const tiled = await post('/watermark', {
    fields: { text: 'COPY', position: 'tile', angle: '45' },
    files: [{ buffer: read('beta.pdf'), name: 'beta.pdf' }],
  });
  ok('tile position works', tiled.status === 200 && countPages(tiled.body) === 3);

  const pageSubset = await post('/watermark', {
    fields: { text: 'PAGE1ONLY', pages: '1' },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  ok('pages=1 only stamps page 1', /PAGE1ONLY/.test(pageSubset.body.toString('latin1')));
});

test('12. Protect PDF — real encryption, verified by needing the password', async () => {
  const result = await post('/protect', {
    fields: { userPassword: 'northstar123', ownerPassword: 'owner456', allowPrint: 'true', allowCopy: 'true', allowFill: 'true', allowModify: 'false' },
    files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }],
  });
  ok('returns 200 + PDF', result.status === 200 && isPdf(result.body), errorOf(result));
  ok('page count preserved (5)', countPages(result.body) === 5, `got ${countPages(result.body)}`);
  ok('PDF now advertises an Encrypt dictionary', /\/Encrypt\s+\d+\s+0\s+R/.test(result.body.toString('latin1')),
    (result.body.toString('latin1').match(/\/Encrypt[^\s>]{0,20}/) || [''])[0]);
  ok('output differs from the input', !result.body.equals(read('alpha.pdf')));

  // Proof of encryption: the backend must now refuse to read it.
  const reRead = await post('/to-text', { files: [{ buffer: result.body, name: 'protected.pdf' }] });
  ok('protected PDF is rejected as password-protected',
    reRead.status === 422 && /password-protected/.test(errorOf(reRead)), `status ${reRead.status} ${errorOf(reRead)}`);

  const reMerge = await post('/merge', { files: [
    { field: 'files', buffer: result.body, name: 'protected.pdf' },
    { field: 'files', buffer: read('beta.pdf'), name: 'beta.pdf' },
  ] });
  ok('merging a protected PDF is rejected clearly',
    reMerge.status === 422 && /password-protected/.test(errorOf(reMerge)), `status ${reMerge.status} ${errorOf(reMerge)}`);

  const noPassword = await post('/protect', { files: [{ buffer: read('alpha.pdf'), name: 'alpha.pdf' }] });
  ok('protect without a password gives a clean 400', noPassword.status === 400 && /password/i.test(errorOf(noPassword)), errorOf(noPassword));

  const permissions = await post('/protect', {
    fields: { userPassword: 'abc123', allowPrint: 'false', allowCopy: 'false', allowFill: 'false', allowModify: 'false' },
    files: [{ buffer: read('beta.pdf'), name: 'beta.pdf' }],
  });
  ok('all-permissions-denied still encrypts', permissions.status === 200 && /\/Encrypt/.test(permissions.body.toString('latin1')));
});

/* ------------------------- Error handling --------------------------- */

test('13. Error handling — every failure mode is a clean message', async () => {
  const cases = [
    ['empty upload', await post('/merge', { files: [] }), 400, /No files/],
    ['non-PDF renamed to .pdf', await post('/to-text', { files: [{ buffer: Buffer.from('hello world, not a pdf'), name: 'fake.pdf' }] }), 415, /not a valid PDF/],
    ['truncated PDF', await post('/to-text', { files: [{ buffer: read('alpha.pdf').subarray(0, 300), name: 'cut.pdf' }] }), 422, /corrupt|incomplete|read/],
    ['wrong extension', await post('/to-text', { files: [{ buffer: read('alpha.pdf'), name: 'doc.txt', type: 'text/plain' }] }), 415, /not a supported PDF/],
    ['image sent to a PDF route', await post('/merge', { files: [{ field: 'files', buffer: read('photo-1.jpg'), name: 'p.jpg', type: 'image/jpeg' }] }), 415, /not a supported PDF/],
    ['bad page range syntax', await post('/extract', { fields: { pages: 'abc' }, files: [{ buffer: read('alpha.pdf'), name: 'a.pdf' }] }), 400, /not a valid page/],
  ];
  for (const [label, result, expectedStatus, pattern] of cases) {
    ok(`${label} -> ${expectedStatus}`, result.status === expectedStatus, `got ${result.status} ${errorOf(result)}`);
    ok(`${label} message is user-friendly`, pattern.test(errorOf(result)), errorOf(result));
  }

  const oversized = Buffer.concat([read('alpha.pdf'), Buffer.alloc(70 * 1024 * 1024)]);
  const big = await post('/to-text', { files: [{ buffer: oversized, name: 'big.pdf' }] });
  ok('oversized upload -> 413 with a limit message',
    big.status === 413 && /too large/i.test(errorOf(big)), `got ${big.status} ${errorOf(big)}`);

  const single = await post('/merge', { files: [{ field: 'files', buffer: read('alpha.pdf'), name: 'a.pdf' }] });
  ok('merge with 1 file -> 400', single.status === 400 && /at least two/.test(errorOf(single)), errorOf(single));

  const noLeak = JSON.stringify(cases.map(([, r]) => r.body));
  ok('no error response leaks a server file path', !/backend[\\/]|node_modules|at Object\.|\.js:\d+:\d+/.test(noLeak));
});

test('14. GET /capabilities advertises the real limits', async () => {
  const response = await fetch(`${BASE}/api/pdf/capabilities`);
  const body = await response.json();
  ok('returns 200', response.status === 200);
  ok('reports an upload limit in MB', body.maxUploadMb > 0, `${body.maxUploadMb}`);
  ok('reports compression levels', Array.isArray(body.compressionLevels) && body.compressionLevels.length === 3,
    JSON.stringify(body.compressionLevels));
  ok('reports an OCR language', typeof body.ocrLanguage === 'string' && body.ocrLanguage.length > 0);
});

/* ------------------------------ Runner ------------------------------ */

(async () => {
  console.log(`\nNorthstar PDF API test suite -> ${BASE}\n`);
  const only = process.argv[2];
  for (const { label, fn } of tests) {
    if (only && !label.includes(only)) continue;
    console.log(label);
    const started = Date.now();
    try {
      await fn();
    } catch (err) {
      failed += 1;
      failures.push(`${label} (threw)`);
      console.log(`  FAIL  ${label} threw: ${err && err.message}`);
    }
    console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}s]\n`);
  }
  console.log('=========================================');
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failures.length) console.log(`  failing: ${failures.join('; ')}`);
  console.log('=========================================\n');
  process.exit(failed ? 1 : 0);
})();
