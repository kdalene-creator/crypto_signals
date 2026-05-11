import { NextResponse, type NextRequest } from 'next/server';
import type { Signal } from '@/lib/types';
import { getKlines, getOpenInterestHist, getFundingRateBp } from '@/lib/binance';
import { classifySession, isActiveSession, sessionStartMs } from '@/lib/indicators/session';
import { oiQuadrant } from '@/lib/oi';
import { detectSweepReclaim } from '@/lib/playbooks/sweep-reclaim';
import { detectSmaCross } from '@/lib/playbooks/sma-cross';
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
      getKlines('BTCUSDT', '1m', 260),
      getOpenInterestHist('BTCUSDT', '5m', 12),
      getFundingRateBp('BTCUSDT'),
    ]);

    const quad = oiQuadrant(candles, oi);
    const sharedCtx = { session, fundingBp, oiQuadrant: quad, now: now.getTime() };

    const detected: Signal[] = [];
    const sweep = detectSweepReclaim(candles, { ...sharedCtx, sessionStart: sessionStartMs(now) });
    if (sweep) detected.push(sweep);
    const smaCross = detectSmaCross(candles, sharedCtx);
    if (smaCross) detected.push(smaCross);

    if (detected.length === 0) {
      return NextResponse.json({ checked: true, signal: null, session });
    }

    // For each detected signal, claim dedup → persist → email. Independent per playbook.
    const results: Array<{ playbook: string; result: 'alerted' | 'deduped' | 'error'; detail?: string }> = [];
    for (const sig of detected) {
      try {
        const claimed = await tryClaim(sig);
        if (!claimed) {
          results.push({ playbook: sig.playbook, result: 'deduped' });
          continue;
        }
        await Promise.all([sendSignalEmail(sig), persistSignal(sig)]);
        results.push({ playbook: sig.playbook, result: 'alerted' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[scan] ${sig.playbook} alert error:`, msg);
        results.push({ playbook: sig.playbook, result: 'error', detail: msg });
      }
    }

    return NextResponse.json({ checked: true, signals: detected, results, session });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scan] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
