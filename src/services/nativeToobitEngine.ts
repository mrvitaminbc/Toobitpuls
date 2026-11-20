import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { analyzeFuturesSymbol } from '../engine/analyzer';
import type {
  AlertAccuracySummary,
  AlertEvent,
  AlertOutcomeRecord,
  AnalysisResult,
  Candle,
  MarketTicker,
  OrderBookLevel,
  OrderBookSnapshot,
  RecentTrade,
  ScannerOpportunity,
  SocialSentimentData,
  Timeframe,
  WebhookConfig,
  WebhookDeliveryLog,
  WebhookPlatform,
} from '../types/futures';
import { evaluateAlertQualification, isPeggedStablecoin } from '../utils/alerts';
import {
  computeAlertAccuracySummary,
  evaluateAlertOutcomeWithPrice,
  initializeOutcomeFromAlert,
} from '../utils/alertTracker';
import {
  getPairAssets,
  isValidActiveFuturesContract,
  isValidMarketTickerRow,
  type RawExchangeContract,
} from '../utils/futuresContracts';
import {
  aggregateSocialSentiment,
  extractBaseAssetFromSymbol,
  normalizeBaseTicker,
  parseRssHeadlines,
  type ParsedRssItem,
} from '../utils/socialSentiment';
import {
  DEFAULT_WEBHOOK_CONFIG,
  buildDiscordWebhookPayload,
  buildTelegramWebhookPayload,
  shouldPushWebhookSignal,
  validateDiscordWebhookUrl,
  validateTelegramWebhookUrl,
  validateWebhookConfig,
  type WebhookSignalInput,
} from '../utils/webhook';

const TOOBIT_BASE_URL = 'https://api.toobit.com';
const TOOBIT_WS_URL = 'wss://stream.toobit.com/quote/ws/v1';
const WEBHOOK_STORAGE_KEY = 'tp_native_webhooks_v1';
const WEBHOOK_COOLDOWN_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

interface RawTicker {
  t: number;
  si?: string;
  s: string;
  c: string;
  h: string;
  l: string;
  o: string;
  v: string;
  qv: string;
  op?: string;
  pc: string;
  pcp: string;
}

interface RawFunding {
  symbol: string;
  rate: string;
  nextFundingTime?: string;
}

interface RawMarkPrice {
  symbolId: string;
  price: string;
  time: number;
}

interface RawDepth {
  t: number;
  b: [string, string][];
  a: [string, string][];
}

interface RawTrade {
  t: number;
  p: string;
  q: string;
  ibm: boolean;
}

interface WsRealtimeItem {
  t: number;
  s: string;
  c: string;
  h: string;
  l: string;
  o: string;
  v: string;
  qv: string;
  m?: string;
}

type RawKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
];

interface HistorySnapshot {
  openInterest: number;
  quoteVolume: number;
  price: number;
  time: number;
}

export interface HttpTransport {
  getJson<T>(url: string, headers?: Record<string, string>): Promise<T>;
  getText(url: string, headers?: Record<string, string>): Promise<string | null>;
  postJson(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; text: string }>;
}

export function createDefaultHttpTransport(): HttpTransport {
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    return {
      async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
        const res = await CapacitorHttp.request({
          url,
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...headers,
          },
          connectTimeout: REQUEST_TIMEOUT_MS,
          readTimeout: REQUEST_TIMEOUT_MS,
        });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`HTTP ${res.status} on ${url}`);
        }
        if (typeof res.data === 'string') {
          return JSON.parse(res.data) as T;
        }
        return res.data as T;
      },

      async getText(url: string, headers: Record<string, string> = {}): Promise<string | null> {
        try {
          const res = await CapacitorHttp.request({
            url,
            method: 'GET',
            headers: {
              Accept: 'application/json, application/rss+xml, application/xml, text/xml',
              ...headers,
            },
            responseType: 'text',
            connectTimeout: 6000,
            readTimeout: 6000,
          });
          if (res.status < 200 || res.status >= 300) return null;
          return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        } catch {
          return null;
        }
      },

      async postJson(
        url: string,
        body: unknown,
        headers: Record<string, string> = {},
      ): Promise<{ ok: boolean; status: number; text: string }> {
        const res = await CapacitorHttp.request({
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          data: body,
          connectTimeout: 6000,
          readTimeout: 6000,
        });
        const text =
          typeof res.data === 'string'
            ? res.data
            : res.data != null
              ? JSON.stringify(res.data)
              : '';
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          text,
        };
      },
    };
  }

  return {
    async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json', ...headers },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} on ${url}`);
        }
        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    },

    async getText(url: string, headers: Record<string, string> = {}): Promise<string | null> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json, application/rss+xml, application/xml, text/xml',
            ...headers,
          },
        });
        if (!res.ok) return null;
        return await res.text();
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },

    async postJson(
      url: string,
      body: unknown,
      headers: Record<string, string> = {},
    ): Promise<{ ok: boolean; status: number; text: string }> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify(body),
        });
        const text = await res.text().catch(() => '');
        return { ok: res.ok, status: res.status, text };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const KNOWN_COINGECKO_IDS: Record<string, { id: string; name: string }> = {
  BTC: { id: 'bitcoin', name: 'Bitcoin' },
  ETH: { id: 'ethereum', name: 'Ethereum' },
  SOL: { id: 'solana', name: 'Solana' },
  XRP: { id: 'ripple', name: 'XRP' },
  BNB: { id: 'binancecoin', name: 'BNB' },
  DOGE: { id: 'dogecoin', name: 'Dogecoin' },
  ADA: { id: 'cardano', name: 'Cardano' },
  AVAX: { id: 'avalanche-2', name: 'Avalanche' },
  TRX: { id: 'tron', name: 'TRON' },
  LINK: { id: 'chainlink', name: 'Chainlink' },
  TON: { id: 'the-open-network', name: 'Toncoin' },
  SUI: { id: 'sui', name: 'Sui' },
  PEPE: { id: 'pepe', name: 'Pepe' },
  SHIB: { id: 'shiba-inu', name: 'Shiba Inu' },
  DOT: { id: 'polkadot', name: 'Polkadot' },
  LTC: { id: 'litecoin', name: 'Litecoin' },
  BCH: { id: 'bitcoin-cash', name: 'Bitcoin Cash' },
  NEAR: { id: 'near', name: 'NEAR Protocol' },
  UNI: { id: 'uniswap', name: 'Uniswap' },
  APT: { id: 'aptos', name: 'Aptos' },
  ARB: { id: 'arbitrum', name: 'Arbitrum' },
  OP: { id: 'optimism', name: 'Optimism' },
  INJ: { id: 'injective-protocol', name: 'Injective' },
  AAVE: { id: 'aave', name: 'Aave' },
  WIF: { id: 'dogwifcoin', name: 'dogwifhat' },
  BONK: { id: 'bonk', name: 'Bonk' },
  FLOKI: { id: 'floki', name: 'FLOKI' },
  RENDER: { id: 'render-token', name: 'Render' },
  FET: { id: 'fetch-ai', name: 'Artificial Superintelligence Alliance' },
  TAO: { id: 'bittensor', name: 'Bittensor' },
  HBAR: { id: 'hedera-hashgraph', name: 'Hedera' },
  SEI: { id: 'sei-network', name: 'Sei' },
  TIA: { id: 'celestia', name: 'Celestia' },
  ATOM: { id: 'cosmos', name: 'Cosmos' },
  FIL: { id: 'filecoin', name: 'Filecoin' },
  XLM: { id: 'stellar', name: 'Stellar' },
};

