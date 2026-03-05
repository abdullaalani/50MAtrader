import { NextResponse } from 'next/server';
import { getTopGainers, getTopLosers, get24HTickers, Ticker24H } from '@/lib/binance';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'gainers';
    const limit = parseInt(searchParams.get('limit') || '20');

    let data: Ticker24H[];

    if (type === 'gainers') {
      data = await getTopGainers(limit);
    } else if (type === 'losers') {
      data = await getTopLosers(limit);
    } else {
      data = await get24HTickers();
    }

    return NextResponse.json({
      success: true,
      data,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error fetching gainers:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch data' },
      { status: 500 }
    );
  }
}
