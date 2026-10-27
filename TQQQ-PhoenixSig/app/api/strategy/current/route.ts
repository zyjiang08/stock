import { NextResponse } from 'next/server';
import { getStrategyPayloads } from '@/lib/strategy/service';

export async function GET() {
  const { current } = await getStrategyPayloads();
  return NextResponse.json(current);
}
