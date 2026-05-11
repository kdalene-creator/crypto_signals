/**
 * Historical backtest for both playbooks: sweep+reclaim and sma-cross.
 *
 * Pulls 1m klines + 5m OI from Binance Futures (no auth), replays the
 * detectors candle-by-candle through historical data, grades each fired
 * signal against subsequent price action, and prints a summary report.
 *
 * Usage: npm run backtest -- [days] [lookahead-minutes]
 *   defaults: 30 days, 60 min lookahead
 */
import type { Candle, OiSample, Signal } from '../lib/types';
import { detectSweepReclaim, LOOKBACK } from '../lib/playbooks/sweep-reclaim';
import { detectSmaCross, SMA_SLOW } from '../lib/playbooks/sma-cross';
import { classifySession, isActiveSession, sessionStartMs } from '../lib/indicators/session';
import { oiQuadrant } from '../lib/oi';

const FAPI = 'https://fapi.binance.com';
const SYMBOL = 'BTCUSDT';
const MIN = 60_000;
const HR = 60 * MIN;
const DAY = 24 * HR;

// Permissive sweep threshold during backtest so we can do a sensitivity sweep
// post-hoc by filtering on signal.volRatio.
const SCAN_VOL_RATIO = 1.0;

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];
type RawOi = { sumOpenInterest: string; timestamp: number };

async function fetchKlines(start: number, end: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = start;
  while (cursor < end) {
    const url = `${FAPI}/fapi/v1/klines?symbol=${SYMBOL}&interval=1m&startTime=${cursor}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`klines ${res.status}: ${await res.text()}`);
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
    process.stderr.write(`  klines: ${out.length.toLocaleString()} (${new Date(cursor).toISOString().slice(0, 16)})\r`);
    if (raw.length < 1500) break;
  }
  process.stderr.write('\n');
  return out;
}

async function fetchOiHist(start: number, end: number): Promise<OiSample[]> {
  // Binance retains ~30d of OI hist. Walk forward from a safe offset.
  const out: OiSample[] = [];
  const SAFE_OFFSET = 25 * DAY;
  let cursor = Math.max(start, Date.now() - SAFE_OFFSET);
  while (cursor < end) {
    const url = `${FAPI}/futures/data/openInterestHist?symbol=${SYMBOL}&period=5m&startTime=${cursor}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) {
      process.stderr.write(`  oi:     skipping (${res.status}); detectors will tag quadrant=unknown\n`);
      return [];
    }
    const raw = (await res.json()) as RawOi[];
    if (raw.length === 0) break;
    for (const s of raw) out.push({ time: s.timestamp, openInterest: +s.sumOpenInterest });
    const lastT = raw[raw.length - 1].timestamp;
    if (lastT <= cursor) break;
    cursor = lastT + 1;
    process.stderr.write(`  oi:     ${out.length.toLocaleString()} (${new Date(cursor).toISOString().slice(0, 16)})\r`);
    if (raw.length < 500) break;
  }
  process.stderr.write('\n');
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
    console.log(`${label.padEnd(22)} ${'0'.padStart(5)} signals`);
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
    `${label.padEnd(22)} ${graded.length.toString().padStart(5)} signals  ` +
      `W ${wins.toString().padStart(3)} / L ${losses.toString().padStart(3)} / T ${timeouts.toString().padStart(3)}  ` +
      `WR ${pct(wr).padStart(6)}  avgR ${avgR.toFixed(2).padStart(6)}  totalR ${totalR.toFixed(1).padStart(7)}`,
  );
}

function reportPlaybook(label: string, graded: Graded[], days: number): void {
  console.log(`\n========== ${label} ==========`);
  summarize('  total', graded);
  console.log(`  (${(graded.length / days).toFixed(1)} signals/day on average)`);
  console.log('\n  by session:');
  for (const s of ['london', 'overlap', 'ny'] as const) {
    summarize(`    ${s}`, graded.filter((g) => g.signal.session === s));
  }
  console.log('\n  by side × session:');
  for (const side of ['long', 'short'] as const) {
    for (const s of ['london', 'overlap', 'ny'] as const) {
      summarize(`    ${side} ${s}`, graded.filter((g) => g.signal.session === s && g.signal.side === side));
    }
  }
}

