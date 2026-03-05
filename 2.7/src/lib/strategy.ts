// MA Reclaim Strategy Logic
// Signal when candle LOW dips below 50MA and CLOSE reclaims above 50MA
// Stop Loss: 0.5× ATR below candle low

import { Kline } from './binance';

export interface MASignal {
  id: string;
  symbol: string;
  type: 'ma_reclaim';
  direction: 'long';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  ma50: number;
  atr: number;
  candleLow: number;
  confidence: number;
  timeframe: string;
  timestamp: number;
  tradingViewUrl: string;
}

export interface StrategyConfig {
  maPeriod: number;
  atrPeriod: number;
  atrMultiplier: number;
  riskRewardRatio: number;
  minVolumeMultiplier: number;
}

const DEFAULT_CONFIG: StrategyConfig = {
  maPeriod: 50,
  atrPeriod: 14,
  atrMultiplier: 0.5,
  riskRewardRatio: 2.0,
  minVolumeMultiplier: 1.0,
};

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(values: number[], period: number): number[] {
  const sma: number[] = [];
  
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
    } else {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
  }
  
  return sma;
}

/**
 * Calculate Average True Range (ATR)
 */
export function calculateATR(klines: Kline[], period: number = 14): number[] {
  const trueRanges: number[] = [];
  
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) {
      trueRanges.push(klines[i].high - klines[i].low);
    } else {
      const tr = Math.max(
        klines[i].high - klines[i].low,
        Math.abs(klines[i].high - klines[i - 1].close),
        Math.abs(klines[i].low - klines[i - 1].close)
      );
      trueRanges.push(tr);
    }
  }
  
  // Smooth using Wilder's smoothing (similar to EMA)
  const atr: number[] = [];
  let firstATR = true;
  
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) {
      atr.push(NaN);
    } else if (firstATR) {
      const avg = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
      atr.push(avg);
      firstATR = false;
    } else {
      const prevATR = atr[i - 1];
      atr.push((prevATR * (period - 1) + trueRanges[i]) / period);
    }
  }
  
  return atr;
}

/**
 * Detect MA Reclaim Signal
 * Conditions:
 * 1. Candle LOW dips below 50MA
 * 2. Candle CLOSE reclaims above 50MA
 * This is a bullish signal - price tested below MA but buyers stepped in
 */
