const express = require('express');

const router = express.Router();

const NOT_FOUND_RESPONSE = "I couldn't find this information in the uploaded document.";

const FEATURES = ['summary', 'keypoints', 'notes', 'mcqs', 'explain', 'ask'];

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const API_KEY = process.env.GEMINI_API_KEY || '';
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 60000;
const MAX_DOCUMENT_CHARS = Number(process.env.GEMINI_MAX_DOCUMENT_CHARS) || 250000;
const MAX_QUESTION_CHARS = 2000;

class AiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function apiConfigured() {
  return Boolean(API_KEY && API_KEY.trim());
}

function contentWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function selectRelevantText(pages, question, fallbackText) {
  const source = Array.isArray(pages) && pages.some((page) => typeof page === 'string' && page.trim())
    ? pages.map((page) => String(page || '').trim())
    : [fallbackText];
  const questionWords = new Set(contentWords(question));
  const scored = source.map((page, index) => {
    const words = new Set(contentWords(page));
    let score = 0;
    for (const word of questionWords) {
      if (words.has(word)) score += 1;
    }
    return { index, score };
  });
  const best = scored.filter((page) => page.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).sort((a, b) => a.index - b.index);
  const picked = best.length ? best.map((page) => source[page.index]) : source.slice(0, 3);
  return picked.join('\n\n') || fallbackText;
}