export type NativeStreamEvent =
  | { type: 'snapshot'; wsConnected: boolean; serverTime: number }
  | { type: 'ticks'; ticks: MarketTicker[]; serverTime: number }
  | { type: 'alerts'; alerts: AlertEvent[] }
  | { type: 'status'; connected: boolean };

type NativeStreamListener = (event: NativeStreamEvent) => void;

export class NativeToobitEngine {
  private readonly transport: HttpTransport;

  private tickers: MarketTicker[] = [];
  private tickerMap = new Map<string, MarketTicker>();
  private activeContracts = new Map<string, RawExchangeContract>();
  private multiplierMap = new Map<string, number>();
  private historyMap = new Map<string, HistorySnapshot[]>();
  private opportunitiesByTf = new Map<Timeframe, ScannerOpportunity[]>();
  private activeScanPromises = new Map<Timeframe, Promise<ScannerOpportunity[]>>();
  private analysisCache = new Map<string, { data: AnalysisResult; expiresAt: number }>();
  private htfCandleCache = new Map<string, { candles: Candle[]; expiresAt: number }>();

  private alerts: AlertEvent[] = [];
  private alertOutcomes = new Map<string, AlertOutcomeRecord>();
  private alertCooldown = new Map<string, { time: number; probability: number; qualityScore: number }>();

  // Live WS stream state
  private dirtyTickers = new Map<string, MarketTicker>();
  private streamListeners = new Set<NativeStreamListener>();
  private subscribedSymbols = new Set<string>();
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private lastMarketSync = 0;
  private lastScanSync = 0;
  private lastContractSync = 0;
  private isScanning = false;
  private scanTotal = 0;
  private scannedCount = 0;
  private lastError: string | null = null;

  // Social sentiment caches
  private fngCache: { value: number | null; label: string | null; expiresAt: number } | null = null;
  private rssCache: { items: ParsedRssItem[]; expiresAt: number } | null = null;
  private coinIdCache = new Map<string, { id: string; name: string; expiresAt: number }>();
  private sentimentCache = new Map<string, { data: SocialSentimentData; expiresAt: number }>();

  // Webhook config & logs persisted in localStorage
  private webhookConfig: WebhookConfig = { ...DEFAULT_WEBHOOK_CONFIG };
  private webhookCooldowns = new Map<string, number>();
  private webhookLogs: WebhookDeliveryLog[] = [];

  constructor(options?: { transport?: HttpTransport }) {
    this.transport = options?.transport ?? createDefaultHttpTransport();
    this.loadWebhookConfig();
  }

  private loadWebhookConfig(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(WEBHOOK_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
      const checked = validateWebhookConfig(parsed);
      if (checked.valid) {
        this.webhookConfig = checked.config;
      }
    } catch {
      // Ignore storage read issues
    }
  }

