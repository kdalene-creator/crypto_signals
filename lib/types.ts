export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type OiSample = {
  time: number;
  openInterest: number;
};

export type Session = 'asia' | 'london' | 'ny' | 'overlap' | 'dead';

export type OiQuadrant =
  | 'longs-entering'
  | 'short-cover'
  | 'shorts-entering'
  | 'long-liquidation'
  | 'unknown';

export type Side = 'long' | 'short';

export type Playbook = 'sweep-reclaim' | 'sma-cross';

export type Signal = {
  id: string;
  ts: number;
  playbook: Playbook;
  side: Side;
  /** Reference level for the setup. For sweep-reclaim = the swept high/low.
   *  For sma-cross = the 20 SMA value at the cross candle. */
  sweptLevel: number;
  entryHint: number;
  stopHint: number;
  tp1Hint: number;
  tp2Hint: number;
  /** sweep-reclaim only — ratio of sweep-candle volume to recent mean. 0 for sma-cross. */
  volRatio: number;
  /** sweep-reclaim: anchored session VWAP. sma-cross: the 20 SMA at signal time. */
  vwap: number;
  oiQuadrant: OiQuadrant;
  session: Session;
  aPlus: boolean;
  fundingBp: number | null;
};
