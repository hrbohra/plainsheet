// Agent loop tested against fake ports: no network, no database, deterministic.
// This is what the hexagonal boundary buys.

import { describe, expect, it } from 'vitest';
import { askQuestion, type AskQuestionDeps } from '../src/application/ask-question.js';
import type { ChunkRepository, EmbeddingProvider, LlmProvider, LlmRequest, LlmResponse, Logger } from '../src/application/ports.js';

const nullLogger: Logger = {
  info: () => {}, warn: () => {}, error: () => {}, child: () => nullLogger,
};

const fakeRepo: ChunkRepository = {
  saveSheet: async () => {},
  search: async () => [{
    score: 1,
    chunk: {
      id: 'sheet1::s3::0', sheetId: 'sheet1', sectionId: 'sheet1::s3',
      sectionHeading: 'Can I withdraw?', index: 0,
      text: 'You are free to withdraw from the study at any time without giving a reason.',
    },
  }],
  getSection: async () => [],
  listSheets: async () => [],
  getSheet: async () => null,
};

const fakeEmbeddings: EmbeddingProvider = { embed: async (texts) => texts.map(() => [0, 0, 0]) };

function scriptedLlm(script: LlmResponse[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let i = 0;
  return {
    requests,
    chat: async (req) => {
      // snapshot: the loop mutates its messages array in place between calls
      requests.push({ ...req, messages: structuredClone(req.messages) });
      const next = script[Math.min(i, script.length - 1)]!;
      i++;
      return next;
    },
    costUsd: (_m, input, output) => (input + output) / 1_000_000,
  };
}

function deps(llm: LlmProvider): AskQuestionDeps {
  return {
    llm,
    tools: { sheetId: 'sheet1', repo: fakeRepo, embeddings: fakeEmbeddings },
    logger: nullLogger,
    clock: { now: () => 0 },
    config: { answerModel: 'answer-model', toolModel: 'tool-model', maxSteps: 4 },
  };
}

const usage = { inputTokens: 100, outputTokens: 50 };

describe('askQuestion agent loop', () => {
  it('runs tool call then final answer, extracting citations', async () => {
    const llm = scriptedLlm([
      {
        content: [{ type: 'tool_use', id: 't1', name: 'search_sheet', input: { query: 'withdraw' } }],
        stopReason: 'tool_use', model: 'tool-model', usage,
      },
      {
        content: [{ type: 'text', text: 'You can stop at any time [cite:sheet1::s3::0|withdraw from the study at any time].' }],
        stopReason: 'end_turn', model: 'tool-model', usage,
      },
      {
        content: [{ type: 'text', text: 'You can stop at any time [cite:sheet1::s3::0|withdraw from the study at any time].' }],
        stopReason: 'end_turn', model: 'answer-model', usage,
      },
    ]);

    const answer = await askQuestion(deps(llm), {
      question: 'Can I quit the trial?', readingLevel: 'plain', requestId: 'req-1',
    });

    expect(answer.kind).toBe('answered');
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]?.chunkId).toBe('sheet1::s3::0');
    expect(answer.text).toContain('[1]');
    // tool results must return in a single user message with matching toolUseId
    const toolResultTurn = llm.requests.at(-2)?.messages.at(-1);
    expect(toolResultTurn?.content[0]).toMatchObject({ type: 'tool_result', toolUseId: 't1' });
    // final user-facing answer came from the answer model
    expect(llm.requests.at(-1)?.model).toBe('answer-model');
  });

  it('classifies refusals', async () => {
    const llm = scriptedLlm([
      {
        content: [{ type: 'text', text: 'REFUSED_MEDICAL_ADVICE I can only describe the document; ask your study nurse.' }],
        stopReason: 'end_turn', model: 'tool-model', usage,
      },
      {
        content: [{ type: 'text', text: 'REFUSED_MEDICAL_ADVICE I can only describe the document; ask your study nurse.' }],
        stopReason: 'end_turn', model: 'answer-model', usage,
      },
    ]);
    const answer = await askQuestion(deps(llm), {
      question: 'Should I join this trial given my symptoms?', readingLevel: 'plain', requestId: 'req-2',
    });
    expect(answer.kind).toBe('refused_medical_advice');
    expect(answer.citations).toHaveLength(0);
  });

  it('stops at the step budget and fails honestly', async () => {
    const llm = scriptedLlm([
      {
        content: [{ type: 'tool_use', id: 'tX', name: 'search_sheet', input: { query: 'loop' } }],
        stopReason: 'tool_use', model: 'tool-model', usage,
      },
    ]);
    const answer = await askQuestion(deps(llm), {
      question: 'anything', readingLevel: 'detailed', requestId: 'req-3',
    });
    expect(answer.kind).toBe('not_in_document');
    expect(answer.trace.filter((t) => t.type === 'model_turn').length).toBeLessThanOrEqual(4);
  });

  it('accumulates usage and cost across steps', async () => {
    const llm = scriptedLlm([
      {
        content: [{ type: 'tool_use', id: 't1', name: 'search_sheet', input: { query: 'q' } }],
        stopReason: 'tool_use', model: 'tool-model', usage,
      },
      { content: [{ type: 'text', text: 'NOT_IN_DOCUMENT The sheet does not cover this.' }], stopReason: 'end_turn', model: 'tool-model', usage },
      { content: [{ type: 'text', text: 'NOT_IN_DOCUMENT The sheet does not cover this.' }], stopReason: 'end_turn', model: 'answer-model', usage },
    ]);
    const answer = await askQuestion(deps(llm), {
      question: 'q', readingLevel: 'plain', requestId: 'req-4',
    });
    expect(answer.usage.inputTokens).toBe(300);
    expect(answer.usage.costUsd).toBeGreaterThan(0);
  });
});
