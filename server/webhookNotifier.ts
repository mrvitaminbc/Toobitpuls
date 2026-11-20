import fs from 'fs';
import type {
  AnalysisResult,
  WebhookConfig,
  WebhookDeliveryLog,
  WebhookPlatform,
} from '../src/types/futures';
import {
  DEFAULT_WEBHOOK_CONFIG,
  buildDiscordWebhookPayload,
  buildTelegramWebhookPayload,
  shouldPushWebhookSignal,
  validateDiscordWebhookUrl,
  validateTelegramWebhookUrl,
  validateWebhookConfig,
  type WebhookSignalInput,
} from '../src/utils/webhook';
import { evaluateAlertQualification } from '../src/utils/alerts';

const PERSIST_PATH = '/tmp/toobitpulse-webhooks.json';
const COOLDOWN_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;

export type FetchLike = typeof fetch;

export class WebhookNotifier {
  private config: WebhookConfig = { ...DEFAULT_WEBHOOK_CONFIG };
  private cooldowns = new Map<string, number>();
  private deliveryLogs: WebhookDeliveryLog[] = [];
  private readonly fetchImpl: FetchLike;
  private readonly persistPath: string | null;

  constructor(options?: { fetchImpl?: FetchLike; persistPath?: string | null }) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.persistPath = options?.persistPath === undefined ? PERSIST_PATH : options.persistPath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
      const checked = validateWebhookConfig(parsed);
      if (checked.valid) {
        this.config = checked.config;
      }
    } catch {
      // Ignore corrupt or missing persistence file
    }
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      fs.writeFileSync(this.persistPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch {
      // Non-fatal in read-only environments
    }
  }

  public getConfig(): WebhookConfig {
    return { ...this.config };
  }

  public getLogs(): WebhookDeliveryLog[] {
    return [...this.deliveryLogs];
  }

  public updateConfig(input: Partial<WebhookConfig>): {
    ok: boolean;
    config: WebhookConfig;
    errors: { discord?: string; telegram?: string };
  } {
    const checked = validateWebhookConfig(input);
    if (!checked.valid) {
      return {
        ok: false,
        config: this.getConfig(),
        errors: checked.errors,
      };
    }

    this.config = checked.config;
    this.saveToDisk();
    return {
      ok: true,
      config: this.getConfig(),
      errors: {},
    };
  }

  private recordLog(entry: WebhookDeliveryLog): void {
    this.deliveryLogs.unshift(entry);
    if (this.deliveryLogs.length > 20) {
      this.deliveryLogs.length = 20;
    }
  }

  private async postJson(
    platform: WebhookPlatform,
    url: string,
    payload: unknown,
    signal: WebhookSignalInput,
  ): Promise<WebhookDeliveryLog> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const now = Date.now();

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      let errorMsg: string | undefined;
      if (!response.ok) {
        try {
          const text = await response.text();
          errorMsg = text ? text.slice(0, 180) : `HTTP ${response.status}`;
        } catch {
          errorMsg = `HTTP ${response.status}`;
        }
      }

      const log: WebhookDeliveryLog = {
        id: `${platform}-${signal.symbol}-${now}`,
        timestamp: now,
        platform,
        symbol: signal.symbol,
        confidence: signal.confidence,
        ok: response.ok,
        statusCode: response.status,
        ...(errorMsg ? { error: errorMsg } : {}),
      };
      this.recordLog(log);
      return log;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Request timed out (6s)'
            : err.message
          : 'Network error';
      const log: WebhookDeliveryLog = {
        id: `${platform}-${signal.symbol}-${now}`,
        timestamp: now,
        platform,
        symbol: signal.symbol,
        confidence: signal.confidence,
        ok: false,
        statusCode: null,
        error: msg,
      };
      this.recordLog(log);
      return log;
    } finally {
      clearTimeout(timer);
    }
  }

  public async dispatchSignal(
    signal: WebhookSignalInput,
    configOverride?: WebhookConfig,
  ): Promise<WebhookDeliveryLog[]> {
    const cfg = configOverride ?? this.config;
    const tasks: Promise<WebhookDeliveryLog>[] = [];

    if (cfg.discordWebhookUrl.trim()) {
      const discordTarget = validateDiscordWebhookUrl(cfg.discordWebhookUrl);
      if (discordTarget.valid && discordTarget.normalized) {
        const payload = buildDiscordWebhookPayload(signal);
        tasks.push(this.postJson('discord', discordTarget.normalized, payload, signal));
      }
    }

    if (cfg.telegramWebhookUrl.trim()) {
      const telegramTarget = validateTelegramWebhookUrl(cfg.telegramWebhookUrl);
      if (telegramTarget.valid && telegramTarget.targetUrl) {
        const payload = buildTelegramWebhookPayload(signal, telegramTarget);
        tasks.push(this.postJson('telegram', telegramTarget.targetUrl, payload, signal));
      }
    }

    if (tasks.length === 0) return [];
    return Promise.all(tasks);
  }

  public async evaluateAndPushSignal(analysis: AnalysisResult): Promise<WebhookDeliveryLog[]> {
    if (!shouldPushWebhookSignal(analysis, this.config)) {
      return [];
    }

    const key = `${analysis.symbol}:${analysis.direction}`;
    const now = Date.now();
    const lastSent = this.cooldowns.get(key) ?? 0;
    if (now - lastSent < COOLDOWN_MS) {
      return [];
    }

    // Reserve cooldown before async network call to prevent duplicate pushes from concurrent scans
    this.cooldowns.set(key, now);

    const hasFullIndicators = Boolean((analysis as Partial<AnalysisResult>).indicators);
    if (hasFullIndicators) {
      const qual = evaluateAlertQualification(analysis);
      const enriched: WebhookSignalInput = {
        ...analysis,
        expectedMoveMinPct: qual.expectedMove.expectedMoveMinPct,
        expectedMoveMaxPct: qual.expectedMove.expectedMoveMaxPct,
        expectedWindowEn: qual.expectedMove.expectedWindowEn,
        qualityGrade: qual.qualified ? qual.qualityGrade : undefined,
      };
      return this.dispatchSignal(enriched, this.config);
    }

    return this.dispatchSignal(analysis, this.config);
  }

  public async sendTestWebhook(overrideInput?: Partial<WebhookConfig>): Promise<{
    valid: boolean;
    errors: { discord?: string; telegram?: string };
    results: WebhookDeliveryLog[];
  }> {
    const cfgToTest = overrideInput
      ? validateWebhookConfig({ ...this.config, ...overrideInput, enabled: true })
      : { valid: true, config: { ...this.config, enabled: true }, errors: {} };

    if (!cfgToTest.valid) {
      return { valid: false, errors: cfgToTest.errors, results: [] };
    }

    const hasDiscord = Boolean(cfgToTest.config.discordWebhookUrl.trim());
    const hasTelegram = Boolean(cfgToTest.config.telegramWebhookUrl.trim());
    if (!hasDiscord && !hasTelegram) {
      return {
        valid: false,
        errors: { discord: 'Enter a Discord or Telegram webhook URL first.' },
        results: [],
      };
    }

    const now = Date.now();
    const sampleSignal: WebhookSignalInput = {
      symbol: 'BTC-SWAP-USDT',
      baseAsset: 'BTC',
      timeframe: '1h',
      direction: 'LONG',
      phase: 'PRE_PUMP',
      confidence: Math.max(84, cfgToTest.config.minConfidence),
      sharpMoveScore: 81,
      expectedMoveMinPct: 4.8,
      expectedMoveMaxPct: 11.4,
      expectedWindowEn: '4–12h',
      qualityGrade: 'A+',
      lastPrice: 95250,
      volumeZScore: 2.85,
      summaryEn:
        'Test Alert from ToobitPulse: MTF 1H/4H/1D bullish confluence with TTM squeeze release and rising taker accumulation.',
      tradePlan: {
        optimalEntry: 95100,
        stopLoss: 93800,
        tp1: 96900,
        tp2: 98800,
        tp3: 101500,
        riskReward2: 2.85,
      },
      analyzedAt: now,
    };

    const results = await this.dispatchSignal(sampleSignal, cfgToTest.config);
    return { valid: true, errors: {}, results };
  }
}

export const webhookNotifier = new WebhookNotifier();
