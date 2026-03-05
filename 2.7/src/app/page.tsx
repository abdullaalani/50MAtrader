'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import {
  TrendingUp, TrendingDown, Activity, DollarSign, Target,
  RefreshCw, Settings, Zap, BarChart3, Wallet, LineChart,
  ChevronUp, Clock, CheckCircle, XCircle, Send, MessageCircle,
  AlertCircle, ExternalLink, Pause, Play
} from 'lucide-react';

// Types
interface Ticker24H {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

interface MASignal {
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

interface Position {
  id: string;
  symbol: string;
  direction: 'long';
  entry: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  entryTime: number;
  pnl: number;
  pnlPercent: number;
  status: 'open' | 'closed' | 'stopped_out' | 'take_profit';
  signal: MASignal;
}

interface Trade {
  id: string;
  symbol: string;
  direction: 'long';
  entry: number;
  exit: number;
  pnl: number;
  pnlPercent: number;
  entryTime: number;
  exitTime: number;
  status: string;
}

interface Account {
  balance: number;
  initialBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  openPositions: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
}

interface Config {
  riskRewardRatio: number;
  autoTrade: boolean;
  positionSizePercent: number;
}

interface TelegramStatus {
  enabled: boolean;
  configured: boolean;
  chatId?: string;
  botInfo?: string;
}

// Helper functions
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toFixed(4);
  } else if (price >= 0.0001) {
    return price.toFixed(6);
  }
  return price.toFixed(8);
}

