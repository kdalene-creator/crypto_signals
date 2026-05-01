import { NextResponse } from 'next/server';
import { recentSignals } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const signals = await recentSignals();
    return NextResponse.json({ count: signals.length, signals });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
