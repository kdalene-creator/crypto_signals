/**
 * Historical backtest for both playbooks across all configured symbols.
 *
 * Pulls 1m klines + 5m OI from Binance Futures (no auth), replays both
 * detectors candle-by-candle through historical data per symbol, grades
 * each fired signal against subsequent price action, and prints per-symbol
 * and aggregate summary reports.
 *
 * Usage: npm run backtest -- [days] [lookahead-minutes]
 *   defaults: 30 days, 60 min lookahead
 */
import type { Candle, OiSample, Signal, Symbol } from '../lib/types';
import { SYMBOLS } from '../lib/symbols';
import { detectSweepReclaim, LOOKBACK } from '../lib/playbooks/sweep-reclaim';
import { detectSmaCross, SMA_SLOW } from '../lib/playbooks/sma-cross';
import { classifySession, isActiveSession, sessionStartMs } from '../lib/indicators/session';
import { oiQuadrant } from '../lib/oi';

const FAPI = 'https://fapi.binance.com';
const MIN = 60_000;
const HR = 60 * MIN;
const DAY = 24 * HR;

const SCAN_VOL_RATIO = 1.0;

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];
type RawOi = { sumOpenInterest: string; timestamp: number };

async function fetchKlines(symbol: Symbol, start: number, end: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = start;
  while (cursor < end) {
    const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${cursor}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`klines ${symbol} ${res.status}: ${await res.text()}`);
    const raw = (await res.json()) as RawKline[];
    if (raw.length === 0) break;
    for (const k of raw) {
      out.push({
        openTime: k[0],
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        closeTime: k[6],
      });
    }
    const lastClose = raw[raw.length - 1][6];
    if (lastClose <= cursor) break;
    cursor = lastClose + 1;
    if (raw.length < 1500) break;
  }
  return out;
}

