import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle, ArrowDown, ArrowRight, ArrowUp, Droplets, Eye, EyeOff,
  FileImage, FilePlus2, FileText, FileType2, ImagePlus, LayoutDashboard, Lock,
  LockKeyhole, Merge, Moon, Package, RotateCw, Scissors, ScanText, ShieldCheck,
  Sparkles, Sun, Upload, X, Zap,
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import {
  buildPdfFromWorkspace, compressPdf, getPageCount, imagesToPdf, mergePdfs,
  parseRanges, pdfToImages, pdfToText, protectPdf, renderPage, splitPdf,
  watermarkPdf,
} from './lib/pdfTools';
import { downloadBlob, exactFileSize, formatBytes, getProfilePhoto, recordActivity, saveFileToDatabase } from './lib/util';
import { runOcr } from './lib/ai';
import PdfWorkspace from './components/PdfWorkspace';
import ImageStudio from './components/ImageStudio';
import AiPanel from './components/AiPanel';
import Dashboard from './components/Dashboard';
import Avatar from './components/Avatar';

const API_BASE = import.meta.env.VITE_API_URL || '';

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const pdfTools = [
  { id: 'merge', label: 'Merge PDF', icon: Merge, kind: 'merge', desc: 'Combine two or more files into one document' },
  { id: 'compress', label: 'Compress PDF', icon: Package, kind: 'single', desc: 'Rebuild pages to shrink file size' },
  { id: 'split', label: 'Split PDF', icon: Scissors, kind: 'single', desc: 'Extract a range or split into separate files' },
  { id: 'organize', label: 'Organize PDF', icon: LayoutGridIcon, kind: 'single', desc: 'Reorder, remove, and rotate pages' },
  { id: 'rotate', label: 'Rotate PDF', icon: RotateCw, kind: 'single', desc: 'Rotate any pages 90°, 180°, or 270°' },
  { id: 'extract', label: 'Extract Pages', icon: FilePlus2, kind: 'single', desc: 'Pull selected pages into a new PDF' },
  { id: 'pdf-to-image', label: 'PDF → JPG', icon: FileImage, kind: 'single', desc: 'Export every page as a raster image' },
  { id: 'images-to-pdf', label: 'JPG → PDF', icon: ImagePlus, kind: 'images', desc: 'Turn images into a single PDF' },
  { id: 'pdf-to-text', label: 'PDF → Text', icon: FileType2, kind: 'single', desc: 'Extract the text layer to a .txt file' },
  { id: 'ocr', label: 'OCR PDF', icon: ScanText, kind: 'single', desc: 'Recognize text from scanned pages' },
  { id: 'watermark', label: 'Watermark PDF', icon: Droplets, kind: 'single', desc: 'Add a text watermark across pages' },
  { id: 'protect', label: 'Protect PDF', icon: Lock, kind: 'single', desc: 'Encrypt with a password and permissions' },
];

function LayoutGridIcon({ size }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>;
}

const toolMix = [
  { label: 'Edit & arrange', value: 5, color: '#2fb0ff', color2: '#4f7cff' },
  { label: 'Convert & compress', value: 4, color: '#2ee6ab', color2: '#17b98c' },
  { label: 'Security', value: 2, color: '#ff9838', color2: '#ffca3d' },
  { label: 'AI & OCR', value: 1, color: '#9d5cff', color2: '#c86bff' },
];

const toolAccents = {
  merge: ['#2fb0ff', '#4f7cff'],
  compress: ['#17b98c', '#2ee6ab'],
  split: ['#ff9838', '#ffca3d'],
  organize: ['#9d5cff', '#c86bff'],
  rotate: ['#26c7d4', '#4fb3ff'],
  extract: ['#ff5b5b', '#ff8a4d'],
  'pdf-to-image': ['#ff4f9a', '#ff7ac2'],
  'images-to-pdf': ['#3aaf7c', '#a3e635'],
  'pdf-to-text': ['#f2545b', '#ff8a5b'],
  ocr: ['#5567ff', '#8a6bff'],
  watermark: ['#3f7cff', '#57b6ff'],
  protect: ['#22c55e', '#7ee787'],
};

function Reveal({ as: Tag = 'div', children, className = '', delay = 0, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element.classList.add('revealed');
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <Tag ref={ref} className={`reveal ${className}`.trim()} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...rest}>{children}</Tag>;
}

