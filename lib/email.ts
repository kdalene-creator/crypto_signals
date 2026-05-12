import { Resend } from 'resend';
import type { Signal } from './types';
import { shortLabel, fmtPrice } from './symbols';

let _resend: Resend | null = null;

function resend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY must be set');
  _resend = new Resend(key);
  return _resend;
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

// Tier classification — currently CONSERVATIVE.
// Two 30d backtests gave CONFLICTING results for sweep-reclaim's "long+overlap" bucket
// (+7.6R then -4.0R). Holding off on A++ promotions until 3+ non-overlapping windows agree.
// A+ marks overlap-window context only; no proven edge.
function tierTag(signal: Signal): { short: string; blurb: string } {
  if (signal.aPlus) {
    return {
      short: 'A+ ',
      blurb: 'A+ (overlap 12-16 UTC) — backtest evidence inconclusive, do not trust on its own',
    };
  }
  return { short: '', blurb: 'no tier (single-session) — research data only' };
}

function playbookLabel(p: Signal['playbook']): string {
  return p === 'sweep-reclaim' ? 'Sweep+Reclaim' : 'SMA Cross';
}

export function renderSignalEmail(signal: Signal): { subject: string; text: string } {
  const sideTag = signal.side.toUpperCase();
  const tier = tierTag(signal);
  const sym = shortLabel(signal.symbol);
  const headerLevel = signal.playbook === 'sweep-reclaim' ? signal.sweptLevel : signal.entryHint;
  const subject = `[${sym} ${tier.short}${sideTag}] ${playbookLabel(signal.playbook)} @ ${fmtPrice(signal.symbol, headerLevel)}`;

  const r = (signal.entryHint - signal.stopHint) * (signal.side === 'long' ? 1 : -1);
  const tp1R = ((signal.tp1Hint - signal.entryHint) * (signal.side === 'long' ? 1 : -1)) / Math.max(Math.abs(r), 1e-9);
  const tp2R = ((signal.tp2Hint - signal.entryHint) * (signal.side === 'long' ? 1 : -1)) / Math.max(Math.abs(r), 1e-9);

  const tp1Note = signal.playbook === 'sweep-reclaim' ? 'range mid' : '1R';
  const tp2Note = signal.playbook === 'sweep-reclaim' ? 'opposite extreme' : '2R';

  const lines = [
    `Symbol: ${sym} (${signal.symbol})`,
    `Playbook: ${playbookLabel(signal.playbook)}`,
    `Side: ${sideTag}`,
    `Tier: ${tier.blurb}`,
    `Session: ${signal.session}`,
    `Time: ${new Date(signal.ts).toISOString()}`,
    '',
    signal.playbook === 'sweep-reclaim'
      ? `Swept level: ${fmtPrice(signal.symbol, signal.sweptLevel)}`
      : `20 SMA at cross: ${fmtPrice(signal.symbol, signal.sweptLevel)}`,
    `Entry hint:  ${fmtPrice(signal.symbol, signal.entryHint)}`,
    `Stop hint:   ${fmtPrice(signal.symbol, signal.stopHint)}  (risk ${fmtPrice(signal.symbol, Math.abs(r))} USD)`,
    `TP1:         ${fmtPrice(signal.symbol, signal.tp1Hint)}  (~${tp1R.toFixed(2)}R, ${tp1Note})`,
    `TP2:         ${fmtPrice(signal.symbol, signal.tp2Hint)}  (~${tp2R.toFixed(2)}R, ${tp2Note})`,
    '',
    signal.playbook === 'sweep-reclaim'
      ? `Vol vs avg:  ${signal.volRatio.toFixed(2)}x`
      : `20/50/200 SMA stacked: ${fmtPrice(signal.symbol, signal.vwap)} (20 SMA at signal)`,
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
