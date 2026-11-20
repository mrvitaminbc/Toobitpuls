import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalysisResult } from '../types/futures';
import {
  buildDiscordWebhookPayload,
  buildTelegramWebhookPayload,
  shouldPushWebhookSignal,
  validateDiscordWebhookUrl,
  validateTelegramWebhookUrl,
  validateWebhookConfig,
  type WebhookSignalInput,
} from './webhook';
import { WebhookNotifier, type FetchLike } from '../../server/webhookNotifier';

const sampleSignal: WebhookSignalInput = {
  symbol: 'SOL-SWAP-USDT',
  baseAsset: 'SOL',
  timeframe: '4h',
  direction: 'LONG',
  phase: 'PRE_PUMP',
  confidence: 83,
  sharpMoveScore: 79,
  lastPrice: 184.25,
  volumeZScore: 2.94,
  summaryEn: 'SOL MTF bullish alignment with TTM squeeze <breakout> & rising OI.',
  tradePlan: {
    optimalEntry: 183.9,
    stopLoss: 176.5,
    tp1: 192.0,
    tp2: 204.5,
    tp3: 218.0,
    riskReward2: 2.78,
  },
  analyzedAt: 1_760_000_000_000,
};

test('validateDiscordWebhookUrl accepts valid Discord URLs and blocks invalid/SSRF URLs', () => {
  const valid = validateDiscordWebhookUrl('https://discord.com/api/webhooks/123456789012345/abc-DEF_123');
  assert.equal(valid.valid, true);

  const validLegacy = validateDiscordWebhookUrl('https://discordapp.com/api/v10/webhooks/987654/token_xyz');
  assert.equal(validLegacy.valid, true);

  const empty = validateDiscordWebhookUrl('   ');
  assert.equal(empty.valid, true);
  assert.equal(empty.normalized, '');

  const httpRejected = validateDiscordWebhookUrl('http://discord.com/api/webhooks/123/abc');
  assert.equal(httpRejected.valid, false);

  const ssrfRejected = validateDiscordWebhookUrl('https://127.0.0.1/api/webhooks/123/abc');
  assert.equal(ssrfRejected.valid, false);

  const wrongHost = validateDiscordWebhookUrl('https://example.com/api/webhooks/123/abc');
  assert.equal(wrongHost.valid, false);

  const badPath = validateDiscordWebhookUrl('https://discord.com/channels/123/456');
  assert.equal(badPath.valid, false);
});

test('validateTelegramWebhookUrl supports Bot API and HTTPS relays while guarding SSRF', () => {
  const botApi = validateTelegramWebhookUrl(
    'https://api.telegram.org/bot123456:ABC-DEF_ghI/sendMessage?chat_id=-100123456789',
  );
  assert.equal(botApi.valid, true);
  assert.equal(botApi.mode, 'bot_api');
  assert.equal(botApi.chatId, '-100123456789');
  assert.equal(botApi.targetUrl, 'https://api.telegram.org/bot123456:ABC-DEF_ghI/sendMessage');

  const missingChatId = validateTelegramWebhookUrl(
    'https://api.telegram.org/bot123456:ABC-DEF_ghI/sendMessage',
  );
  assert.equal(missingChatId.valid, false);

  const relay = validateTelegramWebhookUrl('https://hooks.my-trading-relay.io/telegram-alerts');
  assert.equal(relay.valid, true);
  assert.equal(relay.mode, 'relay');

  const localRejected = validateTelegramWebhookUrl('https://169.254.169.254/latest/meta-data');
  assert.equal(localRejected.valid, false);

  const discordInTelegram = validateTelegramWebhookUrl('https://discord.com/api/webhooks/123/abc');
  assert.equal(discordInTelegram.valid, false);
});

