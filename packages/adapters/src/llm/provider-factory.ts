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
    // Flash for answers, flash-lite for tool steps: both have AI Studio free-tier
    // quotas as of Jul 2026. Override via env if these ids age out.
    answerModel: process.env['ANSWER_MODEL'] ?? 'gemini-2.5-flash',
    toolModel: process.env['TOOL_MODEL'] ?? 'gemini-2.5-flash-lite',
  };
}
