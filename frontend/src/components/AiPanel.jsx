import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpenCheck, FileQuestion, FileText, KeyRound, ListChecks, MessageSquareText,
  ScanSearch, Sparkles, Upload, X,
} from 'lucide-react';
import { getPageCount, pdfToText, renderPage } from '../lib/pdfTools';
import { extractTextPreview, runOcr } from '../lib/ai';
import { runGeminiFeature, NOT_FOUND_RESPONSE } from '../lib/gemini';
import { downloadBlob, exactFileSize, formatBytes, recordActivity } from '../lib/util';

const aiFeatures = [
  { id: 'summary', label: 'Summarize', desc: 'Condense the document into key sentences', icon: BookOpenCheck },
  { id: 'keypoints', label: 'Key points', desc: 'Extract the most important statements', icon: KeyRound },
  { id: 'notes', label: 'Generate notes', desc: 'Structured study notes with keywords', icon: ListChecks },
  { id: 'mcqs', label: 'Generate MCQs', desc: 'Multiple-choice questions from the text', icon: FileQuestion },
  { id: 'explain', label: 'Explain document', desc: 'Plain-language explanation of the content', icon: ScanSearch },
  { id: 'ask', label: 'Ask questions', desc: 'Ask anything and get answers from the text', icon: MessageSquareText },
];

const busyLabels = {
  summary: 'Summarizing with Gemini…',
  keypoints: 'Extracting key points with Gemini…',
  notes: 'Generating notes with Gemini…',
  mcqs: 'Creating questions with Gemini…',
  explain: 'Explaining document with Gemini…',
  ask: 'Asking Gemini…',
  ocr: 'Running OCR…',
};

