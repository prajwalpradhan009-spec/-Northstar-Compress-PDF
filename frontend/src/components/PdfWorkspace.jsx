import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Copy, Files, RefreshCw, RotateCw, Shuffle, Trash2,
} from 'lucide-react';
import { renderThumbnails } from '../lib/pdfTools';

function PdfWorkspace({ file, onApply, applyLabel = 'Apply changes', onNotify, onChanged, onLoaded, showApply = true }) {
  const [thumbs, setThumbs] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadedName, setLoadedName] = useState(null);

  useEffect(() => {
    if (file && file !== loadedName) {
      let cancelled = false;
      setLoading(true);
      renderThumbnails(file, 170)
        .then((result) => {
          if (cancelled) return;
          setThumbs(result);
          const initial = result.map((_, index) => ({ num: index + 1, rotation: 0, deleted: false, selected: true }));
          setPages(initial);
          setLoadedName(file);
          onLoaded?.(initial);
        })
        .catch(() => {
          if (!cancelled) onNotify?.('Could not render page previews for this PDF.', 'error');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  const notifyChanged = (next) => {
    setPages(next);
    onChanged?.(next);
  };

  const rotatePage = (num, delta) => {
    notifyChanged(pages.map((p) => (p.num === num ? { ...p, rotation: (p.rotation + delta) % 360 } : p)));
  };

  const rotateAll = (delta) => {
    notifyChanged(pages.map((p) => ({ ...p, rotation: (p.rotation + delta) % 360 })));
  };

  const toggleSelect = (num) => {
    notifyChanged(pages.map((p) => (p.num === num ? { ...p, selected: !p.selected } : p)));
  };

  const selectAll = (value) => {
    notifyChanged(pages.map((p) => ({ ...p, selected: value })));
  };

  const invertSelection = () => {
    notifyChanged(pages.map((p) => ({ ...p, selected: !p.selected })));
  };

  const deletePage = (num) => {
    notifyChanged(pages.map((p) => (p.num === num ? { ...p, deleted: !p.deleted } : p)));
  };

  const movePage = (num, direction) => {
    const current = [...pages];
    const index = current.findIndex((p) => p.num === num);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= current.length) return;
    const [item] = current.splice(index, 1);
    current.splice(nextIndex, 0, item);
    notifyChanged(current);
  };

  const reset = () => {
    notifyChanged(thumbs.map((_, index) => ({ num: index + 1, rotation: 0, deleted: false, selected: true })));
  };

  if (!file) {
    return (
      <div className="workspace-empty">
        <Files size={28} />
        <p>Upload a PDF above to load the page workspace.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="workspace-empty workspace-loading">
        <span className="loading-spinner" aria-hidden="true" />
        <p>Rendering page thumbnails…</p>
      </div>
    );
  }

  const ordered = pages.filter((p) => !p.deleted);
  const selectedCount = ordered.filter((p) => p.selected).length;

  return (
    <div className="workspace">
      <div className="workspace-header">
        <div>
          <p className="section-kicker">PDF WORKSPACE</p>
          <h3 className="workspace-title">{thumbs.length} page{thumbs.length === 1 ? '' : 's'} loaded</h3>
        </div>
        <div className="workspace-actions">
          <button className="ws-button" onClick={() => rotateAll(90)} title="Rotate all pages 90°"><RotateCw size={15} /> Rotate all</button>
          <button className="ws-button" onClick={() => selectAll(false)} disabled={!ordered.some((p) => p.selected)}><Copy size={15} /> Deselect all</button>
          <button className="ws-button" onClick={invertSelection}><Shuffle size={15} /> Invert selection</button>
          <button className="ws-button" onClick={reset}><RefreshCw size={15} /> Reset</button>
        </div>
      </div>

      <div className="workspace-grid">
        {pages.map((page, index) => (
          <motion.div
            key={page.num}
            className={`ws-page ${page.deleted ? 'deleted' : ''} ${page.selected ? 'selected' : ''}`}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <button className="ws-thumb" onClick={() => toggleSelect(page.num)} title={page.deleted ? 'Page removed' : 'Click to select/deselect'}>
              <span className="ws-loader" />
              <img
                src={thumbs[page.num - 1]?.url}
                alt={`Page ${page.num} preview`}
                style={{ transform: `rotate(${page.rotation}deg)` }}
                loading="lazy"
              />
              <span className="ws-page-badge">Page {String(page.num).padStart(2, '0')}</span>
            </button>
            <div className="ws-controls" aria-label={`Controls for page ${page.num}`}>
              <button onClick={() => movePage(page.num, -1)} disabled={index === 0 || page.deleted} aria-label="Move left"><ArrowLeft size={14} /></button>
              <button onClick={() => rotatePage(page.num, 90)} aria-label="Rotate 90°"><RotateCw size={14} /></button>
              <button onClick={() => deletePage(page.num)} className="danger" aria-label={page.deleted ? 'Restore page' : 'Delete page'}>
                <Trash2 size={14} />
              </button>
              <button onClick={() => movePage(page.num, 1)} disabled={index === pages.length - 1 || page.deleted} aria-label="Move right"><ArrowRight size={14} /></button>
            </div>
            <div className="ws-scrim" />
          </motion.div>
        ))}
      </div>

      <div className="workspace-footer">
        <span className="ws-summary">
          {ordered.length} active · {pages.length - ordered.length} removed · {selectedCount} selected
        </span>
        {showApply && (
          <button className="pdf-start-button ws-apply" onClick={() => onApply?.(pages)}>
            <CheckIcon /> {applyLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
}

export default PdfWorkspace;