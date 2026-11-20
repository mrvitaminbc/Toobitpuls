import type {
  AnalysisResult,
  MarketPhase,
  SignalDirection,
  Timeframe,
  WebhookConfig,
} from '../types/futures';

export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: true,
  discordWebhookUrl: '',
  telegramWebhookUrl: '',
  minConfidence: 75,
};

export interface WebhookSignalInput {
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  direction: SignalDirection;
  phase: MarketPhase;
  confidence: number;
  sharpMoveScore: number;
  lastPrice: number;
  volumeZScore: number;
  summaryEn: string;
  tradePlan: {
    optimalEntry: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    tp3: number;
    riskReward2: number;
  };
  expectedMoveMinPct?: number;
  expectedMoveMaxPct?: number;
  expectedWindowEn?: string;
  qualityGrade?: string;
  analyzedAt: number;
}

export interface UrlValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

export interface TelegramTargetResult extends UrlValidationResult {
  mode?: 'bot_api' | 'relay';
  targetUrl?: string;
  chatId?: string;
}

export interface WebhookConfigValidation {
  valid: boolean;
  config: WebhookConfig;
  errors: {
    discord?: string;
    telegram?: string;
  };
}

function isIpv4PrivateOrLoopback(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) {
    return false;
  }
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => n < 0 || n > 255)) return true;

  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return true;
  }
  if (isIpv4PrivateOrLoopback(host)) {
    return true;
  }
  if (!host.includes('.')) {
    return true;
  }
  return false;
}

export function validateDiscordWebhookUrl(raw: string): UrlValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, normalized: trimmed, error: 'Invalid Discord webhook URL format.' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, normalized: trimmed, error: 'Discord webhook URL must use HTTPS.' };
  }

  if (isBlockedWebhookHost(parsed.hostname)) {
    return { valid: false, normalized: trimmed, error: 'Private or local hosts are not allowed.' };
  }

  const host = parsed.hostname.toLowerCase();
  const isDiscordHost =
    host === 'discord.com' ||
    host === 'discordapp.com' ||
    host === 'ptb.discord.com' ||
    host === 'canary.discord.com';

  if (!isDiscordHost) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Host must be discord.com or discordapp.com.',
    };
  }

  const webhookPathPattern = /^\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9._-]+$/i;
  if (!webhookPathPattern.test(parsed.pathname)) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Expected Discord format: https://discord.com/api/webhooks/<id>/<token>',
    };
  }

  return { valid: true, normalized: parsed.toString() };
}

export function validateTelegramWebhookUrl(raw: string): TelegramTargetResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, normalized: trimmed, error: 'Invalid Telegram webhook URL format.' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, normalized: trimmed, error: 'Telegram webhook URL must use HTTPS.' };
  }

  if (isBlockedWebhookHost(parsed.hostname)) {
    return { valid: false, normalized: trimmed, error: 'Private or local hosts are not allowed.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'api.telegram.org') {
    const botSendPattern = /^\/bot[0-9]+:[A-Za-z0-9_-]+\/sendMessage$/i;
    if (!botSendPattern.test(parsed.pathname)) {
      return {
        valid: false,
        normalized: trimmed,
        error: 'Expected Telegram Bot API path: /bot<TOKEN>/sendMessage?chat_id=<ID>',
      };
    }

    const chatId = parsed.searchParams.get('chat_id')?.trim();
    if (!chatId) {
      return {
        valid: false,
        normalized: trimmed,
        error: 'Telegram Bot API URL requires ?chat_id=<CHAT_ID>.',
      };
    }

    return {
      valid: true,
      normalized: parsed.toString(),
      mode: 'bot_api',
      targetUrl: `${parsed.origin}${parsed.pathname}`,
      chatId,
    };
  }

  if (
    host === 'discord.com' ||
    host === 'discordapp.com' ||
    host === 'ptb.discord.com' ||
    host === 'canary.discord.com'
  ) {
    return {
      valid: false,
      normalized: trimmed,
      error: 'Discord URLs belong in the Discord Webhook field.',
    };
  }

  return {
    valid: true,
    normalized: parsed.toString(),
    mode: 'relay',
    targetUrl: parsed.toString(),
  };
}

export function clampWebhookConfidence(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_WEBHOOK_CONFIG.minConfidence;
  return Math.max(50, Math.min(95, Math.round(num)));
}