async function main() {
  const days = Number(process.argv[2] ?? 30);
  const lookahead = Number(process.argv[3] ?? 60);
  const end = Date.now();
  const start = end - days * DAY;

  console.log(`Backtest BTCUSDT-PERP: ${days}d window, ${lookahead}m lookahead`);
  console.log(`From ${new Date(start).toISOString()} to ${new Date(end).toISOString()}\n`);

  console.log('Fetching candles + open interest...');
  const [candles, oi] = await Promise.all([fetchKlines(start, end), fetchOiHist(start, end)]);
  console.log(`Got ${candles.length.toLocaleString()} klines, ${oi.length.toLocaleString()} OI samples.\n`);

  candles.sort((a, b) => a.openTime - b.openTime);
  oi.sort((a, b) => a.time - b.time);

  console.log('Replaying detectors...');
  // sma-cross needs SMA_SLOW (200) candles minimum; sweep needs LOOKBACK (30).
  const startIdx = Math.max(SMA_SLOW + 4, LOOKBACK + 2);
  const endIdx = candles.length - lookahead - 1;
  const gradedSweep: Graded[] = [];
  const gradedSma: Graded[] = [];
  let oiCursor = 0;

  for (let i = startIdx; i < endIdx; i++) {
    const last = candles[i];
    const candleDate = new Date(last.openTime);
    const session = classifySession(candleDate);
    if (!isActiveSession(session)) continue;

    while (oiCursor < oi.length - 1 && oi[oiCursor + 1].time <= last.closeTime) oiCursor++;
    const oiSlice = oi.slice(Math.max(0, oiCursor - 11), oiCursor + 1);
    const quad = oiQuadrant(candles.slice(Math.max(0, i - 119), i + 1), oiSlice);

    // sweep-reclaim uses a smaller window (last 120 candles is plenty)
    const sweepWindow = candles.slice(Math.max(0, i - 119), i + 1);
    const sweep = detectSweepReclaim(sweepWindow, {
      sessionStart: sessionStartMs(candleDate),
      oiQuadrant: quad,
      session,
      fundingBp: null,
      now: last.closeTime,
      volRatioMin: SCAN_VOL_RATIO,
    });
    if (sweep) {
      const future = candles.slice(i + 1, i + 1 + lookahead);
      gradedSweep.push(gradeSignal(sweep, future));
    }

    // sma-cross needs at least 204 candles of history
    if (i >= SMA_SLOW + 4) {
      const smaWindow = candles.slice(Math.max(0, i - (SMA_SLOW + 10)), i + 1);
      const smaSig = detectSmaCross(smaWindow, {
        oiQuadrant: quad,
        session,
        fundingBp: null,
        now: last.closeTime,
      });
      if (smaSig) {
        const future = candles.slice(i + 1, i + 1 + lookahead);
        gradedSma.push(gradeSignal(smaSig, future));
      }
    }
  }

  // ===== Sweep+Reclaim report =====
  console.log('\n////// SWEEP+RECLAIM //////');
  console.log(`Replay produced ${gradedSweep.length} candidate signals (volRatio >= ${SCAN_VOL_RATIO}).`);

  console.log('\n=== Threshold sensitivity (volRatio ≥ X) ===');
  for (const min of [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]) {
    summarize(`volRatio≥${min}`, gradedSweep.filter((g) => g.signal.volRatio >= min));
  }
  reportPlaybook('Sweep+Reclaim at production (volRatio ≥ 1.5)', gradedSweep.filter((g) => g.signal.volRatio >= 1.5), days);

  // ===== SMA Cross report =====
  console.log('\n////// SMA CROSS //////');
  reportPlaybook('SMA Cross (all signals)', gradedSma, days);

  // ===== Combined recommendation =====
  console.log('\n=== Outcome interpretation ===');
  console.log('  WR = wins / (wins + losses), excludes timeouts');
  console.log('  avgR includes timeouts as 0R (open trade closed flat)');
  console.log('  A profitable strategy needs avgR > 0 AND a usable signal count');
  console.log(`  Win = TP1 hit before stop within ${lookahead} min lookahead`);
  console.log('  sweep TP1 = range midpoint; sma-cross TP1 = entry + 1R');
}

main().catch((e) => {
  console.error('\n[backtest] error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
