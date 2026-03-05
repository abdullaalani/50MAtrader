// Telegram Bot Service for sending trading alerts

import { MASignal, formatSignalForTelegram } from './strategy';

interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

// In-memory storage for Telegram config (in production, use database)
let telegramConfig: TelegramConfig | null = null;

/**
 * Set Telegram configuration
 */
export function setTelegramConfig(botToken: string, chatId: string): void {
  telegramConfig = {
    botToken,
    chatId,
    enabled: true,
  };
}

/**
 * Get current Telegram configuration
 */
export function getTelegramConfig(): TelegramConfig | null {
  return telegramConfig;
}

/**
 * Clear Telegram configuration (disconnect)
 */
export function clearTelegramConfig(): void {
  telegramConfig = null;
}

/**
 * Check if Telegram is configured and enabled
 */
export function isTelegramEnabled(): boolean {
  return telegramConfig !== null && telegramConfig.enabled;
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(message: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<{ success: boolean; error?: string }> {
  if (!telegramConfig) {
    return { success: false, error: 'Telegram not configured' };
  }
  
  const { botToken, chatId } = telegramConfig;
  
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: parseMode,
        disable_web_page_preview: false,
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Telegram API error:', data);
      return { success: false, error: data.description || 'Failed to send message' };
    }
    
    return { success: true };
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Send a test message to verify Telegram configuration
 */
export async function sendTestMessage(): Promise<{ success: boolean; error?: string }> {
  const testMessage = `✅ *Telegram Connected Successfully!*

Trading Monitor v2.7 is now connected and will send alerts for MA Reclaim signals.

🔔 You will receive alerts when:
• Price LOW dips below 50MA
• Price CLOSE reclaims above 50MA

_Test message sent at ${new Date().toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short',
  })} UTC_`;
  
  return sendTelegramMessage(testMessage);
}

/**
 * Send trading signal alert
 */
export async function sendSignalAlert(signal: MASignal): Promise<{ success: boolean; error?: string }> {
  const message = formatSignalForTelegram(signal);
  return sendTelegramMessage(message);
}

/**
 * Send multiple signal alerts
 */
export async function sendSignalAlerts(signals: MASignal[]): Promise<{ success: boolean; results: Array<{ symbol: string; success: boolean; error?: string }> }> {
  if (!isTelegramEnabled()) {
    return { 
      success: false, 
      results: signals.map(s => ({ symbol: s.symbol, success: false, error: 'Telegram not configured' }))
    };
  }
  
  const results: Array<{ symbol: string; success: boolean; error?: string }> = [];
  
  for (const signal of signals) {
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const result = await sendSignalAlert(signal);
    results.push({
      symbol: signal.symbol,
      success: result.success,
      error: result.error,
    });
  }
  
  const allSuccess = results.every(r => r.success);
  return { success: allSuccess, results };
}

/**
 * Validate Telegram bot token format
 */
export function isValidBotToken(token: string): boolean {
  // Bot tokens are typically in format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
  const tokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
  return tokenRegex.test(token);
}

/**
 * Validate Telegram chat ID format
 */
export function isValidChatId(chatId: string): boolean {
  // Chat IDs can be negative (groups/channels) or positive (users)
  return /^-?\d+$/.test(chatId);
}

/**
 * Get bot info (for verification)
 */
export async function getBotInfo(): Promise<{ success: boolean; botName?: string; error?: string }> {
  if (!telegramConfig?.botToken) {
    return { success: false, error: 'Bot token not configured' };
  }
  
  try {
    const url = `https://api.telegram.org/bot${telegramConfig.botToken}/getMe`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      return { success: false, error: data.description || 'Failed to get bot info' };
    }
    
    return { 
      success: true, 
      botName: `${data.result.first_name}${data.result.username ? ` (@${data.result.username})` : ''}` 
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
