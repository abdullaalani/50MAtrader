import { NextResponse } from 'next/server';
import { MASignal, DEFAULT_CONFIG, StrategyConfig, scanForSignals, detectMAReclaimSignal } from '@/lib/strategy';
import { getTopGainers, getKlines } from '@/lib/binance';
import { isTelegramEnabled, sendSignalAlert } from '@/lib/telegram';

// Cache for signals per timeframe
interface SignalsCache {
  [key: string]: {
    signals: MASignal[];
    timestamp: number;
  };
}

const signalsCache: SignalsCache = {};
const CACHE_TTL = 300000; // 5 minutes

// Track sent signals to avoid duplicates
const sentSignalIds = new Set<string>();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const timeframe = searchParams.get('timeframe') || '5m';
    const riskReward = parseFloat(searchParams.get('riskReward') || '2.0');
    const limit = parseInt(searchParams.get('limit') || '20');

    const config: StrategyConfig = {
      ...DEFAULT_CONFIG,
      riskRewardRatio: riskReward,
    };

    // Valid timeframes
    const validTimeframes = ['5m', '15m', '30m', '1h'];
    const tf = validTimeframes.includes(timeframe) ? timeframe : '5m';

    // If specific symbol requested
    if (symbol) {
      const klines = await getKlines(symbol, tf, 100);
      
      if (klines.length < config.maPeriod + 1) {
        return NextResponse.json({
          success: true,
          data: null,
          message: 'Not enough data for analysis',
        });
      }
      
      const signal = detectMAReclaimSignal(symbol, klines, tf, config);
      
      return NextResponse.json({
        success: true,
        data: signal,
        timeframe: tf,
        timestamp: Date.now(),
      });
    }

    // Check cache
    const cacheKey = tf;
    const now = Date.now();
    
    if (signalsCache[cacheKey] && (now - signalsCache[cacheKey].timestamp) < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        data: signalsCache[cacheKey].signals.slice(0, limit),
        cached: true,
        timeframe: tf,
        timestamp: signalsCache[cacheKey].timestamp,
      });
    }

    // Get top 20 gainers only
    const gainers = await getTopGainers(20);
    const symbols = gainers.map(g => g.symbol);

    // Scan for MA Reclaim signals
    const signals = await scanForSignals(symbols, tf, config);

    // Sort by confidence
    signals.sort((a, b) => b.confidence - a.confidence);

    // Store in cache
    signalsCache[cacheKey] = {
      signals,
      timestamp: now,
    };

    // Send Telegram alerts for new signals
    const telegramEnabled = isTelegramEnabled();
    if (telegramEnabled) {
      for (const signal of signals) {
        if (!sentSignalIds.has(signal.id)) {
          sentSignalIds.add(signal.id);
          // Send alert asynchronously (don't wait)
          sendSignalAlert(signal).catch(err => 
            console.error(`Failed to send Telegram alert for ${signal.symbol}:`, err)
          );
        }
      }
    }

    // Clean up old signal IDs (keep last 1000)
    if (sentSignalIds.size > 1000) {
      const idsArray = Array.from(sentSignalIds);
      idsArray.slice(0, 500).forEach(id => sentSignalIds.delete(id));
    }

    return NextResponse.json({
      success: true,
      data: signals.slice(0, limit),
      cached: false,
      timeframe: tf,
      timestamp: now,
      telegramEnabled,
    });
  } catch (error) {
    console.error('Error generating signals:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate signals' },
      { status: 500 }
    );
  }
}
