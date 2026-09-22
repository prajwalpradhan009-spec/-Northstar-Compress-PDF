const API_BASE = import.meta.env.VITE_API_URL || '';

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function exactFileSize(bytes) {
  return `${bytes.toLocaleString('en-US')} bytes`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function getAuthToken() {
  return localStorage.getItem('northstar_token');
}

export function authHeaders(extra = {}) {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra;
}

export function getProfilePhoto(email) {
  try {
    return email ? localStorage.getItem(`northstar_photo_${email}`) || null : null;
  } catch {
    return null;
  }
}

export function saveProfilePhoto(email, dataUrl) {
  try {
    if (!email || !dataUrl) return false;
    localStorage.setItem(`northstar_photo_${email}`, dataUrl);
    window.dispatchEvent(new Event('northstar-photo-change'));
    return true;
  } catch {
    return false;
  }
}

export function clearProfilePhoto(email) {
  try {
    if (email) localStorage.removeItem(`northstar_photo_${email}`);
    window.dispatchEvent(new Event('northstar-photo-change'));
  } catch {
    /* ignore */
  }
}

export async function saveFileToDatabase(blob, filename, metadata) {
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('metadata', JSON.stringify(metadata));
  const response = await fetch(`${API_BASE}/api/files`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!response.ok) throw new Error('File could not be saved to the database');
  return response.json();
}

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('northstar_history') || '[]');
  } catch {
    return [];
  }
}

export function recordActivity(operation, fileName, status = 'Completed') {
  const item = { operation, fileName, status, time: Date.now() };
  try {
    const history = loadHistory();
    history.unshift(item);
    localStorage.setItem('northstar_history', JSON.stringify(history.slice(0, 50)));
  } catch {
    /* history is best-effort */
  }
  const token = getAuthToken();
  if (token) {
    try {
      fetch(`${API_BASE}/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ operation, fileName, status }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
  return item;
}

export function timeAgo(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatDate(input) {
  if (!input) return '—';
  try {
    return new Date(input).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

export function opLabel(operation) {
  const labels = {
    merge: 'Merge PDF',
    compress: 'Compress PDF',
    split: 'Split PDF',
    organize: 'Organize PDF',
    rotate: 'Rotate PDF',
    extract: 'Extract Pages',
    'pdf-to-image': 'PDF → Image',
    'image-to-pdf': 'Image → PDF',
    'pdf-to-text': 'PDF → Text',
    'ocr-pdf': 'OCR PDF',
    watermark: 'Watermark PDF',
    protect: 'Protect PDF',
    'images-to-pdf': 'Image → PDF',
    convert: 'Convert Image',
    resize: 'Resize Image',
    compressImage: 'Compress Image',
  };
  return labels[operation] || operation || 'Operation';
}