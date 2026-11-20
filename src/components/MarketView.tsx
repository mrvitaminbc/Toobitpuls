import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Search, Star, Zap } from 'lucide-react';
import { translations } from '../i18n/translations';
import type { Language, MarketTicker } from '../types/futures';
import { formatCompactUsd, formatFunding, formatPercent, formatPrice } from '../utils/formatters';

interface MarketViewProps {
  tickers: MarketTicker[];
  loading: boolean;
  lang: Language;
  watchlist: string[];
  onToggleWatchlist: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
}

type MarketTab = 'ALL' | 'TOP_VOL' | 'GAINERS' | 'LOSERS' | 'FUNDING' | 'OI_SURGE' | 'WATCHLIST';
type SortKey = 'quoteVolume24h' | 'lastPrice' | 'priceChangePct' | 'openInterestUsd' | 'oiDeltaPct' | 'fundingRate';

export const MarketView: React.FC<MarketViewProps> = ({
  tickers,
  loading,
  lang,
  watchlist,
  onToggleWatchlist,
  onSelectSymbol,
}) => {
  const t = translations[lang];
  const [tab, setTab] = useState<MarketTab>('ALL');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('quoteVolume24h');
  const [sortAsc, setSortAsc] = useState(false);
  const [limit, setLimit] = useState(50);

  const prevPriceRef = useRef<Record<string, number>>({});
  const [tickDirs, setTickDirs] = useState<Record<string, 'up' | 'down'>>({});

  useEffect(() => {
    const nextDirs: Record<string, 'up' | 'down'> = {};
    let changed = false;
    for (const tk of tickers) {
      const prev = prevPriceRef.current[tk.symbol];
      if (prev !== undefined && prev !== tk.lastPrice) {
        nextDirs[tk.symbol] = tk.lastPrice > prev ? 'up' : 'down';
        changed = true;
      }
      prevPriceRef.current[tk.symbol] = tk.lastPrice;
    }
    if (changed) {
      setTickDirs(nextDirs);
      const timer = setTimeout(() => setTickDirs({}), 550);
      return () => clearTimeout(timer);
    }
  }, [tickers]);

  const pulseStats = useMemo(() => {
    if (tickers.length === 0) return null;
    let topGainer = tickers[0];
    let topLoser = tickers[0];
    let topFunding = tickers[0];
    let totalVol = 0;
    for (const tk of tickers) {
      totalVol += tk.quoteVolume24h || 0;
      if (tk.priceChangePct > topGainer.priceChangePct) topGainer = tk;
      if (tk.priceChangePct < topLoser.priceChangePct) topLoser = tk;
      if (Math.abs(tk.fundingRate) > Math.abs(topFunding.fundingRate)) topFunding = tk;
    }
    return { topGainer, topLoser, topFunding, totalVol };
  }, [tickers]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const processed = useMemo(() => {
    const q = query.trim().toUpperCase();
    let list = tickers.filter((item) => {
      if (!q) return true;
      return item.symbol.toUpperCase().includes(q) || item.baseAsset.toUpperCase().includes(q);
    });

    if (tab === 'WATCHLIST') {
      list = list.filter((item) => watchlist.includes(item.symbol));
    } else if (tab === 'TOP_VOL') {
      list = [...list].sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
    } else if (tab === 'GAINERS') {
      list = [...list].sort((a, b) => b.priceChangePct - a.priceChangePct);
    } else if (tab === 'LOSERS') {
      list = [...list].sort((a, b) => a.priceChangePct - b.priceChangePct);
    } else if (tab === 'FUNDING') {
      list = [...list].sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
    } else if (tab === 'OI_SURGE') {
      list = [...list].sort((a, b) => Math.abs(b.oiDeltaPct) - Math.abs(a.oiDeltaPct));
    } else {
      list = [...list].sort((a, b) => {
        const va = a[sortKey];
        const vb = b[sortKey];
        return sortAsc ? va - vb : vb - va;
      });
    }

    return list;
  }, [tickers, query, tab, watchlist, sortKey, sortAsc]);

  const visibleRows = processed.slice(0, limit);

  const tabs: { id: MarketTab; label: string }[] = [
    { id: 'ALL', label: t.tabAllPairs },
    { id: 'TOP_VOL', label: t.tabTopVol },
    { id: 'GAINERS', label: t.tabGainers },
    { id: 'LOSERS', label: t.tabLosers },
    { id: 'FUNDING', label: t.tabFunding },
    { id: 'OI_SURGE', label: t.tabOiSurge },
    { id: 'WATCHLIST', label: t.filterWatchlist },
  ];

  const SortIndicator = ({ col }: { col: SortKey }) => {
    if (tab !== 'ALL' || sortKey !== col) return null;
    return sortAsc ? <ArrowUp className="w-3 h-3 inline ms-1" /> : <ArrowDown className="w-3 h-3 inline ms-1" />;
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t.marketTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t.marketSubtitle}
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(50);
            }}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="w-full rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0C121E] ps-9 pe-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 min-h-[40px]"
          />
        </div>
      </div>

      {/* Market Pulse Strip (Hairline 4-column Leader Summary) */}
      {pulseStats && (
        <div className="tp-panel rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x rtl:sm:divide-x-reverse divide-slate-200/80 dark:divide-slate-800/80">
          <button
            type="button"
            onClick={() => onSelectSymbol(pulseStats.topGainer.symbol)}
            className="p-3.5 text-start hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t.marketTopGainer}</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {pulseStats.topGainer.baseAsset}
              </span>
              <span className="font-mono-num text-sm font-bold text-emerald-500">
                {formatPercent(pulseStats.topGainer.priceChangePct)}
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectSymbol(pulseStats.topLoser.symbol)}
            className="p-3.5 text-start hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t.marketTopLoser}</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {pulseStats.topLoser.baseAsset}
              </span>
              <span className="font-mono-num text-sm font-bold text-rose-500">
                {formatPercent(pulseStats.topLoser.priceChangePct)}
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectSymbol(pulseStats.topFunding.symbol)}
            className="p-3.5 text-start hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t.marketHighFunding}</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {pulseStats.topFunding.baseAsset}
              </span>
              <span className="font-mono-num text-sm font-bold text-amber-500">
                {formatFunding(pulseStats.topFunding.fundingRate)}
              </span>
            </div>
          </button>

          <div className="p-3.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t.marketTotalVol}</div>
            <div className="mt-1 font-mono-num text-base font-extrabold text-sky-500">
              {formatCompactUsd(pulseStats.totalVol)}
            </div>
          </div>
        </div>
      )}

      {/* Segmented Category Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-[#0C121E]/85 overflow-x-auto">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setLimit(50);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
              tab === item.id
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Pro Exchange Data Grid */}
      <div className="tp-panel rounded-xl overflow-hidden">
        {loading && tickers.length === 0 ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="h-10 rounded bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t.emptyFilter}</p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setTab('ALL');
              }}
              className="mt-4 px-4 py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500"
            >
              {t.resetFilters}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="market-table">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800/80 text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50">
                  <th className="py-3 px-3 text-start font-semibold whitespace-nowrap">{t.colPair}</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">
                    <button type="button" onClick={() => handleSort('lastPrice')} className="hover:text-slate-900 dark:hover:text-slate-100">
                      {t.colPrice}
                      <SortIndicator col="lastPrice" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap hidden md:table-cell">
                    {t.colMark}
                  </th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">
                    <button type="button" onClick={() => handleSort('priceChangePct')} className="hover:text-slate-900 dark:hover:text-slate-100">
                      {t.colChange24h}
                      <SortIndicator col="priceChangePct" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">
                    <button type="button" onClick={() => handleSort('quoteVolume24h')} className="hover:text-slate-900 dark:hover:text-slate-100">
                      {t.colVol24h}
                      <SortIndicator col="quoteVolume24h" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap hidden sm:table-cell">
                    <button type="button" onClick={() => handleSort('openInterestUsd')} className="hover:text-slate-900 dark:hover:text-slate-100">
                      {t.colOpenInterest}
                      <SortIndicator col="openInterestUsd" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap hidden lg:table-cell">
                    <button type="button" onClick={() => handleSort('oiDeltaPct')} className="hover:text-slate-900 dark:hover:text-slate-100">
                      {t.colOiDelta}
                      <SortIndicator col="oiDeltaPct" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap hidden sm:table-cell">
                    <button type="button" onClick={() => handleSort('fundingRate')} className="hover:text-slate-900 dark:hover:text-slate-100">
                      {t.colFunding}
                      <SortIndicator col="fundingRate" />
                    </button>
                  </th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">{t.colAction}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {visibleRows.map((row) => {
                  const isWatched = watchlist.includes(row.symbol);
                  const isUp = row.priceChangePct >= 0;
                  const highFunding = Math.abs(row.fundingRate) >= 0.0003;
                  const tickDir = tickDirs[row.symbol];
                  const priceTickClass =
                    tickDir === 'up'
                      ? 'text-emerald-500 transition-colors duration-300'
                      : tickDir === 'down'
                        ? 'text-rose-500 transition-colors duration-300'
                        : 'text-slate-900 dark:text-slate-100 transition-colors duration-300';
                  const barWidth = Math.min(100, Math.abs(row.priceChangePct) * 5);

                  return (
                    <tr
                      key={row.symbol}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/35 transition-colors"
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onToggleWatchlist(row.symbol)}
                            aria-label={`${isWatched ? 'Remove' : 'Add'} ${row.symbol} watchlist`}
                            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded text-slate-400 hover:text-amber-400"
                          >
                            <Star className={`w-3.5 h-3.5 ${isWatched ? 'fill-amber-400 text-amber-400' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(row.symbol)}
                            className="text-start font-bold text-slate-900 dark:text-slate-100 hover:text-sky-500 transition-colors"
                          >
                            <span>{row.baseAsset}</span>
                            <span className="text-slate-400 font-normal">/{row.quoteAsset}</span>
                          </button>
                        </div>
                      </td>
                      <td className={`py-2.5 px-3 text-end font-mono-num font-semibold whitespace-nowrap ${priceTickClass}`}>
                        ${formatPrice(row.lastPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num text-slate-500 dark:text-slate-400 whitespace-nowrap hidden md:table-cell">
                        ${formatPrice(row.markPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num font-semibold whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1">
                          <span className={isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                            {formatPercent(row.priceChangePct)}
                          </span>
                          <div className="w-12 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" dir="ltr">
                            <div
                              className={`h-full ${isUp ? 'bg-emerald-500' : 'bg-rose-500'}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatCompactUsd(row.quoteVolume24h)}
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap hidden sm:table-cell">
                        {formatCompactUsd(row.openInterestUsd)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-end font-mono-num whitespace-nowrap hidden lg:table-cell ${
                          row.oiDeltaPct > 0.3
                            ? 'text-emerald-500'
                            : row.oiDeltaPct < -0.3
                              ? 'text-rose-500'
                              : 'text-slate-400'
                        }`}
                      >
                        {formatPercent(row.oiDeltaPct)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-end font-mono-num whitespace-nowrap hidden sm:table-cell ${
                          highFunding
                            ? row.fundingRate > 0
                              ? 'text-amber-500 font-semibold'
                              : 'text-sky-400 font-semibold'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {formatFunding(row.fundingRate)}
                      </td>
                      <td className="py-2.5 px-3 text-end whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(row.symbol)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-900 dark:bg-slate-800 text-white dark:text-sky-400 hover:bg-sky-600 dark:hover:bg-sky-600 dark:hover:text-white transition-colors font-semibold min-h-[34px]"
                        >
                          <Zap className="w-3 h-3" />
                          <span>{t.analyzeBtn}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {processed.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono-num">
              {t.showingRows} {visibleRows.length} {t.ofRows} {processed.length}
            </span>
            {visibleRows.length < processed.length && (
              <button
                type="button"
                onClick={() => setLimit((prev) => prev + 50)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                {t.loadMore}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
