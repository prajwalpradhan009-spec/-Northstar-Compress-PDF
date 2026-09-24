const API_BASE = import.meta.env.VITE_API_URL || '';
const REQUEST_TIMEOUT_MS = 120000;

export const NOT_FOUND_RESPONSE = "I couldn't find this information in the uploaded document.";

export async function runGeminiFeature({ feature, text, question = '', pages = [] }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature, text, question, pages }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 503) {
        throw new Error('Northstar AI is not configured on the server. Add a Gemini API key to the backend environment.');
      }
      throw new Error(data.error || 'The AI service could not process this request.');
    }
    return data;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('The AI request timed out. Please try again.');
    }
    if (err instanceof TypeError) {
      throw new Error('Cannot reach the server. Start the backend and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}