async function fetchOiHist(symbol: Symbol, start: number, end: number): Promise<OiSample[]> {
  const out: OiSample[] = [];
  const SAFE_OFFSET = 25 * DAY;
  let cursor = Math.max(start, Date.now() - SAFE_OFFSET);
  while (cursor < end) {
    const url = `${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=5m&startTime=${cursor}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const raw = (await res.json()) as RawOi[];
    if (raw.length === 0) break;
    for (const s of raw) out.push({ time: s.timestamp, openInterest: +s.sumOpenInterest });
    const lastT = raw[raw.length - 1].timestamp;
    if (lastT <= cursor) break;
    cursor = lastT + 1;
    if (raw.length < 500) break;
  }
  return out;
}

type Outcome = 'win' | 'loss' | 'timeout';
type Graded = { signal: Signal; outcome: Outcome; rMultiple: number };

function gradeSignal(signal: Signal, future: Candle[]): Graded {
  const { side, entryHint, stopHint, tp1Hint } = signal;
  const R = Math.abs(entryHint - stopHint);
  if (R === 0) return { signal, outcome: 'timeout', rMultiple: 0 };

  for (const c of future) {
    if (side === 'long') {
      if (c.low <= stopHint) return { signal, outcome: 'loss', rMultiple: -1 };
      if (c.high >= tp1Hint) return { signal, outcome: 'win', rMultiple: (tp1Hint - entryHint) / R };
    } else {
      if (c.high >= stopHint) return { signal, outcome: 'loss', rMultiple: -1 };
      if (c.low <= tp1Hint) return { signal, outcome: 'win', rMultiple: (entryHint - tp1Hint) / R };
    }
  }
  return { signal, outcome: 'timeout', rMultiple: 0 };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function summarize(label: string, graded: Graded[]): void {
  if (graded.length === 0) {
    console.log(`${label.padEnd(28)} ${'0'.padStart(5)} signals`);
    return;
  }
  const wins = graded.filter((g) => g.outcome === 'win').length;
  const losses = graded.filter((g) => g.outcome === 'loss').length;
  const timeouts = graded.filter((g) => g.outcome === 'timeout').length;
  const closed = wins + losses;
  const wr = closed === 0 ? 0 : wins / closed;
  const totalR = graded.reduce((s, g) => s + g.rMultiple, 0);
  const avgR = totalR / graded.length;
  console.log(
    `${label.padEnd(28)} ${graded.length.toString().padStart(5)} signals  ` +
      `W ${wins.toString().padStart(3)} / L ${losses.toString().padStart(3)} / T ${timeouts.toString().padStart(3)}  ` +
      `WR ${pct(wr).padStart(6)}  avgR ${avgR.toFixed(2).padStart(6)}  totalR ${totalR.toFixed(1).padStart(7)}`,
  );
}

async function replaySymbol(
  symbol: Symbol,
  days: number,
  lookahead: number,
): Promise<{ sweep: Graded[]; smaCross: Graded[] }> {
  const end = Date.now();
  const start = end - days * DAY;

  process.stderr.write(`Fetching ${symbol} (1m klines + 5m OI)... `);
  const [candles, oi] = await Promise.all([fetchKlines(symbol, start, end), fetchOiHist(symbol, start, end)]);
  process.stderr.write(`${candles.length.toLocaleString()} klines, ${oi.length} OI samples.\n`);

  candles.sort((a, b) => a.openTime - b.openTime);
  oi.sort((a, b) => a.time - b.time);

  const startIdx = Math.max(SMA_SLOW + 4, LOOKBACK + 2);
  const endIdx = candles.length - lookahead - 1;
  const sweep: Graded[] = [];
  const smaCross: Graded[] = [];
  let oiCursor = 0;

  for (let i = startIdx; i < endIdx; i++) {
    const last = candles[i];
    const candleDate = new Date(last.openTime);
    const session = classifySession(candleDate);
    if (!isActiveSession(session)) continue;

    while (oiCursor < oi.length - 1 && oi[oiCursor + 1].time <= last.closeTime) oiCursor++;
    const oiSlice = oi.slice(Math.max(0, oiCursor - 11), oiCursor + 1);
    const window = candles.slice(Math.max(0, i - (SMA_SLOW + 10)), i + 1);
    const quad = oiQuadrant(window, oiSlice);

    const sweepWindow = candles.slice(Math.max(0, i - 119), i + 1);
    const sweepSig = detectSweepReclaim(sweepWindow, {
      symbol,
      sessionStart: sessionStartMs(candleDate),
      oiQuadrant: quad,
      session,
      fundingBp: null,
      now: last.closeTime,
      volRatioMin: SCAN_VOL_RATIO,
    });
    if (sweepSig) {
      const future = candles.slice(i + 1, i + 1 + lookahead);
      sweep.push(gradeSignal(sweepSig, future));
    }

    if (i >= SMA_SLOW + 4) {
      const smaSig = detectSmaCross(window, {
        symbol,
        oiQuadrant: quad,
        session,
        fundingBp: null,
        now: last.closeTime,
      });
      if (smaSig) {
        const future = candles.slice(i + 1, i + 1 + lookahead);
        smaCross.push(gradeSignal(smaSig, future));
      }
    }
  }

  return { sweep, smaCross };
}

async function main() {
  const days = Number(process.argv[2] ?? 30);
  const lookahead = Number(process.argv[3] ?? 60);
  const end = Date.now();
  const start = end - days * DAY;

  console.log(`Backtest: ${days}d window, ${lookahead}m lookahead`);
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`From ${new Date(start).toISOString()} to ${new Date(end).toISOString()}\n`);

  const perSymbol: Record<string, { sweep: Graded[]; smaCross: Graded[] }> = {};
  for (const sym of SYMBOLS) {
    perSymbol[sym] = await replaySymbol(sym, days, lookahead);
  }

  // Per-symbol reports
  console.log('\n////// PER-SYMBOL SUMMARY //////\n');
  for (const sym of SYMBOLS) {
    const { sweep, smaCross } = perSymbol[sym];
    console.log(`\n========== ${sym} ==========`);

    console.log('\n  Sweep+Reclaim (volRatio ≥ 1.5):');
    const sweepProd = sweep.filter((g) => g.signal.volRatio >= 1.5);
    summarize('    total', sweepProd);
    for (const s of ['london', 'overlap', 'ny'] as const) {
      summarize(`    ${s}`, sweepProd.filter((g) => g.signal.session === s));
    }

    console.log('\n  SMA Cross:');
    summarize('    total', smaCross);
    for (const s of ['london', 'overlap', 'ny'] as const) {
      summarize(`    ${s}`, smaCross.filter((g) => g.signal.session === s));
    }
  }

  // Cross-symbol aggregate
  console.log('\n\n////// CROSS-SYMBOL AGGREGATE //////\n');
  const allSweep = SYMBOLS.flatMap((s) => perSymbol[s].sweep.filter((g) => g.signal.volRatio >= 1.5));
  const allSma = SYMBOLS.flatMap((s) => perSymbol[s].smaCross);

  console.log('Sweep+Reclaim (volRatio ≥ 1.5) totals:');
  summarize('  combined', allSweep);
  for (const sym of SYMBOLS) {
    summarize(`  ${sym}`, allSweep.filter((g) => g.signal.symbol === sym));
  }

  console.log('\nSMA Cross totals:');
  summarize('  combined', allSma);
  for (const sym of SYMBOLS) {
    summarize(`  ${sym}`, allSma.filter((g) => g.signal.symbol === sym));
  }

  // Symbol × side × session for sweep (the bucket where we have enough data to slice)
  console.log('\n\n////// SWEEP+RECLAIM: symbol × side × session //////');
  for (const sym of SYMBOLS) {
    console.log(`\n  ${sym}:`);
    for (const side of ['long', 'short'] as const) {
      for (const s of ['london', 'overlap', 'ny'] as const) {
        summarize(`    ${side} ${s}`, allSweep.filter((g) => g.signal.symbol === sym && g.signal.side === side && g.signal.session === s));
      }
    }
  }

  console.log('\n=== Outcome interpretation ===');
  console.log('  WR = wins / (wins + losses), excludes timeouts');
  console.log('  avgR includes timeouts as 0R');
  console.log(`  Win = TP1 hit before stop within ${lookahead} min lookahead`);
  console.log('  sweep TP1 = range midpoint; sma-cross TP1 = entry + 1R');
}

main().catch((e) => {
  console.error('\n[backtest] error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
