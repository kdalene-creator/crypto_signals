import { NextResponse, type NextRequest } from 'next/server';
import { getKlines, getOpenInterestHist, getFundingRateBp } from '@/lib/binance';
import { classifySession, isActiveSession, sessionStartMs } from '@/lib/indicators/session';
import { oiQuadrant } from '@/lib/oi';
import { detectSweepReclaim } from '@/lib/playbooks/sweep-reclaim';
import { tryClaim, persistSignal } from '@/lib/store';
import { sendSignalEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization');
  return header === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const session = classifySession(now);
  if (!isActiveSession(session)) {
    return NextResponse.json({ skipped: true, reason: `session=${session}` });
  }

  try {
    const [candles, oi, fundingBp] = await Promise.all([
      getKlines('BTCUSDT', '1m', 120),
      getOpenInterestHist('BTCUSDT', '5m', 12),
      getFundingRateBp('BTCUSDT'),
    ]);

    const signal = detectSweepReclaim(candles, {
      sessionStart: sessionStartMs(now),
      oiQuadrant: oiQuadrant(candles, oi),
      session,
      fundingBp,
      now: now.getTime(),
    });

    if (!signal) {
      return NextResponse.json({ checked: true, signal: null, session });
    }

    const claimed = await tryClaim(signal);
    if (!claimed) {
      return NextResponse.json({ deduped: true, signal });
    }

    await Promise.all([sendSignalEmail(signal), persistSignal(signal)]);
    return NextResponse.json({ alerted: true, signal });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scan] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
