// Paper Trading Engine
// Simulates trades without real money for testing strategies

import { Signal } from './strategy';

export type PositionStatus = 'open' | 'closed' | 'stopped_out' | 'take_profit';

export interface Position {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  entryTime: number;
  closeTime?: number;
  closePrice?: number;
  pnl: number;
  pnlPercent: number;
  status: PositionStatus;
  signal: Signal;
  fees: number;
}

export interface Trade {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  entryTime: number;
  exitTime: number;
  status: PositionStatus;
  signal: Signal;
  fees: number;
}

export interface Account {
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

export interface TradingConfig {
  initialBalance: number;
  positionSizePercent: number; // % of balance per trade
  feePercent: number; // Trading fee (0.1% for Binance default)
  maxOpenPositions: number;
  autoTrade: boolean;
  riskRewardRatio: number;
}

const DEFAULT_TRADING_CONFIG: TradingConfig = {
  initialBalance: 10000, // $10,000 starting balance
  positionSizePercent: 2, // 2% per trade
  feePercent: 0.1, // 0.1% fee
  maxOpenPositions: 5,
  autoTrade: false,
  riskRewardRatio: 2.0,
};

class TradingEngine {
  private balance: number;
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private config: TradingConfig;
  private priceCache: Map<string, number> = new Map();

  constructor(config: TradingConfig = DEFAULT_TRADING_CONFIG) {
    this.config = config;
    this.balance = config.initialBalance;
  }

  /**
   * Get current account info
   */
  getAccount(): Account {
    const openPositions = Array.from(this.positions.values()).filter(p => p.status === 'open');
    const totalPnl = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const winningTrades = this.trades.filter(t => t.pnl > 0).length;
    const losingTrades = this.trades.filter(t => t.pnl < 0).length;
    const totalTrades = this.trades.length;

    return {
      balance: this.balance,
      initialBalance: this.config.initialBalance,
      totalPnl,
      totalPnlPercent: (totalPnl / this.config.initialBalance) * 100,
      openPositions: openPositions.length,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
    };
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): Position[] {
    return Array.from(this.positions.values())
      .filter(p => p.status === 'open')
      .sort((a, b) => b.entryTime - a.entryTime);
  }

  /**
   * Get all closed trades
   */
  getClosedTrades(): Trade[] {
    return [...this.trades].sort((a, b) => b.exitTime - a.exitTime);
  }

  /**
   * Update price for a symbol and check positions
   */
  updatePrice(symbol: string, price: number): Position[] {
    this.priceCache.set(symbol, price);
    const closedPositions: Position[] = [];

    for (const position of this.positions.values()) {
      if (position.status !== 'open' || position.symbol !== symbol) continue;

      position.currentPrice = price;
      
      // Check stop loss
      if (position.direction === 'long' && price <= position.stopLoss) {
        this.closePosition(position.id, price, 'stopped_out');
        closedPositions.push(position);
      } else if (position.direction === 'short' && price >= position.stopLoss) {
        this.closePosition(position.id, price, 'stopped_out');
        closedPositions.push(position);
      }
      
      // Check take profit
      else if (position.direction === 'long' && price >= position.takeProfit) {
        this.closePosition(position.id, price, 'take_profit');
        closedPositions.push(position);
      } else if (position.direction === 'short' && price <= position.takeProfit) {
        this.closePosition(position.id, price, 'take_profit');
        closedPositions.push(position);
      }
      
      // Update PnL
      else {
        this.updatePositionPnl(position, price);
      }
    }

    return closedPositions;
  }

  /**
   * Update position PnL
   */
  private updatePositionPnl(position: Position, price: number): void {
    const entryValue = position.entry * position.quantity;
    const currentValue = price * position.quantity;
    
    if (position.direction === 'long') {
      position.pnl = currentValue - entryValue - position.fees * 2;
    } else {
      position.pnl = entryValue - currentValue - position.fees * 2;
    }
    
    position.pnlPercent = (position.pnl / entryValue) * 100;
  }

