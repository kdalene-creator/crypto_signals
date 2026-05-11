import type { Candle, OiQuadrant, Session, Signal } from '../types';
import { sma } from '../indicators/sma';

export const SMA_FAST = 20;
export const SMA_MID = 50;
export const SMA_SLOW = 200;
export const SMA_LEVEL_BUCKET_USD = 10;

/** A 'strong' bullish candle has close>open AND no lower wick (low>=open).
 *  Short mirror has close<open AND no upper wick (high<=open). */
function strongBull(c: Candle): boolean {
  return c.close > c.open && c.low >= c.open;
}
function strongBear(c: Candle): boolean {
  return c.close < c.open && c.high <= c.open;
}

export type SmaCrossContext = {
  oiQuadrant: OiQuadrant;
  session: Session;
  fundingBp: number | null;
  now?: number;
};

function bucket(price: number): number {
  return Math.round(price / SMA_LEVEL_BUCKET_USD) * SMA_LEVEL_BUCKET_USD;
}

/**
 * Detects the trend-pullback cross setup.
 *
 * Pattern (long; short is mirror):
 *   t-3: previous candle, close was below 20 SMA
 *   t-2: cross candle — closes above 20 SMA
 *   t-1: confirm 1 — strong bull (close>open, low>=open)
 *   t  : confirm 2 — strong bull (close>open, low>=open)
 *   Trend filter at t: 20 SMA > 50 SMA > 200 SMA
 *
 * Stop = lowest low across cross + 2 confirms.
 * TP1 = entry + 1R, TP2 = entry + 2R, where R = entry - stop.
 */
export function detectSmaCross(
  candles: Candle[],
  ctx: SmaCrossContext,
): Signal | null {
  // Need at least SMA_SLOW + 3 candles (3 for the t-3..t pattern, plus enough history for SMA_SLOW)
  if (candles.length < SMA_SLOW + 4) return null;

  const tIdx = candles.length - 1;
  const t = candles[tIdx];
  const confirm1 = candles[tIdx - 1];
  const cross = candles[tIdx - 2];
  const prevCross = candles[tIdx - 3];

  // Trend filter at t — all SMAs computed on closes up to and including t.
  const sma20 = sma(candles, SMA_FAST, tIdx);
  const sma50 = sma(candles, SMA_MID, tIdx);
  const sma200 = sma(candles, SMA_SLOW, tIdx);
  if (sma20 === null || sma50 === null || sma200 === null) return null;

  // Cross-candle SMA — recompute the 20-SMA as it was at cross/prevCross close.
  const sma20AtCross = sma(candles, SMA_FAST, tIdx - 2);
  const sma20AtPrev = sma(candles, SMA_FAST, tIdx - 3);
  if (sma20AtCross === null || sma20AtPrev === null) return null;

  const ts = ctx.now ?? t.closeTime;
  const aPlus = ctx.session === 'overlap';

  // ---- LONG ----
  if (sma20 > sma50 && sma50 > sma200) {
    const crossedUp = prevCross.close < sma20AtPrev && cross.close > sma20AtCross;
    if (crossedUp && strongBull(confirm1) && strongBull(t)) {
      const entry = t.close;
      const stop = Math.min(cross.low, confirm1.low, t.low);
      const R = entry - stop;
      if (R > 0) {
        return {
          id: `${ts}-smacross-long-${bucket(entry)}`,
          ts,
          playbook: 'sma-cross',
          side: 'long',
          sweptLevel: sma20AtCross,
          entryHint: entry,
          stopHint: stop,
          tp1Hint: entry + R,
          tp2Hint: entry + 2 * R,
          volRatio: 0,
          vwap: sma20,
          oiQuadrant: ctx.oiQuadrant,
          session: ctx.session,
          aPlus,
          fundingBp: ctx.fundingBp,
        };
      }
    }
  }

  // ---- SHORT (mirror) ----
  if (sma20 < sma50 && sma50 < sma200) {
    const crossedDown = prevCross.close > sma20AtPrev && cross.close < sma20AtCross;
    if (crossedDown && strongBear(confirm1) && strongBear(t)) {
      const entry = t.close;
      const stop = Math.max(cross.high, confirm1.high, t.high);
      const R = stop - entry;
      if (R > 0) {
        return {
          id: `${ts}-smacross-short-${bucket(entry)}`,
          ts,
          playbook: 'sma-cross',
          side: 'short',
          sweptLevel: sma20AtCross,
          entryHint: entry,
          stopHint: stop,
          tp1Hint: entry - R,
          tp2Hint: entry - 2 * R,
          volRatio: 0,
          vwap: sma20,
          oiQuadrant: ctx.oiQuadrant,
          session: ctx.session,
          aPlus,
          fundingBp: ctx.fundingBp,
        };
      }
    }
  }

  return null;
}
