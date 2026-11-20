import type { SocialSentimentData } from '../src/types/futures';
import {
  aggregateSocialSentiment,
  extractBaseAssetFromSymbol,
  normalizeBaseTicker,
  parseRssHeadlines,
  type ParsedRssItem,
} from '../src/utils/socialSentiment';

export type FetchLike = typeof fetch;

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

const GLOBAL_CACHE_TTL_MS = 10 * 60 * 1000;
const COIN_SENTIMENT_TTL_MS = 5 * 60 * 1000;
const COIN_ID_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

export class SocialSentimentService {
  private readonly fetchImpl: FetchLike;
  private fngCache: { value: number | null; label: string | null; expiresAt: number } | null = null;
  private rssCache: { items: ParsedRssItem[]; expiresAt: number } | null = null;
  private coinIdCache = new Map<string, { id: string; name: string; expiresAt: number }>();
  private sentimentCache = new Map<string, { data: SocialSentimentData; expiresAt: number }>();
  private inFlight = new Map<string, Promise<SocialSentimentData>>();

  constructor(options?: { fetchImpl?: FetchLike }) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  private async fetchText(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          'User-Agent': 'ToobitPulse/1.0 (+https://toobitpulse.local)',
          Accept: 'application/json, application/rss+xml, application/xml, text/xml',
        },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const txt = await this.fetchText(url);
    if (!txt) return null;
    try {
      return JSON.parse(txt) as T;
    } catch {
      return null;
    }
  }

  private async getFearAndGreed(): Promise<{ value: number | null; label: string | null }> {
    const now = Date.now();
    if (this.fngCache && this.fngCache.expiresAt > now) {
      return { value: this.fngCache.value, label: this.fngCache.label };
    }

    const data = await this.fetchJson<{
      data?: Array<{ value?: string; value_classification?: string }>;
    }>('https://api.alternative.me/fng/?limit=1');

    const first = data?.data?.[0];
    const parsedVal = first?.value ? Number(first.value) : NaN;
    const value = Number.isFinite(parsedVal) ? parsedVal : null;
    const label = first?.value_classification ?? null;

    if (value !== null) {
      this.fngCache = { value, label, expiresAt: now + GLOBAL_CACHE_TTL_MS };
    }
    return { value, label };
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
        const xml = await this.fetchText(src.url);
        return xml ? parseRssHeadlines(xml, src.name, 14) : [];
      }),
    );

    const combined: ParsedRssItem[] = [];
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        combined.push(...res.value);
      }
    }

    if (combined.length > 0) {
      this.rssCache = { items: combined, expiresAt: now + GLOBAL_CACHE_TTL_MS };
    }
    return combined;
  }

  private async resolveCoinGeckoId(ticker: string): Promise<{ id: string; name: string } | null> {
    const known = KNOWN_COINGECKO_IDS[ticker];
    if (known) return known;

    const now = Date.now();
    const cached = this.coinIdCache.get(ticker);
    if (cached && cached.expiresAt > now) {
      return { id: cached.id, name: cached.name };
    }

    const searchRes = await this.fetchJson<{
      coins?: Array<{ id?: string; name?: string; symbol?: string; market_cap_rank?: number | null }>;
    }>(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`);

    const coins = searchRes?.coins ?? [];
    const exactMatch =
      coins.find((c) => c.symbol?.toUpperCase() === ticker) ??
      coins.find((c) => c.symbol?.toUpperCase().startsWith(ticker)) ??
      coins[0];

    if (!exactMatch?.id || !exactMatch?.name) return null;

    const resolved = { id: exactMatch.id, name: exactMatch.name };
    this.coinIdCache.set(ticker, { ...resolved, expiresAt: now + COIN_ID_TTL_MS });
    return resolved;
  }

  private async getCoinGeckoSentiment(ticker: string): Promise<{
    coinName: string | null;
    upPct: number | null;
    downPct: number | null;
    watchlistUsers: number | null;
  }> {
    const coinRef = await this.resolveCoinGeckoId(ticker);
    if (!coinRef) {
      return { coinName: null, upPct: null, downPct: null, watchlistUsers: null };
    }

    const details = await this.fetchJson<{
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
  }

  public async getSentiment(symbol: string, forceRefresh = false): Promise<SocialSentimentData> {
    const baseAsset = extractBaseAssetFromSymbol(symbol);
    const normalizedTicker = normalizeBaseTicker(baseAsset);
    const now = Date.now();

    if (!forceRefresh) {
      const cached = this.sentimentCache.get(normalizedTicker);
      if (cached && cached.expiresAt > now) {
        return {
          ...cached.data,
          symbol,
          baseAsset,
        };
      }
    }

    const existingFlight = this.inFlight.get(normalizedTicker);
    if (existingFlight) {
      const data = await existingFlight;
      return { ...data, symbol, baseAsset };
    }

    const promise = (async (): Promise<SocialSentimentData> => {
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
        expiresAt: Date.now() + COIN_SENTIMENT_TTL_MS,
      });

      return aggregated;
    })().finally(() => {
      this.inFlight.delete(normalizedTicker);
    });

    this.inFlight.set(normalizedTicker, promise);
    return promise;
  }
}

export const socialSentimentService = new SocialSentimentService();