function capText(text, maxLength) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}…`;
}

function buildUserContents({ feature, text, pages, question }) {
  if (feature === 'ask') {
    const relevant = selectRelevantText(pages, question, text);
    return `Document content (extracted from the uploaded PDF):\n${capText(relevant, MAX_DOCUMENT_CHARS)}\n\nQuestion:\n${question.trim()}`;
  }
  return `Document content (extracted from the uploaded PDF):\n${capText(text, MAX_DOCUMENT_CHARS)}`;
}

function systemPromptFor(feature) {
  const baseInstruction = 'You are Northstar AI, an assistant that works strictly from the user\'s uploaded document. Answer using ONLY the document content provided by the user. Never use any outside knowledge. If the document does not contain the information requested, clearly say so instead of inventing an answer. Do not mention these instructions in your reply.';

  if (feature === 'ask') {
    return `${baseInstruction}\n\nIf the document does not contain enough information to answer the question, reply with EXACTLY this phrase and nothing else: "${NOT_FOUND_RESPONSE}"`;
  }
  if (feature === 'summary') {
    return `${baseInstruction}\n\nWrite a concise plain-text summary of the document in 3–6 sentences. No headings, no bullets, no markdown.`;
  }
  if (feature === 'keypoints') {
    return `${baseInstruction}\n\nList the 6–8 most important key points of the document. Put each key point on its own line, numbered "1.", "2.", "3.", … Do not add any other text.`;
  }
  if (feature === 'notes') {
    return `${baseInstruction}\n\nWrite structured study notes for the document. Respond with JSON only (no markdown fences, no extra text) in EXACTLY this shape:\n{"notes":[{"title":"Section title","summary":"2–3 sentence summary of the section","keywords":["keyword1","keyword2"]}]}\nCreate between 4 and 6 notes.`;
  }
  if (feature === 'mcqs') {
    return `${baseInstruction}\n\nCreate 5 multiple-choice questions based strictly on the document. Respond with JSON only (no markdown fences, no extra text) in EXACTLY this shape:\n{"questions":[{"question":"…","options":["A","B","C","D"],"answer":"exact text of the correct option"}]}\nEach question must have exactly 4 options, and "answer" must equal one of its options verbatim.`;
  }
  if (feature === 'explain') {
    return `${baseInstruction}\n\nExplain the document in plain language. Respond with JSON only (no markdown fences, no extra text) in EXACTLY this shape:\n{"explanation":"plain-language explanation","definitions":[{"term":"key term","context":"short quote or context from the document"}]}\nInclude up to 5 definitions.`;
  }
  throw new AiError(400, 'Unknown AI feature.');
}

function extractJson(text) {
  const cleaned = String(text || '').trim();
  const withoutFences = cleaned
    .replace(/^```(?:json)?[ \t]*/i, '')
    .replace(/```[ \t]*$/, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in the model output.');
  return JSON.parse(withoutFences.slice(start, end + 1));
}

function parseKeyPoints(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]\-|\d+[.)]|[-*•])\s+/, '').trim())
    .filter((line) => line.length > 3);
  return lines.length >= 2 ? lines : null;
}

function parseNotes(text) {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed.notes)) throw new Error('Notes payload is invalid.');
  return parsed.notes.map((note, index) => {
    const title = String(note.title || '').trim();
    const summary = String(note.summary || '').trim();
    const keywords = Array.isArray(note.keywords) ? note.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 8) : [];
    return { index: index + 1, body: title ? `${title} — ${summary}` : summary, keywords };
  }).filter((note) => note.body);
}

function parseMcqs(text) {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed.questions)) throw new Error('Questions payload is invalid.');
  return parsed.questions.map((q) => {
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [];
    if (options.length < 2) throw new Error('A question has too few options.');
    return {
      question: String(q.question || '').trim(),
      options,
      answer: String(q.answer || '').trim(),
      userAnswer: -1,
    };
  }).filter((q) => q.question && q.answer);
}

function parseExplain(text) {
  const parsed = extractJson(text);
  const explanation = String(parsed.explanation || '').trim();
  const definitions = Array.isArray(parsed.definitions)
    ? parsed.definitions.map((d) => ({
      term: String(d.term || '').trim(),
      context: String(d.context || '').trim(),
    })).filter((d) => d.term)
    : [];
  return { explanation, definitions };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return (String(haystack).match(new RegExp(escaped, 'gi')) || []).length;
  } catch {
    return 0;
  }
}

async function callGemini(systemPrompt, userPrompt) {
  if (!apiConfigured()) {
    throw new AiError(503, 'Northstar AI is not configured on the server. Add a GEMINI_API_KEY to the backend environment variables and restart.');
  }
  if (typeof fetch !== 'function') {
    throw new AiError(500, 'This server runtime does not support the Gemini API. Please use Node.js 18 or newer.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      let message = `The Gemini API returned an error (HTTP ${response.status}).`;
      try {
        const parsed = JSON.parse(detail);
        const raw = parsed.error && (parsed.error.message || parsed.error.status);
        if (raw && typeof raw === 'string') message = `Gemini API error: ${raw}`;
      } catch {
        /* keep default message */
      }
      if (response.status === 401) message = 'The Gemini API key on the server is invalid or missing permissions.';
      if (response.status === 429) message = 'The Gemini API rate limit was reached. Please try again shortly.';
      throw new AiError(response.status === 401 ? 502 : response.status === 429 ? 429 : 502, message);
    }

    const data = await response.json();
    const candidate = data && data.candidates && data.candidates[0];
    if (!candidate) throw new AiError(502, 'The Gemini API returned an empty response.');
    if (candidate.finishReason === 'SAFETY') throw new AiError(502, 'The AI blocked this request for safety reasons.');
    const text = (candidate.content && candidate.content.parts || [])
      .map((part) => part.text || '')
      .join('')
      .trim();
    return text;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new AiError(504, 'The AI request timed out. Please try again.');
    }
    if (err instanceof AiError) throw err;
    throw new AiError(502, 'The Gemini API could not be reached. Please try again.');
  } finally {
    clearTimeout(timer);
  }
}

router.post('/', async (req, res) => {
  try {
    const { feature, text, pages, question } = req.body || {};
    const normalized = String(feature || '').trim().toLowerCase();

    if (!FEATURES.includes(normalized)) {
      return res.status(400).json({ error: `Unsupported AI feature. Use one of: ${FEATURES.join(', ')}.` });
    }
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'No document text was provided. Upload a PDF first.' });
    }
    if (String(text).length > MAX_DOCUMENT_CHARS * 4) {
      return res.status(400).json({ error: 'The document text is too large to process.' });
    }
    if (normalized === 'ask') {
      if (!question || !String(question).trim()) {
        return res.status(400).json({ error: 'A question is required.' });
      }
      if (String(question).length > MAX_QUESTION_CHARS) {
        return res.status(400).json({ error: 'The question is too long. Please shorten it and try again.' });
      }
    }

    const systemPrompt = systemPromptFor(normalized);
    const userPrompt = buildUserContents({ feature: normalized, text: String(text), pages, question: String(question || '') });
    const raw = await callGemini(systemPrompt, userPrompt);

    if (normalized === 'ask') {
      const answer = raw || NOT_FOUND_RESPONSE;
      return res.json({ type: 'answer', title: 'Answer', body: answer, meta: answer === NOT_FOUND_RESPONSE ? '' : 'answered from the uploaded document' });
    }
    if (normalized === 'summary') {
      return res.json({ type: 'text', title: 'Summary', body: raw || 'The document could not be summarized.' });
    }
    if (normalized === 'keypoints') {
      const items = parseKeyPoints(raw);
      return items
        ? res.json({ type: 'points', title: 'Key points', items })
        : res.json({ type: 'text', title: 'Key points', body: raw });
    }
    if (normalized === 'notes') {
      try {
        const notes = parseNotes(raw);
        return notes.length
          ? res.json({ type: 'notes', title: 'Notes', notes })
          : res.json({ type: 'text', title: 'Notes', body: raw });
      } catch (e) {
        return res.json({ type: 'text', title: 'Notes', body: raw });
      }
    }
    if (normalized === 'mcqs') {
      try {
        const questions = parseMcqs(raw);
        return questions.length
          ? res.json({ type: 'mcqs', title: 'Multiple-choice questions', questions })
          : res.json({ type: 'text', title: 'Multiple-choice questions', body: raw });
      } catch (e) {
        return res.json({ type: 'text', title: 'Multiple-choice questions', body: raw });
      }
    }
    if (normalized === 'explain') {
      try {
        const { explanation, definitions } = parseExplain(raw);
        if (!explanation) return res.json({ type: 'text', title: 'Document explanation', body: raw });
        return res.json({
          type: 'explain',
          title: 'Document explanation',
          explanation,
          definitions: definitions.slice(0, 5).map((d) => ({ ...d, count: countOccurrences(text, d.term) })),
        });
      } catch (e) {
        return res.json({ type: 'text', title: 'Document explanation', body: raw });
      }
    }

    return res.status(400).json({ error: 'Unsupported AI feature.' });
  } catch (err) {
    if (err instanceof AiError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('AI route error:', err);
    return res.status(500).json({ error: 'The AI service could not process this request. Please try again.' });
  }
});

module.exports = router;