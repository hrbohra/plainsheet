// GET /api/audit?sheetId=... - study-team accessibility report.
// Deterministic (no LLM call), so no rate limit needed beyond platform defaults.

import { NextResponse } from 'next/server';
import { auditSheet } from '@plainsheet/core';
import { container } from '@/lib/container';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const deps = container();
  const sheetId = new URL(request.url).searchParams.get('sheetId');
  if (!sheetId) return NextResponse.json({ error: 'sheetId is required' }, { status: 400 });
  try {
    const sheet = await deps.repo.getSheet(sheetId);
    if (!sheet) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    return NextResponse.json({ report: auditSheet(sheet) });
  } catch (err) {
    deps.logger.error('audit failed', { message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