function formatPercent(percent: number): string {
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatVolume(volume: string | number): string {
  const num = typeof volume === 'string' ? parseFloat(volume) : volume;
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

// Timeframe options
const TIMEFRAMES = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
];

export default function TradingDashboard() {
  // State
  const [gainers, setGainers] = useState<Ticker24H[]>([]);
  const [signals, setSignals] = useState<MASignal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [account, setAccount] = useState<Account>({
    balance: 10000,
    initialBalance: 10000,
    totalPnl: 0,
    totalPnlPercent: 0,
    openPositions: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
  });
  const [config, setConfig] = useState<Config>({
    riskRewardRatio: 2.0,
    autoTrade: false,
    positionSizePercent: 2,
  });
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [selectedTimeframe, setSelectedTimeframe] = useState('5m');
  const [nextRefresh, setNextRefresh] = useState<number>(0);

  // Telegram state
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>({ enabled: false, configured: false });
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch top gainers
  const fetchGainers = useCallback(async () => {
    try {
      const response = await fetch('/api/gainers?type=gainers&limit=20');
      const data = await response.json();
      if (data.success) {
        setGainers(data.data.slice(0, 20)); // Only top 20
        // Initialize prices
        const newPrices = new Map(prices);
        data.data.forEach((t: Ticker24H) => {
          newPrices.set(t.symbol, parseFloat(t.lastPrice));
        });
        setPrices(newPrices);
      }
    } catch (error) {
      console.error('Failed to fetch gainers:', error);
    }
  }, [prices]);

  // Fetch signals for current timeframe
  const fetchSignals = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/signals?timeframe=${selectedTimeframe}&riskReward=${config.riskRewardRatio}`);
      const data = await response.json();
      if (data.success) {
        setSignals(data.data || []);
        
        // Auto-trade if enabled
        if (config.autoTrade && data.data && data.data.length > 0) {
          const openPositions = positions.filter(p => p.status === 'open');
          
          for (const signal of data.data) {
            if (openPositions.length >= 5) break; // Max 5 positions
            
            const hasPosition = openPositions.some(p => p.symbol === signal.symbol);
            if (!hasPosition && signal.confidence >= 70) {
              executeTrade(signal);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch signals:', error);
    } finally {
      setIsLoading(false);
      setLastUpdate(new Date());
    }
  }, [selectedTimeframe, config.riskRewardRatio, config.autoTrade, positions]);

  // Execute a trade from signal
  const executeTrade = useCallback((signal: MASignal) => {
    const openPositions = positions.filter(p => p.status === 'open');
    if (openPositions.length >= 5) return; // Max 5 positions

    const positionSize = account.balance * (config.positionSizePercent / 100);
    const quantity = positionSize / signal.entry;
    const fees = positionSize * 0.002; // 0.2% total fees
    
    const newPosition: Position = {
      id: `pos-${Date.now()}-${signal.symbol}`,
      symbol: signal.symbol,
      direction: 'long',
      entry: signal.entry,
      currentPrice: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      quantity,
      entryTime: Date.now(),
      pnl: -fees,
      pnlPercent: -0.2,
      status: 'open',
      signal,
    };
    
    setPositions(prev => [...prev, newPosition]);
    setAccount(prev => ({
      ...prev,
      balance: prev.balance - positionSize,
      openPositions: prev.openPositions + 1,
    }));
  }, [account.balance, config.positionSizePercent, positions]);

  // Close a position
  const closePosition = useCallback((positionId: string, exitPrice?: number) => {
    setPositions(prev => {
      const position = prev.find(p => p.id === positionId);
      if (!position || position.status !== 'open') return prev;
      
      const currentPrice = exitPrice || position.currentPrice;
      const entryValue = position.entry * position.quantity;
      const exitValue = currentPrice * position.quantity;
      
      const pnl = exitValue - entryValue - entryValue * 0.002;
      const pnlPercent = (pnl / entryValue) * 100;
      const isWin = pnl > 0;
      
      const trade: Trade = {
        id: `trade-${position.id}`,
        symbol: position.symbol,
        direction: position.direction,
        entry: position.entry,
        exit: currentPrice,
        pnl,
        pnlPercent,
        entryTime: position.entryTime,
        exitTime: Date.now(),
        status: isWin ? 'take_profit' : 'stopped_out',
      };
      
      setTrades(t => [trade, ...t]);
      setAccount(acc => ({
        ...acc,
        balance: acc.balance + exitValue,
        totalPnl: acc.totalPnl + pnl,
        totalPnlPercent: ((acc.totalPnl + pnl) / acc.initialBalance) * 100,
        openPositions: acc.openPositions - 1,
        totalTrades: acc.totalTrades + 1,
        winningTrades: acc.winningTrades + (isWin ? 1 : 0),
        losingTrades: acc.losingTrades + (isWin ? 0 : 1),
        winRate: ((acc.winningTrades + (isWin ? 1 : 0)) / (acc.totalTrades + 1)) * 100,
      }));
      
      return prev.map(p => 
        p.id === positionId 
          ? { ...p, status: isWin ? 'take_profit' as const : 'stopped_out' as const, pnl, pnlPercent }
          : p
      );
    });
  }, []);

  // Update position prices and check SL/TP
  const updatePrices = useCallback((symbol: string, price: number) => {
    setPrices(prev => new Map(prev).set(symbol, price));
    
    setPositions(prev => {
      return prev.map(position => {
        if (position.symbol !== symbol || position.status !== 'open') {
          return position;
        }
        
        const newPosition = { ...position, currentPrice: price };
        const entryValue = position.entry * position.quantity;
        const currentValue = price * position.quantity;
        
        newPosition.pnl = currentValue - entryValue - entryValue * 0.002;
        
        // Check stop loss
        if (price <= position.stopLoss) {
          setTimeout(() => closePosition(position.id, price), 0);
          return { ...newPosition, status: 'stopped_out' as const };
        }
        // Check take profit
        if (price >= position.takeProfit) {
          setTimeout(() => closePosition(position.id, price), 0);
          return { ...newPosition, status: 'take_profit' as const };
        }
        
        newPosition.pnlPercent = (newPosition.pnl / entryValue) * 100;
        return newPosition;
      });
    });
  }, [closePosition]);

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    setWsStatus('connecting');
    const symbols = gainers.slice(0, 20).map(g => g.symbol.toLowerCase());
    
    if (symbols.length === 0) return;
    
    const streams = symbols.map(s => `${s}@ticker`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    
    wsRef.current = new WebSocket(wsUrl);
    
    wsRef.current.onopen = () => {
      setWsStatus('connected');
    };
    
    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const data = message.data;
        
        if (data && data.s && data.c) {
          const symbol = data.s;
          const price = parseFloat(data.c);
          updatePrices(symbol, price);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    wsRef.current.onclose = () => {
      setWsStatus('disconnected');
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 5000);
    };
    
    wsRef.current.onerror = () => {
      console.error('WebSocket error');
    };
  }, [gainers, updatePrices]);

  // Calculate next 5-minute candle close
  const calculateNextRefresh = useCallback(() => {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ms = now.getMilliseconds();
    
    // Next 5-minute mark
    const next5Min = Math.ceil((minutes + 1) / 5) * 5;
    const targetMinute = next5Min >= 60 ? 0 : next5Min;
    const addHour = next5Min >= 60 ? 1 : 0;
    
    const target = new Date(now);
    target.setMinutes(targetMinute);
    target.setSeconds(0);
    target.setMilliseconds(0);
    if (addHour) target.setHours(target.getHours() + 1);
    
    return target.getTime() - now.getTime();
  }, []);

  // 5-minute candle-synced refresh
  useEffect(() => {
    const scheduleNextRefresh = () => {
      const delay = calculateNextRefresh();
      setNextRefresh(Math.ceil(delay / 1000));
      
      refreshIntervalRef.current = setTimeout(() => {
        fetchSignals();
        scheduleNextRefresh();
      }, delay);
    };
    
    scheduleNextRefresh();
    
    return () => {
      if (refreshIntervalRef.current) {
        clearTimeout(refreshIntervalRef.current);
      }
    };
  }, [fetchSignals, calculateNextRefresh]);

  // Initial fetch
  useEffect(() => {
    fetchGainers();
    fetchTelegramStatus();
  }, []);

  // Connect WebSocket when gainers are loaded
  useEffect(() => {
    if (gainers.length > 0 && wsStatus === 'disconnected') {
      connectWebSocket();
    }
  }, [gainers, wsStatus, connectWebSocket]);

  // Fetch signals when timeframe changes
  useEffect(() => {
    fetchSignals();
  }, [selectedTimeframe]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Fetch Telegram status
  const fetchTelegramStatus = async () => {
    try {
      const response = await fetch('/api/telegram');
      const data = await response.json();
      if (data.success) {
        setTelegramStatus(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch Telegram status:', error);
    }
  };

  // Connect Telegram
  const handleTelegramConnect = async () => {
    if (!telegramBotToken || !telegramChatId) {
      setTelegramMessage({ type: 'error', text: 'Please enter both Bot Token and Chat ID' });
      return;
    }

    setTelegramConnecting(true);
    setTelegramMessage(null);

    try {
      const response = await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'connect',
          botToken: telegramBotToken,
          chatId: telegramChatId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setTelegramStatus({ enabled: true, configured: true, chatId: data.data?.chatId, botInfo: data.data?.botName });
        setTelegramMessage({ type: 'success', text: 'Telegram connected successfully!' });
        setTelegramBotToken('');
        setTelegramChatId('');
      } else {
        setTelegramMessage({ type: 'error', text: data.error || 'Failed to connect' });
      }
    } catch (error) {
      setTelegramMessage({ type: 'error', text: 'Connection failed' });
    } finally {
      setTelegramConnecting(false);
    }
  };

  // Test Telegram alert
  const handleTelegramTest = async () => {
    setTelegramTesting(true);
    setTelegramMessage(null);

    try {
      const response = await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      });

      const data = await response.json();

      if (data.success) {
        setTelegramMessage({ type: 'success', text: 'Test alert sent! Check your Telegram.' });
      } else {
        setTelegramMessage({ type: 'error', text: data.error || 'Failed to send test' });
      }
    } catch (error) {
      setTelegramMessage({ type: 'error', text: 'Failed to send test' });
    } finally {
      setTelegramTesting(false);
    }
  };

  // Disconnect Telegram
  const handleTelegramDisconnect = async () => {
    try {
      await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      setTelegramStatus({ enabled: false, configured: false });
      setTelegramMessage(null);
    } catch (error) {
      console.error('Failed to disconnect Telegram:', error);
    }
  };

  // Reset trading account
  const resetAccount = () => {
    setPositions([]);
    setTrades([]);
    setAccount({
      balance: 10000,
      initialBalance: 10000,
      totalPnl: 0,
      totalPnlPercent: 0,
      openPositions: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 lg:p-6">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <LineChart className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                  Trading Monitor
                </h1>
                <Badge className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-xs font-bold px-2 py-0.5">
                  v2.7
                </Badge>
              </div>
              <p className="text-xs text-slate-400">MA Reclaim Strategy • 5min Refresh • Top 20 Gainers</p>
            </div>
          </div>
          
          {/* Status indicators */}
          <div className="flex items-center gap-4 ml-4">
            {/* Live status */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-xs text-slate-400">
                {wsStatus === 'connected' ? 'Live' : 'Reconnecting...'}
              </span>
            </div>
            
            {/* Telegram status */}
            <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-slate-800/50">
              <MessageCircle className={`w-3.5 h-3.5 ${telegramStatus.enabled ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className="text-xs text-slate-300">
                {telegramStatus.enabled ? 'Telegram ON' : 'Telegram OFF'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4 flex-wrap">
          {/* Next refresh countdown */}
          <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300">
              Next: {nextRefresh}s
            </span>
          </div>
          
          {/* Last update */}
          <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
            <span className="text-sm text-slate-300">
              {lastUpdate.toLocaleTimeString()}
            </span>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchGainers(); fetchSignals(); }}
            disabled={isLoading}
            className="border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-white"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={resetAccount}
            className="border-red-800 bg-red-900/20 hover:bg-red-900/40 text-red-400"
          >
            Reset Account
          </Button>
        </div>
      </header>

      {/* Account Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Wallet className="w-4 h-4" />
              <span className="text-xs">Balance</span>
            </div>
            <p className="text-xl font-bold text-white">${account.balance.toFixed(2)}</p>
          </CardContent>
        </Card>
        
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs">Total PnL</span>
            </div>
            <p className={`text-xl font-bold ${account.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPercent(account.totalPnlPercent)}
            </p>
            <p className={`text-sm ${account.totalPnl >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
              ${account.totalPnl.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Activity className="w-4 h-4" />
              <span className="text-xs">Open Positions</span>
            </div>
            <p className="text-xl font-bold text-white">{positions.filter(p => p.status === 'open').length}<span className="text-sm text-slate-400">/5</span></p>
          </CardContent>
        </Card>
        
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <BarChart3 className="w-4 h-4" />
              <span className="text-xs">Win Rate</span>
            </div>
            <p className="text-xl font-bold text-white">{account.winRate.toFixed(1)}%</p>
            <p className="text-sm text-slate-400">
              {account.winningTrades}W / {account.losingTrades}L
            </p>
          </CardContent>
        </Card>
        
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Target className="w-4 h-4" />
              <span className="text-xs">Total Trades</span>
            </div>
            <p className="text-xl font-bold text-white">{account.totalTrades}</p>
          </CardContent>
        </Card>
        
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Zap className="w-4 h-4" />
              <span className="text-xs">Active Signals</span>
            </div>
            <p className="text-xl font-bold text-amber-400">{signals.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Panel - Top Gainers */}
        <div className="lg:col-span-3">
          <Card className="bg-slate-800/50 border-slate-700/50 h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                  Top 20 Gainers
                </CardTitle>
                <Badge variant="secondary" className="bg-emerald-900/50 text-emerald-400 border-emerald-800">
                  24h
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px] px-4 pb-4">
                <div className="space-y-2">
                  {gainers.slice(0, 20).map((gainer, index) => {
                    const currentPrice = prices.get(gainer.symbol) || parseFloat(gainer.lastPrice);
                    const changePercent = parseFloat(gainer.priceChangePercent);
                    
                    return (
                      <div
                        key={gainer.symbol}
                        className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 hover:bg-slate-900/80 transition-colors cursor-pointer group"
                        onClick={() => {
                          const symbol = gainer.symbol.replace('USDT', '');
                          window.open(`https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}`, '_blank');
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500 text-sm w-5">{index + 1}</span>
                          <div>
                            <p className="font-medium text-white group-hover:text-emerald-400 transition-colors">
                              {gainer.symbol.replace('USDT', '')}
                            </p>
                            <p className="text-xs text-slate-500">
                              Vol: ${formatVolume(gainer.quoteVolume)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono text-white">${formatPrice(currentPrice)}</p>
                          <div className="flex items-center gap-1 justify-end">
                            <ChevronUp className="w-3 h-3 text-emerald-400" />
                            <span className="text-sm font-medium text-emerald-400">
                              {formatPercent(changePercent)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Center Panel - Signals & Trades */}
        <div className="lg:col-span-5">
          <Tabs defaultValue="signals" className="h-full">
            <TabsList className="bg-slate-800/50 border-slate-700/50 w-full">
              <TabsTrigger value="signals" className="flex-1 data-[state=active]:bg-slate-700 text-white">
                <Zap className="w-4 h-4 mr-2" />
                Signals
              </TabsTrigger>
              <TabsTrigger value="trades" className="flex-1 data-[state=active]:bg-slate-700 text-white">
                <Activity className="w-4 h-4 mr-2" />
                History
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1 data-[state=active]:bg-slate-700 text-white">
                <Settings className="w-4 h-4 mr-2" />
                Config
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="signals" className="mt-4">
              <Card className="bg-slate-800/50 border-slate-700/50">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-lg text-white">MA Reclaim Signals</CardTitle>
                      {/* Timeframe Tabs */}
                      <div className="flex gap-1">
                        {TIMEFRAMES.map(tf => (
                          <Button
                            key={tf.value}
                            variant={selectedTimeframe === tf.value ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setSelectedTimeframe(tf.value)}
                            className={`h-7 px-2 text-xs ${
                              selectedTimeframe === tf.value
                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {tf.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-400">Auto-trade</span>
                      <Switch
                        checked={config.autoTrade}
                        onCheckedChange={(checked) => setConfig(c => ({ ...c, autoTrade: checked }))}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[450px] px-4 pb-4">
                    {signals.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                        <Zap className="w-12 h-12 mb-4 opacity-50" />
                        <p className="text-white">No MA Reclaim signals detected</p>
                        <p className="text-sm">Scanning top 20 gainers on {selectedTimeframe}...</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {signals.map((signal) => {
                          const hasPosition = positions.some(p => p.symbol === signal.symbol && p.status === 'open');
                          
                          return (
                            <div
                              key={signal.id}
                              className="p-4 rounded-lg border bg-emerald-950/30 border-emerald-800/50"
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <Badge className="bg-emerald-900/50 text-emerald-400">
                                    LONG
                                  </Badge>
                                  <span className="font-bold text-white">{signal.symbol.replace('USDT', '')}</span>
                                  <Badge variant="outline" className="border-slate-600 text-slate-400">
                                    {signal.timeframe}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-right">
                                    <p className="text-xs text-slate-400">Confidence</p>
                                    <p className={`font-bold ${signal.confidence >= 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                      {signal.confidence}%
                                    </p>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                                <div>
                                  <p className="text-slate-500 text-xs">Entry</p>
                                  <p className="font-mono text-white">${formatPrice(signal.entry)}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs">Stop Loss (0.5×ATR)</p>
                                  <p className="font-mono text-red-400">${formatPrice(signal.stopLoss)}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 text-xs">Take Profit</p>
                                  <p className="font-mono text-emerald-400">${formatPrice(signal.takeProfit)}</p>
                                </div>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-4 text-xs mb-3">
                                <div>
                                  <p className="text-slate-500">MA50</p>
                                  <p className="font-mono text-slate-300">${formatPrice(signal.ma50)}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500">ATR</p>
                                  <p className="font-mono text-slate-300">${formatPrice(signal.atr)}</p>
                                </div>
                              </div>
                              
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-500">R:R</span>
                                  <span className="text-sm font-medium text-white">{signal.riskReward.toFixed(1)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => window.open(signal.tradingViewUrl, '_blank')}
                                    className="text-slate-400 hover:text-white"
                                  >
                                    <ExternalLink className="w-4 h-4 mr-1" />
                                    Chart
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={hasPosition}
                                    onClick={() => executeTrade(signal)}
                                    className={hasPosition
                                      ? 'bg-slate-700 text-slate-400'
                                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                    }
                                  >
                                    {hasPosition ? 'Position Open' : 'Execute Trade'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="trades" className="mt-4">
              <Card className="bg-slate-800/50 border-slate-700/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg text-white">Trade History</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[450px] px-4 pb-4">
                    {trades.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                        <BarChart3 className="w-12 h-12 mb-4 opacity-50" />
                        <p className="text-white">No trades yet</p>
                        <p className="text-sm">Execute signals to see trade history</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {trades.map((trade) => (
                          <div
                            key={trade.id}
                            className={`p-3 rounded-lg ${trade.pnl >= 0 ? 'bg-emerald-950/20' : 'bg-red-950/20'}`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge className={trade.pnl >= 0 ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}>
                                  LONG
                                </Badge>
                                <span className="font-medium text-white">{trade.symbol.replace('USDT', '')}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {trade.pnl >= 0 ? (
                                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-400" />
                                )}
                                <span className={`font-bold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {formatPercent(trade.pnlPercent)}
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4 text-xs">
                              <div>
                                <p className="text-slate-500">Entry</p>
                                <p className="font-mono text-white">${formatPrice(trade.entry)}</p>
                              </div>
                              <div>
                                <p className="text-slate-500">Exit</p>
                                <p className="font-mono text-white">${formatPrice(trade.exit)}</p>
                              </div>
                              <div>
                                <p className="text-slate-500">PnL</p>
                                <p className={`font-mono ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  ${trade.pnl.toFixed(2)}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="settings" className="mt-4">
              <Card className="bg-slate-800/50 border-slate-700/50">
                <CardHeader>
                  <CardTitle className="text-lg text-white">Configuration</CardTitle>
                  <CardDescription className="text-slate-400">Adjust trading parameters and Telegram alerts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Trading Settings */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-white flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-emerald-400" />
                      Trading Settings
                    </h3>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-slate-300">Risk:Reward Ratio</Label>
                        <span className="text-white font-medium">{config.riskRewardRatio.toFixed(1)}</span>
                      </div>
                      <Slider
                        value={[config.riskRewardRatio]}
                        onValueChange={([value]) => setConfig(c => ({ ...c, riskRewardRatio: value }))}
                        min={1}
                        max={5}
                        step={0.5}
                        className="w-full"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-slate-300">Position Size (%)</Label>
                        <span className="text-white font-medium">{config.positionSizePercent}%</span>
                      </div>
                      <Slider
                        value={[config.positionSizePercent]}
                        onValueChange={([value]) => setConfig(c => ({ ...c, positionSizePercent: value }))}
                        min={1}
                        max={10}
                        step={1}
                        className="w-full"
                      />
                    </div>
                    
                    <div className="flex items-center justify-between p-4 rounded-lg bg-slate-900/50">
                      <div>
                        <Label className="text-slate-300">Auto-Trade Mode</Label>
                        <p className="text-sm text-slate-400">Automatically execute signals with 70%+ confidence</p>
                      </div>
                      <Switch
                        checked={config.autoTrade}
                        onCheckedChange={(checked) => setConfig(c => ({ ...c, autoTrade: checked }))}
                      />
                    </div>
                  </div>
                  
                  {/* Telegram Settings */}
                  <div className="space-y-4 pt-4 border-t border-slate-700">
                    <h3 className="text-sm font-medium text-white flex items-center gap-2">
                      <MessageCircle className="w-4 h-4 text-emerald-400" />
                      Telegram Alerts
                    </h3>
                    
                    {telegramMessage && (
                      <div className={`p-3 rounded-lg flex items-center gap-2 ${
                        telegramMessage.type === 'success' 
                          ? 'bg-emerald-900/30 border border-emerald-800/50' 
                          : 'bg-red-900/30 border border-red-800/50'
                      }`}>
                        {telegramMessage.type === 'success' ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-red-400" />
                        )}
                        <span className={`text-sm ${telegramMessage.type === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>
                          {telegramMessage.text}
                        </span>
                      </div>
                    )}
                    
                    {telegramStatus.enabled ? (
                      <div className="p-4 rounded-lg bg-emerald-900/20 border border-emerald-800/50">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-emerald-400" />
                            <span className="font-medium text-white">Telegram Connected</span>
                          </div>
                          {telegramStatus.botInfo && (
                            <span className="text-sm text-slate-400">{telegramStatus.botInfo}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleTelegramTest}
                            disabled={telegramTesting}
                            className="border-emerald-700 bg-emerald-900/30 hover:bg-emerald-800/50 text-emerald-400"
                          >
                            {telegramTesting ? (
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4 mr-2" />
                            )}
                            Test Alert
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleTelegramDisconnect}
                            className="border-red-800 bg-red-900/20 hover:bg-red-900/40 text-red-400"
                          >
                            Disconnect
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-slate-300">Bot Token</Label>
                          <Input
                            type="password"
                            placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                            value={telegramBotToken}
                            onChange={(e) => setTelegramBotToken(e.target.value)}
                            className="bg-slate-900/50 border-slate-700 text-white placeholder:text-slate-500"
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label className="text-slate-300">Chat ID</Label>
                          <Input
                            type="text"
                            placeholder="-1001234567890"
                            value={telegramChatId}
                            onChange={(e) => setTelegramChatId(e.target.value)}
                            className="bg-slate-900/50 border-slate-700 text-white placeholder:text-slate-500"
                          />
                        </div>
                        
                        <Button
                          onClick={handleTelegramConnect}
                          disabled={telegramConnecting}
                          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                          {telegramConnecting ? (
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <MessageCircle className="w-4 h-4 mr-2" />
                          )}
                          Save & Connect
                        </Button>
                        
                        <div className="p-4 rounded-lg bg-slate-900/50 text-sm space-y-2">
                          <p className="font-medium text-white">How to get Telegram credentials:</p>
                          <ol className="list-decimal list-inside space-y-1 text-slate-400">
                            <li>Open Telegram and search for @BotFather</li>
                            <li>Send /newbot and follow instructions</li>
                            <li>Copy the API token (Bot Token)</li>
                            <li>Create a group/channel and add your bot</li>
                            <li>Forward a message from the group to @userinfobot to get Chat ID</li>
                            <li>Chat ID format: -100... for groups, positive for users</li>
                          </ol>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Panel - Open Positions */}
        <div className="lg:col-span-4">
          <Card className="bg-slate-800/50 border-slate-700/50 h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2 text-white">
                  <Activity className="w-5 h-5 text-blue-400" />
                  Open Positions
                </CardTitle>
                <Badge variant="secondary" className="bg-blue-900/50 text-blue-400 border-blue-800">
                  {positions.filter(p => p.status === 'open').length} Active
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px] px-4 pb-4">
                {positions.filter(p => p.status === 'open').length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                    <Target className="w-12 h-12 mb-4 opacity-50" />
                    <p className="text-white">No open positions</p>
                    <p className="text-sm">Execute signals to open positions (max 5)</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {positions.filter(p => p.status === 'open').map((position) => (
                      <div
                        key={position.id}
                        className="p-4 rounded-lg border bg-emerald-950/20 border-emerald-800/30"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-emerald-900/50 text-emerald-400">
                              LONG
                            </Badge>
                            <span className="font-bold text-white">{position.symbol.replace('USDT', '')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {position.pnl >= 0 ? (
                              <TrendingUp className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-400" />
                            )}
                            <span className={`font-bold ${position.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {formatPercent(position.pnlPercent)}
                            </span>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                          <div>
                            <p className="text-slate-500 text-xs">Entry</p>
                            <p className="font-mono text-white">${formatPrice(position.entry)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Current</p>
                            <p className="font-mono text-white">${formatPrice(position.currentPrice)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Stop Loss</p>
                            <p className="font-mono text-red-400">${formatPrice(position.stopLoss)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Take Profit</p>
                            <p className="font-mono text-emerald-400">${formatPrice(position.takeProfit)}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-slate-500">
                            {formatTime(position.entryTime)}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => closePosition(position.id)}
                            className="border-red-800 bg-red-900/20 hover:bg-red-900/40 text-red-400"
                          >
                            Close Position
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
