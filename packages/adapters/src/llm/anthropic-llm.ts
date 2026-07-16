// LlmProvider adapter for the Anthropic Messages API.
// Maps the core's provider-agnostic shapes to SDK types and back, and prices calls.

import Anthropic from '@anthropic-ai/sdk';
import type { LlmContentBlock, LlmProvider, LlmRequest, LlmResponse } from '@plainsheet/core';

// USD per million tokens, current as of Jul 2026 (Sonnet 5 shown at sticker price;
// an introductory rate applies through 2026-08-31). Update alongside model IDs.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export class AnthropicLlm implements LlmProvider {
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content.map((b) => this.toSdkBlock(b)),
      })),
      ...(request.tools
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    });

    const content: LlmContentBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text });
      else if (block.type === 'tool_use') {
        content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
      }
      // thinking blocks are intentionally not surfaced to core
    }

    const stopReason: LlmResponse['stopReason'] =
      response.stop_reason === 'end_turn' || response.stop_reason === 'tool_use' ||
      response.stop_reason === 'max_tokens' || response.stop_reason === 'refusal'
        ? response.stop_reason
        : 'other';

    return {
      content,
      stopReason,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  costUsd(model: string, inputTokens: number, outputTokens: number): number {
    const key = Object.keys(PRICING).find((k) => model.startsWith(k));
    const price = key ? PRICING[key]! : { input: 3, output: 15 };
    return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  }

  private toSdkBlock(block: LlmContentBlock): Anthropic.ContentBlockParam {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: block.content,
          ...(block.isError ? { is_error: true } : {}),
        };
    }
  }
}
