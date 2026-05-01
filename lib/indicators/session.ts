import type { Candle, Session } from '../types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function classifySession(now: Date): Session {
  const h = now.getUTCHours();
  if (h >= 12 && h < 16) return 'overlap';
  if (h >= 7 && h < 12) return 'london';
  if (h >= 16 && h < 21) return 'ny';
  if (h >= 0 && h < 7) return 'asia';
  return 'dead';
}

export function isActiveSession(s: Session): boolean {
  return s === 'london' || s === 'ny' || s === 'overlap';
}

export function sessionStartMs(now: Date): number {
  const s = classifySession(now);
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  switch (s) {
    case 'asia':
      return utcMidnight;
    case 'london':
    case 'overlap':
      return utcMidnight + 7 * HOUR_MS;
    case 'ny':
      return utcMidnight + 16 * HOUR_MS;
    case 'dead':
      return utcMidnight - DAY_MS + 21 * HOUR_MS;
  }
}

export function sessionHighLow(
  candles: Candle[],
  startMs: number,
): { high: number; low: number } | null {
  const closed = candles.slice(0, -1).filter((c) => c.openTime >= startMs);
  if (closed.length === 0) return null;
  let high = closed[0].high;
  let low = closed[0].low;
  for (const c of closed) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  return { high, low };
}
