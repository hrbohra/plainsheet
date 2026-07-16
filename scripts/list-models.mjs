// Lists Gemini models available to the configured key (generateContent only).
// Usage: node scripts/list-models.mjs
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';
loadEnv(fileURLToPath(new URL('../.env', import.meta.url)));

const { GoogleGenAI } = await import('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const pager = await ai.models.list();
for await (const m of pager) {
  const actions = m.supportedActions ?? [];
  if (actions.includes('generateContent')) console.log(m.name, '|', m.displayName);
}
