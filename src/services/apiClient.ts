import { Capacitor } from '@capacitor/core';
import type {
  AiCryptoAnalysisReport,
  AlertAccuracySummary,
  AlertEvent,
  AlertOutcomeRecord,
  AnalysisResult,
  MarketTicker,
  ScannerOpportunity,
  SocialSentimentData,
  Timeframe,
  WebhookConfig,
  WebhookDeliveryLog,
} from '../types/futures';
import { nativeToobitEngine, type NativeStreamEvent } from './nativeToobitEngine';

export function isNativeAndroidRuntime(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export interface MarketApiResponse {
  tickers: MarketTicker[];
  updatedAt: number;
  wsConnected?: boolean;
  error: string | null;
}

export interface ScannerApiResponse {
  opportunities: ScannerOpportunity[];
  updatedAt: number;
  scanning?: boolean;
  scannedCount?: number;
  scanTotal?: number;
}

export interface AlertsApiResponse {
  alerts: AlertEvent[];
  outcomes?: AlertOutcomeRecord[];
  accuracy?: AlertAccuracySummary;
}

export interface WebhookConfigResponse {
  ok?: boolean;
  config?: WebhookConfig;
  logs?: WebhookDeliveryLog[];
  errors?: { discord?: string; telegram?: string };
}

export interface WebhookTestResponse {
  ok?: boolean;
  results?: WebhookDeliveryLog[];
  logs?: WebhookDeliveryLog[];
  errors?: { discord?: string; telegram?: string };
}

export async function fetchMarketData(): Promise<MarketApiResponse> {
  if (isNativeAndroidRuntime()) {
    return nativeToobitEngine.refreshMarketBatch();
  }
  const res = await fetch('/api/market');
  if (!res.ok) throw new Error('Toobit API proxy unavailable');
  return (await res.json()) as MarketApiResponse;
}

export async function fetchScannerData(
  timeframe: Timeframe,
  watchlist: string[],
): Promise<ScannerApiResponse> {
  if (isNativeAndroidRuntime()) {
    return nativeToobitEngine.getScannerResults(timeframe, watchlist);
  }
  const watchQuery = watchlist.join(',');
  const res = await fetch(
    `/api/scanner?timeframe=${encodeURIComponent(timeframe)}&watch=${encodeURIComponent(watchQuery)}`,
  );
  if (!res.ok) throw new Error('Scanner endpoint unavailable');
  return (await res.json()) as ScannerApiResponse;
}

export async function fetchAlertsData(): Promise<AlertsApiResponse> {
  if (isNativeAndroidRuntime()) {
    return nativeToobitEngine.getAlertsWithAccuracy();
  }
  const res = await fetch('/api/alerts');
  if (!res.ok) return { alerts: [] };
  return (await res.json()) as AlertsApiResponse;
}

export async function triggerScanNow(
  timeframe: Timeframe,
  watchlist: string[],
): Promise<ScannerApiResponse> {
  if (isNativeAndroidRuntime()) {
    await nativeToobitEngine.refreshMarketBatch();
    const opportunities = await nativeToobitEngine.runScannerCycle(timeframe, watchlist);
    return { opportunities, updatedAt: Date.now(), scanning: false };
  }
  const res = await fetch('/api/scan-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeframe, watch: watchlist }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ScannerApiResponse;
}

export async function analyzePair(
  symbol: string,
  timeframe: Timeframe,
): Promise<AnalysisResult> {
  if (isNativeAndroidRuntime()) {
    return nativeToobitEngine.analyzeSymbol(symbol, timeframe);
  }
  const res = await fetch(
    `/api/analyze/${encodeURIComponent(symbol)}?timeframe=${encodeURIComponent(timeframe)}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AnalysisResult;
}

export async function notifyFocusSymbol(symbol: string): Promise<void> {
  if (!symbol) return;
  if (isNativeAndroidRuntime()) {
    nativeToobitEngine.focusSymbol(symbol);
    return;
  }
  await fetch('/api/focus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol }),
  }).catch(() => {});
}

export interface LiveStreamCallbacks {
  onStatusChange: (connected: boolean) => void;
  onSnapshot?: (serverTime: number) => void;
  onTicks: (ticks: MarketTicker[], serverTime: number) => void;
  onAlerts: (alerts: AlertEvent[]) => void;
}

export function subscribeLiveStream(
  focusSymbol: string,
  callbacks: LiveStreamCallbacks,
): () => void {
  if (isNativeAndroidRuntime()) {
    return nativeToobitEngine.subscribeStream(focusSymbol, (ev: NativeStreamEvent) => {
      if (ev.type === 'status') {
        callbacks.onStatusChange(ev.connected);
      } else if (ev.type === 'snapshot') {
        callbacks.onStatusChange(true);
        callbacks.onSnapshot?.(ev.serverTime);
      } else if (ev.type === 'ticks') {
        callbacks.onStatusChange(true);
        callbacks.onTicks(ev.ticks, ev.serverTime);
      } else if (ev.type === 'alerts') {
        callbacks.onAlerts(ev.alerts);
      }
    });
  }

  if (typeof EventSource === 'undefined') {
    return () => {};
  }

  const es = new EventSource(`/api/stream?focus=${encodeURIComponent(focusSymbol)}`);

  es.onopen = () => {
    callbacks.onStatusChange(true);
  };

  es.onerror = () => {
    callbacks.onStatusChange(false);
  };

  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as
        | { type: 'snapshot'; wsConnected: boolean; serverTime: number }
        | { type: 'ticks'; ticks: MarketTicker[]; serverTime: number }
        | { type: 'alerts'; alerts: AlertEvent[] };

      if (msg.type === 'snapshot') {
        callbacks.onStatusChange(true);
        callbacks.onSnapshot?.(msg.serverTime);
      } else if (msg.type === 'ticks' && Array.isArray(msg.ticks) && msg.ticks.length > 0) {
        callbacks.onStatusChange(true);
        callbacks.onTicks(msg.ticks, msg.serverTime || Date.now());
      } else if (msg.type === 'alerts' && Array.isArray(msg.alerts) && msg.alerts.length > 0) {
        callbacks.onAlerts(msg.alerts);
      }
    } catch {
      // Ignore malformed SSE payload
    }
  };

  return () => {
    es.close();
    callbacks.onStatusChange(false);
  };
}

export async function fetchSocialSentiment(
  symbol: string,
  forceRefresh = false,
): Promise<SocialSentimentData> {
  if (isNativeAndroidRuntime()) {
    return nativeToobitEngine.getSentiment(symbol, forceRefresh);
  }
  const suffix = forceRefresh ? '?refresh=1' : '';
  const res = await fetch(`/api/sentiment/${encodeURIComponent(symbol)}${suffix}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SocialSentimentData;
}

export class AiClientError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'AiClientError';
    this.code = code;
    this.status = status;
  }
}

export async function requestAiCryptoAnalysis(
  symbol: string,
  timeframe: Timeframe,
  forceRefresh = false,
): Promise<AiCryptoAnalysisReport> {
  if (isNativeAndroidRuntime()) {
    throw new AiClientError(
      'Server-side Gemini AI proxy requires web/Termux backend mode; live CoinGecko, Fear & Greed, and RSS sentiment remain active offline/APK.',
      'NATIVE_APK_NO_SERVER_KEY',
      503,
    );
  }
  const res = await fetch(`/api/ai-analyze/${encodeURIComponent(symbol)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeframe, forceRefresh }),
  });
  const payload = (await res.json().catch(() => ({}))) as Partial<AiCryptoAnalysisReport> & {
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    throw new AiClientError(
      payload.error || `HTTP ${res.status}`,
      payload.code || 'AI_UPSTREAM_ERROR',
      res.status,
    );
  }
  return payload as AiCryptoAnalysisReport;
}

export async function fetchWebhookConfig(): Promise<WebhookConfigResponse | null> {
  if (isNativeAndroidRuntime()) {
    const state = nativeToobitEngine.getWebhookState();
    return { ok: true, config: state.config, logs: state.logs };
  }
  const res = await fetch('/api/webhooks/config');
  if (!res.ok) return null;
  return (await res.json()) as WebhookConfigResponse;
}

export async function saveWebhookConfig(
  config: WebhookConfig,
): Promise<{ ok: boolean; statusOk: boolean; data: WebhookConfigResponse }> {
  if (isNativeAndroidRuntime()) {
    const res = nativeToobitEngine.saveWebhookConfig(config);
    return {
      ok: res.ok,
      statusOk: res.ok,
      data: {
        ok: res.ok,
        config: res.config,
        logs: res.logs,
        errors: res.errors,
      },
    };
  }
  const res = await fetch('/api/webhooks/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = (await res.json()) as WebhookConfigResponse;
  return { ok: res.ok && Boolean(data.ok), statusOk: res.ok, data };
}

export async function sendTestWebhook(
  config: WebhookConfig,
): Promise<{ ok: boolean; statusOk: boolean; data: WebhookTestResponse }> {
  if (isNativeAndroidRuntime()) {
    const res = await nativeToobitEngine.sendTestWebhook(config);
    return {
      ok: res.ok,
      statusOk: res.ok,
      data: {
        ok: res.ok,
        results: res.results,
        logs: res.logs,
        errors: res.errors,
      },
    };
  }
  const res = await fetch('/api/webhooks/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = (await res.json()) as WebhookTestResponse;
  return { ok: res.ok && Boolean(data.ok), statusOk: res.ok, data };
}

export async function triggerRuleWebhook(alert: AlertEvent): Promise<void> {
  if (isNativeAndroidRuntime()) {
    await nativeToobitEngine.triggerRuleWebhook(alert);
    return;
  }
  await fetch('/api/webhooks/rule-trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alert }),
  }).catch(() => {});
}
