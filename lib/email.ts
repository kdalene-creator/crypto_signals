import { Resend } from 'resend';
import type { Signal } from './types';

let _resend: Resend | null = null;

function resend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY must be set');
  _resend = new Resend(key);
  return _resend;
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function quadrantBlurb(side: Signal['side'], q: Signal['oiQuadrant']): string {
  if (q === 'unknown') return 'OI: insufficient data';
  const map: Record<Signal['oiQuadrant'], string> = {
    'longs-entering': 'longs entering (continuation possible)',
    'short-cover': 'short covering (squeeze, may fade)',
    'shorts-entering': 'shorts entering (continuation possible)',
    'long-liquidation': 'long liquidation (watch for reversal)',
    unknown: 'unknown',
  };
  return `OI: ${map[q]}`;
}

// Tier classification based on 30d backtest (2026-04 to 2026-05).
// A++ = long sweep+reclaim during overlap (12-16 UTC) — 61% WR, +0.42 avgR
// A+  = any sweep during overlap (mixed quality, longs > shorts)
// (none) = London-only or NY-only sweep — broadly unprofitable in backtest
function tierTag(signal: Signal): { short: string; blurb: string } {
  const isHighEdge = signal.side === 'long' && signal.session === 'overlap';
  if (isHighEdge) return { short: 'A++ ', blurb: 'A++ (long+overlap — backtested edge bucket)' };
  if (signal.aPlus) return { short: 'A+ ', blurb: 'A+ (overlap window, mixed)' };
  return { short: '', blurb: 'no tier (single-session, low backtest edge)' };
}

export function renderSignalEmail(signal: Signal): { subject: string; text: string } {
  const sideTag = signal.side.toUpperCase();
  const tier = tierTag(signal);
  const subject = `[BTC SCALP ${tier.short}${sideTag}] Sweep+Reclaim @ ${fmt(signal.sweptLevel, 0)}`;

  const r = (signal.entryHint - signal.stopHint) * (signal.side === 'long' ? 1 : -1);
  const tp1R = ((signal.tp1Hint - signal.entryHint) * (signal.side === 'long' ? 1 : -1)) / Math.max(Math.abs(r), 1e-9);
  const tp2R = ((signal.tp2Hint - signal.entryHint) * (signal.side === 'long' ? 1 : -1)) / Math.max(Math.abs(r), 1e-9);

  const lines = [
    `Side: ${sideTag}`,
    `Tier: ${tier.blurb}`,
    `Session: ${signal.session}`,
    `Time: ${new Date(signal.ts).toISOString()}`,
    '',
    `Swept level: ${fmt(signal.sweptLevel, 0)}`,
    `Entry hint:  ${fmt(signal.entryHint, 1)}`,
    `Stop hint:   ${fmt(signal.stopHint, 1)}  (risk ${fmt(Math.abs(r), 1)} USD)`,
    `TP1:         ${fmt(signal.tp1Hint, 1)}  (~${tp1R.toFixed(2)}R, range mid)`,
    `TP2:         ${fmt(signal.tp2Hint, 1)}  (~${tp2R.toFixed(2)}R, opposite extreme)`,
    '',
    `Vol vs avg:  ${signal.volRatio.toFixed(2)}x`,
    `Session VWAP: ${fmt(signal.vwap, 1)}`,
    quadrantBlurb(signal.side, signal.oiQuadrant),
    signal.fundingBp === null ? 'Funding: n/a' : `Funding: ${signal.fundingBp.toFixed(2)} bp`,
    '',
    'Information only — not financial advice. Verify on chart before acting.',
  ];

  return { subject, text: lines.join('\n') };
}

export async function sendSignalEmail(signal: Signal): Promise<void> {
  const to = process.env.ALERT_TO_EMAIL;
  const from = process.env.ALERT_FROM_EMAIL ?? 'onboarding@resend.dev';
  if (!to) throw new Error('ALERT_TO_EMAIL must be set');

  const { subject, text } = renderSignalEmail(signal);
  const result = await resend().emails.send({ from, to, subject, text });
  if (result.error) {
    throw new Error(`Resend error: ${JSON.stringify(result.error)}`);
  }
}
