import type { MarketTicker } from '../types/futures';

export type PairSortBy = 'volume' | 'price' | 'change' | 'alpha';
export type PairSortDir = 'asc' | 'desc';

export interface PairFilterSortOptions {
  query: string;
  sortBy: PairSortBy;
  sortDir: PairSortDir;
  onlyWatchlist?: boolean;
  watchlist?: string[];
  limit?: number;
}

export function filterAndSortPairs(
  tickers: MarketTicker[],
  options: PairFilterSortOptions,
): MarketTicker[] {
  const q = options.query.trim().toUpperCase();
  const watchSet = options.onlyWatchlist && options.watchlist ? new Set(options.watchlist) : null;

  let list = tickers.filter((tk) => {
    if (watchSet && !watchSet.has(tk.symbol)) return false;
    if (!q) return true;
    return tk.baseAsset.toUpperCase().includes(q) || tk.symbol.toUpperCase().includes(q);
  });

  const mult = options.sortDir === 'asc' ? 1 : -1;

  list = [...list].sort((a, b) => {
    if (q) {
      const aExact = a.baseAsset.toUpperCase() === q ? 0 : a.baseAsset.toUpperCase().startsWith(q) ? 1 : 2;
      const bExact = b.baseAsset.toUpperCase() === q ? 0 : b.baseAsset.toUpperCase().startsWith(q) ? 1 : 2;
      if (aExact !== bExact) return aExact - bExact;
    }

    switch (options.sortBy) {
      case 'price':
        return (a.lastPrice - b.lastPrice) * mult;
      case 'change':
        return (a.priceChangePct - b.priceChangePct) * mult;
      case 'alpha':
        return a.baseAsset.localeCompare(b.baseAsset) * mult;
      case 'volume':
      default:
        return (a.quoteVolume24h - b.quoteVolume24h) * mult;
    }
  });

  if (options.limit && options.limit > 0 && list.length > options.limit) {
    return list.slice(0, options.limit);
  }

  return list;
}