  /**
   * Open a new position from signal
   */
  openPosition(signal: Signal): Position | null {
    // Check max positions
    const openCount = Array.from(this.positions.values()).filter(p => p.status === 'open').length;
    if (openCount >= this.config.maxOpenPositions) {
      return null;
    }

    // Check if position already exists for this symbol
    const existingPosition = Array.from(this.positions.values())
      .find(p => p.symbol === signal.symbol && p.status === 'open');
    if (existingPosition) {
      return null;
    }

    // Calculate position size
    const positionSize = this.balance * (this.config.positionSizePercent / 100);
    const quantity = positionSize / signal.entry;
    const entryValue = positionSize;
    const fees = entryValue * (this.config.feePercent / 100);

    // Deduct from balance
    this.balance -= positionSize;

    const position: Position = {
      id: `pos-${Date.now()}-${signal.symbol}`,
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entry,
      currentPrice: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      quantity,
      entryTime: Date.now(),
      pnl: 0,
      pnlPercent: 0,
      status: 'open',
      signal,
      fees,
    };

    this.positions.set(position.id, position);
    return position;
  }

  /**
   * Close a position manually
   */
  closePosition(positionId: string, price?: number, status: PositionStatus = 'closed'): boolean {
    const position = this.positions.get(positionId);
    if (!position || position.status !== 'open') return false;

    const closePrice = price || this.priceCache.get(position.symbol) || position.currentPrice;
    const entryValue = position.entry * position.quantity;
    const exitValue = closePrice * position.quantity;
    
    // Calculate PnL
    let pnl: number;
    if (position.direction === 'long') {
      pnl = exitValue - entryValue - position.fees * 2;
    } else {
      pnl = entryValue - exitValue - position.fees * 2;
    }

    // Add to balance
    this.balance += exitValue;

    // Update position
    position.closePrice = closePrice;
    position.closeTime = Date.now();
    position.pnl = pnl;
    position.pnlPercent = (pnl / entryValue) * 100;
    position.status = status;

    // Create trade record
    const trade: Trade = {
      id: `trade-${position.id}`,
      symbol: position.symbol,
      direction: position.direction,
      entry: position.entry,
      exit: closePrice,
      quantity: position.quantity,
      pnl,
      pnlPercent: position.pnlPercent,
      entryTime: position.entryTime,
      exitTime: position.closeTime,
      status,
      signal: position.signal,
      fees: position.fees * 2,
    };

    this.trades.push(trade);
    return true;
  }

  /**
   * Reset account to initial state
   */
  reset(): void {
    this.balance = this.config.initialBalance;
    this.positions.clear();
    this.trades = [];
    this.priceCache.clear();
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<TradingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get config
   */
  getConfig(): TradingConfig {
    return { ...this.config };
  }

  /**
   * Calculate risk for a potential trade
   */
  calculateRisk(signal: Signal): { riskAmount: number; riskPercent: number } {
    const positionSize = this.balance * (this.config.positionSizePercent / 100);
    const risk = Math.abs(signal.entry - signal.stopLoss);
    const riskAmount = risk * (positionSize / signal.entry);
    const riskPercent = (riskAmount / this.balance) * 100;

    return { riskAmount, riskPercent };
  }
}

// Singleton instance
let tradingEngine: TradingEngine | null = null;

export function getTradingEngine(config?: TradingConfig): TradingEngine {
  if (!tradingEngine) {
    tradingEngine = new TradingEngine(config);
  }
  return tradingEngine;
}

export function resetTradingEngine(config?: TradingConfig): TradingEngine {
  tradingEngine = new TradingEngine(config || DEFAULT_TRADING_CONFIG);
  return tradingEngine;
}

export { DEFAULT_TRADING_CONFIG };
export type { TradingConfig };