function AiPanel({ notify }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('summary');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const pickFile = async (event) => {
    const selected = [...event.target.files];
    const pdf = selected.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdf) {
      notify('Please choose a PDF file.', 'error');
      return;
    }
    setFile(pdf);
    setResult(null);
    setMode('summary');
    setBusy(true);
    try {
      const { text: extracted, pages: pageTexts } = await pdfToText(new Uint8Array(await pdf.arrayBuffer()));
      setText(extracted);
      setPages(pageTexts);
      if (!extracted.trim()) notify('This PDF contains no selectable text. Try OCR instead.', 'error');
    } catch {
      notify('Could not read the text layers of this PDF.', 'error');
    } finally {
      setBusy(false);
    }
    event.target.value = '';
  };

  const runFeature = async (feature) => {
    setMode(feature);
    setResult(null);
    if (!text.trim()) return notify('This PDF has no readable text.', 'error');
    if (feature === 'ask' && !question.trim()) return notify('Type a question first, then run "Ask questions".', 'error');
    setBusy(true);
    try {
      const output = await runGeminiFeature({ feature, text, question: question.trim(), pages });
      if (feature === 'ask' && !output?.body?.trim()) output.body = NOT_FOUND_RESPONSE;
      setResult(output);
      if (feature !== 'ask') recordActivity(`ai-${feature}`, file?.name || 'document');
    } catch (err) {
      console.error(err);
      notify(err?.message || resultError(feature), 'error');
    } finally {
      setBusy(false);
    }
  };

  const runOcrFlow = async () => {
    if (!file) return notify('Upload a PDF first.', 'error');
    setBusy(true);
    setResult(null);
    setMode('ocr');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const count = await getPageCount(bytes);
      const ocrText = [];
      for (let n = 1; n <= count; n += 1) {
        notify(`OCR page ${n} of ${count}…`);
        const canvas = await renderPage(bytes, n, 2);
        const pageText = await runOcr(canvas, 'eng');
        ocrText.push(pageText.trim());
      }
      const full = ocrText.filter(Boolean).join('\n\n');
      setText(full);
      setPages([full]);
      setResult({ type: 'text', title: 'OCR result', body: full });
      const blob = new Blob([full], { type: 'text/plain' });
      downloadBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}_ocr.txt`);
      recordActivity('ocr-pdf', file.name);
      notify('OCR complete. Text downloaded as a .txt file.');
    } catch (err) {
      console.error(err);
      notify('OCR failed to run. Check your network connection for the OCR engine.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const resultError = (feature) => ({
    summary: 'Could not summarize this document.',
    keypoints: 'Could not extract key points.',
    notes: 'Could not generate notes.',
    mcqs: 'Could not generate questions.',
    explain: 'Could not explain this document.',
    ask: 'Could not answer that question.',
  }[feature] || 'Could not process the document.');

  const exportText = () => {
    if (!result?.body) return;
    const blob = new Blob([result.body], { type: 'text/plain' });
    downloadBlob(blob, `${file?.name?.replace(/\.[^.]+$/, '') || 'document'}_${mode}.txt`);
  };

  return (
    <div>
      <div className="panel-heading">
        <div>
          <p className="section-kicker">NORTHSTAR AI</p>
          <h2>Understand any PDF</h2>
          <p>Upload a document, then summarize, question, and study it with Northstar AI powered by Gemini. Every answer is grounded in your uploaded PDF.</p>
        </div>
        {file && <span className="count">{pages.length} pages</span>}
      </div>

      <input ref={inputRef} hidden type="file" accept="application/pdf" onChange={pickFile} />

      {!file ? (
        <div className="pdf-upload-card ai-upload-card" onClick={() => inputRef.current?.click()}>
          <div className="upload-icon-wrap"><Sparkles size={54} /></div>
          <div className="upload-text">Upload a PDF to analyze</div>
          <button type="button" className="pdf-select-button" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}><Upload size={18} /> Choose PDF</button>
        </div>
      ) : (
        <div className="ai-source-row">
          <FileText size={18} />
          <span className="file-name">{file.name}</span>
          <span className="file-size"><strong>{formatBytes(file.size)}</strong><small>{exactFileSize(file.size)}</small></span>
          <button className="row-button danger" onClick={() => setFile(null)} aria-label="Remove PDF"><X size={15} /></button>
        </div>
      )}

      {file && text.trim() && (
        <div className="ai-preview">
          <span className="ai-preview-label">TEXT EXTRACTED</span>
          <p>{extractTextPreview(text, 240)}</p>
        </div>
      )}
      {file && !text.trim() && !busy && (
        <div className="ai-preview warning">
          <span className="ai-preview-label">NO TEXT LAYER</span>
          <p>This PDF appears to be scanned. Use OCR to read it.</p>
          <button className="primary-button" onClick={runOcrFlow} disabled={busy}><ScanSearch size={16} /> Run OCR</button>
        </div>
      )}

      <div className="ai-features">
        {aiFeatures.map((feature) => (
          <motion.button
            key={feature.id}
            className={`ai-feature ${mode === feature.id ? 'active' : ''}`}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => runFeature(feature.id)}
            disabled={busy || !file || !text.trim()}
          >
            <feature.icon size={20} />
            <span className="ai-feature-label">{feature.label}</span>
            <span className="ai-feature-desc">{feature.desc}</span>
          </motion.button>
        ))}
      </div>

      {mode === 'ask' && (
        <div className="ai-ask-row">
          <input type="text" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Type your question about this document, e.g. 'What is the deadline?'" disabled={busy} onKeyDown={(event) => { if (event.key === 'Enter') runFeature('ask'); }} />
          <button className="primary-button" onClick={() => runFeature('ask')} disabled={busy}><MessageSquareText size={16} /> Ask</button>
        </div>
      )}

      {busy && (
        <div className="ai-thinking" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          <span>{busyLabels[mode] || 'Analyzing document…'}</span>
        </div>
      )}

      {result && (
        <div className="ai-result">
          <div className="ai-result-head">
            <h3>{result.title}</h3>
            <div className="ai-result-actions">
              {result.meta && <span className="ai-meta">{result.meta}</span>}
              {result.type === 'text' && <button className="ws-button" onClick={exportText}><ScanSearch size={14} /> Save .txt</button>}
            </div>
          </div>

          {result.type === 'text' && <p className="ai-result-text">{result.body}</p>}

          {result.type === 'points' && (
            <ol className="ai-points">{result.items.map((point, i) => <li key={i}>{point}</li>)}</ol>
          )}

          {result.type === 'notes' && (
            <div className="ai-notes">
              {result.notes.map((note) => (
                <div className="ai-note" key={note.index}>
                  <span className="ai-note-num">{String(note.index).padStart(2, '0')}</span>
                  <p>{note.body}</p>
                  <div className="ai-note-tags">{note.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div>
                </div>
              ))}
            </div>
          )}

          {result.type === 'mcqs' && (
            <div className="ai-mcqs">
              {result.questions.map((q, qi) => (
                <div className="ai-mcq" key={qi}>
                  <p className="ai-mcq-q"><strong>Q{qi + 1}.</strong> {q.question}</p>
                  <div className="ai-mcq-options">
                    {q.options.map((option, oi) => (
                      <button key={oi} className="ai-mcq-option">
                        <span className="ai-opt-letter">{String.fromCharCode(65 + oi)}</span> {option}
                      </button>
                    ))}
                  </div>
                  <details className="ai-mcq-answer"><summary>Reveal answer</summary><span>{q.answer}</span></details>
                </div>
              ))}
            </div>
          )}

          {result.type === 'explain' && (
            <div className="ai-explain">
              <p className="ai-result-text">{result.explanation}</p>
              <div className="ai-explain-terms">
                {result.definitions.map((d) => (
                  <div className="ai-term" key={d.term}>
                    <strong>{d.term}</strong> <span className="ai-term-count">×{d.count}</span>
                    <p>“{d.context}”</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.type === 'answer' && <p className="ai-result-text answer-text">{result.body}</p>}
        </div>
      )}
    </div>
  );
}

export default AiPanel;