// LlmProvider adapter for the Google Gemini API (@google/genai).
// Same port as the Anthropic adapter: swapping providers is this file plus an
// env var, which is the point of the port. Notes on the mapping:
// - Gemini function calls carry no ids; we mint stable ids (`name#index`) when
//   converting to the core's tool_use blocks, and recover the function name from
//   the id when converting tool_result back to a functionResponse part.
// - finishReason SAFETY/other blocks map to the core's 'refusal'/'other'.
// - Cost: this project runs on the AI Studio free tier, so costUsd is 0; the
//   eval table then reports latency and tokens as the honest metrics. Update
//   PRICING if moved to paid tier.

import { GoogleGenAI } from '@google/genai';
import type { LlmContentBlock, LlmProvider, LlmRequest, LlmResponse } from '@plainsheet/core';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** Gemini 3+ models sign parts and require the signature echoed on replay. */
  thoughtSignature?: string;
}
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[]; }

const PRICING: Record<string, { input: number; output: number }> = {
  // AI Studio free tier: $0. Fill in paid per-MTok rates if the key moves tiers.
};

export class GeminiLlm implements LlmProvider {
  private readonly client: GoogleGenAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenAI({ apiKey: apiKey ?? process.env['GEMINI_API_KEY'] ?? '' });
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const contents: GeminiContent[] = request.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: m.content.map((b) => this.toGeminiPart(b)),
    }));

    const response = await this.withRetry(() => this.generate(request, contents));
    const candidate = response.candidates?.[0];
    const parts = (candidate?.content?.parts ?? []) as GeminiPart[];

    const content: LlmContentBlock[] = [];
    let functionCallIndex = 0;
    for (const part of parts) {
      const meta = part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : undefined;
      if (part.text) content.push({ type: 'text', text: part.text, ...(meta ? { meta } : {}) });
      if (part.functionCall?.name) {
        content.push({
          type: 'tool_use',
          id: `${part.functionCall.name}#${functionCallIndex++}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
          ...(meta ? { meta } : {}),
        });
      }
    }

    const finish = String(candidate?.finishReason ?? '');
    const stopReason: LlmResponse['stopReason'] =
      content.some((b) => b.type === 'tool_use') ? 'tool_use'
      : finish === 'STOP' ? 'end_turn'
      : finish === 'MAX_TOKENS' ? 'max_tokens'
      : finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' ? 'refusal'
      : 'other';

    return {
      content,
      stopReason,
      model: request.model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  private generate(request: LlmRequest, contents: GeminiContent[]) {
    return this.client.models.generateContent({
      model: request.model,
      contents,
      config: {
        systemInstruction: request.system,
        maxOutputTokens: request.maxTokens,
        ...(request.tools
          ? {
              tools: [{
                functionDeclarations: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: this.toGeminiSchema(t.inputSchema),
                })),
              }],
            }
          : {}),
      },
    });
  }

  /** Retry transient provider failures (429/500/503) with backoff; the AI Studio
   * free tier throws these routinely under load. Non-transient errors rethrow. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const delaysMs = [1000, 3000, 8000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = (err as { status?: number }).status ?? 0;
        const transient = status === 429 || status === 500 || status === 503;
        if (!transient || attempt >= delaysMs.length) throw err;
        await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      }
    }
  }

  costUsd(model: string, inputTokens: number, outputTokens: number): number {
    const key = Object.keys(PRICING).find((k) => model.startsWith(k));
    if (!key) return 0; // free tier
    const price = PRICING[key]!;
    return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  }

  private toGeminiPart(block: LlmContentBlock): GeminiPart {
    const signature =
      block.type !== 'tool_result' && block.meta && typeof block.meta === 'object'
        ? (block.meta as { thoughtSignature?: string }).thoughtSignature
        : undefined;
    switch (block.type) {
      case 'text':
        return { text: block.text, ...(signature ? { thoughtSignature: signature } : {}) };
      case 'tool_use':
        return {
          functionCall: { name: block.name, args: (block.input ?? {}) as Record<string, unknown> },
          ...(signature ? { thoughtSignature: signature } : {}),
        };
      case 'tool_result': {
        const name = block.toolUseId.split('#')[0] ?? block.toolUseId;
        return {
          functionResponse: {
            name,
            response: block.isError ? { error: block.content } : { result: block.content },
          },
        };
      }
    }
  }

  /** JSON Schema (our port format) to Gemini's OpenAPI-style schema. Handles the
   * object-of-strings shapes our tools use; extend if tools grow richer inputs. */
  private toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const properties = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
    return {
      type: 'OBJECT',
      properties: Object.fromEntries(
        Object.entries(properties).map(([key, prop]) => [
          key,
          {
            type: String(prop['type'] ?? 'string').toUpperCase(),
            ...(prop['description'] ? { description: prop['description'] } : {}),
            ...(prop['enum'] ? { enum: prop['enum'] } : {}),
          },
        ]),
      ),
      ...(Array.isArray(schema['required']) ? { required: schema['required'] } : {}),
    };
  }
}
