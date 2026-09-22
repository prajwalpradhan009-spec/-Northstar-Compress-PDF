import React, { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Camera, Clock, FileText, FolderOpen, Images, LayoutDashboard, User, X } from 'lucide-react';
import { authHeaders, clearProfilePhoto, formatBytes, formatDate, getProfilePhoto, loadHistory, opLabel, saveProfilePhoto, timeAgo } from '../lib/util';
import Avatar from './Avatar';

const API_BASE = import.meta.env.VITE_API_URL || '';

function EmptyGuide({ icon, title, hint, cta, onNavigate }) {
  return (
    <div className="dash-guide">
      <span className="dash-guide-icon">{icon}</span>
      <div className="dash-guide-copy">
        <strong>{title}</strong>
        <span>{hint}</span>
      </div>
      {cta && (
        <button className="dash-guide-cta" onClick={() => onNavigate && onNavigate('tools')}>
          {cta} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

function Dashboard({ user, notify, onNavigate }) {
  const [files, setFiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState(() => getProfilePhoto(user?.email));
  const photoRef = useRef(null);

  useEffect(() => {
    const sync = () => setPhoto(getProfilePhoto(user?.email));
    window.addEventListener('northstar-photo-change', sync);
    return () => window.removeEventListener('northstar-photo-change', sync);
  }, [user]);

  const onPhotoFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return notify('Choose an image smaller than 5 MB.', 'error');
    if (!file.type.startsWith('image/')) return notify('Please choose an image file.', 'error');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const scale = Math.min(1, size / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/webp', 0.9);
        if (saveProfilePhoto(user.email, dataUrl)) {
          setPhoto(dataUrl);
          notify('Profile photo updated.');
        } else {
          notify('Could not save the photo. Storage is full.', 'error');
        }
      };
      img.onerror = () => notify('Could not read that image.', 'error');
      img.src = reader.result;
    };
    reader.onerror = () => notify('Could not read that image.', 'error');
    reader.readAsDataURL(file);
  };

  const openPhotoPicker = () => {
    const input = photoRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); return; } catch { /* fall through to click */ }
    }
    input.click();
  };

  const removePhoto = () => {
    clearProfilePhoto(user.email);
    setPhoto(null);
    notify('Profile photo removed.');
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/files?owned=true`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_BASE}/api/history`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([fileDocs, historyDocs]) => {
        if (cancelled) return;
        setFiles(fileDocs);
        setHistory(historyDocs);
      })
      .catch(() => {
        if (!cancelled) notify('Could not load dashboard data.', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return (
      <div className="dashboard-login">
        <LayoutDashboard size={34} />
        <h3>Your workspace is private</h3>
        <p>Log in or create an account to see your saved files, processing history, and usage.</p>
      </div>
    );
  }

  const localHistory = loadHistory().map((item) => ({ ...item, local: true }));
  const combined = [
    ...history.map((item) => ({ operation: item.operation, fileName: item.fileName, status: item.status, time: new Date(item.createdAt).getTime() })),
    ...localHistory,
  ]
    .filter((item) => item.operation !== 'ai-mcqs' && item.operation !== 'ai-summary' && item.operation !== 'ai-keypoints' && item.operation !== 'ai-notes' && item.operation !== 'ai-explain' && item.operation !== 'ai-ask')
    .sort((a, b) => (b.time || 0) - (a.time || 0))
    .slice(0, 20);

  const pdfFiles = files.filter((file) => (file.originalName || '').toLowerCase().endsWith('.pdf'));
  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const memberSince = user.createdAt ? formatDate(user.createdAt) : '—';

  return (
    <div className="dashboard">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">DASHBOARD</p>
          <h2>Welcome back, {user.name?.split(' ')[0]}</h2>
          <p>A private overview of your Northstar activity.</p>
        </div>
      </div>
      {loading && <div className="ai-thinking"><span className="loading-spinner" aria-hidden="true" /><span>Loading dashboard…</span></div>}

      <div className="dash-grid">
        <section className="dash-card usage-card">
          <h3><Activity size={16} /> Usage</h3>
          <div className="usage-stats">
            <div><strong>{files.length}</strong><span>saved files</span></div>
            <div><strong>{pdfFiles.length}</strong><span>saved PDFs</span></div>
            <div><strong>{formatBytes(totalBytes)}</strong><span>total storage</span></div>
            <div><strong>{combined.length}</strong><span>operations logged</span></div>
          </div>
        </section>

        <section className="dash-card profile-card">
          <h3><User size={16} /> Profile</h3>
          <div className="profile-photo">
            <div className="profile-pic-wrap">
              <Avatar email={user.email} name={user.name} className="user-avatar" photo={photo} />
              <button type="button" className="photo-upload" onClick={openPhotoPicker} aria-label="Change profile photo" title="Change profile photo"><Camera size={13} /></button>
            </div>
            <div className="profile-photo-actions">
              <strong className="profile-name">{user.name}</strong>
              <span className="profile-email">{user.email}</span>
              <div className="profile-photo-buttons">
                <button type="button" className="photo-button" onClick={openPhotoPicker}><Camera size={13} /> Upload photo</button>
                {photo && <button type="button" className="photo-button" onClick={removePhoto}><X size={13} /> Remove</button>}
              </div>
            </div>
            <input ref={photoRef} type="file" accept="image/*" className="photo-input" onChange={onPhotoFile} />
          </div>
          <dl className="profile-details">
            <div><dt>Member since</dt><dd>{memberSince}</dd></div>
            <div><dt>Account type</dt><dd>Free · local-first</dd></div>
            <div><dt>Storage mode</dt><dd>Browser + account sync</dd></div>
          </dl>
        </section>
      </div>

      <section className="dash-card">
        <h3><Clock size={16} /> Recent activity</h3>
        {combined.length === 0 ? (
          <EmptyGuide
            icon={<Clock size={22} />}
            title="No activity yet"
            hint="Start with any PDF tool — merges, splits, compressions and more will show up here automatically."
            cta="Open PDF tools"
            onNavigate={onNavigate}
          />
        ) : (
          <div className="history-table">
            <div className="history-head"><span>Operation</span><span>File</span><span>Status</span><span>When</span></div>
            {combined.map((item, index) => (
              <div className="history-row" key={`${item.time}-${index}`}>
                <span className="history-op">{opLabel(item.operation)}</span>
                <span className="history-file">{item.fileName}</span>
                <span className={`history-status ${item.status === 'Failed' ? 'failed' : ''}`}>{item.status}</span>
                <span className="history-time">{timeAgo(item.time)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="dash-grid dash-grid-2">
        <section className="dash-card">
          <h3><FileText size={16} /> Saved PDFs</h3>
          {pdfFiles.length === 0 ? (
            <EmptyGuide
              icon={<FileText size={22} />}
              title="No saved PDFs yet"
              hint="Process any PDF while signed in and your finished files will be saved here for later."
              cta="Open PDF tools"
              onNavigate={onNavigate}
            />
          ) : (
            <ul className="dash-files">
              {pdfFiles.slice(0, 8).map((file) => (
                <li key={file._id}>
                  <FileText size={15} />
                  <span className="file-name">{file.originalName}</span>
                  <span className="dash-file-meta">{opLabel(file.operation)}</span>
                  <span className="dash-file-time">{timeAgo(new Date(file.createdAt).getTime())}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-card">
          <h3><FolderOpen size={16} /> Recent files</h3>
          {files.length === 0 ? (
            <EmptyGuide
              icon={<FolderOpen size={22} />}
              title="Your files live here"
              hint="Downloads and converted results are attached to your account automatically when you're signed in."
              cta="Open PDF tools"
              onNavigate={onNavigate}
            />
          ) : (
            <ul className="dash-files">
              {files.slice(0, 8).map((file) => (
                <li key={file._id}>
                  {file.mimeType?.startsWith('image') ? <Images size={15} /> : <FileText size={15} />}
                  <span className="file-name">{file.originalName}</span>
                  <span className="dash-file-time">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="dash-privacy">
        <strong>🔒 Private by default</strong>
        <span>Files are processed in your browser. The database stores only what you choose to save while signed in, and you can clear your history anytime.</span>
        <button className="ws-button" onClick={() => { setHistory([]); localStorage.removeItem('northstar_history'); notify('Your local history was cleared.'); }}><X size={14} /> Clear local history</button>
      </div>
    </div>
  );
}

export default Dashboard;