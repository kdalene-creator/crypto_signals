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

// Tier classification — currently CONSERVATIVE.
// Two 30d backtests (windows ending 2026-05-01 and 2026-05-11) gave
// CONFLICTING results for sweep-reclaim's "long+overlap" bucket:
//   Window 1: 18 signals, 61% WR, +0.42 avgR, +7.6R
//   Window 2: 10 signals, 40% WR, -0.40 avgR, -4.0R
// This is regime drift, not noise. Holding off on A++ promotions until at
// least 3 non-overlapping windows agree. The "A+" tag below still marks
// overlap-window signals but no longer implies a proven edge.
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
  const headerLevel = signal.playbook === 'sweep-reclaim' ? signal.sweptLevel : signal.entryHint;
  const subject = `[BTC SCALP ${tier.short}${sideTag}] ${playbookLabel(signal.playbook)} @ ${fmt(headerLevel, 0)}`;

  const r = (signal.entryHint - signal.stopHint) * (signal.side === 'long' ? 1 : -1);
  const tp1R = ((signal.tp1Hint - signal.entryHint) * (signal.side === 'long' ? 1 : -1)) / Math.max(Math.abs(r), 1e-9);
  const tp2R = ((signal.tp2Hint - signal.entryHint) * (signal.side === 'long' ? 1 : -1)) / Math.max(Math.abs(r), 1e-9);

  const tp1Note = signal.playbook === 'sweep-reclaim' ? 'range mid' : '1R';
  const tp2Note = signal.playbook === 'sweep-reclaim' ? 'opposite extreme' : '2R';

  const lines = [
    `Playbook: ${playbookLabel(signal.playbook)}`,
    `Side: ${sideTag}`,
    `Tier: ${tier.blurb}`,
    `Session: ${signal.session}`,
    `Time: ${new Date(signal.ts).toISOString()}`,
    '',
    signal.playbook === 'sweep-reclaim'
      ? `Swept level: ${fmt(signal.sweptLevel, 0)}`
      : `20 SMA at cross: ${fmt(signal.sweptLevel, 1)}`,
    `Entry hint:  ${fmt(signal.entryHint, 1)}`,
    `Stop hint:   ${fmt(signal.stopHint, 1)}  (risk ${fmt(Math.abs(r), 1)} USD)`,
    `TP1:         ${fmt(signal.tp1Hint, 1)}  (~${tp1R.toFixed(2)}R, ${tp1Note})`,
    `TP2:         ${fmt(signal.tp2Hint, 1)}  (~${tp2R.toFixed(2)}R, ${tp2Note})`,
    '',
    signal.playbook === 'sweep-reclaim'
      ? `Vol vs avg:  ${signal.volRatio.toFixed(2)}x`
      : `20/50/200 SMA stacked: ${fmt(signal.vwap, 1)} (20 SMA at signal)`,
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
