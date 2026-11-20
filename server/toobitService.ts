import { analyzeFuturesSymbol } from '../src/engine/analyzer';
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
  Timeframe,
} from '../src/types/futures';
import {
  getPairAssets,
  isValidActiveFuturesContract,
  isValidMarketTickerRow,
  type RawExchangeContract,
} from '../src/utils/futuresContracts';
import { evaluateAlertQualification, isPeggedStablecoin } from '../src/utils/alerts';
import {
  computeAlertAccuracySummary,
  evaluateAlertOutcomeWithPrice,
  initializeOutcomeFromAlert,
} from '../src/utils/alertTracker';
import { webhookNotifier } from './webhookNotifier';

const BASE_URL = 'https://api.toobit.com';
const WS_URL = 'wss://stream.toobit.com/quote/ws/v1';

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

export type StreamEvent =
  | { type: 'ticks'; ticks: MarketTicker[]; serverTime: number }
  | { type: 'alerts'; alerts: AlertEvent[] };

type StreamListener = (event: StreamEvent) => void;

async function fetchJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ToobitPulse-Scanner/2.0',
      },
    });
    if (!res.ok) {
      throw new Error(`Toobit HTTP ${res.status} on ${path}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function parseAssetName(symbol: string): { baseAsset: string; quoteAsset: string } {
  return getPairAssets(symbol);
}

class ToobitFuturesService {
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

  private dirtyTickers = new Map<string, MarketTicker>();
  private streamListeners = new Set<StreamListener>();
  private subscribedSymbols = new Set<string>();
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;

  private lastMarketSync = 0;
  private lastScanSync = 0;
  private lastContractSync = 0;
  private isScanning = false;
  private scanTotal = 0;
  private scannedCount = 0;
  private lastError: string | null = null;
  private started = false;

  public start(): void {
    if (this.started) return;
    this.started = true;

    void this.bootstrap();

    // Poll full active Futures contract batch every 2.5 seconds for live market-wide coverage
    setInterval(() => {
      void this.refreshMarketBatch();
    }, 2500);

    // Flush live WebSocket & REST tick updates to SSE subscribers every 450ms
    setInterval(() => {
      this.flushDirtyTicks();
    }, 450);
  }

  private scheduleNextScan(): void {
    setTimeout(() => {
      void this.runScannerCycle('1h').finally(() => {
        this.scheduleNextScan();
      });
    }, 45_000);
  }

  private async bootstrap(): Promise<void> {
    await this.refreshMarketBatch();
    this.connectWebSocket();
    await this.runScannerCycle('1h');
    this.scheduleNextScan();
  }

  public addStreamListener(listener: StreamListener): () => void {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  private emitStream(event: StreamEvent): void {
    for (const listener of this.streamListeners) {
      try {
        listener(event);
      } catch {
        // Ignore closed listener
      }
    }
  }

  private flushDirtyTicks(): void {
    if (this.dirtyTickers.size === 0) return;
    const ticks = Array.from(this.dirtyTickers.values());
    this.dirtyTickers.clear();
    this.emitStream({
      type: 'ticks',
      ticks,
      serverTime: Date.now(),
    });
  }

  private connectWebSocket(): void {
    if (typeof WebSocket === 'undefined') return;
    try {
      if (this.ws) {
        this.ws.close();
      }
    } catch {
      // Ignore
    }

    try {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        this.wsConnected = true;
        this.subscribeTopSymbols();

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
          // Ignore malformed ping/pong or control frames
        }
      };

      ws.onclose = () => {
        this.wsConnected = false;
        if (this.wsPingTimer) {
          clearInterval(this.wsPingTimer);
          this.wsPingTimer = null;
        }
        setTimeout(() => this.connectWebSocket(), 2500);
      };

      ws.onerror = () => {
        this.wsConnected = false;
      };
    } catch {
      this.wsConnected = false;
      setTimeout(() => this.connectWebSocket(), 4000);
    }
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

  private subscribeTopSymbols(): void {
    const top = this.tickers.slice(0, 65).map((t) => t.symbol);
    if (top.length === 0) {
      top.push('BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'SOL-SWAP-USDT', 'XRP-SWAP-USDT', 'DOGE-SWAP-USDT');
    }
    this.subscribeSymbolsBatch(top);
  }

  public focusSymbol(symbol: string): void {
    if (!symbol) return;
    if (!this.subscribedSymbols.has(symbol)) {
      this.subscribeSymbolsBatch([symbol]);
    }
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

  private evaluateOutcomeForSymbol(symbol: string, livePrice: number, now = Date.now()): void {
    if (!livePrice || livePrice <= 0 || this.alertOutcomes.size === 0) return;
    for (const [id, rec] of this.alertOutcomes.entries()) {
      if (rec.symbol === symbol && rec.status === 'TRACKING') {
        const next = evaluateAlertOutcomeWithPrice(rec, livePrice, now);
        if (next !== rec) {
          this.alertOutcomes.set(id, next);
        }
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
        if (next !== rec) {
          this.alertOutcomes.set(id, next);
        }
      }
    }
  }

  private async ensureContractSpecs(force = false): Promise<void> {
    const now = Date.now();
    const cacheAge = now - this.lastContractSync;
    const ttl = this.activeContracts.size > 0 ? 10 * 60 * 1000 : 5_000;
    if (!force && cacheAge < ttl && this.activeContracts.size > 0) {
      return;
    }
    try {
      const info = await fetchJson<{
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
      // Retry on next cycle if exchangeInfo temporarily failed
    }
  }

  public isActiveFuturesSymbol(symbol: string): boolean {
    if (this.activeContracts.size > 0) {
      return this.activeContracts.has(symbol);
    }
    return isValidMarketTickerRow(symbol, null, 1);
  }

  public async refreshMarketBatch(): Promise<MarketTicker[]> {
    try {
      await this.ensureContractSpecs();
      const [rawTickers, rawFunding, rawMark] = await Promise.all([
        fetchJson<RawTicker[]>('/quote/v1/contract/ticker/24hr'),
        fetchJson<RawFunding[]>('/api/v1/futures/fundingRate').catch(() => [] as RawFunding[]),
        fetchJson<RawMarkPrice[]>('/quote/v1/markPrice').catch(() => [] as RawMarkPrice[]),
      ]);

      const fundingMap = new Map<string, RawFunding>();
      for (const f of rawFunding) {
        fundingMap.set(f.symbol, f);
      }

      const markMap = new Map<string, RawMarkPrice>();
      for (const m of rawMark) {
        markMap.set(m.symbolId, m);
      }

      const now = Date.now();
      const parsed: MarketTicker[] = [];
      const activeRegistry = this.activeContracts.size > 0 ? this.activeContracts : null;
      const validSymbolSet = new Set<string>();

      for (const item of rawTickers) {
        const symbol = item.s || item.si || '';
        const lastPrice = Number(item.c) || 0;
        if (!isValidMarketTickerRow(symbol, activeRegistry, lastPrice)) continue;

        const quoteVolume24h = Number(item.qv) || 0;
        const { baseAsset, quoteAsset } = parseAssetName(symbol);
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

      // Prune any stale or newly delisted contracts from caches
      for (const existingSym of this.tickerMap.keys()) {
        if (!validSymbolSet.has(existingSym)) {
          this.tickerMap.delete(existingSym);
          this.historyMap.delete(existingSym);
          this.dirtyTickers.delete(existingSym);
        }
      }
      if (activeRegistry) {
        for (const [tf, opps] of this.opportunitiesByTf.entries()) {
          const pruned = opps.filter((o) => activeRegistry.has(o.symbol));
          if (pruned.length !== opps.length) {
            this.opportunitiesByTf.set(tf, pruned);
          }
        }
      }

      parsed.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
      this.tickers = parsed;
      this.lastMarketSync = now;
      this.lastError = null;
      this.evaluateOutcomesWithTickers(now);
      return parsed;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Market fetch failed';
      return this.tickers;
    }
  }

  public getMarketTickers(): {
    tickers: MarketTicker[];
    updatedAt: number;
    wsConnected: boolean;
    error: string | null;
  } {
    // Keep array fresh with latest WS ticker prices
    const freshTickers = this.tickers.map((t) => this.tickerMap.get(t.symbol) ?? t);
    return {
      tickers: freshTickers,
      updatedAt: this.lastMarketSync,
      wsConnected: this.wsConnected,
      error: this.lastError,
    };
  }

  public async fetchKlines(symbol: string, interval: Timeframe, limit = 120): Promise<Candle[]> {
    const raw = await fetchJson<RawKline[]>(
      `/quote/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
    );
    return raw.map((k) => ({
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
      if (this.htfCandleCache.size > 2600) {
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
      const raw = await fetchJson<RawDepth>(
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
      const raw = await fetchJson<RawTrade[]>(
        `/quote/v1/trades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
      );
      const mult = this.multiplierMap.get(symbol) ?? 1;
      return raw.map((t) => {
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
      throw new Error(`Contract ${symbol} is delisted or not an active Toobit Futures pair`);
    }
    if (!isValidMarketTickerRow(symbol, this.activeContracts.size > 0 ? this.activeContracts : null, 1)) {
      throw new Error(`Invalid Toobit Futures contract: ${symbol}`);
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
    const { baseAsset } = parseAssetName(symbol);

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

  private getAllOrderedScanSymbols(extraSymbols: string[] = []): MarketTicker[] {
    const picked = new Map<string, MarketTicker>();

    // Prioritize watchlist, highest volume, top movers, and funding extremes first,
    // then include EVERY remaining active Toobit Futures contract so 100% of the exchange is scanned.
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
    for (const t of byMover.slice(0, 20)) {
      picked.set(t.symbol, t);
    }

    const byFunding = [...this.tickers].sort(
      (a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate),
    );
    for (const t of byFunding.slice(0, 15)) {
      picked.set(t.symbol, t);
    }

    for (const t of this.tickers) {
      if (!picked.has(t.symbol)) {
        picked.set(t.symbol, t);
      }
    }

    return Array.from(picked.values());
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
    if (inFlight) {
      return inFlight;
    }

    const scanPromise = this.executeFullFuturesScan(timeframe, extraSymbols).finally(() => {
      this.activeScanPromises.delete(timeframe);
    });
    this.activeScanPromises.set(timeframe, scanPromise);
    return scanPromise;
  }

  private async executeFullFuturesScan(
    timeframe: Timeframe,
    extraSymbols: string[],
  ): Promise<ScannerOpportunity[]> {
    this.isScanning = true;
    try {
      if (this.tickers.length === 0) {
        await this.refreshMarketBatch();
      }

      const allCandidates = this.getAllOrderedScanSymbols(extraSymbols);
      this.scanTotal = allCandidates.length;
      this.scannedCount = 0;

      const candleCache = new Map<string, Candle[]>();
      const finalAnalysisBySymbol = new Map<string, AnalysisResult>();
      const resultsBySymbol = new Map<string, ScannerOpportunity>();
      const queue = [...allCandidates];
      const concurrency = 24;

      // Pass 1: Scan EVERY active Futures contract on Toobit with 110 klines
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
              // Skip transient single-contract error without aborting full scan
            } finally {
              this.scannedCount += 1;
            }
          }
        }),
      );

      // Sort initial full-market results prioritizing coiled pre-move >=20% candidates + suspicious volume
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

      // Pass 2: Enrich top 80 highest-conviction candidates + watchlist with full 1H/4H/1D MTF klines & live orderbook depth
      const enrichSet = new Set<string>(rankedInitial.slice(0, 80).map((o) => o.symbol));
      for (const sym of extraSymbols) {
        if (resultsBySymbol.has(sym)) enrichSet.add(sym);
      }
      const enrichQueue = Array.from(enrichSet);
      await Promise.all(
        Array.from({ length: 14 }, async () => {
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
                mtfCandles: {
                  tf1h: htf1h,
                  tf4h: htf4h,
                  tf1d: htf1d,
                },
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
              // Keep Pass 1 result if enrichment fails
            }
          }
        }),
      );

      // Push high-conviction signals above configured webhook confidence threshold (excluding stablecoins & counter-HTF noise)
      for (const analysis of finalAnalysisBySymbol.values()) {
        if (isPeggedStablecoin(analysis.baseAsset)) continue;
        if (analysis.quoteVolume24h > 0 && analysis.quoteVolume24h < 400_000) continue;
        const qual = evaluateAlertQualification(analysis);
        if (qual.qualified) {
          void webhookNotifier.evaluateAndPushSignal(analysis);
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
      this.isScanning = this.activeScanPromises.size > 1;
    }
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

    // Replace stale alert for the same symbol+side if upgrading so list stays clean & current
    this.alerts = [
      newAlert,
      ...this.alerts.filter((existing) => {
        const existingSide = existing.direction === 'SHORT' ? 'DUMP' : 'PUMP';
        return !(existing.symbol === analysis.symbol && existingSide === qualification.side);
      }),
    ];

    if (this.alerts.length > 100) {
      this.alerts.length = 100;
    }

    this.alertOutcomes.set(newAlert.id, initializeOutcomeFromAlert(newAlert));
    if (this.alertOutcomes.size > 100) {
      const oldestKey = this.alertOutcomes.keys().next().value;
      if (oldestKey) this.alertOutcomes.delete(oldestKey);
    }

    this.emitStream({ type: 'alerts', alerts: this.alerts });
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
    if (!existing || existing.length === 0) {
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

  public getAlerts(): AlertEvent[] {
    return this.alerts;
  }

  public getAlertsWithAccuracy(): {
    alerts: AlertEvent[];
    outcomes: AlertOutcomeRecord[];
    accuracy: AlertAccuracySummary;
  } {
    this.evaluateOutcomesWithTickers();
    const outcomes = Array.from(this.alertOutcomes.values()).sort((a, b) => b.startedAt - a.startedAt);
    return {
      alerts: this.alerts,
      outcomes,
      accuracy: computeAlertAccuracySummary(outcomes),
    };
  }

  public getHealth() {
    return {
      ok: true,
      contractsCount: this.tickers.length,
      activeRegistryCount: this.activeContracts.size,
      wsConnected: this.wsConnected,
      subscribedCount: this.subscribedSymbols.size,
      lastMarketSync: this.lastMarketSync,
      lastScanSync: this.lastScanSync,
      isScanning: this.isScanning,
      scannedCount: this.scannedCount,
      scanTotal: this.scanTotal,
      alertsCount: this.alerts.length,
      error: this.lastError,
    };
  }
}

export const toobitService = new ToobitFuturesService();
