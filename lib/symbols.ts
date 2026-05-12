import type { Symbol } from './types';

/**
 * Symbols the bot scans every cron tick. Add a new symbol here, redeploy,
 * and it will start firing alerts. All entries must be valid USDT-margined
 * perpetuals on Binance fapi.binance.com.
 */
export const SYMBOLS: readonly Symbol[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;

/** Short label for emails and logs (without USDT suffix). */
export function shortLabel(s: Symbol): string {
  return s.replace(/USDT$/, '');
}

/**
 * Per-symbol price formatting. Picks decimal places based on rough magnitude
 * so prices in emails read naturally (BTC: "80,432" / ETH: "3,425.7" / SOL: "215.43").
 */
export function fmtPrice(s: Symbol, n: number): string {
  const digits = s === 'BTCUSDT' ? 0 : s === 'ETHUSDT' ? 1 : 2;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
