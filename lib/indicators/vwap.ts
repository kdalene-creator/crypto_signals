import type { Candle } from '../types';

export function anchoredVwap(candles: Candle[], anchorMs: number): number | null {
  let pv = 0;
  let v = 0;
  for (const c of candles) {
    if (c.openTime < anchorMs) continue;
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    v += c.volume;
  }
  if (v === 0) return null;
  return pv / v;
}
