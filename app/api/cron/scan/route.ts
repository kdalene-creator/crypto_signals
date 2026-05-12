import { NextResponse, type NextRequest } from 'next/server';
import type { Signal, Symbol } from '@/lib/types';
import { SYMBOLS } from '@/lib/symbols';
import { getKlines, getOpenInterestHist, getFundingRateBp } from '@/lib/binance';
import { classifySession, isActiveSession, sessionStartMs } from '@/lib/indicators/session';
import { oiQuadrant } from '@/lib/oi';
import { detectSweepReclaim } from '@/lib/playbooks/sweep-reclaim';
import { detectSmaCross } from '@/lib/playbooks/sma-cross';
import { tryClaim, persistSignal } from '@/lib/store';
import { sendSignalEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization');
  return header === `Bearer ${expected}`;
}

async function scanSymbol(symbol: Symbol, now: Date) {
  const session = classifySession(now);
  const [candles, oi, fundingBp] = await Promise.all([
    getKlines(symbol, '1m', 260),
    getOpenInterestHist(symbol, '5m', 12),
    getFundingRateBp(symbol),
  ]);

  const quad = oiQuadrant(candles, oi);
  const signals: Signal[] = [];

  const sweep = detectSweepReclaim(candles, {
    symbol,
    sessionStart: sessionStartMs(now),
    oiQuadrant: quad,
    session,
    fundingBp,
    now: now.getTime(),
  });
  if (sweep) signals.push(sweep);

  const smaCross = detectSmaCross(candles, {
    symbol,
    oiQuadrant: quad,
    session,
    fundingBp,
    now: now.getTime(),
  });
  if (smaCross) signals.push(smaCross);

  return signals;
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
    // Scan all symbols in parallel. One bad symbol doesn't block others.
    const symbolResults = await Promise.allSettled(SYMBOLS.map((sym) => scanSymbol(sym, now)));
    const detected: Signal[] = [];
    const symbolErrors: Array<{ symbol: Symbol; error: string }> = [];

    symbolResults.forEach((r, i) => {
      const sym = SYMBOLS[i];
      if (r.status === 'fulfilled') {
        detected.push(...r.value);
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`[scan] ${sym} fetch error:`, msg);
        symbolErrors.push({ symbol: sym, error: msg });
      }
    });

    if (detected.length === 0) {
      return NextResponse.json({ checked: true, signals: [], session, symbolErrors });
    }

    const results: Array<{ symbol: Symbol; playbook: string; result: 'alerted' | 'deduped' | 'error'; detail?: string }> = [];
    for (const sig of detected) {
      try {
        const claimed = await tryClaim(sig);
        if (!claimed) {
          results.push({ symbol: sig.symbol, playbook: sig.playbook, result: 'deduped' });
          continue;
        }
        await Promise.all([sendSignalEmail(sig), persistSignal(sig)]);
        results.push({ symbol: sig.symbol, playbook: sig.playbook, result: 'alerted' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[scan] ${sig.symbol} ${sig.playbook} alert error:`, msg);
        results.push({ symbol: sig.symbol, playbook: sig.playbook, result: 'error', detail: msg });
      }
    }

    return NextResponse.json({ checked: true, signals: detected, results, session, symbolErrors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scan] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
