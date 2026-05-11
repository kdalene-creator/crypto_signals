import type { Candle } from '../types';

/**
 * Simple moving average over the last `period` candles ending at `endIdx`
 * (inclusive). If endIdx is omitted, uses the last candle.
 * Returns null if there aren't enough candles for a full window.
 */
export function sma(candles: Candle[], period: number, endIdx?: number): number | null {
  const end = endIdx ?? candles.length - 1;
  const start = end - period + 1;
  if (start < 0) return null;
  let sum = 0;
  for (let i = start; i <= end; i++) sum += candles[i].close;
  return sum / period;
}
