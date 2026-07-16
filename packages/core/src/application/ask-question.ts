// The agent loop: own orchestration over the LLM provider's tool-use protocol.
// Bounded steps, typed tool dispatch, trace events for the UI, cost accounting,
// and guardrails enforced in the system rules and verified by the eval suite.

import type { Answer, AnswerKind, Citation, ReadingLevel, TraceEvent, UsageTotals } from '../domain/types.js';
import type { Clock, LlmContentBlock, LlmMessage, LlmProvider, Logger } from './ports.js';
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from './tools.js';

export interface AskQuestionDeps {
  llm: LlmProvider;
  tools: ToolContext;
  logger: Logger;
  clock: Clock;
  config: {
    answerModel: string; // final user-facing answer
    toolModel: string;   // tool-selection steps (cheaper, faster)
    maxSteps: number;
  };
}

export interface AskQuestionInput {
  question: string;
  readingLevel: ReadingLevel;
  requestId: string;
}

const CITATION_PATTERN = /\[cite:([^\]|]+)\|([^\]]*)\]/g;

function systemPrompt(readingLevel: ReadingLevel): string {
  const level =
    readingLevel === 'plain'
      ? 'Write for a reading age of about 11: short sentences, everyday words, no jargon. ' +
        'If a technical term is unavoidable, explain it in brackets.'
      : 'Write for a clinically literate reader: precise terms are fine, stay concise.';
  return [
    'You answer questions about ONE clinical trial participant information sheet.',
    'Hard rules, in priority order:',
    '1. Only state what the document supports. Every factual claim must end with a citation',
    '   marker of the form [cite:<chunkId>|<short verbatim quote from that chunk>].',
    '2. If the document does not contain the answer, reply with exactly the marker',
    '   NOT_IN_DOCUMENT followed by one sentence saying the sheet does not cover it and',
    '   suggesting the participant ask the study team.',
    '3. Never give medical advice, opinions on whether to join a trial, or interpretations of',
    '   symptoms. If asked, reply with exactly the marker REFUSED_MEDICAL_ADVICE followed by',
    '   one sentence explaining you can only describe the document, and who to ask instead.',
    '4. Use search_sheet before answering; use get_section when you need context.',
    level,
  ].join('\n');
}

function extractText(content: LlmContentBlock[]): string {
  return content
    .filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function parseAnswer(raw: string): { kind: AnswerKind; text: string; citations: Citation[] } {
  if (raw.includes('REFUSED_MEDICAL_ADVICE')) {
    return { kind: 'refused_medical_advice', text: raw.replace('REFUSED_MEDICAL_ADVICE', '').trim(), citations: [] };
  }
  if (raw.includes('NOT_IN_DOCUMENT')) {
    return { kind: 'not_in_document', text: raw.replace('NOT_IN_DOCUMENT', '').trim(), citations: [] };
  }
  const citations: Citation[] = [];
  const text = raw.replace(CITATION_PATTERN, (_m, chunkId: string, quote: string) => {
    citations.push({ chunkId: chunkId.trim(), sectionHeading: '', quote: quote.trim() });
    return `[${citations.length}]`;
  });
  return { kind: 'answered', text: text.trim(), citations };
}

export async function askQuestion(deps: AskQuestionDeps, input: AskQuestionInput): Promise<Answer> {
  const log = deps.logger.child({ requestId: input.requestId, useCase: 'askQuestion' });
  const system = systemPrompt(input.readingLevel);
  const messages: LlmMessage[] = [
    { role: 'user', content: [{ type: 'text', text: input.question }] },
  ];
  const trace: TraceEvent[] = [];
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  for (let step = 1; step <= deps.config.maxSteps; step++) {
    // Cheap model while tools are in play; strong model for the last permitted step
    // so the final answer is always produced by answerModel.
    const isLastStep = step === deps.config.maxSteps;
    const model = isLastStep ? deps.config.answerModel : deps.config.toolModel;

    const t0 = deps.clock.now();
    const response = await deps.llm.chat({
      model,
      system,
      messages,
      ...(isLastStep ? {} : { tools: TOOL_DEFINITIONS }),
      maxTokens: 1500,
    });
    const ms = deps.clock.now() - t0;

    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    usage.costUsd += deps.llm.costUsd(response.model, response.usage.inputTokens, response.usage.outputTokens);
    trace.push({ type: 'model_turn', step, model: response.model, stopReason: response.stopReason, ms });

    if (response.stopReason !== 'tool_use') {
      // Final answer path: if the tool model produced it before the last step, upgrade
      // once to the answer model for the user-facing text, reusing gathered context.
      if (!isLastStep && model !== deps.config.answerModel) {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: 'Rewrite your final answer for the user, following every rule.' }],
        });
        const t1 = deps.clock.now();
        const finalResponse = await deps.llm.chat({
          model: deps.config.answerModel,
          system,
          messages,
          maxTokens: 1500,
        });
        usage.inputTokens += finalResponse.usage.inputTokens;
        usage.outputTokens += finalResponse.usage.outputTokens;
        usage.costUsd += deps.llm.costUsd(
          finalResponse.model, finalResponse.usage.inputTokens, finalResponse.usage.outputTokens,
        );
        trace.push({
          type: 'model_turn', step: step + 1, model: finalResponse.model,
          stopReason: finalResponse.stopReason, ms: deps.clock.now() - t1,
        });
        const parsedFinal = parseAnswer(extractText(finalResponse.content));
        log.info('answered', { kind: parsedFinal.kind, steps: step + 1, costUsd: usage.costUsd });
        return { ...parsedFinal, readingLevel: input.readingLevel, trace, usage };
      }
      const parsed = parseAnswer(extractText(response.content));
      log.info('answered', { kind: parsed.kind, steps: step, costUsd: usage.costUsd });
      return { ...parsed, readingLevel: input.readingLevel, trace, usage };
    }

    // Tool-use turn: execute every requested tool, return all results in ONE user message.
    messages.push({ role: 'assistant', content: response.content });
    const results: LlmContentBlock[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const t1 = deps.clock.now();
      try {
        const result = await executeTool(deps.tools, block.name, block.input);
        trace.push({ type: 'tool_call', step, tool: block.name, input: block.input, ms: deps.clock.now() - t1 });
        trace.push({ type: 'tool_result', step, tool: block.name, summary: result.slice(0, 160) });
        results.push({ type: 'tool_result', toolUseId: block.id, content: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn('tool error', { tool: block.name, message });
        results.push({ type: 'tool_result', toolUseId: block.id, content: `Error: ${message}`, isError: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  // Step budget exhausted without a final text turn. Fail honestly.
  log.warn('step budget exhausted');
  return {
    kind: 'not_in_document',
    text: 'I could not find a supported answer within the step limit. Please ask the study team.',
    citations: [],
    readingLevel: input.readingLevel,
    trace,
    usage,
  };
}
