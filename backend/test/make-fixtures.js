const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

const OUT = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

async function makeTextPdf(file, pages, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i += 1) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(label, { x: 50, y: 760, size: 26, font: bold, color: rgb(0.05, 0.1, 0.2) });
    page.drawText(`Page ${i} of ${pages}`, { x: 50, y: 720, size: 14, font });
    page.drawText('The quick brown fox jumps over the lazy dog. '.repeat(8), {
      x: 50, y: 660, size: 11, font, lineHeight: 16, maxWidth: 495,
    });
    page.drawRectangle({ x: 60, y: 400, width: 200 + i * 20, height: 120, color: rgb(0.1, 0.6, 0.9) });
    page.drawText('NORTHSTAR', { x: 70, y: 440, size: 20, font: bold, color: rgb(1, 1, 1) });
  }
  fs.writeFileSync(path.join(OUT, file), await doc.save());
  console.log('wrote', file);
}

async function makeScannedPdf(file, pages) {
  // A PDF whose pages are pure raster images (no text layer) — the OCR case.
  const { createCanvas } = require('@napi-rs/canvas');
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i += 1) {
    const canvas = createCanvas(1240, 1754);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1240, 1754);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(`SCANNED DOCUMENT`, 90, 160);
    ctx.font = '52px sans-serif';
    ctx.fillText(`This is page number ${i}.`, 90, 300);
    ctx.fillText('Invoice number 88421', 90, 400);
    ctx.fillText('Total amount due 1250 USD', 90, 500);
    const jpg = canvas.toBuffer('image/jpeg', 0.9);
    const image = await doc.embedJpg(jpg);
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  fs.writeFileSync(path.join(OUT, file), await doc.save());
  console.log('wrote', file);
}

async function makeJpegs(count) {
  const { createCanvas } = require('@napi-rs/canvas');
  for (let i = 1; i <= count; i += 1) {
    const canvas = createCanvas(900, 1200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = ['#1b2a4a', '#2a1b4a', '#1b4a2a'][i % 3];
    ctx.fillRect(0, 0, 900, 1200);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 96px sans-serif';
    ctx.fillText(`IMAGE ${i}`, 160, 620);
    fs.writeFileSync(path.join(OUT, `photo-${i}.jpg`), canvas.toBuffer('image/jpeg', 0.92));
  }
  console.log(`wrote ${count} jpgs`);
}

async function makeRotatedPdf(file) {
  const doc = await PDFDocument.load(fs.readFileSync(path.join(OUT, file)));
  doc.getPage(0).setRotation(degrees(90));
  fs.writeFileSync(path.join(OUT, 'pre-rotated.pdf'), await doc.save());
  console.log('wrote pre-rotated.pdf');
}

(async () => {
  await makeTextPdf('alpha.pdf', 5, 'ALPHA REPORT');
  await makeTextPdf('beta.pdf', 3, 'BETA SUMMARY');
  await makeTextPdf('big-scan-source.pdf', 1, 'SOURCE');
  await makeScannedPdf('scanned.pdf', 2);
  await makeJpegs(4);
  await makeRotatedPdf('alpha.pdf');
})().catch((e) => { console.error(e); process.exit(1); });
