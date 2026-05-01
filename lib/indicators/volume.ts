import type { Candle } from '../types';

export function meanVolume(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
}

export function volumeRatio(candle: Candle, ref: Candle[]): number {
  const mean = meanVolume(ref);
  if (mean === 0) return 0;
  return candle.volume / mean;
}
