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
    // -latest aliases are the stable choice (verified against a fresh key,
    // Jul 2026; scripts/list-models.mjs shows what a given key can use).
    answerModel: process.env['ANSWER_MODEL'] ?? 'gemini-flash-latest',
    toolModel: process.env['TOOL_MODEL'] ?? 'gemini-flash-lite-latest',
  };
}
