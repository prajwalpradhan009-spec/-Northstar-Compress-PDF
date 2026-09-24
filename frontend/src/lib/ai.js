export function extractTextPreview(text, maxLength = 220) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}…`;
}

export async function runOcr(canvas, language = 'eng') {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(language);
  try {
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}