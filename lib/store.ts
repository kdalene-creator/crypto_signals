import { Redis } from '@upstash/redis';
import type { Signal, Side } from './types';
import { bucket } from './playbooks/sweep-reclaim';

const DEDUP_TTL_S = 30 * 60;
const RECENT_KEY = 'signals:recent';
const RECENT_MAX = 100;

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

function dedupKey(side: Side, sweptLevel: number): string {
  return `dedup:${side}:${bucket(sweptLevel)}`;
}

export async function tryClaim(signal: Signal): Promise<boolean> {
  const key = dedupKey(signal.side, signal.sweptLevel);
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
