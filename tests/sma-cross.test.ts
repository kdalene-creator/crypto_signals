import { describe, it, expect } from 'vitest';
import type { Candle } from '../lib/types';
import { detectSmaCross, SMA_FAST } from '../lib/playbooks/sma-cross';
import { sma } from '../lib/indicators/sma';

const MIN = 60_000;

function mkCandle(i: number, close: number, open?: number, high?: number, low?: number): Candle {
  const o = open ?? close;
  const h = high ?? Math.max(o, close) + 0.1;
  const l = low ?? Math.min(o, close) - 0.1;
  return {
    openTime: i * MIN,
    open: o,
    high: h,
    low: l,
    close,
    volume: 50,
    closeTime: i * MIN + MIN - 1,
  };
}

/** Build a `n`-candle linear uptrend used as a base for SMA-cross fixtures. */
function uptrend(n: number, startClose = 100, slope = 0.5): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const close = startClose + i * slope;
    const open = close - slope * 0.5;
    out.push(mkCandle(i, close, open));
  }
  return out;
}

const baseCtx = {
  oiQuadrant: 'longs-entering' as const,
  session: 'overlap' as const,
  fundingBp: 1.5,
};

describe('detectSmaCross', () => {
  it('returns null without enough history for SMA200', () => {
    expect(detectSmaCross(uptrend(50), baseCtx)).toBeNull();
  });

  it('detects a long cross+confirms in a stacked uptrend', () => {
    const candles = uptrend(246); // idx 0..245 trending up
    // idx 246 (prevCross): pull back below SMA20
    const sma20At245 = sma(candles, SMA_FAST, 245)!;
    const prevClose = sma20At245 - 5;
    candles.push(mkCandle(246, prevClose, prevClose + 1, prevClose + 1, prevClose - 1));
    // idx 247 (cross): close back above SMA20
    const sma20At246 = sma(candles, SMA_FAST, 246)!;
    const crossClose = sma20At246 + 8;
    candles.push(mkCandle(247, crossClose, sma20At246 - 3, crossClose + 0.5, sma20At246 - 4));
    // idx 248 (confirm1): strong bull, low === open, close > open
    const c1Open = crossClose + 0.5;
    candles.push(mkCandle(248, c1Open + 4, c1Open, c1Open + 4.5, c1Open));
    // idx 249 (confirm2): strong bull, low === open, close > open
    const c2Open = c1Open + 4.5;
    candles.push(mkCandle(249, c2Open + 3, c2Open, c2Open + 3.5, c2Open));

    const sig = detectSmaCross(candles, baseCtx);
    expect(sig).not.toBeNull();
    expect(sig!.playbook).toBe('sma-cross');
    expect(sig!.side).toBe('long');
    expect(sig!.entryHint).toBe(c2Open + 3);
    expect(sig!.stopHint).toBeLessThanOrEqual(sig!.entryHint);
    // TP1 is 1R, TP2 is 2R
    const R = sig!.entryHint - sig!.stopHint;
    expect(sig!.tp1Hint).toBeCloseTo(sig!.entryHint + R, 5);
    expect(sig!.tp2Hint).toBeCloseTo(sig!.entryHint + 2 * R, 5);
  });

  it('rejects long when confirm1 has a lower wick (low < open)', () => {
    const candles = uptrend(246);
    const sma20At245 = sma(candles, SMA_FAST, 245)!;
    const prevClose = sma20At245 - 5;
    candles.push(mkCandle(246, prevClose, prevClose + 1, prevClose + 1, prevClose - 1));
    const sma20At246 = sma(candles, SMA_FAST, 246)!;
    const crossClose = sma20At246 + 8;
    candles.push(mkCandle(247, crossClose, sma20At246 - 3, crossClose + 0.5, sma20At246 - 4));
    const c1Open = crossClose + 0.5;
    // BAD confirm1: lower wick — low < open
    candles.push(mkCandle(248, c1Open + 4, c1Open, c1Open + 4.5, c1Open - 0.5));
    const c2Open = c1Open + 4.5;
    candles.push(mkCandle(249, c2Open + 3, c2Open, c2Open + 3.5, c2Open));
    expect(detectSmaCross(candles, baseCtx)).toBeNull();
  });

  it('rejects long when confirm2 is bearish (close < open)', () => {
    const candles = uptrend(246);
    const sma20At245 = sma(candles, SMA_FAST, 245)!;
    candles.push(mkCandle(246, sma20At245 - 5, sma20At245 - 4, sma20At245 - 4, sma20At245 - 6));
    const sma20At246 = sma(candles, SMA_FAST, 246)!;
    const crossClose = sma20At246 + 8;
    candles.push(mkCandle(247, crossClose, sma20At246 - 3, crossClose + 0.5, sma20At246 - 4));
    const c1Open = crossClose + 0.5;
    candles.push(mkCandle(248, c1Open + 4, c1Open, c1Open + 4.5, c1Open));
    const c2Open = c1Open + 4.5;
    // BAD confirm2: bearish close
    candles.push(mkCandle(249, c2Open - 1, c2Open, c2Open + 0.5, c2Open - 1.5));
    expect(detectSmaCross(candles, baseCtx)).toBeNull();
  });

  it('rejects when prev candle was already above SMA20 (no cross-up)', () => {
    const candles = uptrend(246);
    const sma20At245 = sma(candles, SMA_FAST, 245)!;
    // prev candle ABOVE SMA20 — no cross will fire
    const prevClose = sma20At245 + 5;
    candles.push(mkCandle(246, prevClose, prevClose - 1, prevClose + 1, prevClose - 1));
    const sma20At246 = sma(candles, SMA_FAST, 246)!;
    const crossClose = sma20At246 + 8;
    candles.push(mkCandle(247, crossClose, sma20At246 + 2, crossClose + 0.5, sma20At246 + 1));
    const c1Open = crossClose + 0.5;
    candles.push(mkCandle(248, c1Open + 4, c1Open, c1Open + 4.5, c1Open));
    const c2Open = c1Open + 4.5;
    candles.push(mkCandle(249, c2Open + 3, c2Open, c2Open + 3.5, c2Open));
    expect(detectSmaCross(candles, baseCtx)).toBeNull();
  });

  it('rejects when trend is not stacked (downtrending base)', () => {
    // Downtrend: SMA stack will be reversed (20<50<200), so a long cross filter fails
    const candles: Candle[] = [];
    for (let i = 0; i < 246; i++) {
      const close = 300 - i * 0.5;
      candles.push(mkCandle(i, close, close + 0.25));
    }
    const sma20At245 = sma(candles, SMA_FAST, 245)!;
    candles.push(mkCandle(246, sma20At245 - 5, sma20At245 - 4));
    const sma20At246 = sma(candles, SMA_FAST, 246)!;
    candles.push(mkCandle(247, sma20At246 + 8, sma20At246 - 3));
    const c1Open = sma20At246 + 8.5;
    candles.push(mkCandle(248, c1Open + 4, c1Open, c1Open + 4.5, c1Open));
    const c2Open = c1Open + 4.5;
    candles.push(mkCandle(249, c2Open + 3, c2Open, c2Open + 3.5, c2Open));
    expect(detectSmaCross(candles, baseCtx)).toBeNull();
  });

  it('detects a short cross+confirms in a stacked downtrend', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 246; i++) {
      const close = 300 - i * 0.5;
      candles.push(mkCandle(i, close, close + 0.25));
    }
    // idx 246: rally above SMA20 (the "prev" candle for a short cross-down)
    const sma20At245 = sma(candles, SMA_FAST, 245)!;
    const prevClose = sma20At245 + 5;
    candles.push(mkCandle(246, prevClose, prevClose - 1, prevClose + 1, prevClose - 1));
    // idx 247: cross back down below SMA20
    const sma20At246 = sma(candles, SMA_FAST, 246)!;
    const crossClose = sma20At246 - 8;
    candles.push(mkCandle(247, crossClose, sma20At246 + 3, sma20At246 + 4, crossClose - 0.5));
    // idx 248: strong bear (high === open, close < open)
    const c1Open = crossClose - 0.5;
    candles.push(mkCandle(248, c1Open - 4, c1Open, c1Open, c1Open - 4.5));
    const c2Open = c1Open - 4.5;
    candles.push(mkCandle(249, c2Open - 3, c2Open, c2Open, c2Open - 3.5));

    const sig = detectSmaCross(candles, baseCtx);
    expect(sig).not.toBeNull();
    expect(sig!.side).toBe('short');
    expect(sig!.entryHint).toBe(c2Open - 3);
    expect(sig!.stopHint).toBeGreaterThanOrEqual(sig!.entryHint);
  });
});