export function validateWebhookConfig(input: Partial<WebhookConfig> | null | undefined): WebhookConfigValidation {
  const safeInput = input ?? {};
  const discordCheck = validateDiscordWebhookUrl(
    typeof safeInput.discordWebhookUrl === 'string' ? safeInput.discordWebhookUrl : '',
  );
  const telegramCheck = validateTelegramWebhookUrl(
    typeof safeInput.telegramWebhookUrl === 'string' ? safeInput.telegramWebhookUrl : '',
  );

  const errors: WebhookConfigValidation['errors'] = {};
  if (!discordCheck.valid && discordCheck.error) {
    errors.discord = discordCheck.error;
  }
  if (!telegramCheck.valid && telegramCheck.error) {
    errors.telegram = telegramCheck.error;
  }

  return {
    valid: discordCheck.valid && telegramCheck.valid,
    config: {
      enabled: Boolean(safeInput.enabled),
      discordWebhookUrl: discordCheck.normalized,
      telegramWebhookUrl: telegramCheck.normalized,
      minConfidence: clampWebhookConfidence(safeInput.minConfidence),
    },
    errors,
  };
}

export function shouldPushWebhookSignal(
  signal: Pick<AnalysisResult, 'direction' | 'confidence'>,
  config: WebhookConfig,
): boolean {
  if (!config.enabled) return false;
  if (!config.discordWebhookUrl.trim() && !config.telegramWebhookUrl.trim()) {
    return false;
  }
  if (signal.direction === 'NEUTRAL') return false;
  return signal.confidence >= config.minConfidence;
}

function formatNum(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4);
  if (abs >= 0.01) return value.toFixed(5);
  return value.toFixed(6);
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatPairDisplay(symbol: string, baseAsset: string): string {
  if (symbol.includes('-SWAP-')) {
    const parts = symbol.split('-SWAP-');
    if (parts.length === 2 && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
  }
  return `${baseAsset}/USDT`;
}

export function buildDiscordWebhookPayload(signal: WebhookSignalInput): {
  username: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    footer: { text: string };
    timestamp: string;
  }>;
} {
  const pair = formatPairDisplay(signal.symbol, signal.baseAsset);
  const isBull = signal.direction === 'LONG';
  const color = isBull ? 0x10b981 : 0xf43f5e;
  const emoji = isBull ? '🟢' : '🔴';

  const estMoveText =
    typeof signal.expectedMoveMinPct === 'number' && typeof signal.expectedMoveMaxPct === 'number'
      ? `${signal.expectedMoveMinPct >= 0 ? '+' : ''}${signal.expectedMoveMinPct}% to ${signal.expectedMoveMaxPct >= 0 ? '+' : ''}${signal.expectedMoveMaxPct}% (${signal.expectedWindowEn ?? '4–12h'})`
      : null;

  return {
    username: 'ToobitPulse',
    embeds: [
      {
        title: `${emoji} ${pair} · ${signal.direction} (${signal.confidence}%${signal.qualityGrade ? ` · Grade ${signal.qualityGrade}` : ''})`,
        description: signal.summaryEn,
        color,
        fields: [
          { name: 'Phase', value: `${signal.phase} (${signal.timeframe})`, inline: true },
          { name: 'Last Price', value: `$${formatNum(signal.lastPrice)}`, inline: true },
          { name: 'Sharp ≥20%', value: `${signal.sharpMoveScore}%`, inline: true },
          ...(estMoveText ? [{ name: 'Est. Move', value: estMoveText, inline: true }] : []),
          { name: 'Optimal Entry', value: `$${formatNum(signal.tradePlan.optimalEntry)}`, inline: true },
          { name: 'Stop Loss', value: `$${formatNum(signal.tradePlan.stopLoss)}`, inline: true },
          { name: 'TP1 / TP2', value: `$${formatNum(signal.tradePlan.tp1)} / $${formatNum(signal.tradePlan.tp2)}`, inline: true },
          { name: 'Vol Z-Score', value: `${signal.volumeZScore.toFixed(2)}σ`, inline: true },
          { name: 'R:R (TP2)', value: `1:${signal.tradePlan.riskReward2.toFixed(2)}`, inline: true },
        ],
        footer: { text: 'ToobitPulse Institutional Futures Scanner' },
        timestamp: new Date(signal.analyzedAt || Date.now()).toISOString(),
      },
    ],
  };
}

