import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Check, ChevronDown, FilePlus2, FileText, ImagePlus, Moon, Sun, Trash2, Upload, X } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const imageTypes = 'image/jpeg,image/png,image/webp,image/bmp,image/tiff';
const outputTypes = ['JPEG', 'PNG', 'WEBP'];
const pdfOutputTypes = ['PDF', 'JPG', 'PNG', 'PPT'];
const pdfImageMimeTypes = { JPG: 'image/jpeg', PNG: 'image/png' };
const compressionModes = [
  {
    id: 'recommended',
    label: 'Recommended compression',
    description: 'Good quality, good compression',
    badge: 'RECOMMENDED',
  },
  {
    id: 'extreme',
    label: 'Extreme compression',
    description: 'Lower quality, high compression',
    badge: 'BEST COMPRESSION',
  },
  {
    id: 'lossless',
    label: 'Lossless compression',
    description: 'Preserve image quality',
    badge: 'LOSSLESS',
  },
];
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function SourcePicker({ inputRef, label, disabled, onCloudSource }) {
  const [open, setOpen] = useState(false);

  const chooseDevice = () => {
    setOpen(false);
    inputRef.current?.click();
  };

  const chooseCloud = (source) => {
    setOpen(false);
    onCloudSource(source);
  };

  return (
    <div className="source-picker" onClick={(event) => event.stopPropagation()}>
      <button className="source-button" onClick={() => setOpen((value) => !value)} disabled={disabled} aria-expanded={open}>
        <Upload size={18} /> <strong>{label}</strong> <ChevronDown className={open ? 'chevron open' : 'chevron'} size={17} />
      </button>
      {open && <div className="source-menu" role="menu">
        <button onClick={chooseDevice} role="menuitem"><Upload size={18} /> From device <span>All files</span></button>
       
      </div>}
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function exactFileSize(bytes) {
  return `${bytes.toLocaleString('en-US')} bytes`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveFileToDatabase(blob, filename, metadata) {
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('metadata', JSON.stringify(metadata));
  const response = await fetch('http://localhost:4000/api/files', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('File could not be saved to the database');
  return response.json();
}

function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState('pdf');
  const [pdfs, setPdfs] = useState([]);
  const [images, setImages] = useState([]);
  const [format, setFormat] = useState('JPEG');
  const [authMode, setAuthMode] = useState('login');
  const [authOpen, setAuthOpen] = useState(false);
  const [authData, setAuthData] = useState({ name: '', email: '', password: '' });
  const [user, setUser] = useState(null);
  const [pdfFormat, setPdfFormat] = useState('PDF');
  const [quality, setQuality] = useState(82);
  const [compressionMode, setCompressionMode] = useState('recommended');
  const [targetSize, setTargetSize] = useState(60);
  const [targetFileSize, setTargetFileSize] = useState(500);
  const [targetUnit, setTargetUnit] = useState('KB');
  const [processing, setProcessing] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [notice, setNotice] = useState(null);
  const pdfInput = useRef(null);
  const imageInput = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  }, [darkMode]);

  useEffect(() => {
    const savedToken = localStorage.getItem('northstar_token');
    if (!savedToken) return;

    const savedUser = localStorage.getItem('northstar_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('northstar_user');
      }
    }
  }, []);

  const showNotice = (message, kind = 'success') => {
    setNotice({ message, kind });
  };

  const openStudioTab = (tab) => {
    if (tab === 'image' && !user) {
      showNotice('Please sign up or log in before opening Image studio.', 'error');
      setAuthMode('signup');
      setAuthOpen(true);
      return;
    }
    setActiveTab(tab);
  };

  const handleAuthInput = (event) => {
    const { name, value } = event.target;
    setAuthData((current) => ({ ...current, [name]: value }));
  };

  const submitAuth = async () => {
    try {
      const endpoint = authMode === 'login' ? 'http://localhost:4000/api/auth/login' : 'http://localhost:4000/api/auth/signup';
      const body = authMode === 'login'
        ? { email: authData.email, password: authData.password }
        : { name: authData.name, email: authData.email, password: authData.password };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Authentication failed');
      }

      localStorage.setItem('northstar_token', result.token);
      localStorage.setItem('northstar_user', JSON.stringify(result.user));
      setUser(result.user);
      setAuthOpen(false);
      setAuthData({ name: '', email: '', password: '' });
      showNotice(authMode === 'login' ? 'Signed in successfully.' : 'Account created successfully.');
    } catch (error) {
      showNotice(error.message || 'Authentication failed.', 'error');
    }
  };

  const showCloudNotice = (source) => showNotice(`${source} connection needs to be configured first.`, 'error');

  const addPdfs = (event) => {
    const selected = [...event.target.files];
    const valid = selected.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (valid.length !== selected.length) showNotice('Only PDF files can be added to the PDF merger.', 'error');
    setPdfs((current) => [...current, ...valid]);
    event.target.value = '';
  };

  const addImages = (event) => {
    const selected = [...event.target.files];
    const valid = selected.filter((file) => file.type.startsWith('image/'));
    if (valid.length !== selected.length) showNotice('Only image files can be added to Image studio.', 'error');
    const imageFiles = valid.map((file) => ({ file, id: crypto.randomUUID() }));
    setImages((current) => [...current, ...imageFiles]);
    event.target.value = '';
  };

  const movePdf = (index, direction) => {
    setPdfs((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const mergePdfs = async () => {
    if (pdfs.length < 2) {
      showNotice('Choose at least two PDF files first.', 'error');
      return;
    }
    if (pdfFormat === 'PPT') {
      showNotice('PPT export needs a server-side converter.', 'error');
      return;
    }
    setProcessing(true);
    try {
      if (pdfFormat !== 'PDF') {
        let pageCount = 0;
        for (const file of pdfs) {
          const pdfDocument = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
          for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
            const page = await pdfDocument.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.7 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, pdfImageMimeTypes[pdfFormat], 0.92));
            if (!blob) throw new Error('Page export failed');
            pageCount += 1;
            downloadBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}_page-${pageNumber}.${pdfFormat.toLowerCase()}`);
          }
        }
        showNotice(`${pageCount} PDF page${pageCount === 1 ? '' : 's'} downloaded as ${pdfFormat}.`);
        return;
      }
      const merged = await PDFDocument.create();
      for (const file of pdfs) {
        const source = await PDFDocument.load(await file.arrayBuffer());
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
      }
      const blob = new Blob([await merged.save()], { type: 'application/pdf' });
      await saveFileToDatabase(blob, 'Merged_Document.pdf', {
        operation: 'merge',
        sourceFiles: pdfs.map((file) => file.name),
        outputFormat: 'PDF',
      });
      downloadBlob(blob, 'Merged_Document.pdf');
      showNotice('Merged PDF downloaded successfully.');
    } catch (err) {
      console.error(err);
      showNotice('One of the PDFs could not be processed.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const processImages = async () => {
    if (!images.length) {
      showNotice('Choose one or more images first.', 'error');
      return;
    }
    setProcessing(true);
    setImageProgress(0);
    try {
      for (const [{ file }, index] of images.map((item, itemIndex) => [item, itemIndex])) {
        const bitmap = await createImageBitmap(file);
        const mime = format === 'JPEG' ? 'image/jpeg' : format === 'PNG' ? 'image/png' : 'image/webp';
        const originalSize = file.size || 1;
        const percentGoal = Math.min(100, Math.max(1, targetSize));
        const unitMultiplier = targetUnit === 'MB' ? 1024 * 1024 : 1024;
        const fileGoal = Math.max(1, Number(targetFileSize || 1)) * unitMultiplier;
        const targetBytes = Math.min(originalSize * (percentGoal / 100), fileGoal);

        let qualityValue = Math.max(0.05, quality / 100);
        let width = bitmap.width;
        let height = bitmap.height;
        let blob = null;

        for (let attempt = 0; attempt < 18; attempt += 1) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0, width, height);

          blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, qualityValue));
          if (!blob) break;
          if (blob.size <= targetBytes) break;

          if (format === 'PNG') {
            const scale = Math.max(0.55, Math.sqrt(targetBytes / blob.size));
            width = Math.max(64, Math.floor(width * scale));
            height = Math.max(64, Math.floor(height * scale));
            qualityValue = Math.max(0.1, qualityValue * 0.9);
          } else {
            qualityValue = Math.max(0.05, qualityValue * 0.8);
          }
        }

        if (!blob) {
          const fallbackCanvas = document.createElement('canvas');
          fallbackCanvas.width = bitmap.width;
          fallbackCanvas.height = bitmap.height;
          fallbackCanvas.getContext('2d').drawImage(bitmap, 0, 0);
          blob = await new Promise((resolve) => fallbackCanvas.toBlob(resolve, mime, 0.1));
        }

        if (!blob) throw new Error('Image export failed');

        const extension = format.toLowerCase().replace('jpeg', 'jpg');
        const outputName = `${file.name.replace(/\.[^.]+$/, '')}_converted.${extension}`;
        await saveFileToDatabase(blob, outputName, {
          operation: 'convert',
          sourceFile: file.name,
          outputFormat: format,
          quality,
          targetPercent: targetSize,
          targetBytes,
        });
        downloadBlob(blob, outputName);
        setImageProgress(index + 1);
      }
      showNotice(`${images.length} image${images.length === 1 ? '' : 's'} downloaded.`);
    } catch (err) {
      console.error(err);
      showNotice(err.message || 'An image could not be converted in this browser.', 'error');
    } finally {
      setProcessing(false);
      setImageProgress(0);
    }
  };

  const addSamplePdf = async () => {
    try {
      const sampleDoc = await PDFDocument.create();
      const page = sampleDoc.addPage([595, 842]);
      page.drawText('Northstar File Studio - Sample Document', {
        x: 50,
        y: 750,
        size: 18,
      });
      page.drawText(`Page created: ${new Date().toLocaleString()}`, {
        x: 50,
        y: 710,
        size: 12,
      });
      page.drawText('This is a valid PDF generated in-browser for merging.', {
        x: 50,
        y: 680,
        size: 12,
      });
      const pdfBytes = await sampleDoc.save();
      const sampleBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      const sampleFile = new File([sampleBlob], `Sample_${pdfs.length + 1}.pdf`, { type: 'application/pdf' });
      setPdfs((current) => [...current, sampleFile]);
      showNotice('Sample PDF added.');
    } catch (err) {
      console.error(err);
      showNotice('Could not generate sample PDF.', 'error');
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">N</span><span>NORTHSTAR</span></div>
        <div className="header-actions">
          <button className="icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle color theme" title="Toggle color theme">
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {user ? (
            <div className="user-pill">
              <span className="user-avatar">{user.name?.[0]?.toUpperCase() || 'U'}</span>
              <span>{user.name}</span>
              <button
                className="logout-button"
                onClick={() => {
                  localStorage.removeItem('northstar_token');
                  localStorage.removeItem('northstar_user');
                  setUser(null);
                  setActiveTab('pdf');
                }}
              >
                Log out
              </button>
            </div>
          ) : (
            <>
              <button className="soft-button" onClick={() => { setAuthMode('login'); setAuthOpen(true); }}>Log in</button>
              <button className="primary-button auth-button" onClick={() => { setAuthMode('signup'); setAuthOpen(true); }}>Sign up</button>
            </>
          )}
        </div>
      </header>

      <AnimatePresence>
        {authOpen && (
          <motion.div className="auth-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAuthOpen(false)}>
            <motion.div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" initial={{ y: 18, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 18, opacity: 0, scale: 0.98 }} onClick={(event) => event.stopPropagation()}>
              <div className="auth-header">
                <div>
                  <h3 id="auth-title">{authMode === 'login' ? 'Welcome back' : 'Create account'}</h3>
                  <p className="auth-subtitle">{authMode === 'login' ? 'Access your Northstar workspace.' : 'Save your account securely in the database.'}</p>
                </div>
                <button className="close-auth" onClick={() => setAuthOpen(false)} aria-label="Close authentication dialog"><X size={16} /></button>
              </div>

              <div className="auth-switch">
                <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Log in</button>
                <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign up</button>
              </div>

              <form className="auth-form" onSubmit={(event) => { event.preventDefault(); submitAuth(); }}>
                {authMode === 'signup' && (
                  <label>
                    <span>Name</span>
                    <input name="name" type="text" value={authData.name} onChange={handleAuthInput} placeholder="Your name" autoComplete="name" required />
                  </label>
                )}

                <label>
                  <span>Email</span>
                  <input name="email" type="email" value={authData.email} onChange={handleAuthInput} placeholder="you@example.com" autoComplete="email" required />
                </label>

                <label>
                  <span>Password</span>
                  <input name="password" type="password" value={authData.password} onChange={handleAuthInput} placeholder="At least 6 characters" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength="6" required />
                </label>

                <button className="primary-button auth-submit" type="submit">
                  {authMode === 'login' ? 'Log in' : 'Create account'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="intro">
        <p className="eyebrow">FILE STUDIO / 01</p>
        <h1>Make every file<br /><em>ready to move.</em></h1>
        <p className="intro-copy">A focused workspace for combining documents and preparing images, entirely in your browser.</p>
      </section>

      <section className="studio" aria-label="File studio">
        <nav className="tabs" aria-label="Studio tools">
          <button className={activeTab === 'pdf' ? 'tab active' : 'tab'} onClick={() => openStudioTab('pdf')}><FileText size={17} /> PDF merger</button>
          <button className={activeTab === 'image' ? 'tab active' : 'tab'} onClick={() => openStudioTab('image')}><ImagePlus size={17} /> Image studio {!user && <span className="tab-lock">Sign up required</span>}</button>
        </nav>

        <AnimatePresence mode="wait">
          {activeTab === 'pdf' ? (
            <motion.div className="tool-panel pdf-panel" key="pdf" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <p className="section-kicker">PDF TOOL</p>
              <h2 className="pdf-title">Compress PDF</h2>
              <p className="pdf-description">Use this online PDF compressor to reduce the file size of your PDF documents. Make PDFs smaller to send them by email or upload them online.</p>

              <input ref={pdfInput} hidden type="file" accept="application/pdf" multiple onChange={addPdfs} />

              <div className="pdf-upload-card" onClick={() => pdfInput.current?.click()}>
                <div className="upload-icon-wrap">
                  <Upload size={54} />
                </div>
                <div className="upload-text">Drop files here or click to upload</div>
                <button type="button" className="pdf-select-button" onClick={(event) => { event.stopPropagation(); pdfInput.current?.click(); }}>
                  <Upload size={18} /> Choose file
                </button>
              </div>

              <div className="pdf-inline-actions">
                <button className="pdf-start-button" onClick={mergePdfs} disabled={processing}>
                  {processing ? 'Processing...' : 'START'}
                </button>

                <button className="pdf-sample-button" type="button" onClick={addSamplePdf}>
                  + Add sample file
                </button>
              </div>

              {pdfs.length > 0 && (
                <div className="pdf-files-box">
                  {pdfs.map((file, index) => (
                    <div className="pdf-file-row" key={`${file.name}-${index}`}>
                      <FileText size={16} />
                      <span>{file.name}</span>
                      <button className="pdf-remove-button" onClick={() => setPdfs((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="pdf-mode-list">
                <button type="button" className={`pdf-mode-item ${pdfFormat === 'PDF' ? 'selected' : ''}`} onClick={() => setPdfFormat('PDF')}>
                  <span className="mode-radio" />
                  <span className="mode-text">
                    <span className="mode-title">Basic compression</span>
                    <span className="mode-subtitle">Medium file size and high quality</span>
                  </span>
                  <span className="mode-badge">DEFAULT</span>
                </button>

                <button type="button" className={`pdf-mode-item ${pdfFormat === 'JPG' ? 'selected' : ''}`} onClick={() => setPdfFormat('JPG')}>
                  <span className="mode-radio" />
                  <span className="mode-text">
                    <span className="mode-title">Strong compression</span>
                    <span className="mode-subtitle">Small file size and medium quality</span>
                  </span>
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div className="tool-panel" key="image" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="panel-heading"><div><p className="section-kicker">IMAGES</p><h2>Prepare your images</h2><p>Convert a batch to a format that fits the next destination.</p></div><span className="count">{images.length} files</span></div>
              <input ref={imageInput} hidden type="file" accept="image/*" multiple onChange={addImages} />
              <div className="compression-panel">
                {compressionModes.map((mode) => (
                  <motion.button
                    key={mode.id}
                    type="button"
                    layout
                    whileTap={{ scale: 0.99 }}
                    className={`compression-option ${compressionMode === mode.id ? 'active' : ''}`}
                    onClick={() => setCompressionMode(mode.id)}
                    aria-pressed={compressionMode === mode.id}
                  >
                    <span className="compression-radio">
                      <span className="compression-radio-dot" />
                    </span>
                    <span className="compression-copy">
                      <span className="compression-label-row">
                        <span className="compression-label">{mode.label}</span>
                        {compressionMode === mode.id && <span className="compression-badge">{mode.badge}</span>}
                      </span>
                      <span className="compression-description">{mode.description}</span>
                    </span>
                  </motion.button>
                ))}

                <div className="compression-option compact-panel compact-row">
                  <span className="compression-label">Target file size limit</span>
                  <div className="target-size-inline">
                    <input
                      type="number"
                      min="1"
                      max={targetUnit === 'MB' ? 100 : 10240}
                      value={targetFileSize}
                      onChange={(event) => {
                        const val = Number(event.target.value);
                        setTargetFileSize(isNaN(val) || val <= 0 ? 1 : val);
                      }}
                    />
                    <select
                      value={targetUnit}
                      onChange={(event) => setTargetUnit(event.target.value)}
                      aria-label="Target size unit"
                    >
                      <option value="KB">KB</option>
                      <option value="MB">MB</option>
                    </select>
                  </div>
                </div>

                <div className="compression-option compact-panel range-panel">
                  <div className="range-line">
                    <span className="compression-label">Target file size (percentage of original)</span>
                    <span className="range-value-box">{targetSize}%</span>
                  </div>
                  <div className="range-wrapper">
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={targetSize}
                      onChange={(event) => setTargetSize(Number(event.target.value))}
                      style={{ '--percent': `${targetSize}%` }}
                    />
                    <div className="range-scale">
                      <span>1%</span>
                      <span>20%</span>
                      <span>40%</span>
                      <span>60%</span>
                      <span>80%</span>
                      <span>100%</span>
                    </div>
                  </div>
                </div>

                <div className="compression-option compact-panel range-panel quality-panel">
                  <div className="range-line">
                    <span className="compression-label">Quality</span>
                    <span className="range-value-box">{quality}%</span>
                  </div>
                  <div className="range-wrapper quality-range">
                    <input type="range" min="5" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} style={{ '--percent': `${quality}%` }} />
                    <div className="range-scale">
                      <span>5%</span>
                      <span>20%</span>
                      <span>40%</span>
                      <span>60%</span>
                      <span>80%</span>
                      <span>100%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="image-tools footer-row"><SourcePicker inputRef={imageInput} label="Choose images" disabled={processing} onCloudSource={showCloudNotice} /><div className="format-picker" role="group" aria-label="Output format"><span>Format</span><div className="format-buttons">{outputTypes.map((type) => <button key={type} className={format === type ? 'format-button selected' : 'format-button'} onClick={() => setFormat(type)} aria-pressed={format === type} disabled={processing}>{type === 'JPEG' ? 'JPG' : type}</button>)}</div></div></div>
              <div className="image-list">{images.length ? images.map(({ file, id }) => <div className="file-row" key={id}><ImagePlus className="file-icon" size={20} /><span className="file-name">{file.name}</span><span className="file-size" title={`Exact size: ${exactFileSize(file.size)}`}><strong>{formatBytes(file.size)}</strong><small>{exactFileSize(file.size)}</small></span><button className="row-button danger" onClick={() => setImages((current) => current.filter((item) => item.id !== id))} aria-label={`Remove ${file.name}`}><X size={15} /></button></div>) : <div className="empty-state">No images selected yet.</div>}</div>
              <div className="action-bar image-action-bar"><span>{processing ? `Converting image ${imageProgress + 1} of ${images.length}...` : "Exports are downloaded to your browser's download folder."}</span><button className="primary-button" onClick={processImages} disabled={processing}>{processing ? <><span className="loading-spinner" aria-hidden="true" /> Converting...</> : <><Check size={17} /> Convert images</>}</button></div>
              {processing && <div className="conversion-progress" role="progressbar" aria-label="Image conversion progress" aria-valuemin="0" aria-valuemax={images.length} aria-valuenow={imageProgress}><span style={{ width: `${(imageProgress / images.length) * 100}%` }} /></div>}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <AnimatePresence>{notice && <motion.div className={`notice ${notice.kind}`} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 15 }} onAnimationComplete={() => setTimeout(() => setNotice(null), 2600)}>{notice.message}<button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={15} /></button></motion.div>}</AnimatePresence>
      <footer>PRIVATE BY DEFAULT <span>•</span> YOUR FILES STAY IN THIS BROWSER</footer>
    </main>
  );
}

export default App;
