import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

async function bytesOf(file) {
  return new Uint8Array(await file.arrayBuffer());
}

async function openSource(bytes) {
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

export async function getPageCount(bytes) {
  const doc = await openSource(bytes);
  return doc.numPages;
}

export async function renderPage(bytes, pageNumber, scale = 1.5) {
  const doc = await openSource(bytes);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  await doc.destroy();
  return canvas;
}

export async function renderThumbnails(file, targetWidth = 150) {
  const bytes = await bytesOf(file);
  const doc = await openSource(bytes);
  const thumbs = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    thumbs.push({ width: canvas.width, height: canvas.height, url: canvas.toDataURL('image/jpeg', 0.7) });
  }
  await doc.destroy();
  return thumbs;
}

export function normalizeRotation(angle) {
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

export async function mergePdfs(files) {
  const merged = await PDFDocument.create();
  merged.setTitle('Merged Document — Northstar');
  for (const file of files) {
    let source;
    try {
      source = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        capNumbers: true,
        updateMetadata: false,
      });
    } catch (err) {
      const fileName = file.name || 'file';
      if (String(err?.message || '').toLowerCase().includes('encrypt')) {
        throw new Error(`"${fileName}" is password-protected and can't be merged without its open password.`);
      }
      throw new Error(`Could not read "${fileName}" — it may not be a valid PDF.`);
    }
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  const bytes = await merged.save();
  return { bytes, name: 'Merged_Document.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) };
}

export function parseRanges(input, pageCount) {
  const result = new Set();
  const chunks = String(input || '')
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    if (/^every\s+(\d+)$/i.test(chunk)) {
      const step = Math.max(1, parseInt(chunk.match(/^every\s+(\d+)$/i)[1], 10));
      for (let p = 1; p <= pageCount; p += step) result.add(p);
      continue;
    }
    if (!/^\d+\s*(-\s*\d+)?$/.test(chunk)) continue;
    const [startStr, endStr] = chunk.split('-').map((part) => parseInt(part.replace(/\s/g, ''), 10));
    const start = Math.max(1, startStr);
    const end = Math.min(pageCount, endStr || start);
    for (let p = start; p <= end; p += 1) result.add(p);
  }
  return [...result].sort((a, b) => a - b);
}

export async function extractPages(bytes, pages) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices = pages.map((p) => p - 1).filter((i) => i >= 0 && i < source.getPageCount());
  const copied = await out.copyPages(source, indices);
  copied.forEach((page) => out.addPage(page));
  return out.save();
}

export async function splitPdf(bytes, pages) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, capNumbers: true, updateMetadata: false });
  if (!pages || !pages.length) return [];
  const sorted = [...new Set(pages)].filter((p) => Number.isInteger(p) && p >= 1 && p <= source.getPageCount()).sort((a, b) => a - b);
  if (!sorted.length) return [];

  const groups = [];
  let run = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1] + 1) run.push(sorted[i]);
    else {
      groups.push(run);
      run = [sorted[i]];
    }
  }
  groups.push(run);

  const results = [];
  for (const group of groups) {
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(source, group.map((p) => p - 1));
    copied.forEach((page) => doc.addPage(page));
    results.push({ bytes: await doc.save(), pages: group });
  }
  return results;
}

export async function rotatePdf(bytes, rotations) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices = [];
  const angles = [];
  rotations.forEach((r) => {
    if (r.rotate !== 0) {
      indices.push(r.page - 1);
      angles.push(normalizeRotation(r.rotate));
    }
  });
  const copied = await out.copyPages(source, indices);
  copied.forEach((page, i) => page.setRotation(degrees(angles[i])));
  return out.save();
}

export async function buildPdfFromWorkspace(bytes, pageModels, { onlySelected = false } = {}) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  let models = pageModels.filter((p) => !p.deleted);
  if (onlySelected) {
    const selected = models.filter((p) => p.selected);
    if (selected.length) models = selected;
  }
  if (!models.length) throw new Error('No pages to export.');
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, models.map((p) => p.num - 1));
  copied.forEach((page, i) => {
    const rotation = normalizeRotation(models[i].rotation);
    if (rotation) page.setRotation(degrees(rotation));
  });
  return out.save();
}

export async function compressPdf(bytes, { scale = 1, quality = 82, format = 'JPG' }) {
  const source = await openSource(bytes);
  const out = await PDFDocument.create();
  const mime = format === 'PNG' ? 'image/png' : 'image/jpeg';
  for (let n = 1; n <= source.numPages; n += 1) {
    const canvas = await renderPage(bytes, n, scale);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, format === 'PNG' ? undefined : quality / 100));
    if (!blob) throw new Error('Compression rendering failed.');
    const imageBytes = new Uint8Array(await blob.arrayBuffer());
    const embedded = format === 'PNG' ? await out.embedPng(imageBytes) : await out.embedJpg(imageBytes);
    const page = out.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  await source.destroy();
  return out.save();
}

