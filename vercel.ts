import type { VercelConfig } from '@vercel/config/v1';

// On Hobby, native Vercel Cron is limited to daily jobs. We trigger
// /api/cron/scan from an external pinger (cron-job.org) every minute
// during active sessions. If you upgrade to Pro, add:
//   crons: [{ path: '/api/cron/scan', schedule: '* * * * *' }]
//
// Functions deploy to fra1 (Frankfurt) because Binance geoblocks US
// (default iad1 returns HTTP 451 from fapi.binance.com).
export const config: VercelConfig = {
  framework: 'nextjs',
  regions: ['fra1'],
};
