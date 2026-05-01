import type { Candle, OiQuadrant, Session, Signal } from '../types';
import { anchoredVwap } from '../indicators/vwap';
import { meanVolume } from '../indicators/volume';

export const LOOKBACK = 30;
export const VOL_RATIO_MIN = 1.5;
export const LEVEL_BUCKET_USD = 10;

export type DetectorContext = {
  sessionStart: number;
  oiQuadrant: OiQuadrant;
  session: Session;
  fundingBp: number | null;
  now?: number;
  volRatioMin?: number;
};

export function detectSweepReclaim(
  candles: Candle[],
  ctx: DetectorContext,
): Signal | null {
  if (candles.length < LOOKBACK + 1) return null;

  const last = candles[candles.length - 1];
  const recent = candles.slice(-1 - LOOKBACK, -1);
  if (recent.length < LOOKBACK) return null;

  let rangeHigh = recent[0].high;
  let rangeLow = recent[0].low;
  for (const c of recent) {
    if (c.high > rangeHigh) rangeHigh = c.high;
    if (c.low < rangeLow) rangeLow = c.low;
  }

  const refMean = meanVolume(recent);
  const volRatio = refMean === 0 ? 0 : last.volume / refMean;

  const vwap = anchoredVwap(candles, ctx.sessionStart);
  if (vwap === null) return null;

  const ts = ctx.now ?? last.closeTime;
  const aPlus = ctx.session === 'overlap';
  const volMin = ctx.volRatioMin ?? VOL_RATIO_MIN;

  const rangeMid = (rangeHigh + rangeLow) / 2;

  if (last.low < rangeLow && last.close > rangeLow && volRatio >= volMin && last.close > vwap) {
    return {
      id: `${ts}-long-${bucket(rangeLow)}`,
      ts,
      side: 'long',
      sweptLevel: rangeLow,
      entryHint: last.close,
      stopHint: last.low,
      tp1Hint: rangeMid,
      tp2Hint: rangeHigh,
      volRatio,
      vwap,
      oiQuadrant: ctx.oiQuadrant,
      session: ctx.session,
      aPlus,
      fundingBp: ctx.fundingBp,
    };
  }

  if (last.high > rangeHigh && last.close < rangeHigh && volRatio >= volMin && last.close < vwap) {
    return {
      id: `${ts}-short-${bucket(rangeHigh)}`,
      ts,
      side: 'short',
      sweptLevel: rangeHigh,
      entryHint: last.close,
      stopHint: last.high,
      tp1Hint: rangeMid,
      tp2Hint: rangeLow,
      volRatio,
      vwap,
      oiQuadrant: ctx.oiQuadrant,
      session: ctx.session,
      aPlus,
      fundingBp: ctx.fundingBp,
    };
  }

  return null;
}

export function bucket(price: number): number {
  return Math.round(price / LEVEL_BUCKET_USD) * LEVEL_BUCKET_USD;
}