export async function pdfToImages(bytes, { format = 'JPG', scale = 2, quality = 92 }) {
  const source = await openSource(bytes);
  const mime = format === 'PNG' ? 'image/png' : 'image/jpeg';
  const results = [];
  for (let n = 1; n <= source.numPages; n += 1) {
    const canvas = await renderPage(bytes, n, scale);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, format === 'PNG' ? undefined : quality / 100));
    if (!blob) throw new Error('Page export failed.');
    results.push({ blob, name: `page-${n}.${format === 'PNG' ? 'png' : 'jpg'}` });
  }
  await source.destroy();
  return results;
}

export async function imagesToPdf(files, { pageSize = 'auto', margin = 0, orientation = 'auto' } = {}) {
  const doc = await PDFDocument.create();
  for (const file of files) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      const anyFile = new File([file], file.name || 'image', { type: 'image/png' });
      const url = URL.createObjectURL(anyFile);
      try {
        bitmap = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Image could not be decoded.'));
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const imgW = bitmap.width;
    const imgH = bitmap.height;

    const canvas = document.createElement('canvas');
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext('2d');
    if (ctx.createImageBitmap) {
      ctx.drawImage(bitmap, 0, 0);
    } else {
      ctx.drawImage(bitmap, 0, 0, imgW, imgH);
    }
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('Image encoding failed.');
    const embedded = await doc.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));

    const sizes = { A4: [595.28, 841.89], Letter: [612, 792] };
    const [pw, ph] = sizes[pageSize] || [embedded.width, embedded.height];
    let page = null;
    if (pageSize === 'auto') {
      page = doc.addPage([Math.max(1, embedded.width + margin * 2), Math.max(1, embedded.height + margin * 2)]);
      page.drawImage(embedded, { x: margin, y: margin });
    } else {
      const drawW = Math.max(1, pw - margin * 2);
      const drawH = Math.max(1, ph - margin * 2);
      const fit = Math.min(drawW / embedded.width, drawH / embedded.height);
      const w = embedded.width * fit;
      const h = embedded.height * fit;
      let useLandscape = pw < ph;
      if (orientation !== 'auto') useLandscape = orientation === 'landscape';
      const [fw, fh] = useLandscape ? [Math.max(pw, ph), Math.min(pw, ph)] : [pw, ph];
      page = doc.addPage([fh, fw]);
      page.drawImage(embedded, { x: (fw - w) / 2, y: (fh - h) / 2, width: w, height: h });
    }
  }
  return doc.save();
}

export async function pdfToText(bytes) {
  const doc = await openSource(bytes);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => (item.str ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push(text);
  }
  await doc.destroy();
  return { text: pages.filter(Boolean).join('\n\n'), pages };
}

export function hexToRgba(hex, alpha) {
  let value = String(hex || '#000000').replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const num = parseInt(value, 16) || 0;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export async function watermarkPdf(bytes, { text = 'CONFIDENTIAL', fontSize = 48, angle = -30, opacity = 0.18, color = '#e85a2e', applyTo = 'all' } = {}) {
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const scale = 2;
  for (let n = 1; n <= srcDoc.getPageCount(); n += 1) {
    if ((applyTo === 'even' && n % 2 !== 0) || (applyTo === 'odd' && n % 2 === 0)) {
      const [copied] = await out.copyPages(srcDoc, [n - 1]);
      out.addPage(copied);
      continue;
    }
    const canvas = await renderPage(bytes, n, scale);
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.fillStyle = hexToRgba(color, opacity);
    ctx.font = `900 ${fontSize * scale}px Manrope, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const spacing = fontSize * scale * 2;
    const diag = Math.hypot(W, H);
    const lines = Math.ceil(diag / spacing) + 2;
    for (let i = -lines / 2; i < lines / 2; i += 1) {
      ctx.fillText(text, 0, i * spacing * 1.2);
    }
    ctx.restore();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob) throw new Error('Watermark rendering failed.');
    const embedded = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const page = out.addPage([canvas.width, canvas.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  }
  await srcDoc.destroy();
  return out.save();
}

export async function protectPdf(bytes, { userPassword = '', ownerPassword = '', permissions = {} } = {}) {
  const doc = await PDFDocument.load(bytes);
  doc.encrypt({
    userPassword: userPassword || ownerPassword,
    ownerPassword: ownerPassword || userPassword || undefined,
    permissions: {
      printing: permissions.allowPrint ? 'highResolution' : 'none',
      modifying: permissions.allowModify ? 'lowQuality' : 'none',
      copying: !!permissions.allowCopy,
      annotating: false,
      fillingForms: !!permissions.allowFill,
      contentAccessibility: true,
      documentAssembly: !!permissions.allowModify,
    },
  });
  return doc.save();
}

export { StandardFonts, rgb, degrees };