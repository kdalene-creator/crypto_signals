import { Redis } from '@upstash/redis';
import type { Signal } from './types';

const DEDUP_TTL_S = 30 * 60;
const RECENT_KEY = 'signals:recent';
const RECENT_MAX = 100;

/** Log-based price bucketing for symbol-agnostic dedup.
 *  bpStep = 5 means prices within 0.05% of each other share the same bucket.
 *  Works equally for BTC at $80k and SOL at $200. */
function logBucket(price: number, bpStep = 5): string {
  if (price <= 0) return '0';
  return Math.round((Math.log(price) * 10000) / bpStep).toString();
}

let _redis: Redis | null = null;

function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Redis URL/token missing. Expected KV_REST_API_URL+KV_REST_API_TOKEN (Vercel Marketplace) or UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN.',
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

export async function tryClaim(signal: Signal): Promise<boolean> {
  // sweep-reclaim keys on swept level; sma-cross keys on entry.
  const level = signal.playbook === 'sweep-reclaim' ? signal.sweptLevel : signal.entryHint;
  const key = `dedup:${signal.symbol}:${signal.playbook}:${signal.side}:${logBucket(level)}`;
  const claimed = await redis().set(key, signal.id, { nx: true, ex: DEDUP_TTL_S });
  return claimed === 'OK';
}

export async function persistSignal(signal: Signal): Promise<void> {
  const r = redis();
  await r.lpush(RECENT_KEY, JSON.stringify(signal));
  await r.ltrim(RECENT_KEY, 0, RECENT_MAX - 1);
}

export async function recentSignals(): Promise<Signal[]> {
  const items = await redis().lrange(RECENT_KEY, 0, RECENT_MAX - 1);
  return items.map((raw) => (typeof raw === 'string' ? JSON.parse(raw) : raw)) as Signal[];
}
