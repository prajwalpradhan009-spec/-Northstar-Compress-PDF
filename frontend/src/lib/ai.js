export function extractTextPreview(text, maxLength = 220) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}…`;
}

const TESSERACT_VERSION = '7.0.0';
const TESSERACT_CORE_VERSION = '7.0.0';
const OCR_LOAD_TIMEOUT_MS = 30000;

function ocrProviders(language) {
  const langPath = (host) => `https://${host}/npm/@tesseract.js-data/${language}/4.0.0_best_int`;
  const workerPath = (host, version) => `https://${host}/npm/tesseract.js@v${version}/dist/worker.min.js`;
  const corePath = (host, version) => `https://${host}/npm/tesseract.js-core@v${version}`;
  return [
    { name: 'jsdelivr', workerPath: workerPath('cdn.jsdelivr.net', TESSERACT_VERSION), corePath: corePath('cdn.jsdelivr.net', TESSERACT_CORE_VERSION), langPath: langPath('cdn.jsdelivr.net') },
    { name: 'gcore', workerPath: workerPath('gcore.jsdelivr.net', TESSERACT_VERSION), corePath: corePath('gcore.jsdelivr.net', TESSERACT_CORE_VERSION), langPath: langPath('gcore.jsdelivr.net') },
    { name: 'unpkg', workerPath: `https://unpkg.com/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`, corePath: `https://unpkg.com/tesseract.js-core@${TESSERACT_CORE_VERSION}`, langPath: langPath('cdn.jsdelivr.net') },
    { name: 'fastly', workerPath: workerPath('fastly.jsdelivr.net', TESSERACT_VERSION), corePath: corePath('fastly.jsdelivr.net', TESSERACT_CORE_VERSION), langPath: langPath('fastly.jsdelivr.net') },
  ];
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || 'Operation'} timed out after ${Math.round(ms / 1000)}s.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function runOcr(canvas, language = 'eng') {
  const { createWorker } = await import('tesseract.js');
  const providers = ocrProviders(language);
  const failures = [];
  for (const provider of providers) {
    let worker = null;
    try {
      worker = await withTimeout(
        createWorker(language, undefined, {
          workerPath: provider.workerPath,
          corePath: provider.corePath,
          langPath: provider.langPath,
        }),
        OCR_LOAD_TIMEOUT_MS,
        `OCR engine load (${provider.name})`
      );
      const { data } = await worker.recognize(canvas);
      return data.text;
    } catch (err) {
      failures.push(`${provider.name}: ${err && err.message ? err.message : String(err)}`);
      if (worker) {
        try {
          await worker.terminate();
        } catch {
          /* ignore */
        }
      }
    }
  }
  const detail = failures.join(' | ');
  throw new Error(`OCR engine could not be downloaded from any CDN (tried ${providers.map((p) => p.name).join(', ')}). ${detail}`);
}