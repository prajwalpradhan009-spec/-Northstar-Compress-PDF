const archiverModule = require('archiver');
// archiver v7+ ships as ESM; requiring it from CommonJS yields a namespace
// whose default export is the factory function.
const archiver = typeof archiverModule === 'function' ? archiverModule : (archiverModule.default || null);

/**
 * Build an in-memory ZIP from generated files.
 * Used whenever a tool produces more than one download (split parts, page images).
 */
function buildZip(files, { prefix = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!archiver) {
      reject(new Error('The ZIP builder is unavailable on this server.'));
      return;
    }
    if (!Array.isArray(files) || !files.length) {
      reject(new Error('No files to archive.'));
      return;
    }
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    for (const file of files) {
      if (!file || !file.buffer || !file.buffer.length) continue;
      const name = prefix ? `${prefix}/${file.name}` : file.name;
      archive.append(file.buffer, { name, date: new Date() });
    }
    archive.finalize();
  });
}

module.exports = { buildZip };