export function buildTelegramWebhookPayload(
  signal: WebhookSignalInput,
  target: Pick<TelegramTargetResult, 'mode' | 'chatId'>,
): Record<string, unknown> {
  const pair = formatPairDisplay(signal.symbol, signal.baseAsset);
  const emoji = signal.direction === 'LONG' ? '🟢' : '🔴';
  const estMoveText =
    typeof signal.expectedMoveMinPct === 'number' && typeof signal.expectedMoveMaxPct === 'number'
      ? `${signal.expectedMoveMinPct >= 0 ? '+' : ''}${signal.expectedMoveMinPct}% to ${signal.expectedMoveMaxPct >= 0 ? '+' : ''}${signal.expectedMoveMaxPct}% (${signal.expectedWindowEn ?? '4–12h'})`
      : null;

  const htmlText = [
    `${emoji} <b>ToobitPulse Alert — ${escapeHtml(pair)}${signal.qualityGrade ? ` [${escapeHtml(signal.qualityGrade)}]` : ''}</b>`,
    `<b>Direction:</b> ${escapeHtml(signal.direction)} | <b>Phase:</b> ${escapeHtml(signal.phase)} (${escapeHtml(signal.timeframe)})`,
    `<b>Confidence:</b> ${signal.confidence}% | <b>Sharp ≥20%:</b> ${signal.sharpMoveScore}% | <b>Vol Z:</b> ${signal.volumeZScore.toFixed(2)}σ`,
    ...(estMoveText ? [`<b>Est. Move:</b> ${escapeHtml(estMoveText)}`] : []),
    `<b>Price:</b> $${formatNum(signal.lastPrice)} | <b>Entry:</b> $${formatNum(signal.tradePlan.optimalEntry)}`,
    `<b>SL:</b> $${formatNum(signal.tradePlan.stopLoss)} | <b>TP1:</b> $${formatNum(signal.tradePlan.tp1)} | <b>TP2:</b> $${formatNum(signal.tradePlan.tp2)}`,
    `<b>R:R:</b> 1:${signal.tradePlan.riskReward2.toFixed(2)}`,
    '',
    escapeHtml(signal.summaryEn),
  ].join('\n');

  if (target.mode === 'bot_api') {
    return {
      chat_id: target.chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
  }

  const plainText = [
    `${emoji} ToobitPulse Alert — ${pair}`,
    `Direction: ${signal.direction} | Phase: ${signal.phase} (${signal.timeframe})`,
    `Confidence: ${signal.confidence}% | Sharp >=20%: ${signal.sharpMoveScore}% | Vol Z: ${signal.volumeZScore.toFixed(2)}σ`,
    ...(estMoveText ? [`Est. Move: ${estMoveText}`] : []),
    `Price: $${formatNum(signal.lastPrice)} | Entry: $${formatNum(signal.tradePlan.optimalEntry)}`,
    `SL: $${formatNum(signal.tradePlan.stopLoss)} | TP1: $${formatNum(signal.tradePlan.tp1)} | TP2: $${formatNum(signal.tradePlan.tp2)}`,
    signal.summaryEn,
  ].join('\n');

  return {
    source: 'ToobitPulse',
    text: plainText,
    signal: {
      symbol: signal.symbol,
      pair,
      timeframe: signal.timeframe,
      direction: signal.direction,
      phase: signal.phase,
      confidence: signal.confidence,
      sharpMoveScore: signal.sharpMoveScore,
      expectedMoveMinPct: signal.expectedMoveMinPct,
      expectedMoveMaxPct: signal.expectedMoveMaxPct,
      expectedWindow: signal.expectedWindowEn,
      qualityGrade: signal.qualityGrade,
      lastPrice: signal.lastPrice,
      volumeZScore: signal.volumeZScore,
      entry: signal.tradePlan.optimalEntry,
      stopLoss: signal.tradePlan.stopLoss,
      tp1: signal.tradePlan.tp1,
      tp2: signal.tradePlan.tp2,
      tp3: signal.tradePlan.tp3,
      riskReward2: signal.tradePlan.riskReward2,
      summary: signal.summaryEn,
      analyzedAt: signal.analyzedAt,
    },
  };
}
