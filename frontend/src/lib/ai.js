const STOPWORDS = new Set('a,about,above,after,again,against,all,am,an,and,any,are,as,at,be,because,been,before,being,below,between,both,but,by,could,did,do,does,doing,down,during,each,few,for,from,further,had,has,have,having,he,her,here,hers,herself,him,himself,his,how,i,if,in,into,is,it,its,itself,just,me,more,most,my,myself,no,nor,not,now,of,off,on,once,only,or,other,our,ours,ourselves,out,over,own,same,she,should,so,some,such,than,that,the,their,theirs,them,themselves,then,there,these,they,this,those,through,to,too,under,until,up,very,was,we,were,what,when,where,which,while,who,whom,why,will,with,would,you,your,yours,yourself,yourselves,this,also,can,its,may,please,shall,us'.split(','));

function cleanWord(word) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitSentences(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"']|$)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 2);
}

function contentWords(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(cleanWord)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function wordFrequency(text) {
  const map = new Map();
  for (const word of contentWords(text)) map.set(word, (map.get(word) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function scoreSentence(sentence, frequencies) {
  const words = new Set(contentWords(sentence));
  let score = 0;
  for (const word of words) score += frequencies.get(word) || 0;
  return score;
}

function topSentences(text, count) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];
  const frequencies = new Map(wordFrequency(text));
  const scored = sentences
    .map((sentence, index) => ({ sentence, index, score: scoreSentence(sentence, frequencies) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index);
  return scored;
}

export function extractTextPreview(text, maxLength = 220) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}…`;
}

export function summarize(text, sentenceCount = 4) {
  const sentences = topSentences(text, sentenceCount);
  return sentences.map((item) => item.sentence).join(' ');
}

export function keyPoints(text, count = 5) {
  const sentences = topSentences(text, count);
  return sentences.map((item) => ({ point: item.sentence, score: item.score }));
}

export function generateNotes(text) {
  const paragraphs = String(text)
    .split(/\n{2,}|\r\n{2,}/)
    .filter((p) => p.trim().length > 4);
  const notes = [];
  for (const paragraph of paragraphs.slice(0, 6)) {
    const sentences = splitSentences(paragraph);
    if (!sentences.length) continue;
    const frequencies = new Map(wordFrequency(paragraph));
    const summarized = sentences
      .map((sentence, index) => ({ sentence, index, score: scoreSentence(sentence, frequencies) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .sort((a, b) => a.index - b.index)
      .map((item) => item.sentence);
    notes.push({ source: summarized.join(' ') || sentences[0], keywords: wordFrequency(paragraph).slice(0, 6).map(([w]) => w) });
  }
  return notes;
}

function distractorCandidates(text, excluded) {
  return wordFrequency(text).filter(([word]) => !excluded.has(word)).slice(0, 6).map(([word]) => word);
}

export function generateMcqs(text, count = 5) {
  const frequencies = new Map(wordFrequency(text));
  const sentences = splitSentences(text)
    .map((sentence, index) => {
      const words = [...new Set(contentWords(sentence))].filter((w) => (frequencies.get(w) || 0) >= 1 && w.length > 3);
      return { sentence, index, words };
    })
    .filter((item) => item.words.length >= 3)
    .sort((a, b) => b.words.length - a.words.length)
    .slice(0, count);
  return sentences.map((item) => {
    const excluded = new Set(item.words);
    const answer = item.words[Math.floor(Math.random() * item.words.length)];
    const distractors = distractorCandidates(text, new Set([answer]))
      .filter((word) => word.length > 3)
      .slice(0, 5);
    const options = [...new Set([answer, ...distractors])].sort(() => Math.random() - 0.5).slice(0, 4);
    const blankSentence = item.sentence.replace(new RegExp(`\\b${answer}\\b`, 'i'), '__________');
    return {
      question: `${blankSentence}`,
      answer,
      options,
    };
  });
}

export function answerQuestion(question, text) {
  const questionWords = [...new Set(contentWords(question))].filter((w) => w.length > 3);
  if (!questionWords.length) return { answer: 'Could not understand your question. Try asking with more detail.', confidence: 0 };
  const sentences = splitSentences(text).map((sentence, index) => {
    const overlap = new Set(contentWords(sentence)).size;
    let score = 0;
    for (const word of questionWords) {
      if (sentence.toLowerCase().includes(word)) score += 2;
    }
    return { sentence, index, score: score + overlap * 0.5 + (new Set(contentWords(sentence)).size > 15 ? 1 : 0) };
  });
  const ranked = sentences.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { answer: 'The document may not contain an answer to that question.', confidence: 0 };
  const best = ranked[0];
  const confidence = Math.min(best.score / (questionWords.length + 3), 1);
  return { answer: best.sentence, confidence, source: `found in the area: "${extractTextPreview(best.sentence, 120)}"` };
}

export function explainDocument(text, sentenceCount = 6) {
  const frequencies = new Map(wordFrequency(text));
  const keywords = wordFrequency(text).slice(0, 6).map(([word, count]) => ({ word, count }));
  const sentences = topSentences(text, sentenceCount).map((item) => item.sentence);
  return {
    keywords,
    explanation: sentences.join(' '),
    definitions: keywords.map(({ word, count }) => ({
      term: word,
      context: (function findContext() {
        const idx = text.toLowerCase().indexOf(word);
        if (idx === -1) return '';
        return extractTextPreview(text.slice(Math.max(0, idx - 60), idx + word.length + 90), 150);
      })(),
      count,
    })),
  };
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