export function detectMAReclaimSignal(
  symbol: string,
  klines: Kline[],
  timeframe: string,
  config: StrategyConfig = DEFAULT_CONFIG
): MASignal | null {
  if (klines.length < config.maPeriod + 1) {
    return null;
  }
  
  const closes = klines.map(k => k.close);
  const ma50 = calculateSMA(closes, config.maPeriod);
  const atr = calculateATR(klines, config.atrPeriod);
  
  // Get current candle (last in array)
  const currentCandle = klines[klines.length - 1];
  const currentMA50 = ma50[ma50.length - 1];
  const currentATR = atr[atr.length - 1];
  
  // Skip if values are NaN
  if (isNaN(currentMA50) || isNaN(currentATR)) {
    return null;
  }
  
  // Check MA Reclaim conditions:
  // 1. LOW dips below MA50
  // 2. CLOSE reclaims above MA50
  const lowBelowMA = currentCandle.low < currentMA50;
  const closeAboveMA = currentCandle.close >= currentMA50;
  
  if (lowBelowMA && closeAboveMA) {
    // Calculate Stop Loss: 0.5× ATR below candle low
    const stopLoss = currentCandle.low - (currentATR * config.atrMultiplier);
    
    // Calculate Take Profit based on R:R ratio
    const risk = currentCandle.close - stopLoss;
    const takeProfit = currentCandle.close + (risk * config.riskRewardRatio);
    
    // Calculate confidence
    let confidence = 50;
    
    // Check volume
    const avgVolume = klines.slice(-20, -1).reduce((sum, k) => sum + k.volume, 0) / 19;
    if (currentCandle.volume > avgVolume * 1.5) {
      confidence += 15;
    } else if (currentCandle.volume > avgVolume * 1.2) {
      confidence += 10;
    }
    
    // Check candle body size (reclaim strength)
    const bodySize = Math.abs(currentCandle.close - currentCandle.open);
    const candleRange = currentCandle.high - currentCandle.low;
    if (bodySize > candleRange * 0.5) {
      confidence += 10; // Strong body indicates conviction
    }
    
    // Check how deep the wick went below MA
    const wickDepth = currentMA50 - currentCandle.low;
    const wickDepthPercent = (wickDepth / currentMA50) * 100;
    if (wickDepthPercent < 1) {
      confidence += 10; // Shallow dip = stronger support
    }
    
    // Check recent trend
    const recentCloses = closes.slice(-10);
    const isUptrend = recentCloses[recentCloses.length - 1] > recentCloses[0];
    if (isUptrend) {
      confidence += 10;
    }
    
    // Create TradingView URL
    const tvSymbol = symbol.replace('USDT', '');
    const tradingViewUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${tvSymbol}`;
    
    return {
      id: `ma-reclaim-${symbol}-${timeframe}-${currentCandle.openTime}`,
      symbol,
      type: 'ma_reclaim',
      direction: 'long',
      entry: currentCandle.close,
      stopLoss,
      takeProfit,
      riskReward: config.riskRewardRatio,
      ma50: currentMA50,
      atr: currentATR,
      candleLow: currentCandle.low,
      confidence: Math.min(100, Math.max(0, confidence)),
      timeframe,
      timestamp: currentCandle.closeTime,
      tradingViewUrl,
    };
  }
  
  return null;
}

/**
 * Scan multiple symbols for MA Reclaim signals
 */
export async function scanForSignals(
  symbols: string[],
  timeframe: string,
  config: StrategyConfig = DEFAULT_CONFIG
): Promise<MASignal[]> {
  const { getKlines } = await import('./binance');
  
  const signals: MASignal[] = [];
  
  // Process in batches of 10
  const batchSize = 10;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    
    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const klines = await getKlines(symbol, timeframe, 100);
        if (klines.length < config.maPeriod + 1) return null;
        
        return detectMAReclaimSignal(symbol, klines, timeframe, config);
      })
    );
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        signals.push(result.value);
      }
    }
  }
  
  // Sort by confidence (highest first)
  return signals.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Format signal for Telegram message
 */
export function formatSignalForTelegram(signal: MASignal): string {
  const symbol = signal.symbol.replace('USDT', '');
  const entryPrice = signal.entry.toFixed(signal.entry >= 1 ? 4 : 8);
  const sl = signal.stopLoss.toFixed(signal.stopLoss >= 1 ? 4 : 8);
  const tp = signal.takeProfit.toFixed(signal.takeProfit >= 1 ? 4 : 8);
  const ma50 = signal.ma50.toFixed(signal.ma50 >= 1 ? 4 : 8);
  const atr = signal.atr.toFixed(signal.atr >= 1 ? 4 : 8);
  
  return `🚀 *MA Reclaim Signal*

📊 *${symbol}* | ${signal.timeframe.toUpperCase()}
━━━━━━━━━━━━━━━━━━━

✅ *Direction:* LONG
📈 *Entry:* $${entryPrice}
🛑 *Stop Loss:* $${sl}
🎯 *Take Profit:* $${tp}

📉 *MA50:* $${ma50}
📏 *ATR:* $${atr}
💪 *Confidence:* ${signal.confidence}%
⚖️ *R:R:* ${signal.riskReward.toFixed(1)}

━━━━━━━━━━━━━━━━━━━
📅 ${new Date(signal.timestamp).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short',
  })} UTC

📈 [View on TradingView](${signal.tradingViewUrl})`;
}

export { DEFAULT_CONFIG };
