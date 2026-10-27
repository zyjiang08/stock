import { NextResponse } from 'next/server';
import { getStrategyPayloads } from '@/lib/strategy/service';

export async function GET() {
  const { backtest } = await getStrategyPayloads();
  return NextResponse.json(backtest);
}
