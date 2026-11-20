import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Search,
  Star,
  X,
} from 'lucide-react';
import { translations } from '../i18n/translations';
import type { Language, MarketTicker } from '../types/futures';
import { formatCompactUsd, formatPercent, formatPrice } from '../utils/formatters';
import { getPairAssets } from '../utils/futuresContracts';
import { filterAndSortPairs, type PairSortBy, type PairSortDir } from '../utils/pairSort';

interface PairSelectorDropdownProps {
  value: string;
  tickers: MarketTicker[];
  lang: Language;
  watchlist?: string[];
  onToggleWatchlist?: (symbol: string) => void;
  onChange: (symbol: string) => void;
  ariaLabel?: string;
  compact?: boolean;
  fullWidth?: boolean;
  align?: 'start' | 'end';
}

export const PairSelectorDropdown: React.FC<PairSelectorDropdownProps> = ({
  value,
  tickers,
  lang,
  watchlist,
  onToggleWatchlist,
  onChange,
  ariaLabel,
  compact = false,
  fullWidth = false,
  align = 'end',
}) => {
  const t = translations[lang];
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<PairSortBy>('volume');
  const [sortDir, setSortDir] = useState<PairSortDir>('desc');
  const [onlyWatchlist, setOnlyWatchlist] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [orderedSymbols, setOrderedSymbols] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tickersRef = useRef<MarketTicker[]>(tickers);
  tickersRef.current = tickers;

  const tickerMap = useMemo(() => {
    const map = new Map<string, MarketTicker>();
    for (const tk of tickers) {
      map.set(tk.symbol, tk);
    }
    return map;
  }, [tickers]);

  const selectedTicker = tickerMap.get(value);
  const parsedSelected = getPairAssets(value);
  const selectedBase = selectedTicker?.baseAsset || parsedSelected.baseAsset;
  const selectedQuote = selectedTicker?.quoteAsset || parsedSelected.quoteAsset;

  // Recompute sorted row order ONLY when menu opens, search/sort/filter changes, or initial tickers load.
  // Never re-order rows on 450ms SSE price ticks while the user is browsing/scrolling!
  useEffect(() => {
    if (!isOpen) return;
    const limit = showAll || query.trim().length > 0 ? 9999 : 150;
    const sorted = filterAndSortPairs(tickersRef.current, {
      query,
      sortBy,
      sortDir,
      onlyWatchlist,
      watchlist,
      limit,
    });
    setOrderedSymbols(sorted.map((s) => s.symbol));
  }, [isOpen, query, sortBy, sortDir, onlyWatchlist, watchlist, showAll]);

  // If tickers just finished loading while menu was already open
  useEffect(() => {
    if (isOpen && orderedSymbols.length === 0 && tickers.length > 0) {
      const limit = showAll || query.trim().length > 0 ? 9999 : 150;
      const sorted = filterAndSortPairs(tickers, {
        query,
        sortBy,
        sortDir,
        onlyWatchlist,
        watchlist,
        limit,
      });
      setOrderedSymbols(sorted.map((s) => s.symbol));
    }
  }, [isOpen, orderedSymbols.length, tickers, query, sortBy, sortDir, onlyWatchlist, watchlist, showAll]);

  // Reset scroll to top only when user actively changes sort/search inside open dropdown
  useEffect(() => {
    if (isOpen && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [query, sortBy, sortDir, onlyWatchlist, isOpen]);

  // Focus search input cleanly when opening on desktop
  useEffect(() => {
    if (isOpen && typeof window !== 'undefined' && window.innerWidth >= 640) {
      const id = setTimeout(() => searchInputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  // Close only on outside pointerdown or Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSortClick = (target: PairSortBy) => {
    if (sortBy === target) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(target);
      setSortDir(target === 'alpha' ? 'asc' : 'desc');
    }
  };

  const handleSelect = (sym: string) => {
    onChange(sym);
    setIsOpen(false);
  };

  const sortOptions: { id: PairSortBy; label: string }[] = [
    { id: 'volume', label: t.sortVolume },
    { id: 'price', label: t.sortPrice },
    { id: 'change', label: t.sortChange },
    { id: 'alpha', label: t.sortAlpha },
  ];

  const totalMatches = useMemo(() => {
    if (!isOpen) return 0;
    return filterAndSortPairs(tickers, {
      query,
      sortBy,
      sortDir,
      onlyWatchlist,
      watchlist,
    }).length;
  }, [isOpen, tickers, query, sortBy, sortDir, onlyWatchlist, watchlist]);

  return (
    <div ref={containerRef} className={`relative ${fullWidth ? 'w-full' : 'w-auto'}`}>
      {/* Trigger Button */}
      <button
        type="button"
        aria-label={ariaLabel || t.selectPair}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        data-testid="pair-selector-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group flex items-center justify-between gap-2.5 rounded-xl border transition-all ${
          isOpen
            ? 'border-sky-500 ring-2 ring-sky-500/20 bg-white dark:bg-[#0C121E]'
            : 'border-slate-200/90 dark:border-slate-800/90 bg-white/95 dark:bg-[#0C121E]/95 hover:border-sky-500/60'
        } ${compact ? 'w-full px-3 py-1.5 min-h-[38px]' : 'px-3.5 py-2 min-h-[42px] min-w-[215px] sm:min-w-[260px]'} ${
          fullWidth ? 'w-full' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-[10px] font-extrabold text-sky-600 dark:text-sky-400">
            {selectedBase.slice(0, 3)}
          </span>
          <span dir="ltr" className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
            {selectedBase}
            <span className="font-normal text-slate-400">/{selectedQuote}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {selectedTicker && (
            <div className="flex items-center gap-1.5 font-mono-num text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                ${formatPrice(selectedTicker.lastPrice)}
              </span>
              {!compact && (
                <span
                  className={`text-[11px] font-semibold ${
                    selectedTicker.priceChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {formatPercent(selectedTicker.priceChangePct)}
                </span>
              )}
            </div>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-sky-500' : ''
            }`}
          />
        </div>
      </button>

      {/* Dropdown Popover (Desktop) / Sheet (Mobile) */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-[2px] sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div
            role="listbox"
            aria-label={ariaLabel || t.selectPair}
            data-testid="pair-selector-panel"
            className={`fixed inset-x-3 top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-50 sm:absolute sm:inset-x-auto sm:top-full sm:mt-2 sm:w-[410px] ${
              align === 'start' ? 'sm:start-0' : 'sm:end-0'
            } rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#0A101B] shadow-2xl overflow-hidden flex flex-col`}
          >
            {/* Header: Search + Close */}
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/80 dark:bg-[#0D1422]">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t.pairSearchPlaceholder}
                    data-testid="pair-selector-search"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B0F17] ps-9 pe-8 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label={t.close}
                      className="absolute top-1/2 -translate-y-1/2 end-2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {watchlist && (
                  <button
                    type="button"
                    onClick={() => setOnlyWatchlist((w) => !w)}
                    aria-label={t.filterWatchlist}
                    title={t.filterWatchlist}
                    className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border transition-colors ${
                      onlyWatchlist
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-400'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B0F17] text-slate-400 hover:text-amber-400'
                    }`}
                  >
                    <Star className={`w-4 h-4 ${onlyWatchlist ? 'fill-amber-400' : ''}`} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label={t.close}
                  className="sm:hidden min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B0F17] text-slate-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Sort Controls */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 flex-wrap">
                  {sortOptions.map((opt) => {
                    const active = sortBy === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`pair-sort-${opt.id}`}
                        onClick={() => handleSortClick(opt.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-sky-600 text-white'
                            : 'bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-sky-500/50'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {active &&
                          (sortDir === 'desc' ? (
                            <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUp className="w-3 h-3" />
                          ))}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] font-mono-num text-slate-400 whitespace-nowrap">
                  {orderedSymbols.length} / {totalMatches}
                </span>
              </div>
            </div>

            {/* Smooth Scrollable Pair List */}
            <div
              ref={listRef}
              data-testid="pair-selector-list"
              className="overflow-y-auto overscroll-contain touch-pan-y max-h-[60vh] sm:max-h-[340px] divide-y divide-slate-100 dark:divide-slate-800/60"
            >
              {orderedSymbols.length === 0 ? (
                <div className="py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  {t.emptyFilter}
                </div>
              ) : (
                orderedSymbols.map((sym) => {
                  const tk = tickerMap.get(sym);
                  if (!tk) return null;
                  const isSelected = tk.symbol === value;
                  const isWatched = watchlist?.includes(tk.symbol) ?? false;
                  const isPos = tk.priceChangePct >= 0;

                  return (
                    <div
                      key={tk.symbol}
                      role="option"
                      aria-selected={isSelected}
                      data-testid={`pair-option-${tk.symbol}`}
                      className={`flex items-center justify-between gap-2 px-3 py-2.5 transition-colors ${
                        isSelected
                          ? 'bg-sky-500/12'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {onToggleWatchlist && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleWatchlist(tk.symbol);
                            }}
                            aria-label={`Watch ${tk.symbol}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 shrink-0"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                isWatched ? 'fill-amber-400 text-amber-400' : ''
                              }`}
                            />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleSelect(tk.symbol)}
                          className="flex-1 flex items-center justify-between gap-2 text-start min-w-0 min-h-[34px]"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span dir="ltr" className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                {tk.baseAsset}
                                <span className="text-[11px] font-normal text-slate-400">/{tk.quoteAsset}</span>
                              </span>
                              {isSelected && <Check className="w-3.5 h-3.5 text-sky-500 shrink-0" />}
                            </div>
                            <div className="text-[10px] font-mono-num text-slate-400">
                              Vol {formatCompactUsd(tk.quoteVolume24h)}
                            </div>
                          </div>

                          <div className="text-end font-mono-num shrink-0">
                            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              ${formatPrice(tk.lastPrice)}
                            </div>
                            <div
                              className={`text-[11px] font-semibold ${
                                isPos ? 'text-emerald-500' : 'text-rose-500'
                              }`}
                            >
                              {formatPercent(tk.priceChangePct)}
                            </div>
                          </div>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}

              {!showAll && totalMatches > orderedSymbols.length && (
                <div className="p-2.5 text-center bg-slate-50/70 dark:bg-[#111827]/70">
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="w-full py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-sky-500 hover:bg-sky-500/10 transition-colors"
                  >
                    {t.showAllPairs} ({totalMatches} {t.pairsCountLabel})
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
