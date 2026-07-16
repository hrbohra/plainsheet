// POST /api/ask - the single entry point for participant questions.
// Zod-validated input, request ID threaded through the whole agent trace.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { askQuestion } from '@plainsheet/core';
import { container } from '@/lib/container';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BodySchema = z.object({
  sheetId: z.string().min(1),
  question: z.string().min(3).max(1000),
  readingLevel: z.enum(['plain', 'detailed']).default('plain'),
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  const deps = container();
  const log = deps.logger.child({ requestId, route: 'ask' });

  const limit = checkRateLimit(clientIp(request));
  if (!limit.allowed) {
    log.warn('rate limited', { ip: clientIp(request) });
    return NextResponse.json(
      { error: 'Too many requests. Please wait before asking again.', requestId },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: 'Invalid request', detail: String(err) }, { status: 400 });
  }

  try {
    const answer = await askQuestion(
      {
        llm: deps.llm,
        tools: { sheetId: body.sheetId, repo: deps.repo, embeddings: deps.embeddings },
        logger: log,
        clock: deps.clock,
        config: deps.config,
      },
      { question: body.question, readingLevel: body.readingLevel, requestId },
    );
    return NextResponse.json({ requestId, answer });
  } catch (err) {
    log.error('ask failed', { message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal error', requestId }, { status: 500 });
  }
}
