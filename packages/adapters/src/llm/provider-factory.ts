// One env var picks the provider; per-provider model defaults live here.
// LLM_PROVIDER=gemini (default: free tier friendly) or anthropic.
// ANSWER_MODEL / TOOL_MODEL override the defaults either way.

import type { LlmProvider } from '@plainsheet/core';
import { AnthropicLlm } from './anthropic-llm.js';
import { GeminiLlm } from './gemini-llm.js';

export interface LlmSelection {
  llm: LlmProvider;
  provider: 'gemini' | 'anthropic';
  answerModel: string;
  toolModel: string;
}

export function createLlmFromEnv(): LlmSelection {
  const provider = (process.env['LLM_PROVIDER'] ?? 'gemini').toLowerCase() as 'gemini' | 'anthropic';

  if (provider === 'anthropic') {
    return {
      llm: new AnthropicLlm(),
      provider,
      answerModel: process.env['ANSWER_MODEL'] ?? 'claude-sonnet-5',
      toolModel: process.env['TOOL_MODEL'] ?? 'claude-haiku-4-5',
    };
  }

  return {
    llm: new GeminiLlm(),
    provider: 'gemini',
    // Rolling aliases: Google gates dated model ids for new API keys, so the
    // -latest aliases are the stable choice (scripts/list-models.mjs shows what
    // a given key can use). flash-lite for answers too: measured 16 Jul 2026,
    // full ask drops from ~18s to ~2s with citation faithfulness and refusal
    // behavior unchanged on the golden set; flash-latest ignored thinking hints
    // and spent ~16s reasoning on grounded QA that does not need it. Set
    // ANSWER_MODEL=gemini-flash-latest to trade latency for the bigger model.
    answerModel: process.env['ANSWER_MODEL'] ?? 'gemini-flash-lite-latest',
    toolModel: process.env['TOOL_MODEL'] ?? 'gemini-flash-lite-latest',
  };
}
