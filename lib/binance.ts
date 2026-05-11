import type { Candle, OiSample } from './types';

const FAPI = 'https://fapi.binance.com';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Binance ${res.status}: ${url} — ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

type RawKline = [
  number, // openTime
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // closeTime
  string, // quoteVolume
  number, // trades
  string, // takerBuyBase
  string, // takerBuyQuote
  string, // ignore
];

export async function getKlines(
  symbol = 'BTCUSDT',
  interval = '1m',
  limit = 260,
): Promise<Candle[]> {
  const raw = await fetchJson<RawKline[]>(
    `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
  return raw.map((k) => ({
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: k[6],
  }));
}

type RawOi = { sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number };

export async function getOpenInterestHist(
  symbol = 'BTCUSDT',
  period: '5m' | '15m' | '30m' | '1h' = '5m',
  limit = 12,
): Promise<OiSample[]> {
  const raw = await fetchJson<RawOi[]>(
    `${FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`,
  );
  return raw.map((s) => ({ time: s.timestamp, openInterest: Number(s.sumOpenInterest) }));
}

type RawPremium = { lastFundingRate: string };

export async function getFundingRateBp(symbol = 'BTCUSDT'): Promise<number | null> {
  try {
    const raw = await fetchJson<RawPremium>(`${FAPI}/fapi/v1/premiumIndex?symbol=${symbol}`);
    return Number(raw.lastFundingRate) * 10_000;
  } catch {
    return null;
  }
}