test('shouldPushWebhookSignal respects enabled, direction, URLs, and confidence threshold', () => {
  const cfg = {
    enabled: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/123456/token_abc',
    telegramWebhookUrl: '',
    minConfidence: 75,
  };

  assert.equal(shouldPushWebhookSignal({ direction: 'LONG', confidence: 75 }, cfg), true);
  assert.equal(shouldPushWebhookSignal({ direction: 'SHORT', confidence: 88 }, cfg), true);
  assert.equal(shouldPushWebhookSignal({ direction: 'LONG', confidence: 74 }, cfg), false);
  assert.equal(shouldPushWebhookSignal({ direction: 'NEUTRAL', confidence: 92 }, cfg), false);
  assert.equal(shouldPushWebhookSignal({ direction: 'LONG', confidence: 90 }, { ...cfg, enabled: false }), false);
  assert.equal(
    shouldPushWebhookSignal({ direction: 'LONG', confidence: 90 }, { ...cfg, discordWebhookUrl: '' }),
    false,
  );
});

test('validateWebhookConfig clamps confidence threshold to 50..95', () => {
  const checked = validateWebhookConfig({
    enabled: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/111/tok',
    telegramWebhookUrl: '',
    minConfidence: 99,
  });
  assert.equal(checked.valid, true);
  assert.equal(checked.config.minConfidence, 95);
});

test('payload builders format Discord embed and Telegram Bot API HTML safely', () => {
  const discordPayload = buildDiscordWebhookPayload(sampleSignal);
  assert.equal(discordPayload.username, 'ToobitPulse');
  assert.equal(discordPayload.embeds.length, 1);
  assert.ok(discordPayload.embeds[0].title.includes('SOL/USDT'));
  assert.ok(discordPayload.embeds[0].title.includes('83%'));
  assert.equal(discordPayload.embeds[0].color, 0x10b981);

  const tgBotPayload = buildTelegramWebhookPayload(sampleSignal, {
    mode: 'bot_api',
    chatId: '-100999',
  });
  assert.equal(tgBotPayload.chat_id, '-100999');
  assert.equal(tgBotPayload.parse_mode, 'HTML');
  assert.ok(String(tgBotPayload.text).includes('&lt;breakout&gt;'));
  assert.ok(String(tgBotPayload.text).includes('SOL/USDT'));

  const tgRelayPayload = buildTelegramWebhookPayload(sampleSignal, { mode: 'relay' });
  assert.equal(tgRelayPayload.source, 'ToobitPulse');
  assert.equal((tgRelayPayload.signal as { confidence: number }).confidence, 83);
});

test('WebhookNotifier dispatches above threshold, enforces cooldown, and logs errors cleanly', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const mockFetch: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const notifier = new WebhookNotifier({ fetchImpl: mockFetch, persistPath: null });
  const saved = notifier.updateConfig({
    enabled: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/12345/secret_tok',
    telegramWebhookUrl: 'https://api.telegram.org/bot999:tok/sendMessage?chat_id=-10011',
    minConfidence: 80,
  });
  assert.equal(saved.ok, true);

  const lowAnalysis = {
    ...sampleSignal,
    confidence: 78,
  } as unknown as AnalysisResult;

  const skipped = await notifier.evaluateAndPushSignal(lowAnalysis);
  assert.equal(skipped.length, 0);
  assert.equal(calls.length, 0);

  const highAnalysis = {
    ...sampleSignal,
    confidence: 86,
  } as unknown as AnalysisResult;

  const sent = await notifier.evaluateAndPushSignal(highAnalysis);
  assert.equal(sent.length, 2);
  assert.equal(sent.every((r) => r.ok), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://discord.com/api/webhooks/12345/secret_tok');
  assert.equal(calls[1].url, 'https://api.telegram.org/bot999:tok/sendMessage');
  assert.equal(calls[1].body.chat_id, '-10011');

  // Cooldown prevents duplicate dispatch for same symbol + direction
  const duplicate = await notifier.evaluateAndPushSignal(highAnalysis);
  assert.equal(duplicate.length, 0);
  assert.equal(calls.length, 2);

  // Delivery history recorded
  assert.equal(notifier.getLogs().length, 2);
});
