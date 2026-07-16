// GET /api/sheets - the sheets available to query (drives the UI picker).

import { NextResponse } from 'next/server';
import { container } from '@/lib/container';

export const runtime = 'nodejs';

export async function GET() {
  const deps = container();
  try {
    const sheets = await deps.repo.listSheets();
    return NextResponse.json({ sheets });
  } catch (err) {
    deps.logger.error('list sheets failed', { message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
