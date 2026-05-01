import type { Candle, OiSample, OiQuadrant } from './types';

export function oiQuadrant(
  candles: Candle[],
  oi: OiSample[],
  windowMs = 15 * 60 * 1000,
): OiQuadrant {
  if (candles.length < 2 || oi.length < 2) return 'unknown';

  const last = candles[candles.length - 1];
  const priceCutoff = last.openTime - windowMs;
  const pastCandle = [...candles].reverse().find((c) => c.openTime <= priceCutoff);
  if (!pastCandle) return 'unknown';

  const priceUp = last.close > pastCandle.close;

  const lastOi = oi[oi.length - 1].openInterest;
  const oiCutoff = oi[oi.length - 1].time - windowMs;
  const pastOi = [...oi].reverse().find((s) => s.time <= oiCutoff) ?? oi[0];
  const oiUp = lastOi > pastOi.openInterest;

  if (priceUp && oiUp) return 'longs-entering';
  if (priceUp && !oiUp) return 'short-cover';
  if (!priceUp && oiUp) return 'shorts-entering';
  return 'long-liquidation';
}