function HBarChart({ data }) {
  const width = 460;
  const barHeight = 16;
  const gap = 18;
  const labelWidth = 132;
  const valueWidth = 34;
  const plotWidth = width - labelWidth - valueWidth - 8;
  const chartHeight = data.length * (barHeight + gap) + 6;
  const max = Math.max(...data.map((item) => item.value));
  const gid = 'hbar-mix';
  return (
    <svg className="hbar-chart" viewBox={`0 0 ${width} ${chartHeight}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="PDF tool mix by category">
      <defs>
        {data.map((item, index) => (
          <linearGradient key={item.label} id={`${gid}-${index}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={item.color} />
            <stop offset="1" stopColor={item.color2} />
          </linearGradient>
        ))}
      </defs>
      {data.map((item, index) => {
        const y = 4 + index * (barHeight + gap);
        const barWidth = (item.value / max) * plotWidth;
        return (
          <g key={item.label}>
            <text className="hbar-label" x={0} y={y + barHeight - 1}>{item.label}</text>
            <rect className="hbar-track" x={labelWidth} y={y} width={plotWidth} height={barHeight} rx={barHeight / 2} />
            <rect className="hbar-bar" x={labelWidth} y={y} width={barWidth} height={barHeight} rx={barHeight / 2} fill={`url(#${gid}-${index})`} />
            <text className="hbar-value" x={width - 4} y={y + barHeight - 1} textAnchor="end">{item.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ data, centerValue, centerLabel, size = 146, thickness = 17 }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  let cursor = 0;
  return (
    <svg className="donut-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel}: ${centerValue}`}>
      <circle className="donut-track" cx={cx} cy={cx} r={radius} fill="none" strokeWidth={thickness} />
      {data.map((item) => {
        const len = (item.value / total) * circumference;
        const segment = (
          <circle
            key={item.label}
            className="donut-segment"
            cx={cx}
            cy={cx}
            r={radius}
            fill="none"
            strokeWidth={thickness}
            stroke={item.color}
            strokeDasharray={`${len} ${circumference - len}`}
            strokeDashoffset={-cursor}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        );
        cursor += len;
        return segment;
      })}
      <text className="donut-value" x="50%" y="50%" textAnchor="middle" dy="-0.35em">{centerValue}</text>
      <text className="donut-label" x="50%" y="50%" textAnchor="middle" dy="1.1em">{centerLabel}</text>
    </svg>
  );
}

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try { return (localStorage.getItem('northstar_theme') || 'dark') === 'dark'; } catch { return true; }
  });
  const [activeTab, setActiveTab] = useState('tools');
  const [pdfTool, setPdfTool] = useState('compress');

  // Auth
  const [authMode, setAuthMode] = useState('login');
  const [authOpen, setAuthOpen] = useState(false);
  const [authData, setAuthData] = useState({ name: '', email: '', password: '' });
  const [authLoading, setAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [user, setUser] = useState(null);
  const [headerHidden, setHeaderHidden] = useState(false);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 760px)');
    let lastY = window.scrollY;
    const onScroll = () => {
      if (!mobile.matches) {
        setHeaderHidden(false);
        return;
      }
      const y = window.scrollY;
      if (y > 80 && y > lastY) setHeaderHidden(true);
      else if (y < lastY) setHeaderHidden(false);
      lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Shared single-PDF workspace
  const [wFile, setWFile] = useState(null);
  const [wPages, setWPages] = useState(null);
  const [wDirty, setWDirty] = useState(false);
  const wPagesRef = useRef(null);
  const wDirtyRef = useRef(false);

  // Multi-file tools
  const [pdfs, setPdfs] = useState([]);
  const [imagesFiles, setImagesFiles] = useState([]);

  // Tool settings
  const [cQuality, setCQuality] = useState(82);
  const [cScale, setCScale] = useState(1);
  const [cFormat, setCFormat] = useState('JPG');
  const [splitRanges, setSplitRanges] = useState('');
  const [imgFormat, setImgFormat] = useState('JPG');
  const [imgScale, setImgScale] = useState(2);
  const [pdfPageSize, setPdfPageSize] = useState('A4');
  const [pdfOrientation, setPdfOrientation] = useState('auto');
  const [pdfMargin, setPdfMargin] = useState(24);
  const [wText, setWText] = useState('CONFIDENTIAL');
  const [wFontSize, setWFontSize] = useState(48);
  const [wAngle, setWAngle] = useState(-30);
  const [wOpacity, setWOpacity] = useState(0.18);
  const [wColor, setWColor] = useState('#e85a2e');
  const [wApplyTo, setWApplyTo] = useState('all');
  const [pUserPwd, setPUserPwd] = useState('');
  const [pOwnerPwd, setPOwnerPwd] = useState('');
  const [pAllowPrint, setPAllowPrint] = useState(true);
  const [pAllowCopy, setPAllowCopy] = useState(true);
  const [pAllowFill, setPAllowFill] = useState(true);
  const [pAllowModify, setPAllowModify] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [textOutput, setTextOutput] = useState(null);
  const [ocrOutput, setOcrOutput] = useState(null);
  const [photoTick, setPhotoTick] = useState(0);

  useEffect(() => {
    const sync = () => setPhotoTick((tick) => tick + 1);
    window.addEventListener('northstar-photo-change', sync);
    return () => window.removeEventListener('northstar-photo-change', sync);
  }, []);

  useEffect(() => {
    if (!user) return;
    setPhotoTick((tick) => tick + 1);
  }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const singleRef = useRef(null);
  const mergeRef = useRef(null);
  const imagesRef = useRef(null);

  const tool = pdfTools.find((item) => item.id === pdfTool);
  const fileNameBase = useMemo(() => (wFile?.name ? wFile.name.replace(/\.[^.]+$/, '') : 'document'), [wFile]);
  const pageCount = useMemo(() => (wPages ? wPages.filter((p) => !p.deleted).length : 0), [wPages]);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    try { localStorage.setItem('northstar_theme', darkMode ? 'dark' : 'light'); } catch { /* storage unavailable */ }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', darkMode ? '#0a1211' : '#eef4f1');
  }, [darkMode]);

  useEffect(() => {
    const savedToken = localStorage.getItem('northstar_token');
    if (!savedToken) return;
    const cachedUser = localStorage.getItem('northstar_user');
    if (cachedUser) {
      try {
        setUser(JSON.parse(cachedUser));
      } catch {
        localStorage.removeItem('northstar_user');
      }
    }
    fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${savedToken}` } })
      .then(async (response) => {
        if (response.status === 401) throw new Error('Session is no longer valid.');
        if (!response.ok) return;
        const result = await response.json();
        setUser(result.user);
        localStorage.setItem('northstar_user', JSON.stringify(result.user));
      })
      .catch((error) => {
        if (error.message !== 'Session is no longer valid.') return;
        localStorage.removeItem('northstar_token');
        localStorage.removeItem('northstar_user');
        setUser(null);
      });
  }, []);

  const showNotice = (message, kind = 'success') => setNotice({ message, kind });

  const openTab = (tab) => {
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
    if (authLoading) return;
    setAuthLoading(true);
    try {
      if ((authMode === 'signup' || authMode === 'reset') && !STRONG_PASSWORD_REGEX.test(authData.password)) {
        throw new Error('Use a strong password: at least 8 characters, including uppercase, lowercase, a number, and a symbol like @ # $.');
      }
      let endpoint;
      let body;
      if (authMode === 'login') {
        endpoint = `${API_BASE}/api/auth/login`;
        body = { email: authData.email, password: authData.password };
      } else if (authMode === 'signup') {
        endpoint = `${API_BASE}/api/auth/signup`;
        body = { name: authData.name, email: authData.email, password: authData.password };
      } else if (authMode === 'forgot') {
        endpoint = `${API_BASE}/api/auth/forgot-password`;
        body = { email: authData.email };
      } else {
        endpoint = `${API_BASE}/api/auth/reset-password`;
        body = { token: resetCode.trim(), password: authData.password };
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseText = await response.text();
      let result = {};
      try {
        result = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(response.ok ? 'The server returned an invalid response.' : 'The backend server is not available. Start the backend and try again.');
      }
      if (!response.ok) throw new Error(result.error || 'Authentication failed');

      if (authMode === 'login' || authMode === 'signup') {
        localStorage.setItem('northstar_token', result.token);
        localStorage.setItem('northstar_user', JSON.stringify(result.user));
        setUser(result.user);
        setAuthOpen(false);
        setAuthData({ name: '', email: '', password: '' });
        setResetCode('');
        showNotice(authMode === 'login' ? 'Signed in successfully.' : 'Account created successfully.');
      } else if (authMode === 'forgot') {
        if (result.emailed) {
          setResetCode('');
          setAuthMode('reset');
          showNotice('Reset code sent! Check your inbox and enter it below.');
        } else {
          showNotice('No account found for that email. Check the address and try again.', 'error');
        }
      } else {
        setAuthData({ name: '', email: '', password: '' });
        setResetCode('');
        setAuthMode('login');
        showNotice('Password updated. Log in with your new password.');
      }
    } catch (error) {
      showNotice(error instanceof TypeError ? 'Cannot reach the server. Start the backend and MongoDB, then try again.' : error.message || 'Authentication failed.', 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const addSingleFile = (event) => {
    const selected = [...event.target.files];
    const valid = selected.find((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!valid) {
      showNotice('Please choose a valid PDF file.', 'error');
      event.target.value = '';
      return;
    }
    setWFile(valid);
    setWPages(null);
    setWDirty(false);
    wPagesRef.current = null;
    wDirtyRef.current = false;
    setTextOutput(null);
    setOcrOutput(null);
    event.target.value = '';
  };

  const addMergeFiles = (event) => {
    const selected = [...event.target.files];
    const valid = selected.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (valid.length !== selected.length) showNotice('Only PDF files can be added to the PDF merger.', 'error');
    setPdfs((current) => [...current, ...valid]);
    event.target.value = '';
  };

  const addImagesToPdf = (event) => {
    const selected = [...event.target.files];
    const valid = selected.filter((file) => file.type.startsWith('image/'));
    if (valid.length !== selected.length) showNotice('Only image files can be added here.', 'error');
    setImagesFiles((current) => [...current, ...valid.map((file) => ({ file, id: crypto.randomUUID() }))]);
    event.target.value = '';
  };

  const changeTool = (id, event) => {
    setPdfTool(id);
    setTextOutput(null);
    setOcrOutput(null);
    if (event) event.stopPropagation();
  };

  const onWorkspaceChanged = (pages) => {
    wPagesRef.current = pages;
    const dirty = pages.some((p, index) => p.num !== index + 1 || p.rotation !== 0 || p.deleted);
    wDirtyRef.current = dirty;
    setWPages(pages);
    setWDirty(dirty);
  };

  async function assembleBase(file) {
    if (!wDirtyRef.current || !wPagesRef.current) return new Uint8Array(await file.arrayBuffer());
    return buildPdfFromWorkspace(new Uint8Array(await file.arrayBuffer()), wPagesRef.current);
  }

  const runMerge = async () => {
    if (pdfs.length < 2) return showNotice('Choose at least two PDF files first.', 'error');
    setProcessing(true);
    try {
      const { bytes, blob, name } = await mergePdfs(pdfs);
      if (user) await saveFileToDatabase(blob, name, { operation: 'merge', sourceFiles: pdfs.map((file) => file.name), outputFormat: 'PDF' }).catch(() => {});
      recordActivity('merge', name);
      downloadBlob(blob, name);
      showNotice(`Merged ${pdfs.length} PDFs into ${name}.`);
    } catch (err) {
      console.error(err);
      showNotice(err?.message || 'One of the PDFs could not be processed.', 'error');
      recordActivity('merge', 'merge', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runImagesToPdf = async () => {
    if (!imagesFiles.length) return showNotice('Choose one or more images first.', 'error');
    setProcessing(true);
    try {
      const bytes = await imagesToPdf(imagesFiles.map((item) => item.file), {
        pageSize: pdfPageSize,
        orientation: pdfOrientation,
        margin: Number(pdfMargin) || 0,
      });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const first = imagesFiles[0].file.name.replace(/\.[^.]+$/, '');
      const name = `${first}${imagesFiles.length > 1 ? `_and_${imagesFiles.length - 1}_more` : ''}.pdf`;
      if (user) await saveFileToDatabase(blob, name, { operation: 'images-to-pdf', pageSize: pdfPageSize }).catch(() => {});
      recordActivity('images-to-pdf', name);
      downloadBlob(blob, name);
      showNotice('Images converted to PDF successfully.');
    } catch (err) {
      console.error(err);
      showNotice(err.message || 'Could not create the PDF from your images.', 'error');
      recordActivity('images-to-pdf', 'images', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runCompress = async () => {
    if (!wFile) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    try {
      const base = await assembleBase(wFile);
      const bytes = await compressPdf(base, { scale: cScale, quality: cQuality, format: cFormat });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const name = `${fileNameBase}_compressed.pdf`;
      if (user) await saveFileToDatabase(blob, name, { operation: 'compress', quality: cQuality, scale: cScale }).catch(() => {});
      recordActivity('compress', wFile.name);
      const original = wFile.size;
      showNotice(`Compressed from ${formatBytes(original)} to ${formatBytes(blob.size)} (${Math.round((1 - blob.size / original) * 100)}% smaller).`);
      downloadBlob(blob, name);
    } catch (err) {
      console.error(err);
      showNotice('Could not compress this PDF.', 'error');
      recordActivity('compress', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runSplit = async () => {
    if (!wFile) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    try {
      const base = await assembleBase(wFile);
      const count = await getPageCount(base);
      const hasCustom = splitRanges.trim().length > 0;
      let pages;
      if (hasCustom) {
        pages = parseRanges(splitRanges, count);
        if (!pages.length) throw new Error('No valid page ranges.');
      } else {
        const selected = (wPagesRef.current || []).filter((p) => !p.deleted && p.selected).map((p) => p.num);
        pages = selected.length && selected.length < count ? selected : Array.from({ length: count }, (_, i) => i + 1);
      }
      const results = await splitPdf(base, pages);
      if (!results.length) throw new Error('Nothing to split.');
      results.forEach((part, index) => {
        const pagesLabel = part.pages.length > 1 ? `${part.pages[0]}-${part.pages[part.pages.length - 1]}` : String(part.pages[0]);
        downloadBlob(new Blob([part.bytes], { type: 'application/pdf' }), `${fileNameBase}_part-${index + 1}_p${pagesLabel}.pdf`);
      });
      recordActivity('split', wFile.name);
      showNotice(`${results.length} PDF${results.length === 1 ? '' : 's'} created.`);
    } catch (err) {
      console.error(err);
      showNotice(err.message || 'Could not split this PDF.', 'error');
      recordActivity('split', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runOrganize = async () => {
    const pagesHere = wPagesRef.current || wPages;
    if (!wFile || !pagesHere) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    try {
      const bytes = await buildPdfFromWorkspace(new Uint8Array(await wFile.arrayBuffer()), pagesHere);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const name = `${fileNameBase}_organized.pdf`;
      if (user) await saveFileToDatabase(blob, name, { operation: 'organize', pageCount: pagesHere.length }).catch(() => {});
      recordActivity('organize', wFile.name);
      downloadBlob(blob, name);
      showNotice(`Organized PDF downloaded (${pagesHere.filter((p) => !p.deleted).length} pages).`);
    } catch (err) {
      console.error(err);
      showNotice('Could not organize this PDF.', 'error');
      recordActivity('organize', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runRotate = async () => {
    const pagesHere = wPagesRef.current || wPages;
    if (!wFile || !pagesHere) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    try {
      const bytes = await buildPdfFromWorkspace(new Uint8Array(await wFile.arrayBuffer()), pagesHere);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const name = `${fileNameBase}_rotated.pdf`;
      if (user) await saveFileToDatabase(blob, name, { operation: 'rotate' }).catch(() => {});
      recordActivity('rotate', wFile.name);
      downloadBlob(blob, name);
      showNotice('Rotated PDF downloaded.');
    } catch (err) {
      console.error(err);
      showNotice('Could not rotate this PDF.', 'error');
      recordActivity('rotate', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

const runExtract = async () => {
    const pagesHere = wPagesRef.current || wPages;
    if (!wFile || !pagesHere) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    try {
      const bytes = await buildPdfFromWorkspace(new Uint8Array(await wFile.arrayBuffer()), pagesHere, { onlySelected: true });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const selected = pagesHere.filter((p) => !p.deleted && p.selected).map((p) => p.num);
      const name = `${fileNameBase}_extracted_p${selected.join('-') || 'all'}.pdf`;
      if (user) await saveFileToDatabase(blob, name, { operation: 'extract' }).catch(() => {});
      recordActivity('extract', wFile.name);
      downloadBlob(blob, name);
      showNotice(`Extracted ${selected.length} page${selected.length === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error(err);
      showNotice('Could not extract pages.', 'error');
      recordActivity('extract', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runPdfToImage = async () => {
    if (!wFile) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    try {
      const base = await assembleBase(wFile);
      const images = await pdfToImages(base, { format: imgFormat, scale: imgScale, quality: 92 });
      images.forEach((image) => downloadBlob(image.blob, `${fileNameBase}_${image.name}`));
      recordActivity('pdf-to-image', wFile.name);
      showNotice(`${images.length} page${images.length === 1 ? '' : 's'} exported as ${imgFormat}.`);
    } catch (err) {
      console.error(err);
      showNotice('Could not export pages as images.', 'error');
      recordActivity('pdf-to-image', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runPdfToText = async () => {
    if (!wFile) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    try {
      const base = await assembleBase(wFile);
      const { text } = await pdfToText(base);
      setTextOutput(text);
      if (!text.trim()) return showNotice('No selectable text was found in this PDF. Try the OCR tool.', 'error');
      const blob = new Blob([text], { type: 'text/plain' });
      downloadBlob(blob, `${fileNameBase}.txt`);
      recordActivity('pdf-to-text', wFile.name);
      showNotice('Text extracted and downloaded as a .txt file.');
    } catch (err) {
      console.error(err);
      showNotice('Could not extract text from this PDF.', 'error');
      recordActivity('pdf-to-text', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runOcrTool = async () => {
    if (!wFile) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    setOcrOutput(null);
    try {
      const bytes = new Uint8Array(await wFile.arrayBuffer());
      const count = await getPageCount(bytes);
      const parts = [];
      for (let n = 1; n <= count; n += 1) {
        showNotice(`OCR page ${n} of ${count}…`);
        const canvas = await renderPage(bytes, n, 2);
        const text = await runOcr(canvas, 'eng');
        parts.push(text.trim());
      }
      const full = parts.filter(Boolean).join('\n\n');
      setOcrOutput(full);
      const blob = new Blob([full], { type: 'text/plain' });
      downloadBlob(blob, `${fileNameBase}_ocr.txt`);
      recordActivity('ocr-pdf', wFile.name);
      showNotice('OCR complete — text downloaded.');
    } catch (err) {
      console.error(err);
      showNotice('OCR failed. The OCR engine is downloaded from multiple content-delivery networks — check your network connection, then try again.', 'error');
      recordActivity('ocr-pdf', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runWatermark = async () => {
    if (!wFile) return showNotice('Upload a PDF first.', 'error');
    setProcessing(true);
    try {
      const base = await assembleBase(wFile);
      const bytes = await watermarkPdf(base, {
        text: wText || 'CONFIDENTIAL',
        fontSize: Number(wFontSize) || 48,
        angle: Number(wAngle) || -30,
        opacity: Number(wOpacity) || 0.18,
        color: wColor,
        applyTo: wApplyTo,
      });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const name = `${fileNameBase}_watermarked.pdf`;
      if (user) await saveFileToDatabase(blob, name, { operation: 'watermark' }).catch(() => {});
      recordActivity('watermark', wFile.name);
      downloadBlob(blob, name);
      showNotice('Watermarked PDF downloaded.');
    } catch (err) {
      console.error(err);
      showNotice('Could not watermark this PDF.', 'error');
      recordActivity('watermark', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runProtect = async () => {
    if (!wFile) return showNotice('Upload a PDF first.', 'error');
    if (!pUserPwd && !pOwnerPwd) return showNotice('Set a password to protect this PDF.', 'error');
    setProcessing(true);
    try {
      const bytes = new Uint8Array(await wFile.arrayBuffer());
      const protectedBytes = await protectPdf(bytes, {
        userPassword: pUserPwd,
        ownerPassword: pOwnerPwd,
        permissions: { allowPrint: pAllowPrint, allowCopy: pAllowCopy, allowFill: pAllowFill, allowModify: pAllowModify },
      });
      const blob = new Blob([protectedBytes], { type: 'application/pdf' });
      const name = `${fileNameBase}_protected.pdf`;
      if (user) await saveFileToDatabase(blob, name, { operation: 'protect' }).catch(() => {});
      recordActivity('protect', wFile.name);
      downloadBlob(blob, name);
      showNotice('Password-protected PDF downloaded.');
    } catch (err) {
      console.error(err);
      showNotice('Could not protect this PDF.', 'error');
      recordActivity('protect', wFile?.name || 'pdf', 'Failed');
    } finally {
      setProcessing(false);
    }
  };

  const runTool = () => {
    switch (pdfTool) {
      case 'merge': return runMerge();
      case 'images-to-pdf': return runImagesToPdf();
      case 'compress': return runCompress();
      case 'split': return runSplit();
      case 'organize': return runOrganize();
      case 'rotate': return runRotate();
      case 'extract': return runExtract();
      case 'pdf-to-image': return runPdfToImage();
      case 'pdf-to-text': return runPdfToText();
      case 'ocr': return runOcrTool();
      case 'watermark': return runWatermark();
      case 'protect': return runProtect();
      default: return null;
    }
  };

  const applyLabel = {
    merge: 'MERGE PDFs',
    'images-to-pdf': 'CREATE PDF',
    compress: 'COMPRESS PDF',
    split: 'SPLIT PDF',
    organize: 'APPLY CHANGES',
    rotate: 'SAVE ROTATED',
    extract: 'EXTRACT SELECTED',
    'pdf-to-image': `EXPORT AS ${imgFormat}`,
    'pdf-to-text': 'EXTRACT TEXT',
    ocr: 'RUN OCR',
    watermark: 'WATERMARK PDF',
    protect: 'PROTECT PDF',
  }[pdfTool] || 'APPLY';

  const toolTitles = {
    merge: ['Merge PDF', 'Combine two or more PDFs in the order you choose, right in your browser.'],
    compress: ['Compress PDF', 'Reduce file size by rebuilding every page and optimizing images.'],
    split: ['Split PDF', 'Extract a page range (1-3, 5, 8-10), split every Nth page, or send selected pages to their own files.'],
    organize: ['Organize PDF', 'Reorder, remove, and rotate pages with visual thumbnails.'],
    rotate: ['Rotate PDF', 'Rotate any page 90°, 180°, or 270° using the workspace controls.'],
    extract: ['Extract Pages', 'Select pages in the workspace and export only those pages into a new PDF.'],
    'pdf-to-image': ['PDF → JPG', 'Export each page as a high-resolution JPEG or PNG image.'],
    'images-to-pdf': ['JPG → PDF', 'Combine JPEG, PNG, or WebP images into a single PDF document.'],
    'pdf-to-text': ['PDF → Text', 'Extract the selectable text layer into a plain text file.'],
    ocr: ['OCR PDF', 'Recognize text from scanned pages using optical character recognition.'],
    watermark: ['Watermark PDF', 'Stamp confidential text across every page (or even/odd pages).'],
    protect: ['Protect PDF', 'Encrypt your PDF with a password and set permission flags.'],
  }[pdfTool] || ['PDF Tool', ''];

  const isWorkspaceTool = ['organize', 'rotate', 'extract'].includes(pdfTool);
  const usesWorkspaceBuild = ['compress', 'split', 'pdf-to-image', 'pdf-to-text', 'watermark'].includes(pdfTool);
  const hasBottomBar = tool?.kind !== 'single' || (tool?.kind === 'single' && !isWorkspaceTool);

  const runDisabled = processing || (tool?.kind === 'single' && !wFile) || (tool?.kind === 'merge' && pdfs.length < 2) || (tool?.kind === 'images' && !imagesFiles.length);

  return (
    <main className="app-shell">
      <header className={`topbar${headerHidden ? ' topbar-hidden' : ''}`}>
        <div className="topbar-inner">
          <div className="brand">
            <picture>
              <source srcSet="/northstar-logo.png" type="image/png" />
              <img className="brand-logo" src="/northstar-logo.png" alt="Northstar — PDF tools, image studio, and document AI" />
            </picture>
            <span>NORTHSTAR</span>
          </div>
          <div className="header-actions">
            <button className="icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle color theme" title="Toggle color theme">
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {user ? (
              <div className="user-pill">
                <Avatar email={user.email} name={user.name} className="user-avatar" photo={getProfilePhoto(user.email)} title={`${user.name}'s avatar`} />
                <span>{user.name}</span>
                <button
                  className="logout-button"
                  onClick={() => {
                    localStorage.removeItem('northstar_token');
                    localStorage.removeItem('northstar_user');
                    setUser(null);
                    setActiveTab('tools');
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
        </div>
      </header>

      <section className="intro">
        <div className="hero-copy">
          <Reveal><p className="eyebrow">FILE STUDIO / 01</p></Reveal>
          <Reveal delay={90}>
            <h1>Make every file<br /><em>ready to move.</em></h1>
          </Reveal>
          <Reveal delay={180}>
            <p className="intro-copy">A complete PDF toolbox with an image studio, page workspace, and document AI — all in your browser.</p>
          </Reveal>
          <Reveal delay={260}>
            <div className="hero-actions">
              <a className="primary-button hero-primary" href="#studio" onClick={(event) => { event.preventDefault(); document.querySelector('.studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                Start working <ArrowRight size={17} />
              </a>
              <a className="soft-button hero-secondary" href="#about" onClick={(event) => { event.preventDefault(); document.querySelector('.about')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                About the project
              </a>
            </div>
          </Reveal>
          <Reveal delay={330}>
            <ul className="hero-points">
              <li><ShieldCheck size={15} /> 100% local &amp; private</li>
              <li><Zap size={15} /> Instant, no installation</li>
              <li><Sparkles size={15} /> Built-in AI assistant</li>
            </ul>
          </Reveal>
        </div>

        <Reveal delay={220} className="hero-showcase">
          <aside className="showcase-card" aria-label="Northstar highlights">
            <div className="showcase-top">
              <span className="showcase-live"><i className="live-dot" /> LIVE PREVIEW</span>
              <span className="showcase-tag">FILE STUDIO</span>
            </div>

            <div className="showcase-file">
              <span className="showcase-file-icon"><FileText size={30} /></span>
              <div className="showcase-file-meta">
                <span className="showcase-file-name">Quarterly-Report.pdf</span>
                <span className="showcase-file-size">8.4 MB&nbsp;→&nbsp;<strong>1.9 MB</strong></span>
              </div>
            </div>

            <div className="showcase-bar">
              <span className="showcase-bar-label">COMPRESSED</span>
              <span className="showcase-bar-track"><i style={{ width: '23%' }} /></span>
              <span className="showcase-bar-percent">-77%</span>
            </div>

            <div className="showcase-features">
              <div className="showcase-feature"><span className="feature-chip" style={{ '--fc': '#2fb0ff' }}><Merge size={15} /></span><span>Merge &amp; organize pages</span></div>
              <div className="showcase-feature"><span className="feature-chip" style={{ '--fc': '#2ee6ab' }}><ScanText size={15} /></span><span>OCR — read scanned text</span></div>
              <div className="showcase-feature"><span className="feature-chip" style={{ '--fc': '#ff9838' }}><Package size={15} /></span><span>Compress &amp; shrink file sizes</span></div>
              <div className="showcase-feature"><span className="feature-chip" style={{ '--fc': '#9d5cff' }}><Lock size={15} /></span><span>Protect, split &amp; watermark</span></div>
            </div>

            <div className="showcase-footer">
              <span><ShieldCheck size={14} /> Client-side only</span>
              <span><Zap size={14} /> Works offline</span>
            </div>
          </aside>
        </Reveal>
      </section>

      <section className="about animated-border" aria-label="About Northstar">
        <div className="about-inner">
          <div className="about-head">
            <span className="about-mark"><Sparkles size={19} /></span>
            <div>
              <p className="section-kicker">ABOUT THE PROJECT</p>
              <h2>Northstar is your private file studio.</h2>
            </div>
          </div>
          <p className="about-text">
            Compress, merge, split, rotate, watermark, and protect PDFs entirely in your browser — nothing is uploaded unless you choose to save a result to your account.
            With the page-by-page workspace, the image studio, and the built-in Northstar AI assistant, you can turn any document into exactly what you need from a single place.
          </p>
          <div className="about-bottom">
            <div className="about-stats">
              <div><strong>12</strong><span>PDF tools</span></div>
              <div><strong>4</strong><span>studios in one app</span></div>
              <div><strong>100%</strong><span>private &amp; local</span></div>
            </div>
            <div className="chart-card">
              <p className="chart-title">TOOL MIX</p>
              <HBarChart data={toolMix} />
            </div>
          </div>
        </div>
      </section>

      <Reveal as="section" className="studio" aria-label="Northstar studio">
        <nav className="tabs" aria-label="Main tools">
          <button className={activeTab === 'tools' ? 'tab active' : 'tab'} onClick={() => openTab('tools')}><FileText size={17} /> PDF tools</button>
          <button className={activeTab === 'image' ? 'tab active' : 'tab'} onClick={() => openTab('image')}><ImagePlus size={17} /> Image studio{!user && <span className="tab-lock"><Lock size={9} /><span className="tab-lock-text">Login required</span></span>}</button>
          <button className={activeTab === 'ai' ? 'tab active' : 'tab'} onClick={() => openTab('ai')}><Sparkles size={17} /> Northstar AI</button>
          <button className={activeTab === 'dashboard' ? 'tab active' : 'tab'} onClick={() => openTab('dashboard')}><LayoutDashboard size={17} /> Dashboard</button>
        </nav>

        <AnimatePresence mode="wait">
          {activeTab === 'image' && (
            <motion.div className="tool-panel" key="image" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <ImageStudio user={user} notify={showNotice} />
            </motion.div>
          )}

          {activeTab === 'ai' && (
            <motion.div className="tool-panel" key="ai" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <AiPanel notify={showNotice} />
            </motion.div>
          )}

          {activeTab === 'dashboard' && (
            <motion.div className="tool-panel" key="dashboard" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Dashboard user={user} notify={showNotice} onNavigate={setActiveTab} />
            </motion.div>
          )}

          {activeTab === 'tools' && (
            <motion.div className="tool-panel pdf-panel" key="tools" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} style={{ '--chip-a': toolAccents[pdfTool]?.[0] || '#17b98c', '--chip-b': toolAccents[pdfTool]?.[1] || '#2ee6ab' }}>
              <p className="section-kicker pdf-tool-kicker">PDF TOOLS</p>
              <h2 className="pdf-title">{toolTitles[0]}</h2>

              <div className="security-strip">
                <span className="security-shield"><Lock size={16} /></span>
                <p>
                  <strong>Private by design</strong>
                  <span>Every tool runs 100% locally in this browser. Nothing is uploaded unless you sign in and save a result — plus built-in Protect (password) and Watermark security.</span>
                </p>
              </div>

              <div className="tool-selector" role="tablist" aria-label="Choose a PDF tool">
                {pdfTools.map((item) => {
                  const [a, b] = toolAccents[item.id] || ['#17b98c', '#2ee6ab'];
                  return (
                    <button
                      key={item.id}
                      role="tab"
                      aria-selected={pdfTool === item.id}
                      className={`tool-chip ${pdfTool === item.id ? 'active' : ''}`}
                      style={{ '--chip-a': a, '--chip-b': b }}
                      onClick={(event) => changeTool(item.id, event)}
                    >
                      <item.icon size={17} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <p className="tool-description">{toolTitles[1]}</p>

              <div className="tool-facts">
                <DonutChart data={toolMix} centerValue="12" centerLabel="PDF tools" />
                <div className="tool-facts-list" role="list" aria-label="PDF tool categories">
                  {toolMix.map((item) => (
                    <div className="fact-row" role="listitem" key={item.label}>
                      <span className="fact-dot" style={{ background: `linear-gradient(135deg, ${item.color}, ${item.color2})` }} />
                      <span className="fact-name">{item.label}</span>
                      <span className="fact-count">{item.value}</span>
                      <span className="fact-track"><i style={{ width: `${(item.value / 12) * 100}%`, background: `linear-gradient(90deg, ${item.color}, ${item.color2})` }} /></span>
                    </div>
                  ))}
                </div>
              </div>

              {tool?.kind === 'merge' && (
                <>
                  <input ref={mergeRef} hidden type="file" accept="application/pdf" multiple onChange={addMergeFiles} />
                  <div className="pdf-upload-card" onClick={() => mergeRef.current?.click()}>
                    <div className="upload-icon-wrap"><Merge size={54} /></div>
                    <div className="upload-text">Drop PDFs here or click to upload</div>
                    <button type="button" className="pdf-select-button" onClick={(event) => { event.stopPropagation(); mergeRef.current?.click(); }}><Upload size={18} /> Choose PDFs</button>
                  </div>
                  {pdfs.length > 0 && (
                    <div className="pdf-files-box">
                      {pdfs.map((file, index) => (
                        <div className="pdf-file-row merge-row" key={`${file.name}-${index}`}>
                          <span className="merge-index">{index + 1}</span>
                          <FileText size={16} />
                          <span>{file.name}</span>
                          <button className="pdf-remove-button" onClick={() => setPdfs((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X size={14} /></button>
                          <div className="merge-move">
                            <button disabled={index === 0} onClick={() => setPdfs((current) => { const next = [...current]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; return next; })} aria-label="Move up"><ArrowUp size={14} /></button>
                            <button disabled={index === pdfs.length - 1} onClick={() => setPdfs((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })} aria-label="Move down"><ArrowDown size={14} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {tool?.kind === 'images' && (
                <>
                  <input ref={imagesRef} hidden type="file" accept="image/*" multiple onChange={addImagesToPdf} />
                  <div className="pdf-upload-card image-upload-card" onClick={() => imagesRef.current?.click()}>
                    <div className="upload-icon-wrap"><ImagePlus size={54} /></div>
                    <div className="upload-text">Drop images here or click to upload</div>
                    <button type="button" className="pdf-select-button" onClick={(event) => { event.stopPropagation(); imagesRef.current?.click(); }}><Upload size={18} /> Choose images</button>
                  </div>
                  {imagesFiles.length > 0 && (
                    <div className="selected-images">
                      {imagesFiles.map(({ file, id }) => (
                        <div className="file-row" key={id}>
                          <ImagePlus className="file-icon" size={20} />
                          <span className="file-name">{file.name}</span>
                          <span className="file-size" title={`Exact size: ${exactFileSize(file.size)}`}><strong>{formatBytes(file.size)}</strong><small>{exactFileSize(file.size)}</small></span>
                          <button className="row-button danger" onClick={() => setImagesFiles((current) => current.filter((item) => item.id !== id))} aria-label={`Remove ${file.name}`}><X size={15} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="resize-px grid-3 pdf-settings">
                    <label>Page size
                      <select value={pdfPageSize} onChange={(event) => setPdfPageSize(event.target.value)}>
                        <option value="auto">Fit image</option>
                        <option value="A4">A4</option>
                        <option value="Letter">Letter</option>
                      </select>
                    </label>
                    <label>Orientation
                      <select value={pdfOrientation} onChange={(event) => setPdfOrientation(event.target.value)}>
                        <option value="auto">Automatic</option>
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </label>
                    <label>Margin (px)<input type="number" min="0" max="200" value={pdfMargin} onChange={(event) => setPdfMargin(event.target.value)} /></label>
                  </div>
                </>
              )}

              {tool?.kind === 'single' && (
                <>
                  <input ref={singleRef} hidden type="file" accept="application/pdf" onChange={addSingleFile} />
                  <div className="pdf-upload-card" onClick={() => singleRef.current?.click()}>
                    <div className="upload-icon-wrap"><Upload size={54} /></div>
                    <div className="upload-text">Drop your PDF here or click to upload</div>
                    <button type="button" className="pdf-select-button" onClick={(event) => { event.stopPropagation(); singleRef.current?.click(); }}><Upload size={18} /> Choose file</button>
                  </div>

                  {wFile && (
                    <div className="single-file-row">
                      <FileText size={18} />
                      <span className="file-name">{wFile.name}</span>
                      <span className="file-size"><strong>{formatBytes(wFile.size)}</strong><small>{exactFileSize(wFile.size)}</small></span>
                      <button className="row-button danger" onClick={() => { setWFile(null); setWPages(null); setWDirty(false); setTextOutput(null); setOcrOutput(null); }} aria-label="Remove PDF"><X size={15} /></button>
                      {wDirty && <span className="workspace-dirty-badge">Workspace edits ready</span>}
                    </div>
                  )}

                  <div className="tool-controls">
                    {pdfTool === 'compress' && (
                      <>
                        <div className="compression-option compact-panel range-panel">
                          <div className="range-line"><span className="compression-label">Image quality</span><span className="range-value-box">{cQuality}%</span></div>
                          <div className="range-wrapper">
                            <input type="range" min="20" max="98" value={cQuality} onChange={(event) => setCQuality(Number(event.target.value))} style={{ '--percent': `${cQuality / 98 * 100}%` }} />
                            <div className="range-scale"><span>20%</span><span>40%</span><span>60%</span><span>80%</span><span>98%</span></div>
                          </div>
                        </div>
                        <div className="compression-option compact-panel range-panel">
                          <div className="range-line"><span className="compression-label">Resolution scale</span><span className="range-value-box">{cScale}×</span></div>
                          <div className="range-wrapper">
                            <input type="range" min="0.5" max="2" step="0.1" value={cScale} onChange={(event) => setCScale(Number(event.target.value))} style={{ '--percent': `${(cScale - 0.5) / 1.5 * 100}%` }} />
                            <div className="range-scale"><span>0.5×</span><span>1×</span><span>1.5×</span><span>2×</span></div>
                          </div>
                        </div>
                        <div className="format-picker output-picker" role="group" aria-label="Rebuild format">
                          <span>Rebuild pages as</span>
                          <div className="format-buttons">
                            {['JPG', 'PNG'].map((type) => <button key={type} type="button" className={cFormat === type ? 'format-button selected' : 'format-button'} onClick={() => setCFormat(type)} aria-pressed={cFormat === type}><span className="format-label">{type}</span></button>)}
                          </div>
                        </div>
                      </>
                    )}

                    {pdfTool === 'split' && (
                      <div className="compression-option compact-panel control-stack">
                        <span className="compression-label">Page ranges</span>
                        <input className="rangetext-input" type="text" value={splitRanges} onChange={(event) => setSplitRanges(event.target.value)} placeholder="e.g. 1-3, 5, 8-10  or  every 2" />
                        <span className="control-hint">Leave empty to split every selected page into its own file. Selected pages in the workspace are used when you don&apos;t type ranges.</span>
                      </div>
                    )}

                    {pdfTool === 'pdf-to-image' && (
                      <>
                        <div className="format-picker output-picker" role="group" aria-label="Output format">
                          <span>Output format</span>
                          <div className="format-buttons">
                            {['JPG', 'PNG'].map((type) => <button key={type} type="button" className={imgFormat === type ? 'format-button selected' : 'format-button'} onClick={() => setImgFormat(type)} aria-pressed={imgFormat === type}><span className="format-label">{type}</span></button>)}
                          </div>
                        </div>
                        <div className="compression-option compact-panel range-panel">
                          <div className="range-line"><span className="compression-label">Export scale</span><span className="range-value-box">{imgScale}×</span></div>
                          <div className="range-wrapper">
                            <input type="range" min="0.5" max="4" step="0.25" value={imgScale} onChange={(event) => setImgScale(Number(event.target.value))} style={{ '--percent': `${(imgScale - 0.5) / 3.5 * 100}%` }} />
                            <div className="range-scale"><span>0.5×</span><span>1×</span><span>2×</span><span>3×</span><span>4×</span></div>
                          </div>
                        </div>
                      </>
                    )}

                    {pdfTool === 'watermark' && (
                      <>
                        <div className="compression-option compact-panel control-stack">
                          <span className="compression-label">Watermark text</span>
                          <input className="rangetext-input" type="text" value={wText} onChange={(event) => setWText(event.target.value)} maxLength={40} />
                        </div>
                        <div className="compression-option compact-panel range-panel">
                          <div className="range-line"><span className="compression-label">Opacity</span><span className="range-value-box">{Math.round(wOpacity * 100)}%</span></div>
                          <div className="range-wrapper">
                            <input type="range" min="0.03" max="0.6" step="0.01" value={wOpacity} onChange={(event) => setWOpacity(Number(event.target.value))} style={{ '--percent': `${wOpacity / 0.6 * 100}%` }} />
                            <div className="range-scale"><span>3%</span><span>20%</span><span>40%</span><span>60%</span></div>
                          </div>
                        </div>
                        <div className="resize-px grid-3">
                          <label>Font size<input type="number" min="12" max="140" value={wFontSize} onChange={(event) => setWFontSize(event.target.value)} /></label>
                          <label>Angle<input type="number" min="-90" max="90" value={wAngle} onChange={(event) => setWAngle(event.target.value)} /></label>
                          <label>Apply to
                            <select value={wApplyTo} onChange={(event) => setWApplyTo(event.target.value)}>
                              <option value="all">All pages</option>
                              <option value="even">Even pages</option>
                              <option value="odd">Odd pages</option>
                            </select>
                          </label>
                        </div>
                        <div className="color-row">
                          <span className="compression-label">Color</span>
                          <input type="color" value={wColor} onChange={(event) => setWColor(event.target.value)} aria-label="Watermark color" />
                        </div>
                      </>
                    )}

                    {pdfTool === 'protect' && (
                      <div className="compression-option compact-panel control-stack">
                        <span className="compression-label"><LockKeyhole size={15} /> Password protection</span>
                        <div className="resize-px grid-2">
                          <label>Open password<input type="password" value={pUserPwd} onChange={(event) => setPUserPwd(event.target.value)} placeholder="Required to open" /></label>
                          <label>Owner password<input type="password" value={pOwnerPwd} onChange={(event) => setPOwnerPwd(event.target.value)} placeholder="Controls permissions" /></label>
                        </div>
                        <div className="perm-box">
                          {[
                            { key: 'pAllowPrint', label: 'Allow printing', value: pAllowPrint, set: setPAllowPrint },
                            { key: 'pAllowCopy', label: 'Allow copying text', value: pAllowCopy, set: setPAllowCopy },
                            { key: 'pAllowFill', label: 'Allow filling forms', value: pAllowFill, set: setPAllowFill },
                            { key: 'pAllowModify', label: 'Allow editing', value: pAllowModify, set: setPAllowModify },
                          ].map((permission) => (
                            <label className="aspect-toggle" key={permission.key}>
                              <input type="checkbox" checked={permission.value} onChange={(event) => permission.set(event.target.checked)} />
                              {permission.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {(isWorkspaceTool || usesWorkspaceBuild || pdfTool === 'ocr' || pdfTool === 'protect') && wFile && (
                    <>
                      <PdfWorkspace
                        file={wFile}
                        showApply={isWorkspaceTool}
                        onLoaded={isWorkspaceTool || usesWorkspaceBuild || pdfTool === 'ocr' ? onWorkspaceChanged : undefined}
                        onChanged={isWorkspaceTool || usesWorkspaceBuild || pdfTool === 'ocr' ? onWorkspaceChanged : undefined}
                        onApply={(pages) => { onWorkspaceChanged(pages); runTool(); }}
                        applyLabel={applyLabel}
                        onNotify={showNotice}
                      />
                      {isWorkspaceTool && (
                        <div className="privacy-note standalone-note workspace-note">
                          <Lock size={14} />
                          <div>
                            <strong>Your files are processed securely.</strong>
                            <span>Changes are built locally in your browser. Nothing is uploaded unless you sign in and save the result to your account.</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {(textOutput !== null || ocrOutput !== null) && (
                <div className="text-output">
                  <div className="ai-result-head">
                    <h3>{pdfTool === 'ocr' ? 'OCR result' : 'Extracted text'}</h3>
                    <button className="ws-button" onClick={() => { setTextOutput(null); setOcrOutput(null); }}><X size={14} /> Dismiss</button>
                  </div>
                  <pre>{textOutput !== null ? textOutput : ocrOutput}</pre>
                </div>
              )}

              {hasBottomBar && (tool?.kind === 'single' ? wFile : tool?.kind === 'merge' ? pdfs.length > 0 : imagesFiles.length > 0) && (
                <div className="pdf-inline-actions">
                  <button className="pdf-start-button" onClick={runTool} disabled={runDisabled}>
                    {processing ? 'Processing...' : applyLabel}
                  </button>
                  <div className="privacy-note">
                    <Lock size={14} />
                    <div>
                      <strong>Your files are processed securely.</strong>
                      <span>Everything runs in this browser on your device. Nothing is uploaded unless you sign in and save a result to your account.</span>
                    </div>
                  </div>
                </div>
              )}

              {!wFile && tool?.kind === 'single' && (
                <div className="privacy-note standalone-note">
                  <Lock size={14} />
                  <div>
                    <strong>Your files are processed securely.</strong>
                    <span>All processing happens locally in your browser. Files stay on this device by default.</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Reveal>

      <AnimatePresence>
        {authOpen && (
          <motion.div className="auth-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAuthOpen(false)}>
            <motion.div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" initial={{ y: 18, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 18, opacity: 0, scale: 0.98 }} onClick={(event) => event.stopPropagation()}>
              <div className="auth-header">
                <div>
                  <h3 id="auth-title">{authMode === 'forgot' ? 'Reset your password' : authMode === 'reset' ? 'Enter reset code' : authMode === 'login' ? 'Welcome back' : 'Create account'}</h3>
                  <p className="auth-subtitle">{authMode === 'forgot' ? 'Enter your account email to receive a reset code.' : authMode === 'reset' ? 'Use the code to set a new password. It expires in 30 minutes.' : authMode === 'login' ? 'Access your Northstar workspace.' : 'Save files, history, and usage to your private dashboard.'}</p>
                </div>
                <button className="close-auth" onClick={() => setAuthOpen(false)} aria-label="Close authentication dialog"><X size={16} /></button>
              </div>
              {(authMode === 'login' || authMode === 'signup') && (
                <div className="auth-switch">
                  <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Log in</button>
                  <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign up</button>
                </div>
              )}
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
                {authMode !== 'forgot' && (
                  <label>
                    <span>Password</span>
                    <span className="password-field">
                      <input name="password" type={showPassword ? 'text' : 'password'} value={authData.password} onChange={handleAuthInput} placeholder={authMode === 'reset' ? 'New password — strong (8+ chars, @ # $, A-Z, a-z, 0-9)' : 'Strong password — 8+ chars with @ # $, A-Z, a-z, 0-9'} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength="8" required />
                      <button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </span>
                  </label>
                )}
                {authMode === 'reset' && (
                  <label>
                    <span>Reset code</span>
                    <input name="resetCode" type="text" value={resetCode} onChange={(event) => setResetCode(event.target.value)} placeholder="Paste the reset code" autoComplete="one-time-code" required />
                  </label>
                )}
                <button className="primary-button auth-submit" type="submit" disabled={authLoading}>
                  {authLoading ? 'Please wait...' : authMode === 'login' ? 'Log in' : authMode === 'signup' ? 'Create account' : authMode === 'forgot' ? 'Send reset code' : 'Set new password'}
                </button>
                {authMode === 'login' && (
                  <button className="forgot-link" type="button" onClick={() => { setResetCode(''); setAuthMode('forgot'); }}>Forgot password?</button>
                )}
                {(authMode === 'forgot' || authMode === 'reset') && (
                  <button className="forgot-link" type="button" onClick={() => { setResetCode(''); setAuthData((current) => ({ ...current, password: '' })); setAuthMode('login'); }}>← Back to log in</button>
                )}
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notice && (
          <div className="notice-root" role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
            <motion.div className={`notice ${notice.kind}`} initial={{ opacity: 0, y: -30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -22, scale: 0.96 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} onAnimationComplete={() => setTimeout(() => setNotice(null), 3400)}>
              {notice.kind === 'error' && <AlertCircle size={20} strokeWidth={2.5} aria-hidden="true" />}
              <span>{notice.message}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={17} /></button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Reveal as="footer">PRIVATE BY DEFAULT <span>•</span> YOUR FILES STAY IN THIS BROWSER</Reveal>
    </main>
  );
}

export default App;