  private saveWebhookConfigToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(WEBHOOK_STORAGE_KEY, JSON.stringify(this.webhookConfig));
    } catch {
      // Ignore storage write issues
    }
  }

  private fetchToobitJson<T>(path: string): Promise<T> {
    return this.transport.getJson<T>(`${TOOBIT_BASE_URL}${path}`);
  }

  private async ensureContractSpecs(force = false): Promise<void> {
    const now = Date.now();
    const cacheAge = now - this.lastContractSync;
    const ttl = this.activeContracts.size > 0 ? 10 * 60 * 1000 : 5_000;
    if (!force && cacheAge < ttl && this.activeContracts.size > 0) {
      return;
    }
    try {
      const info = await this.fetchToobitJson<{
        contracts?: RawExchangeContract[];
      }>('/api/v1/exchangeInfo');

      const nextActive = new Map<string, RawExchangeContract>();
      const nextMult = new Map<string, number>();

      for (const c of info.contracts || []) {
        if (!isValidActiveFuturesContract(c, now) || !c.symbol) continue;
        nextActive.set(c.symbol, c);
        if (c.contractMultiplier) {
          const mult = Number(c.contractMultiplier);
          if (Number.isFinite(mult) && mult > 0) {
            nextMult.set(c.symbol, mult);
          }
        }
      }

      if (nextActive.size > 0) {
        this.activeContracts = nextActive;
        this.multiplierMap = nextMult;
        this.lastContractSync = now;
      }
    } catch {
      // Retry on next cycle
    }
  }

  public async refreshMarketBatch(): Promise<{
    tickers: MarketTicker[];
    updatedAt: number;
    wsConnected: boolean;
    error: string | null;
  }> {
    try {
      await this.ensureContractSpecs();
      const [rawTickers, rawFunding, rawMark] = await Promise.all([
        this.fetchToobitJson<RawTicker[]>('/quote/v1/contract/ticker/24hr'),
        this.fetchToobitJson<RawFunding[]>('/api/v1/futures/fundingRate').catch(
          () => [] as RawFunding[],
        ),
        this.fetchToobitJson<RawMarkPrice[]>('/quote/v1/markPrice').catch(
          () => [] as RawMarkPrice[],
        ),
      ]);

      const fundingMap = new Map<string, RawFunding>();
      for (const f of rawFunding || []) fundingMap.set(f.symbol, f);

      const markMap = new Map<string, RawMarkPrice>();
      for (const m of rawMark || []) markMap.set(m.symbolId, m);

      const now = Date.now();
      const parsed: MarketTicker[] = [];
      const activeRegistry = this.activeContracts.size > 0 ? this.activeContracts : null;
      const validSymbolSet = new Set<string>();

      for (const item of rawTickers || []) {
        const symbol = item.s || item.si || '';
        const lastPrice = Number(item.c) || 0;
        if (!isValidMarketTickerRow(symbol, activeRegistry, lastPrice)) continue;

        const quoteVolume24h = Number(item.qv) || 0;
        const { baseAsset, quoteAsset } = getPairAssets(symbol);
        const markEntry = markMap.get(symbol);
        const markPrice = markEntry ? Number(markEntry.price) || lastPrice : lastPrice;
        const indexBasisPct = markPrice > 0 ? ((lastPrice - markPrice) / markPrice) * 100 : 0;

        const mult = this.multiplierMap.get(symbol) ?? 1;
        const openInterest = (Number(item.op) || 0) * mult;
        const openInterestUsd = openInterest * lastPrice;

        const fundEntry = fundingMap.get(symbol);
        const fundingRate = fundEntry ? Number(fundEntry.rate) || 0 : 0;
        const nextFundingTime = fundEntry?.nextFundingTime ? Number(fundEntry.nextFundingTime) : 0;

        const hist = this.historyMap.get(symbol) ?? [];
        hist.push({
          openInterest,
          quoteVolume: quoteVolume24h,
          price: lastPrice,
          time: now,
        });
        if (hist.length > 40) hist.shift();
        this.historyMap.set(symbol, hist);

        let oiDeltaPct = 0;
        let volumeAccelPct = 0;
        if (hist.length >= 2) {
          const oldest = hist[0];
          if (oldest.openInterest > 0 && openInterest > 0) {
            oiDeltaPct = ((openInterest - oldest.openInterest) / oldest.openInterest) * 100;
          }
          if (oldest.quoteVolume > 0 && quoteVolume24h > oldest.quoteVolume) {
            volumeAccelPct = ((quoteVolume24h - oldest.quoteVolume) / oldest.quoteVolume) * 100;
          }
        }

        const prev = this.tickerMap.get(symbol);
        const ticker: MarketTicker = {
          symbol,
          baseAsset,
          quoteAsset,
          lastPrice,
          markPrice,
          indexBasisPct: Number(indexBasisPct.toFixed(4)),
          open24h: Number(item.o) || lastPrice,
          high24h: Number(item.h) || lastPrice,
          low24h: Number(item.l) || lastPrice,
          priceChange: Number(item.pc) || 0,
          priceChangePct: (Number(item.pcp) || 0) * 100,
          volume24h: (Number(item.v) || 0) * mult,
          quoteVolume24h,
          openInterest,
          openInterestUsd,
          oiDeltaPct: Number(oiDeltaPct.toFixed(3)),
          fundingRate,
          nextFundingTime,
          volumeAccelPct: Number(volumeAccelPct.toFixed(3)),
          updatedAt: item.t || now,
        };

        if (
          !prev ||
          prev.lastPrice !== ticker.lastPrice ||
          prev.fundingRate !== ticker.fundingRate ||
          prev.markPrice !== ticker.markPrice
        ) {
          this.dirtyTickers.set(symbol, ticker);
        }

        parsed.push(ticker);
        validSymbolSet.add(symbol);
        this.tickerMap.set(symbol, ticker);
      }

      for (const existingSym of this.tickerMap.keys()) {
        if (!validSymbolSet.has(existingSym)) {
          this.tickerMap.delete(existingSym);
          this.historyMap.delete(existingSym);
          this.dirtyTickers.delete(existingSym);
        }
      }

      parsed.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
      this.tickers = parsed;
      this.lastMarketSync = now;
      this.lastError = null;
      this.evaluateOutcomesWithTickers(now);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Toobit API fetch failed';
    }

    const freshTickers = this.tickers.map((t) => this.tickerMap.get(t.symbol) ?? t);
    return {
      tickers: freshTickers,
      updatedAt: this.lastMarketSync,
      wsConnected: this.wsConnected,
      error: this.lastError,
    };
  }

  public async fetchKlines(symbol: string, interval: Timeframe, limit = 120): Promise<Candle[]> {
    const raw = await this.fetchToobitJson<RawKline[]>(
      `/quote/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
    );
    return (raw || []).map((k) => ({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      quoteVolume: Number(k[7]),
      tradesCount: Number(k[8]) || 0,
      takerBuyBaseVol: Number(k[9]) || 0,
      takerBuyQuoteVol: Number(k[10]) || 0,
    }));
  }

  private getHtfTtlMs(tf: '1h' | '4h' | '1d'): number {
    if (tf === '1d') return 10 * 60 * 1000;
    if (tf === '4h') return 3 * 60 * 1000;
    return 75 * 1000;
  }

  private async fetchCachedHtfKlines(
    symbol: string,
    tf: '1h' | '4h' | '1d',
    limit = 100,
  ): Promise<Candle[]> {
    const key = `${symbol}:${tf}`;
    const now = Date.now();
    const cached = this.htfCandleCache.get(key);
    if (cached && cached.expiresAt > now && cached.candles.length >= Math.min(40, limit)) {
      return cached.candles;
    }
    const fresh = await this.fetchKlines(symbol, tf, limit);
    if (fresh.length > 0) {
      if (this.htfCandleCache.size > 600) {
        this.htfCandleCache.clear();
      }
      this.htfCandleCache.set(key, {
        candles: fresh,
        expiresAt: now + this.getHtfTtlMs(tf),
      });
    }
    return fresh;
  }

  public async fetchOrderBook(symbol: string, limit = 30): Promise<OrderBookSnapshot | null> {
    try {
      const raw = await this.fetchToobitJson<RawDepth>(
        `/quote/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
      );
      const mult = this.multiplierMap.get(symbol) ?? 1;
      const bids: OrderBookLevel[] = (raw.b || []).slice(0, limit).map(([p, q]) => {
        const price = Number(p);
        const qty = Number(q) * mult;
        return { price, qty, totalUsd: price * qty };
      });
      const asks: OrderBookLevel[] = (raw.a || []).slice(0, limit).map(([p, q]) => {
        const price = Number(p);
        const qty = Number(q) * mult;
        return { price, qty, totalUsd: price * qty };
      });

      const bidDepthUsd = bids.reduce((acc, l) => acc + l.totalUsd, 0);
      const askDepthUsd = asks.reduce((acc, l) => acc + l.totalUsd, 0);
      const imbalanceRatio = askDepthUsd > 0 ? bidDepthUsd / askDepthUsd : 1;
      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 0;
      const spreadPct = bestBid > 0 && bestAsk > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 0;

      const largestBidWall = bids.reduce<OrderBookLevel | null>(
        (best, curr) => (!best || curr.totalUsd > best.totalUsd ? curr : best),
        null,
      );
      const largestAskWall = asks.reduce<OrderBookLevel | null>(
        (best, curr) => (!best || curr.totalUsd > best.totalUsd ? curr : best),
        null,
      );

      return {
        bids,
        asks,
        bidDepthUsd,
        askDepthUsd,
        imbalanceRatio: Number(imbalanceRatio.toFixed(2)),
        spreadPct: Number(spreadPct.toFixed(4)),
        largestBidWall,
        largestAskWall,
        updatedAt: raw.t || Date.now(),
      };
    } catch {
      return null;
    }
  }

  public async fetchRecentTrades(symbol: string, limit = 40): Promise<RecentTrade[]> {
    try {
      const raw = await this.fetchToobitJson<RawTrade[]>(
        `/quote/v1/trades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
      );
      const mult = this.multiplierMap.get(symbol) ?? 1;
      return (raw || []).map((t) => {
        const price = Number(t.p);
        const qty = Number(t.q) * mult;
        return {
          time: Number(t.t),
          price,
          qty,
          quoteUsd: price * qty,
          isBuyerMaker: Boolean(t.ibm),
        };
      });
    } catch {
      return [];
    }
  }

  public async analyzeSymbol(symbol: string, timeframe: Timeframe = '1h'): Promise<AnalysisResult> {
    await this.ensureContractSpecs();
    if (this.activeContracts.size > 0 && !this.activeContracts.has(symbol)) {
      throw new Error(`Contract ${symbol} is not an active Toobit Futures pair`);
    }

    this.focusSymbol(symbol);
    const cacheKey = `${symbol}:${timeframe}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    if (this.tickers.length === 0) {
      await this.refreshMarketBatch();
    }

    const ticker = this.tickerMap.get(symbol);
    const { baseAsset } = getPairAssets(symbol);

    const [candles, orderBook, recentTrades, htf1h, htf4h, htf1d] = await Promise.all([
      this.fetchKlines(symbol, timeframe, 260),
      this.fetchOrderBook(symbol, 30),
      this.fetchRecentTrades(symbol, 40),
      timeframe === '1h'
        ? Promise.resolve<Candle[] | undefined>(undefined)
        : this.fetchCachedHtfKlines(symbol, '1h', 110).catch(() => undefined),
      timeframe === '4h'
        ? Promise.resolve<Candle[] | undefined>(undefined)
        : this.fetchCachedHtfKlines(symbol, '4h', 110).catch(() => undefined),
      timeframe === '1d'
        ? Promise.resolve<Candle[] | undefined>(undefined)
        : this.fetchCachedHtfKlines(symbol, '1d', 90).catch(() => undefined),
    ]);

    const analysis = analyzeFuturesSymbol({
      symbol,
      baseAsset: ticker?.baseAsset ?? baseAsset,
      timeframe,
      candles,
      mtfCandles: {
        tf1h: timeframe === '1h' ? candles : htf1h,
        tf4h: timeframe === '4h' ? candles : htf4h,
        tf1d: timeframe === '1d' ? candles : htf1d,
      },
      markPrice: ticker?.markPrice,
      indexBasisPct: ticker?.indexBasisPct ?? 0,
      priceChangePct: ticker?.priceChangePct ?? 0,
      quoteVolume24h: ticker?.quoteVolume24h ?? 0,
      openInterestUsd: ticker?.openInterestUsd ?? 0,
      oiDeltaPct: ticker?.oiDeltaPct ?? 0,
      fundingRate: ticker?.fundingRate ?? 0,
      orderBook,
      recentTrades,
    });

    this.analysisCache.set(cacheKey, {
      data: analysis,
      expiresAt: Date.now() + 2000,
    });

    return analysis;
  }

  /**
   * Mobile-friendly candidate selection: prioritizes watchlist, top 24h liquidity,
   * top movers, and funding extremes (~45 pairs) so mobile phones stay fast and cool.
   */
  private getMobileOrderedScanSymbols(extraSymbols: string[] = []): MarketTicker[] {
    const picked = new Map<string, MarketTicker>();

    for (const sym of extraSymbols) {
      const t = this.tickerMap.get(sym);
      if (t) picked.set(t.symbol, t);
    }
    for (const t of this.tickers.slice(0, 25)) {
      picked.set(t.symbol, t);
    }

    const byMover = [...this.tickers].sort(
      (a, b) => Math.abs(b.priceChangePct) - Math.abs(a.priceChangePct),
    );
    for (const t of byMover.slice(0, 12)) {
      picked.set(t.symbol, t);
    }

    const byFunding = [...this.tickers].sort(
      (a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate),
    );
    for (const t of byFunding.slice(0, 8)) {
      picked.set(t.symbol, t);
    }

    return Array.from(picked.values()).slice(0, 48);
  }

  private buildOpportunityFromAnalysis(
    analysis: AnalysisResult,
    imbalanceRatio: number | null,
  ): ScannerOpportunity {
    const topPat = analysis.patterns[0];
    const vwap = analysis.indicators.vwap;
    const vwapDistPct =
      vwap > 0 ? Number((((analysis.lastPrice - vwap) / vwap) * 100).toFixed(2)) : 0;
    return {
      symbol: analysis.symbol,
      baseAsset: analysis.baseAsset,
      timeframe: analysis.timeframe,
      lastPrice: analysis.lastPrice,
      markPrice: analysis.markPrice,
      priceChangePct: analysis.priceChangePct,
      quoteVolume24h: analysis.quoteVolume24h,
      openInterestUsd: analysis.openInterestUsd,
      oiDeltaPct: analysis.oiDeltaPct,
      fundingRate: analysis.fundingRate,
      direction: analysis.direction,
      phase: analysis.phase,
      confidence: analysis.confidence,
      pumpProbability: analysis.pumpProbability,
      dumpProbability: analysis.dumpProbability,
      sharpMoveScore: analysis.sharpMoveScore,
      sharpMoveBias: analysis.sharpMoveBias,
      ttmSqueeze: analysis.indicators.ttmSqueeze,
      squeezeBars: analysis.indicators.squeezeBars,
      cvdDivergence: analysis.indicators.cvdDivergence,
      suspiciousVolumeScore: analysis.suspiciousVolumeScore,
      volumeZScore: analysis.volumeZScore,
      volumeRatio20: analysis.volumeRatio20,
      takerBuyRatio: analysis.takerBuyRatio,
      rsi14: analysis.indicators.rsi14,
      adx14: analysis.indicators.adx14,
      vwapDistPct,
      cmf20: analysis.indicators.cmf20,
      atrPct: analysis.indicators.atrPct,
      bbWidthPercentile: analysis.indicators.bbWidthPercentile,
      isSqueeze: analysis.isSqueeze,
      imbalanceRatio,
      spreadPct: analysis.orderBook ? analysis.orderBook.spreadPct : null,
      mtfAlignment: analysis.mtf?.alignmentLabel ?? null,
      alignedTimeframes: analysis.mtf?.alignedTimeframes ?? 0,
      topPatternEn: topPat?.nameEn ?? null,
      topPatternFa: topPat?.nameFa ?? null,
      optimalEntry: analysis.tradePlan.optimalEntry,
      stopLoss: analysis.tradePlan.stopLoss,
      tp1: analysis.tradePlan.tp1,
      tp2: analysis.tradePlan.tp2,
      tp3: analysis.tradePlan.tp3,
      support1: analysis.indicators.support1,
      resistance1: analysis.indicators.resistance1,
      smcZone: analysis.indicators.smcZone,
      riskReward2: analysis.tradePlan.riskReward2,
      suggestedMaxLeverage: analysis.tradePlan.suggestedMaxLeverage,
      summaryEn: analysis.summaryEn,
      summaryFa: analysis.summaryFa,
      analyzedAt: analysis.analyzedAt,
    };
  }

  public async runScannerCycle(
    timeframe: Timeframe = '1h',
    extraSymbols: string[] = [],
  ): Promise<ScannerOpportunity[]> {
    const inFlight = this.activeScanPromises.get(timeframe);
    if (inFlight) return inFlight;

    const promise = this.executeMobileScan(timeframe, extraSymbols).finally(() => {
      this.activeScanPromises.delete(timeframe);
    });
    this.activeScanPromises.set(timeframe, promise);
    return promise;
  }

  private async executeMobileScan(
    timeframe: Timeframe,
    extraSymbols: string[],
  ): Promise<ScannerOpportunity[]> {
    this.isScanning = true;
    try {
      if (this.tickers.length === 0) {
        await this.refreshMarketBatch();
      }

      const candidates = this.getMobileOrderedScanSymbols(extraSymbols);
      this.scanTotal = candidates.length;
      this.scannedCount = 0;

      const candleCache = new Map<string, Candle[]>();
      const finalAnalysisBySymbol = new Map<string, AnalysisResult>();
      const resultsBySymbol = new Map<string, ScannerOpportunity>();
      const queue = [...candidates];
      const concurrency = 4;

      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (queue.length > 0) {
            const ticker = queue.shift();
            if (!ticker) break;
            try {
              const latestTicker = this.tickerMap.get(ticker.symbol) ?? ticker;
              const candles = await this.fetchKlines(latestTicker.symbol, timeframe, 110);
              if (candles.length < 30) continue;

              candleCache.set(latestTicker.symbol, candles);
              if (timeframe === '1h' || timeframe === '4h' || timeframe === '1d') {
                this.htfCandleCache.set(`${latestTicker.symbol}:${timeframe}`, {
                  candles,
                  expiresAt: Date.now() + this.getHtfTtlMs(timeframe),
                });
              }

              const analysis = analyzeFuturesSymbol({
                symbol: latestTicker.symbol,
                baseAsset: latestTicker.baseAsset,
                timeframe,
                candles,
                markPrice: latestTicker.markPrice,
                indexBasisPct: latestTicker.indexBasisPct,
                priceChangePct: latestTicker.priceChangePct,
                quoteVolume24h: latestTicker.quoteVolume24h,
                openInterestUsd: latestTicker.openInterestUsd,
                oiDeltaPct: latestTicker.oiDeltaPct,
                fundingRate: latestTicker.fundingRate,
                orderBook: null,
              });

              finalAnalysisBySymbol.set(latestTicker.symbol, analysis);
              resultsBySymbol.set(
                latestTicker.symbol,
                this.buildOpportunityFromAnalysis(analysis, null),
              );
            } catch {
              // Skip transient single-pair failure
            } finally {
              this.scannedCount += 1;
            }
          }
        }),
      );

      const rankedInitial = Array.from(resultsBySymbol.values()).sort((a, b) => {
        const aScore =
          Math.max(a.pumpProbability, a.dumpProbability) * 0.45 +
          (a.sharpMoveScore ?? 0) * 0.35 +
          a.suspiciousVolumeScore * 0.2;
        const bScore =
          Math.max(b.pumpProbability, b.dumpProbability) * 0.45 +
          (b.sharpMoveScore ?? 0) * 0.35 +
          b.suspiciousVolumeScore * 0.2;
        return bScore - aScore;
      });

      const enrichSet = new Set<string>(rankedInitial.slice(0, 18).map((o) => o.symbol));
      for (const sym of extraSymbols) {
        if (resultsBySymbol.has(sym)) enrichSet.add(sym);
      }

      const enrichQueue = Array.from(enrichSet);
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (enrichQueue.length > 0) {
            const sym = enrichQueue.shift();
            if (!sym) break;
            try {
              const latestTicker = this.tickerMap.get(sym);
              const candles = candleCache.get(sym);
              if (!latestTicker || !candles) continue;

              const [orderBook, htf1h, htf4h, htf1d] = await Promise.all([
                this.fetchOrderBook(sym, 20),
                timeframe === '1h'
                  ? Promise.resolve(candles)
                  : this.fetchCachedHtfKlines(sym, '1h', 110).catch(() => undefined),
                timeframe === '4h'
                  ? Promise.resolve(candles)
                  : this.fetchCachedHtfKlines(sym, '4h', 110).catch(() => undefined),
                timeframe === '1d'
                  ? Promise.resolve(candles)
                  : this.fetchCachedHtfKlines(sym, '1d', 90).catch(() => undefined),
              ]);

              const analysis = analyzeFuturesSymbol({
                symbol: latestTicker.symbol,
                baseAsset: latestTicker.baseAsset,
                timeframe,
                candles,
                mtfCandles: { tf1h: htf1h, tf4h: htf4h, tf1d: htf1d },
                markPrice: latestTicker.markPrice,
                indexBasisPct: latestTicker.indexBasisPct,
                priceChangePct: latestTicker.priceChangePct,
                quoteVolume24h: latestTicker.quoteVolume24h,
                openInterestUsd: latestTicker.openInterestUsd,
                oiDeltaPct: latestTicker.oiDeltaPct,
                fundingRate: latestTicker.fundingRate,
                orderBook,
              });

              this.maybeRecordAlert(analysis);
              finalAnalysisBySymbol.set(sym, analysis);
              resultsBySymbol.set(
                sym,
                this.buildOpportunityFromAnalysis(analysis, orderBook?.imbalanceRatio ?? null),
              );
            } catch {
              // Keep Pass 1 result
            }
          }
        }),
      );

      for (const analysis of finalAnalysisBySymbol.values()) {
        if (isPeggedStablecoin(analysis.baseAsset)) continue;
        if (analysis.quoteVolume24h > 0 && analysis.quoteVolume24h < 400_000) continue;
        const qual = evaluateAlertQualification(analysis);
        if (qual.qualified) {
          void this.evaluateAndPushWebhookSignal(analysis);
        }
      }

      const finalResults = Array.from(resultsBySymbol.values()).sort((a, b) => {
        const aMtfBoost = (a.alignedTimeframes ?? 0) >= 2 ? 6 : 0;
        const bMtfBoost = (b.alignedTimeframes ?? 0) >= 2 ? 6 : 0;
        const aPreBoost = a.phase === 'PRE_PUMP' || a.phase === 'PRE_DUMP' ? 5 : 0;
        const bPreBoost = b.phase === 'PRE_PUMP' || b.phase === 'PRE_DUMP' ? 5 : 0;
        const aScore =
          Math.max(a.pumpProbability, a.dumpProbability) * 0.45 +
          (a.sharpMoveScore ?? 0) * 0.35 +
          a.suspiciousVolumeScore * 0.2 +
          aMtfBoost +
          aPreBoost;
        const bScore =
          Math.max(b.pumpProbability, b.dumpProbability) * 0.45 +
          (b.sharpMoveScore ?? 0) * 0.35 +
          b.suspiciousVolumeScore * 0.2 +
          bMtfBoost +
          bPreBoost;
        return bScore - aScore;
      });

      this.opportunitiesByTf.set(timeframe, finalResults);
      this.lastScanSync = Date.now();
      return finalResults;
    } finally {
      this.isScanning = false;
    }
  }

  public async getScannerResults(
    timeframe: Timeframe = '1h',
    extraSymbols: string[] = [],
  ): Promise<{
    opportunities: ScannerOpportunity[];
    updatedAt: number;
    scanning: boolean;
    scannedCount: number;
    scanTotal: number;
  }> {
    const existing = this.opportunitiesByTf.get(timeframe);
    if (!existing || existing.length === 0 || Date.now() - this.lastScanSync > 40_000) {
      const results = await this.runScannerCycle(timeframe, extraSymbols);
      return {
        opportunities: results,
        updatedAt: this.lastScanSync,
        scanning: this.isScanning,
        scannedCount: this.scannedCount,
        scanTotal: this.scanTotal,
      };
    }

    return {
      opportunities: existing,
      updatedAt: this.lastScanSync,
      scanning: this.isScanning,
      scannedCount: this.scannedCount,
      scanTotal: this.scanTotal,
    };
  }

  private maybeRecordAlert(analysis: AnalysisResult): void {
    const qualification = evaluateAlertQualification(analysis);
    if (!qualification.qualified) return;

    const key = `${analysis.symbol}:${qualification.side}`;
    const now = Date.now();
    const prev = this.alertCooldown.get(key);
    const COOLDOWN_MS = 12 * 60 * 1000;
    const isMaterialUpgrade =
      prev !== undefined &&
      (qualification.probability >= prev.probability + 10 ||
        qualification.qualityScore >= prev.qualityScore + 12);

    if (prev && now - prev.time < COOLDOWN_MS && !isMaterialUpgrade) {
      return;
    }

    this.alertCooldown.set(key, {
      time: now,
      probability: qualification.probability,
      qualityScore: qualification.qualityScore,
    });

    const newAlert: AlertEvent = {
      id: `${analysis.symbol}-${now}`,
      timestamp: now,
      symbol: analysis.symbol,
      baseAsset: analysis.baseAsset,
      timeframe: analysis.timeframe,
      phase: analysis.phase,
      direction: analysis.direction,
      confidence: analysis.confidence,
      pumpProbability: analysis.pumpProbability,
      dumpProbability: analysis.dumpProbability,
      price: analysis.lastPrice,
      optimalEntry: analysis.tradePlan.optimalEntry,
      stopLoss: analysis.tradePlan.stopLoss,
      tp1: analysis.tradePlan.tp1,
      tp2: analysis.tradePlan.tp2,
      tp3: analysis.tradePlan.tp3,
      suggestedMaxLeverage: analysis.tradePlan.suggestedMaxLeverage,
      volumeZScore: analysis.volumeZScore,
      qualityGrade: qualification.qualityGrade,
      qualityScore: qualification.qualityScore,
      alignedTimeframes: qualification.alignedTimeframes,
      expectedMoveMinPct: qualification.expectedMove.expectedMoveMinPct,
      expectedMoveMaxPct: qualification.expectedMove.expectedMoveMaxPct,
      expectedHorizonHoursMin: qualification.expectedMove.expectedHorizonHoursMin,
      expectedHorizonHoursMax: qualification.expectedMove.expectedHorizonHoursMax,
      expectedWindowEn: qualification.expectedMove.expectedWindowEn,
      expectedWindowFa: qualification.expectedMove.expectedWindowFa,
      riskReward1: analysis.tradePlan.riskReward1,
      takerBuyPct: Math.round(analysis.takerBuyRatio * 100),
      reasonEn: analysis.summaryEn,
      reasonFa: analysis.summaryFa,
    };

    this.alerts = [
      newAlert,
      ...this.alerts.filter((existing) => {
        const existingSide = existing.direction === 'SHORT' ? 'DUMP' : 'PUMP';
        return !(existing.symbol === analysis.symbol && existingSide === qualification.side);
      }),
    ].slice(0, 100);

    this.alertOutcomes.set(newAlert.id, initializeOutcomeFromAlert(newAlert));
    if (this.alertOutcomes.size > 100) {
      const oldestKey = this.alertOutcomes.keys().next().value;
      if (oldestKey) this.alertOutcomes.delete(oldestKey);
    }

    this.emitStream({ type: 'alerts', alerts: this.alerts });
  }

  private evaluateOutcomeForSymbol(symbol: string, livePrice: number, now = Date.now()): void {
    if (!livePrice || livePrice <= 0 || this.alertOutcomes.size === 0) return;
    for (const [id, rec] of this.alertOutcomes.entries()) {
      if (rec.symbol === symbol && rec.status === 'TRACKING') {
        const next = evaluateAlertOutcomeWithPrice(rec, livePrice, now);
        if (next !== rec) this.alertOutcomes.set(id, next);
      }
    }
  }

  private evaluateOutcomesWithTickers(now = Date.now()): void {
    if (this.alertOutcomes.size === 0) return;
    for (const [id, rec] of this.alertOutcomes.entries()) {
      if (rec.status !== 'TRACKING') continue;
      const tk = this.tickerMap.get(rec.symbol);
      if (tk && tk.lastPrice > 0) {
        const next = evaluateAlertOutcomeWithPrice(rec, tk.lastPrice, now);
        if (next !== rec) this.alertOutcomes.set(id, next);
      }
    }
  }

  public getAlertsWithAccuracy(): {
    alerts: AlertEvent[];
    outcomes: AlertOutcomeRecord[];
    accuracy: AlertAccuracySummary;
  } {
    this.evaluateOutcomesWithTickers();
    const outcomes = Array.from(this.alertOutcomes.values()).sort(
      (a, b) => b.startedAt - a.startedAt,
    );
    return {
      alerts: this.alerts,
      outcomes,
      accuracy: computeAlertAccuracySummary(outcomes),
    };
  }

  // --- Live WebSocket Stream ---

  private emitStream(event: NativeStreamEvent): void {
    for (const listener of this.streamListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener error
      }
    }
  }

  private flushDirtyTicks(): void {
    if (this.dirtyTickers.size === 0) return;
    const ticks = Array.from(this.dirtyTickers.values());
    this.dirtyTickers.clear();
    this.emitStream({ type: 'ticks', ticks, serverTime: Date.now() });
  }

  private applyWsRealtimeTick(item: WsRealtimeItem): void {
    const symbol = item.s;
    const existing = this.tickerMap.get(symbol);
    if (!existing) return;

    const lastPrice = Number(item.c);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) return;

    const open24h = Number(item.o) || existing.open24h;
    const high24h = Number(item.h) || existing.high24h;
    const low24h = Number(item.l) || existing.low24h;
    const mult = this.multiplierMap.get(symbol) ?? 1;
    const volume24h = (Number(item.v) || 0) * mult || existing.volume24h;
    const quoteVolume24h = Number(item.qv) || existing.quoteVolume24h;
    const priceChange = lastPrice - open24h;
    const priceChangePct =
      item.m !== undefined
        ? Number(item.m) * 100
        : open24h > 0
          ? (priceChange / open24h) * 100
          : existing.priceChangePct;
    const indexBasisPct =
      existing.markPrice > 0
        ? Number((((lastPrice - existing.markPrice) / existing.markPrice) * 100).toFixed(4))
        : existing.indexBasisPct;

    const updated: MarketTicker = {
      ...existing,
      lastPrice,
      open24h,
      high24h,
      low24h,
      volume24h,
      quoteVolume24h,
      priceChange,
      priceChangePct,
      indexBasisPct,
      openInterestUsd: existing.openInterest * lastPrice,
      updatedAt: item.t || Date.now(),
    };

    this.tickerMap.set(symbol, updated);
    this.dirtyTickers.set(symbol, updated);
    this.lastMarketSync = Date.now();
    this.evaluateOutcomeForSymbol(symbol, lastPrice);
  }

  private subscribeSymbolsBatch(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || symbols.length === 0) return;
    const chunkSize = 25;
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      for (const s of chunk) this.subscribedSymbols.add(s);
      this.ws.send(
        JSON.stringify({
          symbol: chunk.join(','),
          topic: 'realtimes',
          event: 'sub',
          params: { binary: false },
        }),
      );
    }
  }

  private connectWebSocket(focusSymbol?: string): void {
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (focusSymbol) this.focusSymbol(focusSymbol);
      return;
    }

    try {
      const ws = new WebSocket(TOOBIT_WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        this.wsConnected = true;
        this.emitStream({ type: 'status', connected: true });
        this.emitStream({ type: 'snapshot', wsConnected: true, serverTime: Date.now() });

        const top = this.tickers.slice(0, 45).map((t) => t.symbol);
        if (top.length === 0) {
          top.push('BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'SOL-SWAP-USDT', 'XRP-SWAP-USDT', 'DOGE-SWAP-USDT');
        }
        if (focusSymbol && !top.includes(focusSymbol)) top.unshift(focusSymbol);
        this.subscribeSymbolsBatch(top);

        if (this.wsPingTimer) clearInterval(this.wsPingTimer);
        this.wsPingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ ping: Date.now() }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            topic?: string;
            data?: WsRealtimeItem[];
          };
          if (payload.topic === 'realtimes' && Array.isArray(payload.data)) {
            for (const item of payload.data) {
              this.applyWsRealtimeTick(item);
            }
          }
        } catch {
          // Ignore ping/pong control frames
        }
      };

      ws.onclose = () => {
        this.wsConnected = false;
        this.emitStream({ type: 'status', connected: false });
        if (this.wsPingTimer) {
          clearInterval(this.wsPingTimer);
          this.wsPingTimer = null;
        }
        if (this.streamListeners.size > 0 && !this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectWebSocket(focusSymbol);
          }, 2500);
        }
      };

      ws.onerror = () => {
        this.wsConnected = false;
        this.emitStream({ type: 'status', connected: false });
      };
    } catch {
      this.wsConnected = false;
    }
  }

  public focusSymbol(symbol: string): void {
    if (!symbol) return;
    if (!this.subscribedSymbols.has(symbol)) {
      this.subscribeSymbolsBatch([symbol]);
    }
  }

  public subscribeStream(focusSymbol: string, listener: NativeStreamListener): () => void {
    this.streamListeners.add(listener);
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flushDirtyTicks(), 450);
    }
    this.connectWebSocket(focusSymbol);
    if (this.wsConnected) {
      listener({ type: 'snapshot', wsConnected: true, serverTime: Date.now() });
    }

    return () => {
      this.streamListeners.delete(listener);
      if (this.streamListeners.size === 0) {
        if (this.flushTimer) {
          clearInterval(this.flushTimer);
          this.flushTimer = null;
        }
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      }
    };
  }

  // --- Social Sentiment ---

  private async getFearAndGreed(): Promise<{ value: number | null; label: string | null }> {
    const now = Date.now();
    if (this.fngCache && this.fngCache.expiresAt > now) {
      return { value: this.fngCache.value, label: this.fngCache.label };
    }
    try {
      const data = await this.transport.getJson<{
        data?: Array<{ value?: string; value_classification?: string }>;
      }>('https://api.alternative.me/fng/?limit=1');
      const first = data?.data?.[0];
      const parsedVal = first?.value ? Number(first.value) : NaN;
      const value = Number.isFinite(parsedVal) ? parsedVal : null;
      const label = first?.value_classification ?? null;
      if (value !== null) {
        this.fngCache = { value, label, expiresAt: now + 10 * 60 * 1000 };
      }
      return { value, label };
    } catch {
      return { value: null, label: null };
    }
  }

  private async getRssHeadlines(): Promise<ParsedRssItem[]> {
    const now = Date.now();
    if (this.rssCache && this.rssCache.expiresAt > now) {
      return this.rssCache.items;
    }

    const sources = [
      { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
      { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
      { name: 'Decrypt', url: 'https://decrypt.co/feed' },
    ];

    const settled = await Promise.allSettled(
      sources.map(async (src) => {
        const xml = await this.transport.getText(src.url);
        return xml ? parseRssHeadlines(xml, src.name, 14) : [];
      }),
    );

    const combined: ParsedRssItem[] = [];
    for (const res of settled) {
      if (res.status === 'fulfilled') combined.push(...res.value);
    }
    if (combined.length > 0) {
      this.rssCache = { items: combined, expiresAt: now + 10 * 60 * 1000 };
    }
    return combined;
  }

  private async getCoinGeckoSentiment(ticker: string): Promise<{
    coinName: string | null;
    upPct: number | null;
    downPct: number | null;
    watchlistUsers: number | null;
  }> {
    let coinRef: { id: string; name: string } | null = KNOWN_COINGECKO_IDS[ticker] ?? null;
    if (!coinRef) {
      const now = Date.now();
      const cached = this.coinIdCache.get(ticker);
      if (cached && cached.expiresAt > now) {
        coinRef = { id: cached.id, name: cached.name };
      } else {
        try {
          const searchRes = await this.transport.getJson<{
            coins?: Array<{ id?: string; name?: string; symbol?: string }>;
          }>(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`);
          const coins = searchRes?.coins ?? [];
          const match =
            coins.find((c) => c.symbol?.toUpperCase() === ticker) ??
            coins.find((c) => c.symbol?.toUpperCase().startsWith(ticker)) ??
            coins[0];
          if (match?.id && match?.name) {
            coinRef = { id: match.id, name: match.name };
            this.coinIdCache.set(ticker, { ...coinRef, expiresAt: now + 24 * 60 * 60 * 1000 });
          }
        } catch {
          coinRef = null;
        }
      }
    }

    if (!coinRef) {
      return { coinName: null, upPct: null, downPct: null, watchlistUsers: null };
    }

    try {
      const details = await this.transport.getJson<{
        name?: string;
        sentiment_votes_up_percentage?: number | null;
        sentiment_votes_down_percentage?: number | null;
        watchlist_portfolio_users?: number | null;
      }>(
        `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinRef.id)}?localization=false&tickers=false&market_data=false&community_data=true&developer_data=false&sparkline=false`,
      );
      return {
        coinName: details?.name ?? coinRef.name,
        upPct:
          typeof details?.sentiment_votes_up_percentage === 'number'
            ? details.sentiment_votes_up_percentage
            : null,
        downPct:
          typeof details?.sentiment_votes_down_percentage === 'number'
            ? details.sentiment_votes_down_percentage
            : null,
        watchlistUsers:
          typeof details?.watchlist_portfolio_users === 'number'
            ? details.watchlist_portfolio_users
            : null,
      };
    } catch {
      return { coinName: coinRef.name, upPct: null, downPct: null, watchlistUsers: null };
    }
  }

  public async getSentiment(symbol: string, forceRefresh = false): Promise<SocialSentimentData> {
    const baseAsset = extractBaseAssetFromSymbol(symbol);
    const normalizedTicker = normalizeBaseTicker(baseAsset);
    const now = Date.now();

    if (!forceRefresh) {
      const cached = this.sentimentCache.get(normalizedTicker);
      if (cached && cached.expiresAt > now) {
        return { ...cached.data, symbol, baseAsset };
      }
    }

    const [cg, fng, rssItems] = await Promise.all([
      this.getCoinGeckoSentiment(normalizedTicker),
      this.getFearAndGreed(),
      this.getRssHeadlines(),
    ]);

    const aggregated = aggregateSocialSentiment({
      symbol,
      baseAsset,
      coinName: cg.coinName,
      coingeckoUpPct: cg.upPct,
      coingeckoDownPct: cg.downPct,
      watchlistUsers: cg.watchlistUsers,
      fearGreedValue: fng.value,
      fearGreedLabel: fng.label,
      rssItems,
      fetchedAt: Date.now(),
    });

    this.sentimentCache.set(normalizedTicker, {
      data: aggregated,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return aggregated;
  }

  // --- Webhooks (Local Persistence + Native Direct Push) ---

  public getWebhookState(): { config: WebhookConfig; logs: WebhookDeliveryLog[] } {
    return {
      config: { ...this.webhookConfig },
      logs: [...this.webhookLogs],
    };
  }

  public saveWebhookConfig(input: Partial<WebhookConfig>): {
    ok: boolean;
    config: WebhookConfig;
    logs: WebhookDeliveryLog[];
    errors: { discord?: string; telegram?: string };
  } {
    const checked = validateWebhookConfig(input);
    if (!checked.valid) {
      return {
        ok: false,
        config: { ...this.webhookConfig },
        logs: [...this.webhookLogs],
        errors: checked.errors,
      };
    }

    this.webhookConfig = checked.config;
    this.saveWebhookConfigToStorage();
    return {
      ok: true,
      config: { ...this.webhookConfig },
      logs: [...this.webhookLogs],
      errors: {},
    };
  }

  private recordWebhookLog(entry: WebhookDeliveryLog): void {
    this.webhookLogs.unshift(entry);
    if (this.webhookLogs.length > 20) this.webhookLogs.length = 20;
  }

  private async postWebhook(
    platform: WebhookPlatform,
    url: string,
    payload: unknown,
    signal: WebhookSignalInput,
  ): Promise<WebhookDeliveryLog> {
    const now = Date.now();
    try {
      const res = await this.transport.postJson(url, payload);
      const log: WebhookDeliveryLog = {
        id: `${platform}-${signal.symbol}-${now}`,
        timestamp: now,
        platform,
        symbol: signal.symbol,
        confidence: signal.confidence,
        ok: res.ok,
        statusCode: res.status,
        ...(!res.ok ? { error: res.text ? res.text.slice(0, 180) : `HTTP ${res.status}` } : {}),
      };
      this.recordWebhookLog(log);
      return log;
    } catch (err) {
      const log: WebhookDeliveryLog = {
        id: `${platform}-${signal.symbol}-${now}`,
        timestamp: now,
        platform,
        symbol: signal.symbol,
        confidence: signal.confidence,
        ok: false,
        statusCode: null,
        error: err instanceof Error ? err.message : 'Network error',
      };
      this.recordWebhookLog(log);
      return log;
    }
  }

  public async dispatchWebhookSignal(
    signal: WebhookSignalInput,
    configOverride?: WebhookConfig,
  ): Promise<WebhookDeliveryLog[]> {
    const cfg = configOverride ?? this.webhookConfig;
    const tasks: Promise<WebhookDeliveryLog>[] = [];

    if (cfg.discordWebhookUrl.trim()) {
      const discordTarget = validateDiscordWebhookUrl(cfg.discordWebhookUrl);
      if (discordTarget.valid && discordTarget.normalized) {
        tasks.push(
          this.postWebhook(
            'discord',
            discordTarget.normalized,
            buildDiscordWebhookPayload(signal),
            signal,
          ),
        );
      }
    }

    if (cfg.telegramWebhookUrl.trim()) {
      const telegramTarget = validateTelegramWebhookUrl(cfg.telegramWebhookUrl);
      if (telegramTarget.valid && telegramTarget.targetUrl) {
        tasks.push(
          this.postWebhook(
            'telegram',
            telegramTarget.targetUrl,
            buildTelegramWebhookPayload(signal, telegramTarget),
            signal,
          ),
        );
      }
    }

    return tasks.length > 0 ? Promise.all(tasks) : [];
  }

  private async evaluateAndPushWebhookSignal(analysis: AnalysisResult): Promise<void> {
    if (!shouldPushWebhookSignal(analysis, this.webhookConfig)) return;
    const key = `${analysis.symbol}:${analysis.direction}`;
    const now = Date.now();
    const lastSent = this.webhookCooldowns.get(key) ?? 0;
    if (now - lastSent < WEBHOOK_COOLDOWN_MS) return;

    this.webhookCooldowns.set(key, now);
    const qual = evaluateAlertQualification(analysis);
    await this.dispatchWebhookSignal({
      ...analysis,
      expectedMoveMinPct: qual.expectedMove.expectedMoveMinPct,
      expectedMoveMaxPct: qual.expectedMove.expectedMoveMaxPct,
      expectedWindowEn: qual.expectedMove.expectedWindowEn,
      qualityGrade: qual.qualified ? qual.qualityGrade : undefined,
    });
  }

  public async sendTestWebhook(overrideInput?: Partial<WebhookConfig>): Promise<{
    ok: boolean;
    errors: { discord?: string; telegram?: string };
    results: WebhookDeliveryLog[];
    logs: WebhookDeliveryLog[];
  }> {
    const checked = overrideInput
      ? validateWebhookConfig({ ...this.webhookConfig, ...overrideInput, enabled: true })
      : { valid: true, config: { ...this.webhookConfig, enabled: true }, errors: {} };

    if (!checked.valid) {
      return {
        ok: false,
        errors: checked.errors,
        results: [],
        logs: [...this.webhookLogs],
      };
    }

    if (!checked.config.discordWebhookUrl.trim() && !checked.config.telegramWebhookUrl.trim()) {
      return {
        ok: false,
        errors: { discord: 'Enter a Discord or Telegram webhook URL first.' },
        results: [],
        logs: [...this.webhookLogs],
      };
    }

    const results = await this.dispatchWebhookSignal(
      {
        symbol: 'BTC-SWAP-USDT',
        baseAsset: 'BTC',
        timeframe: '1h',
        direction: 'LONG',
        phase: 'PRE_PUMP',
        confidence: Math.max(84, checked.config.minConfidence),
        sharpMoveScore: 81,
        expectedMoveMinPct: 4.8,
        expectedMoveMaxPct: 11.4,
        expectedWindowEn: '4–12h',
        qualityGrade: 'A+',
        lastPrice: 95250,
        volumeZScore: 2.85,
        summaryEn: 'Test Alert from ToobitPulse Android APK: Direct native webhook push active.',
        tradePlan: {
          optimalEntry: 95100,
          stopLoss: 93800,
          tp1: 96900,
          tp2: 98800,
          tp3: 101500,
          riskReward2: 2.85,
        },
        analyzedAt: Date.now(),
      },
      checked.config,
    );

    const allOk = results.length > 0 && results.every((r) => r.ok);
    return {
      ok: allOk,
      errors: {},
      results,
      logs: [...this.webhookLogs],
    };
  }

  public async triggerRuleWebhook(alert: AlertEvent): Promise<void> {
    if (!this.webhookConfig.enabled || !alert.symbol || !alert.optimalEntry || !alert.stopLoss || !alert.tp1) {
      return;
    }
    await this.dispatchWebhookSignal({
      symbol: alert.symbol,
      baseAsset: alert.baseAsset,
      timeframe: alert.timeframe,
      direction: alert.direction,
      phase: alert.phase,
      confidence: alert.confidence,
      sharpMoveScore: 0,
      lastPrice: alert.price,
      volumeZScore: alert.volumeZScore,
      summaryEn: alert.reasonEn,
      qualityGrade: alert.qualityGrade,
      tradePlan: {
        optimalEntry: alert.optimalEntry,
        stopLoss: alert.stopLoss,
        tp1: alert.tp1,
        tp2: alert.tp2 ?? alert.tp1,
        tp3: alert.tp3 ?? alert.tp1,
        riskReward2: alert.riskReward1 ?? 2,
      },
      analyzedAt: alert.timestamp,
    });
  }
}

export const nativeToobitEngine = new NativeToobitEngine();
