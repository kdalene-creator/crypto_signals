import { describe, it, expect } from 'vitest';
import type { Candle } from '../lib/types';
import { detectSweepReclaim, LOOKBACK } from '../lib/playbooks/sweep-reclaim';

const MINUTE = 60_000;
const SESSION_START = 0;

function candle(i: number, o: number, h: number, l: number, c: number, v: number): Candle {
  const openTime = i * MINUTE;
  return { openTime, open: o, high: h, low: l, close: c, volume: v, closeTime: openTime + MINUTE - 1 };
}

function rangeCandles(count: number, low: number, high: number, vol: number): Candle[] {
  const mid = (low + high) / 2;
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const open = mid + (i % 2 === 0 ? -1 : 1);
    const close = mid + (i % 2 === 0 ? 1 : -1);
    out.push(candle(i, open, high, low, close, vol));
  }
  return out;
}

const baseCtx = {
  symbol: 'BTCUSDT' as const,
  sessionStart: SESSION_START,
  oiQuadrant: 'shorts-entering' as const,
  session: 'overlap' as const,
  fundingBp: 1.5,
};

describe('detectSweepReclaim', () => {
  it('returns null without enough candles', () => {
    const candles = rangeCandles(5, 100, 200, 50);
    expect(detectSweepReclaim(candles, baseCtx)).toBeNull();
  });

  it('detects a long sweep+reclaim with VWAP above and volume spike', () => {
    const range = rangeCandles(LOOKBACK, 100, 200, 50);
    const sweep = candle(LOOKBACK, 110, 165, 90, 160, 500);
    const candles = [...range, sweep];
    const sig = detectSweepReclaim(candles, baseCtx);
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe('long');
    expect(sig!.sweptLevel).toBe(100);
    expect(sig!.entryHint).toBe(160);
    expect(sig!.stopHint).toBe(90);
    expect(sig!.tp1Hint).toBe(150);
    expect(sig!.tp2Hint).toBe(200);
    expect(sig!.aPlus).toBe(true);
    expect(sig!.volRatio).toBeGreaterThanOrEqual(1.5);
  });

  it('detects a short sweep+rejection mirror', () => {
    const range = rangeCandles(LOOKBACK, 100, 200, 50);
    const sweep = candle(LOOKBACK, 195, 215, 130, 135, 500);
    const candles = [...range, sweep];
    const sig = detectSweepReclaim(candles, baseCtx);
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe('short');
    expect(sig!.sweptLevel).toBe(200);
    expect(sig!.entryHint).toBe(135);
    expect(sig!.stopHint).toBe(215);
    expect(sig!.tp1Hint).toBe(150);
    expect(sig!.tp2Hint).toBe(100);
  });

  it('rejects sweep without volume spike', () => {
    const range = rangeCandles(LOOKBACK, 100, 200, 50);
    const sweep = candle(LOOKBACK, 110, 165, 90, 160, 55);
    const candles = [...range, sweep];
    expect(detectSweepReclaim(candles, baseCtx)).toBeNull();
  });

  it('rejects sweep that closes below VWAP for a long', () => {
    const range = rangeCandles(LOOKBACK, 100, 200, 50);
    const sweep = candle(LOOKBACK, 110, 145, 90, 105, 500);
    const candles = [...range, sweep];
    expect(detectSweepReclaim(candles, baseCtx)).toBeNull();
  });

  it('rejects sweep that fails to reclaim (close below the swept low)', () => {
    const range = rangeCandles(LOOKBACK, 100, 200, 50);
    const sweep = candle(LOOKBACK, 110, 165, 80, 90, 500);
    const candles = [...range, sweep];
    expect(detectSweepReclaim(candles, baseCtx)).toBeNull();
  });

  it('flags non-overlap sessions as not A+', () => {
    const range = rangeCandles(LOOKBACK, 100, 200, 50);
    const sweep = candle(LOOKBACK, 110, 165, 90, 160, 500);
    const candles = [...range, sweep];
    const sig = detectSweepReclaim(candles, { ...baseCtx, session: 'london' });
    expect(sig?.aPlus).toBe(false);
  });
});
