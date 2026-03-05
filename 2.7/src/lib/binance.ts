// Binance API integration for Spot market
// REST API: https://api.binance.com
// WebSocket: wss://stream.binance.com:9443

export interface BinanceTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

export interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
}

export interface BinanceSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
}

export interface Ticker24H {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
}

const BINANCE_REST_API = 'https://api.binance.com';
const BINANCE_WS_API = 'wss://stream.binance.com:9443/ws';

// Cache for exchange info
let exchangeInfoCache: BinanceSymbol[] | null = null;
let exchangeInfoCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch exchange info (list of all trading pairs)
 */
export async function getExchangeInfo(): Promise<BinanceSymbol[]> {
  const now = Date.now();
  if (exchangeInfoCache && (now - exchangeInfoCacheTime) < CACHE_TTL) {
    return exchangeInfoCache;
  }

  try {
    const response = await fetch(`${BINANCE_REST_API}/api/v3/exchangeInfo`);
    const data = await response.json();
    
    exchangeInfoCache = data.symbols
      .filter((s: { status: string; quoteAsset: string }) => 
        s.status === 'TRADING' && s.quoteAsset === 'USDT'
      )
      .map((s: { symbol: string; status: string; baseAsset: string; quoteAsset: string }) => ({
        symbol: s.symbol,
        status: s.status,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
      }));
    
    exchangeInfoCacheTime = now;
    return exchangeInfoCache!;
  } catch (error) {
    console.error('Failed to fetch exchange info:', error);
    return exchangeInfoCache || [];
  }
}

/**
 * Fetch 24h ticker for all symbols
 */
export async function get24HTickers(): Promise<Ticker24H[]> {
  try {
    const response = await fetch(`${BINANCE_REST_API}/api/v3/ticker/24hr`);
    const data = await response.json();
    
    return data
      .filter((t: { symbol: string }) => t.symbol.endsWith('USDT'))
      .map((t: { symbol: string; priceChange: string; priceChangePercent: string; lastPrice: string; highPrice: string; lowPrice: string; volume: string; quoteVolume: string }) => ({
        symbol: t.symbol,
        priceChange: t.priceChange,
        priceChangePercent: t.priceChangePercent,
        lastPrice: t.lastPrice,
        highPrice: t.highPrice,
        lowPrice: t.lowPrice,
        volume: t.volume,
        quoteVolume: t.quoteVolume,
      }));
  } catch (error) {
    console.error('Failed to fetch 24h tickers:', error);
    return [];
  }
}

/**
 * Fetch 24h ticker for a specific symbol
 */
