import { NextResponse } from 'next/server';
import {
  setTelegramConfig,
  getTelegramConfig,
  clearTelegramConfig,
  isTelegramEnabled,
  sendTestMessage,
  isValidBotToken,
  isValidChatId,
  getBotInfo,
} from '@/lib/telegram';

export async function GET() {
  try {
    const config = getTelegramConfig();
    const enabled = isTelegramEnabled();
    
    let botInfo = null;
    if (enabled && config) {
      const info = await getBotInfo();
      if (info.success) {
        botInfo = info.botName;
      }
    }
    
    return NextResponse.json({
      success: true,
      data: {
        enabled,
        configured: config !== null,
        chatId: config?.chatId ? `${config.chatId.slice(0, 4)}****` : null,
        botInfo,
      },
    });
  } catch (error) {
    console.error('Error getting Telegram config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get Telegram config' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, botToken, chatId } = body;
    
    if (action === 'connect') {
      // Validate inputs
      if (!botToken || !chatId) {
        return NextResponse.json(
          { success: false, error: 'Bot token and chat ID are required' },
          { status: 400 }
        );
      }
      
      if (!isValidBotToken(botToken)) {
        return NextResponse.json(
          { success: false, error: 'Invalid bot token format. Expected: 123456789:ABCdef...' },
          { status: 400 }
        );
      }
      
      if (!isValidChatId(chatId)) {
        return NextResponse.json(
          { success: false, error: 'Invalid chat ID format. Should be a numeric value.' },
          { status: 400 }
        );
      }
      
      // Set config and test connection
      setTelegramConfig(botToken, chatId);
      
      // Get bot info
      const botInfo = await getBotInfo();
      if (!botInfo.success) {
        clearTelegramConfig();
        return NextResponse.json(
          { success: false, error: `Failed to verify bot: ${botInfo.error}` },
          { status: 400 }
        );
      }
      
      // Send test message
      const testResult = await sendTestMessage();
      if (!testResult.success) {
        clearTelegramConfig();
        return NextResponse.json(
          { success: false, error: `Bot verified but failed to send message: ${testResult.error}. Check your chat ID.` },
          { status: 400 }
        );
      }
      
      return NextResponse.json({
        success: true,
        message: 'Telegram connected successfully',
        data: {
          botName: botInfo.botName,
          chatId: `${chatId.slice(0, 4)}****`,
        },
      });
    }
    
    if (action === 'test') {
      if (!isTelegramEnabled()) {
        return NextResponse.json(
          { success: false, error: 'Telegram not configured' },
          { status: 400 }
        );
      }
      
      const result = await sendTestMessage();
      
      if (result.success) {
        return NextResponse.json({
          success: true,
          message: 'Test alert sent successfully',
        });
      } else {
        return NextResponse.json(
          { success: false, error: result.error || 'Failed to send test alert' },
          { status: 400 }
        );
      }
    }
    
    if (action === 'disconnect') {
      clearTelegramConfig();
      return NextResponse.json({
        success: true,
        message: 'Telegram disconnected',
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error handling Telegram request:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
