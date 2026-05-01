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

export type Signal = {
  id: string;
  ts: number;
  side: Side;
  sweptLevel: number;
  entryHint: number;
  stopHint: number;
  tp1Hint: number;
  tp2Hint: number;
  volRatio: number;
  vwap: number;
  oiQuadrant: OiQuadrant;
  session: Session;
  aPlus: boolean;
  fundingBp: number | null;
};