export async function get24HTicker(symbol: string): Promise<Ticker24H | null> {
  try {
    const response = await fetch(`${BINANCE_REST_API}/api/v3/ticker/24hr?symbol=${symbol}`);
    const data = await response.json();
    
    return {
      symbol: data.symbol,
      priceChange: data.priceChange,
      priceChangePercent: data.priceChangePercent,
      lastPrice: data.lastPrice,
      highPrice: data.highPrice,
      lowPrice: data.lowPrice,
      volume: data.volume,
      quoteVolume: data.quoteVolume,
    };
  } catch (error) {
    console.error(`Failed to fetch 24h ticker for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch klines/candlestick data
 */
export async function getKlines(
  symbol: string,
  interval: string = '1h',
  limit: number = 100
): Promise<Kline[]> {
  try {
    const response = await fetch(
      `${BINANCE_REST_API}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    const data = await response.json();
    
    return data.map((k: (string | number)[]) => ({
      openTime: k[0] as number,
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
      closeTime: k[6] as number,
      quoteVolume: parseFloat(k[7] as string),
      trades: k[8] as number,
    }));
  } catch (error) {
    console.error(`Failed to fetch klines for ${symbol}:`, error);
    return [];
  }
}

/**
 * Get top gainers (sorted by 24h price change percentage)
 */
export async function getTopGainers(limit: number = 20): Promise<Ticker24H[]> {
  const tickers = await get24HTickers();
  
  return tickers
    .filter(t => parseFloat(t.quoteVolume) > 1000000) // Min $1M volume
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
    .slice(0, limit);
}

/**
 * Get top losers (sorted by 24h price change percentage - descending)
 */
export async function getTopLosers(limit: number = 20): Promise<Ticker24H[]> {
  const tickers = await get24HTickers();
  
  return tickers
    .filter(t => parseFloat(t.quoteVolume) > 1000000) // Min $1M volume
    .sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
    .slice(0, limit);
}

/**
 * WebSocket message types
 */
export interface WSTickerMessage {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  p: string; // Price change
  P: string; // Price change percent
  c: string; // Last price
  h: string; // High price
  l: string; // Low price
  v: string; // Total traded base asset volume
  q: string; // Total traded quote asset volume
}

export interface WSKlineMessage {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  k: {
    t: number; // Kline start time
    T: number; // Kline close time
    s: string; // Symbol
    i: string; // Interval
    o: string; // Open price
    c: string; // Close price
    h: string; // High price
    l: string; // Low price
    v: string; // Base asset volume
    q: string; // Quote asset volume
    x: boolean; // Is this kline closed?
  };
}

/**
 * WebSocket connection manager
 */
export class BinanceWebSocket {
  private ws: WebSocket | null = null;
  private subscriptions: Set<string> = new Set();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageHandler: ((data: WSTickerMessage | WSKlineMessage) => void) | null = null;
  private connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';

  constructor() {
    this.connect();
  }

  private connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.connectionStatus = 'connecting';
    this.ws = new WebSocket(BINANCE_WS_API);

    this.ws.onopen = () => {
      this.connectionStatus = 'connected';
      console.log('WebSocket connected to Binance');
      
      // Resubscribe to all streams
      if (this.subscriptions.size > 0) {
        this.sendSubscribe(Array.from(this.subscriptions));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (this.messageHandler) {
          this.messageHandler(data);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      this.connectionStatus = 'disconnected';
      console.log('WebSocket disconnected from Binance');
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 5000);
  }

  private sendSubscribe(streams: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: streams,
      id: Date.now(),
    }));
  }

  private sendUnsubscribe(streams: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      method: 'UNSUBSCRIBE',
      params: streams,
      id: Date.now(),
    }));
  }

  subscribeToTicker(symbol: string): void {
    const stream = `${symbol.toLowerCase()}@ticker`;
    if (!this.subscriptions.has(stream)) {
      this.subscriptions.add(stream);
      this.sendSubscribe([stream]);
    }
  }

  unsubscribeFromTicker(symbol: string): void {
    const stream = `${symbol.toLowerCase()}@ticker`;
    if (this.subscriptions.has(stream)) {
      this.subscriptions.delete(stream);
      this.sendUnsubscribe([stream]);
    }
  }

  subscribeToKline(symbol: string, interval: string = '1m'): void {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    if (!this.subscriptions.has(stream)) {
      this.subscriptions.add(stream);
      this.sendSubscribe([stream]);
    }
  }

  unsubscribeFromKline(symbol: string, interval: string = '1m'): void {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    if (this.subscriptions.has(stream)) {
      this.subscriptions.delete(stream);
      this.sendUnsubscribe([stream]);
    }
  }

  setMessageHandler(handler: (data: WSTickerMessage | WSKlineMessage) => void): void {
    this.messageHandler = handler;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.connectionStatus === 'connected';
  }
}

// Singleton instance for server-side use
let wsInstance: BinanceWebSocket | null = null;

export function getWebSocketInstance(): BinanceWebSocket {
  if (!wsInstance) {
    wsInstance = new BinanceWebSocket();
  }
  return wsInstance;
}

/**
 * Format price for display
 */
export function formatPrice(price: number | string): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (num >= 1000) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (num >= 1) {
    return num.toFixed(4);
  } else if (num >= 0.0001) {
    return num.toFixed(6);
  } else {
    return num.toFixed(8);
  }
}

/**
 * Format percentage for display
 */
export function formatPercent(percent: number | string): string {
  const num = typeof percent === 'string' ? parseFloat(percent) : percent;
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * Format volume for display
 */
export function formatVolume(volume: number | string): string {
  const num = typeof volume === 'string' ? parseFloat(volume) : volume;
  if (num >= 1e9) {
    return `${(num / 1e9).toFixed(2)}B`;
  } else if (num >= 1e6) {
    return `${(num / 1e6).toFixed(2)}M`;
  } else if (num >= 1e3) {
    return `${(num / 1e3).toFixed(2)}K`;
  }
  return num.toFixed(2);
}
