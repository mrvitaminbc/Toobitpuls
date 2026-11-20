import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  Flame,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  Star,
  TableProperties,
  Zap,
} from 'lucide-react';
import { getDirectionLabel, getPhaseLabel, translations } from '../i18n/translations';
import type { Language, ScannerOpportunity } from '../types/futures';
import { formatCompactUsd, formatFunding, formatPercent, formatPrice } from '../utils/formatters';
import { getPairAssets } from '../utils/futuresContracts';
import { evaluateCrowdedSqueeze } from '../utils/liquidationClusters';
import {
  type AdvancedScannerFilters,
  DEFAULT_ADVANCED_FILTERS,
  countActiveAdvancedFilters,
  matchesAdvancedFilters,
} from '../utils/scannerFilters';
import { ScannerFilterView } from './ScannerFilterView';

interface RadarViewProps {
  opportunities: ScannerOpportunity[];
  loading: boolean;
  lang: Language;
  watchlist: string[];
  loggedSymbols?: Set<string>;
  onToggleWatchlist: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onLogSignal?: (opp: ScannerOpportunity) => void;
}

type RadarFilter =
  | 'ALL'
  | 'PRE_PUMP'
  | 'PRE_DUMP'
  | 'SQUEEZE_RADAR'
  | 'SUSPICIOUS'
  | 'SQUEEZE'
  | 'WATCHLIST';
type ViewMode = 'grid' | 'table';

export const RadarView: React.FC<RadarViewProps> = ({
  opportunities,
  loading,
  lang,
  watchlist,
  loggedSymbols,
  onToggleWatchlist,
  onSelectSymbol,
  onLogSignal,
}) => {
  const t = translations[lang];
  const [filter, setFilter] = useState<RadarFilter>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(60);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedScannerFilters>(
    DEFAULT_ADVANCED_FILTERS,
  );
  const [showScannerFilters, setShowScannerFilters] = useState(true);

  const activeAdvancedCount = useMemo(
    () => countActiveAdvancedFilters(advancedFilters),
    [advancedFilters],
  );

  const stats = useMemo(() => {
    const prePump = opportunities.filter(
      (o) => o.phase === 'PRE_PUMP' || (o.pumpProbability >= 65 && o.phase !== 'PUMP_ACTIVE'),
    ).length;
    const preDump = opportunities.filter(
      (o) => o.phase === 'PRE_DUMP' || (o.dumpProbability >= 65 && o.phase !== 'DUMP_ACTIVE'),
    ).length;
    const suspicious = opportunities.filter((o) => o.suspiciousVolumeScore >= 40).length;
    return { total: opportunities.length, prePump, preDump, suspicious };
  }, [opportunities]);

  const spotlights = useMemo(() => {
    if (opportunities.length === 0) return { topPump: null, topDump: null };
    const pumps = opportunities
      .filter((o) => o.direction === 'LONG' || o.phase === 'PRE_PUMP' || o.pumpProbability >= 55)
      .sort((a, b) => b.pumpProbability * b.confidence - a.pumpProbability * a.confidence);
    const dumps = opportunities
      .filter((o) => o.direction === 'SHORT' || o.phase === 'PRE_DUMP' || o.dumpProbability >= 55)
      .sort((a, b) => b.dumpProbability * b.confidence - a.dumpProbability * b.confidence);
    return {
      topPump: pumps[0] ?? null,
      topDump: dumps[0] ?? null,
    };
  }, [opportunities]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return opportunities.filter((item) => {
      if (q && !item.symbol.toUpperCase().includes(q) && !item.baseAsset.toUpperCase().includes(q)) {
        return false;
      }
      if (filter === 'PRE_PUMP') {
        if (!(item.phase === 'PRE_PUMP' || (item.pumpProbability >= 65 && item.phase !== 'PUMP_ACTIVE'))) {
          return false;
        }
      } else if (filter === 'PRE_DUMP') {
        if (!(item.phase === 'PRE_DUMP' || (item.dumpProbability >= 65 && item.phase !== 'DUMP_ACTIVE'))) {
          return false;
        }
      } else if (filter === 'SUSPICIOUS') {
        if (item.suspiciousVolumeScore < 35) return false;
      } else if (filter === 'SQUEEZE') {
        if (!item.isSqueeze && !item.ttmSqueeze) return false;
      } else if (filter === 'SQUEEZE_RADAR') {
        if (!evaluateCrowdedSqueeze(item).isCrowded) return false;
      } else if (filter === 'WATCHLIST') {
        if (!watchlist.includes(item.symbol)) return false;
      }
      return matchesAdvancedFilters(item, advancedFilters);
    });
  }, [opportunities, filter, query, watchlist, advancedFilters]);

  const visibleOpportunities = filtered.slice(0, limit);

  const filterButtons: { id: RadarFilter; label: string }[] = [
    { id: 'ALL', label: t.filterAll },
    { id: 'PRE_PUMP', label: t.filterPrePump },
    { id: 'PRE_DUMP', label: t.filterPreDump },
    { id: 'SQUEEZE_RADAR', label: t.filterSqueezeRadar },
    { id: 'SUSPICIOUS', label: t.filterSuspicious },
    { id: 'SQUEEZE', label: t.filterSqueeze },
    { id: 'WATCHLIST', label: t.filterWatchlist },
  ];

  const renderSpotlight = (opp: ScannerOpportunity, side: 'PUMP' | 'DUMP') => {
    const isPump = side === 'PUMP';
    const prob = isPump ? opp.pumpProbability : opp.dumpProbability;
    const { quoteAsset } = getPairAssets(opp.symbol);
    const isLogged = loggedSymbols?.has(opp.symbol);
    return (
      <div
        className={`relative overflow-hidden rounded-xl border p-4 flex flex-col justify-between gap-3 ${
          isPump
            ? 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] via-white/95 to-white/95 dark:via-[#0C121E] dark:to-[#0C121E]'
            : 'border-rose-500/25 bg-gradient-to-br from-rose-500/[0.08] via-white/95 to-white/95 dark:via-[#0C121E] dark:to-[#0C121E]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {isPump ? (
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              )}
              <span className={isPump ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                {isPump ? t.topPumpSpotlight : t.topDumpSpotlight}
              </span>
              <span className="text-slate-400" aria-hidden="true">·</span>
              <span className="font-mono-num text-slate-500 dark:text-slate-400">
                {opp.timeframe} · {t.confidence} {opp.confidence}%
              </span>
            </div>

            <div className="mt-1 flex items-baseline gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => onSelectSymbol(opp.symbol)}
                className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-slate-100 hover:text-sky-500 transition-colors"
              >
                {opp.baseAsset}
                <span className="text-xs font-normal text-slate-400">/{quoteAsset}</span>
              </button>
              <span className="font-mono-num text-sm font-semibold text-slate-700 dark:text-slate-200">
                ${formatPrice(opp.lastPrice)}
              </span>
              <span
                className={`font-mono-num text-xs font-semibold ${
                  opp.priceChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                }`}
              >
                {formatPercent(opp.priceChangePct)}
              </span>
            </div>
          </div>

          <div className="text-end shrink-0">
            <div
              className={`text-2xl font-extrabold font-mono-num leading-none ${
                isPump ? 'text-emerald-500' : 'text-rose-500'
              }`}
            >
              {prob}%
            </div>
            <div className="mt-1 text-[10px] font-mono-num text-slate-500 dark:text-slate-400">
              Vol {opp.volumeRatio20}x
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-1">
          {lang === 'fa' ? opp.summaryFa : opp.summaryEn}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800/70 text-[11px] font-mono-num">
          <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
            <span>
              {t.entry}: <strong className="text-slate-900 dark:text-slate-100">${formatPrice(opp.optimalEntry)}</strong>
            </span>
            <span>
              SL: <strong className="text-rose-500">${formatPrice(opp.stopLoss)}</strong>
            </span>
            <span className="hidden sm:inline">
              TP1: <strong className="text-emerald-500">${formatPrice(opp.tp1)}</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-sans">
            {onLogSignal && opp.direction !== 'NEUTRAL' && (
              <button
                type="button"
                onClick={() => onLogSignal(opp)}
                disabled={isLogged}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap min-h-[34px] ${
                  isLogged
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                    : 'border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
                }`}
              >
                <BookOpenCheck className="w-3.5 h-3.5" />
                <span>{isLogged ? t.loggedDone : t.logToJournal}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onSelectSymbol(opp.symbol)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500 transition-colors whitespace-nowrap min-h-[34px]"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{t.analyzeBtn}</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-5">
      {/* Header + Unified 4-Col Hairline Telemetry Strip */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              {t.radarTitle}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {t.radarSubtitle}
            </p>
          </div>
        </div>

        {/* Unified Single-Elevation Hairline Metric Bar */}
        <div className="tp-panel rounded-xl grid grid-cols-2 lg:grid-cols-4 overflow-hidden">
          <div className="p-4 flex items-center justify-between gap-3 border-e border-b lg:border-b-0 border-slate-200/80 dark:border-slate-800/80">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.kpiTracked}</div>
              <div className="mt-1 text-2xl font-extrabold font-mono-num text-slate-900 dark:text-slate-100">
                {stats.total}
              </div>
            </div>
            <Activity className="w-4 h-4 text-sky-500/70 shrink-0" />
          </div>

          <div className="p-4 flex items-center justify-between gap-3 border-b lg:border-b-0 lg:border-e border-slate-200/80 dark:border-slate-800/80">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.kpiPrePump}</div>
              <div className="mt-1 text-2xl font-extrabold font-mono-num text-emerald-600 dark:text-emerald-400">
                {stats.prePump}
              </div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-emerald-500/75 shrink-0" />
          </div>

          <div className="p-4 flex items-center justify-between gap-3 border-e border-slate-200/80 dark:border-slate-800/80">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.kpiPreDump}</div>
              <div className="mt-1 text-2xl font-extrabold font-mono-num text-rose-600 dark:text-rose-400">
                {stats.preDump}
              </div>
            </div>
            <ArrowDownRight className="w-4 h-4 text-rose-500/75 shrink-0" />
          </div>

          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.kpiSuspicious}</div>
              <div className="mt-1 text-2xl font-extrabold font-mono-num text-amber-600 dark:text-amber-400">
                {stats.suspicious}
              </div>
            </div>
            <Flame className="w-4 h-4 text-amber-500/75 shrink-0" />
          </div>
        </div>
      </div>

      {/* Featured Pre-Pump vs Pre-Dump Dual Spotlight */}
      {filter === 'ALL' && !query && activeAdvancedCount === 0 && (spotlights.topPump || spotlights.topDump) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {spotlights.topPump && renderSpotlight(spotlights.topPump, 'PUMP')}
          {spotlights.topDump && renderSpotlight(spotlights.topDump, 'DUMP')}
        </div>
      )}

      {/* Filter Segmented Rail, Search & View Mode Switcher */}
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3">
        <div
          data-testid="radar-filter-rail"
          className="flex items-center gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#0C121E]/85 overflow-x-auto w-full 2xl:w-auto"
        >
          {filterButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => {
                setFilter(btn.id);
                setLimit(60);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[36px] ${
                filter === btn.id
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5">
          <div className="relative flex-1 min-w-[200px] sm:w-64 sm:flex-initial">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(60);
              }}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              className="w-full rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0C121E] ps-9 pe-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 min-h-[40px]"
            />
          </div>

          <button
            type="button"
            data-testid="radar-filter-toggle"
            aria-expanded={showScannerFilters}
            onClick={() => setShowScannerFilters((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap min-h-[40px] ${
              showScannerFilters || activeAdvancedCount > 0
                ? 'border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0C121E] text-slate-700 dark:text-slate-200 hover:border-sky-500'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{t.scannerFilterToggle}</span>
            {activeAdvancedCount > 0 && (
              <span className="font-mono-num text-[11px] font-bold">({activeAdvancedCount})</span>
            )}
          </button>

          <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0C121E]">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label={t.viewCards}
              title={t.viewCards}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap min-h-[32px] ${
                viewMode === 'grid'
                  ? 'bg-slate-900 dark:bg-sky-600 text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.viewCards}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label={t.viewTable}
              title={t.viewTable}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap min-h-[32px] ${
                viewMode === 'table'
                  ? 'bg-slate-900 dark:bg-sky-600 text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <TableProperties className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.viewTable}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Advanced Technical Scanner Filter Panel */}
      {showScannerFilters && (
        <ScannerFilterView
          filters={advancedFilters}
          onChange={(next) => {
            setAdvancedFilters(next);
            setLimit(60);
          }}
          onReset={() => {
            setAdvancedFilters(DEFAULT_ADVANCED_FILTERS);
            setLimit(60);
          }}
          matchedCount={filtered.length}
          totalCount={opportunities.length}
          lang={lang}
        />
      )}

      {/* Loading Skeleton */}
      {loading && opportunities.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="tp-panel h-56 rounded-xl animate-pulse p-4" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="tp-panel rounded-xl p-8 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">{t.emptyFilter}</p>
          <button
            type="button"
            onClick={() => {
              setFilter('ALL');
              setQuery('');
              setAdvancedFilters(DEFAULT_ADVANCED_FILTERS);
            }}
            className="mt-4 px-4 py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500 transition-colors"
          >
            {t.resetFilters}
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* Dense Terminal Table View */
        <div className="tp-panel rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse" data-testid="radar-grid">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/50 text-[11px] text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-3 text-start font-semibold whitespace-nowrap">{t.colPair}</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">{t.colPrice}</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">{t.colChange24h}</th>
                  <th className="py-3 px-3 text-start font-semibold whitespace-nowrap">{t.telemPhase}</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">{t.pumpProb}</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">{t.dumpProb}</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap hidden md:table-cell">{t.suspiciousVol}</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap hidden xl:table-cell">{t.entry} / SL / TP1</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">{t.confidence}</th>
                  <th className="py-3 px-3 text-end font-semibold whitespace-nowrap">{t.colAction}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {visibleOpportunities.map((item) => {
                  const isWatched = watchlist.includes(item.symbol);
                  const isBull = item.direction === 'LONG' || item.phase === 'PRE_PUMP';
                  const isBear = item.direction === 'SHORT' || item.phase === 'PRE_DUMP';
                  const { quoteAsset } = getPairAssets(item.symbol);
                  const isLogged = loggedSymbols?.has(item.symbol);

                  return (
                    <tr
                      key={item.symbol}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/35 transition-colors"
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onToggleWatchlist(item.symbol)}
                            aria-label={`${isWatched ? 'Remove' : 'Add'} ${item.symbol} watchlist`}
                            className="text-slate-400 hover:text-amber-400"
                          >
                            <Star className={`w-3.5 h-3.5 ${isWatched ? 'fill-amber-400 text-amber-400' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(item.symbol)}
                            className="font-bold text-slate-900 dark:text-slate-100 hover:text-sky-500"
                          >
                            {item.baseAsset}
                            <span className="text-slate-400 font-normal">/{quoteAsset}</span>
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num font-semibold whitespace-nowrap text-slate-900 dark:text-slate-100">
                        ${formatPrice(item.lastPrice)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-end font-mono-num font-semibold whitespace-nowrap ${
                          item.priceChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        {formatPercent(item.priceChangePct)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            isBull ? 'text-emerald-500' : isBear ? 'text-rose-500' : 'text-amber-500'
                          }`}
                        >
                          {getPhaseLabel(item.phase, lang)}
                        </span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {getDirectionLabel(item.direction, lang)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num font-bold text-emerald-500 whitespace-nowrap">
                        {item.pumpProbability}%
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num font-bold text-rose-500 whitespace-nowrap">
                        {item.dumpProbability}%
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num text-amber-500 font-semibold whitespace-nowrap hidden md:table-cell">
                        {item.suspiciousVolumeScore}/100 ({item.volumeRatio20}x)
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num text-[11px] whitespace-nowrap hidden xl:table-cell">
                        <span className="text-slate-700 dark:text-slate-200">${formatPrice(item.optimalEntry)}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="text-rose-500">${formatPrice(item.stopLoss)}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="text-emerald-500">${formatPrice(item.tp1)}</span>
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono-num font-bold text-sky-500 whitespace-nowrap">
                        {item.confidence}%
                      </td>
                      <td className="py-2.5 px-3 text-end whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {onLogSignal && item.direction !== 'NEUTRAL' && (
                            <button
                              type="button"
                              onClick={() => onLogSignal(item)}
                              disabled={isLogged}
                              className={`px-2 py-1 rounded-md border text-[11px] font-semibold transition-colors ${
                                isLogged
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
                              }`}
                            >
                              {isLogged ? t.loggedDone : t.logToJournal}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(item.symbol)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 dark:bg-sky-600 text-white text-[11px] font-semibold hover:bg-sky-500 transition-colors"
                          >
                            <Zap className="w-3 h-3" />
                            <span>{t.analyzeBtn}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Upgraded Grid Cards View */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="radar-grid">
          {visibleOpportunities.map((item) => {
            const isWatched = watchlist.includes(item.symbol);
            const isBull = item.direction === 'LONG' || item.phase === 'PRE_PUMP';
            const isBear = item.direction === 'SHORT' || item.phase === 'PRE_DUMP';
            const { quoteAsset } = getPairAssets(item.symbol);
            const isLogged = loggedSymbols?.has(item.symbol);
            const totalProb = Math.max(1, item.pumpProbability + item.dumpProbability);
            const pumpShare = (item.pumpProbability / totalProb) * 100;

            return (
              <article
                key={item.symbol}
                className="tp-panel tp-panel-interactive relative overflow-hidden rounded-xl p-4 flex flex-col justify-between gap-3.5"
              >
                {/* Subtle Top Directional Hairline */}
                <div
                  aria-hidden="true"
                  className={`absolute inset-x-0 top-0 h-[2px] ${
                    isBull
                      ? 'bg-gradient-to-r from-emerald-500/80 via-emerald-400/40 to-transparent'
                      : isBear
                        ? 'bg-gradient-to-r from-rose-500/80 via-rose-400/40 to-transparent'
                        : 'bg-gradient-to-r from-sky-500/50 via-slate-400/20 to-transparent'
                  }`}
                />

                <div>
                  {/* Header Row: Symbol + Star + Live Price */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(item.symbol)}
                          className="text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100 hover:text-sky-500 transition-colors"
                        >
                          {item.baseAsset}
                          <span className="text-xs font-normal text-slate-400"> / {quoteAsset}</span>
                        </button>
                        <span className="text-[11px] font-mono-num text-slate-400">{item.timeframe}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          ${formatPrice(item.lastPrice)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={item.priceChangePct >= 0 ? 'text-emerald-500 font-semibold' : 'text-rose-500 font-semibold'}>
                          {formatPercent(item.priceChangePct)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Vol {formatCompactUsd(item.quoteVolume24h)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onToggleWatchlist(item.symbol)}
                      aria-label={`${isWatched ? 'Remove' : 'Add'} ${item.symbol} watchlist`}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors"
                    >
                      <Star className={`w-4 h-4 ${isWatched ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>
                  </div>

                  {/* Phase + Signal Line */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800/80">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      {isBull ? (
                        <ArrowUpRight className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : isBear ? (
                        <ArrowDownRight className="w-4 h-4 text-rose-500 shrink-0" />
                      ) : (
                        <Activity className="w-4 h-4 text-amber-500 shrink-0" />
                      )}
                      <span
                        className={
                          isBull
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isBear
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-amber-600 dark:text-amber-400'
                        }
                      >
                        {getPhaseLabel(item.phase, lang)}
                      </span>
                      <span className="text-slate-400" aria-hidden="true">·</span>
                      <span className="text-slate-700 dark:text-slate-200">
                        {getDirectionLabel(item.direction, lang)}
                      </span>
                    </div>

                    <div className="text-xs font-mono-num font-bold text-sky-600 dark:text-sky-400">
                      {t.confidence}: {item.confidence}%
                    </div>
                  </div>

                  {/* Pump vs Dump Split Bar & Suspicious Volume */}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.pumpProb}</div>
                      <div className="mt-0.5 font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                        {item.pumpProbability}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.dumpProb}</div>
                      <div className="mt-0.5 font-mono-num font-bold text-rose-600 dark:text-rose-400">
                        {item.dumpProbability}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        {item.suspiciousVolumeScore >= 40 && <Flame className="w-3 h-3 text-amber-500" />}
                        <span>{t.suspiciousVol}</span>
                      </div>
                      <div className="mt-0.5 font-mono-num font-bold text-amber-600 dark:text-amber-400">
                        {item.suspiciousVolumeScore}/100 ({item.volumeRatio20}x)
                      </div>
                    </div>
                  </div>

                  {/* Tug-of-War Bull/Bear Probability Bar */}
                  <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800/90 overflow-hidden flex" dir="ltr">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${pumpShare}%` }}
                    />
                    <div
                      className="h-full bg-rose-500/80 transition-all duration-300"
                      style={{ width: `${100 - pumpShare}%` }}
                    />
                  </div>

                  <p className="mt-2.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                    {lang === 'fa' ? item.summaryFa : item.summaryEn}
                  </p>

                  {(() => {
                    const squeezeInfo = evaluateCrowdedSqueeze(item);
                    const hasTags =
                      item.alignedTimeframes ||
                      item.topPatternEn ||
                      item.sharpMoveScore !== undefined ||
                      item.ttmSqueeze ||
                      squeezeInfo.isCrowded ||
                      (item.cvdDivergence && item.cvdDivergence !== 'NONE');
                    if (!hasTags) return null;
                    return (
                      <div className="mt-2 space-y-0.5 text-[11px]">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-sky-600 dark:text-sky-400">
                          {squeezeInfo.isCrowded && (
                            <span
                              className={`font-semibold ${
                                squeezeInfo.squeezeType === 'SHORT_SQUEEZE'
                                  ? 'text-emerald-500'
                                  : 'text-amber-500'
                              }`}
                            >
                              {lang === 'fa' ? squeezeInfo.labelFa : squeezeInfo.labelEn}
                            </span>
                          )}
                          {typeof item.alignedTimeframes === 'number' && item.alignedTimeframes > 0 && (
                            <span dir="ltr" className="font-mono-num font-semibold">
                              MTF {item.alignedTimeframes}/3
                            </span>
                          )}
                          {typeof item.sharpMoveScore === 'number' && item.sharpMoveScore >= 45 && (
                            <span
                              dir="ltr"
                              className={`font-mono-num font-semibold ${
                                item.sharpMoveBias === 'PUMP_20_PLUS'
                                  ? 'text-emerald-500'
                                  : item.sharpMoveBias === 'DUMP_20_PLUS'
                                    ? 'text-rose-500'
                                    : 'text-amber-500'
                              }`}
                            >
                              Sharp {item.sharpMoveScore}%
                            </span>
                          )}
                          {item.ttmSqueeze && (
                            <span dir="ltr" className="font-mono-num font-semibold text-amber-500">
                              TTM {item.squeezeBars ?? 1}b
                            </span>
                          )}
                          {item.cvdDivergence && item.cvdDivergence !== 'NONE' && (
                            <span
                              dir="ltr"
                              className={`font-mono-num font-semibold ${
                                item.cvdDivergence === 'BULLISH' ? 'text-emerald-500' : 'text-rose-500'
                              }`}
                            >
                              CVD{item.cvdDivergence === 'BULLISH' ? '+' : '-'}
                            </span>
                          )}
                        </div>
                        {(lang === 'fa' ? item.topPatternFa : item.topPatternEn) && (
                          <div className="truncate text-slate-700 dark:text-slate-300">
                            {lang === 'fa' ? item.topPatternFa : item.topPatternEn}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Actionable Levels Strip + CTA */}
                <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5">
                  <div className="grid grid-cols-4 gap-1.5 text-[11px] font-mono-num">
                    <div>
                      <div className="text-slate-400">{t.entry}</div>
                      <div className="text-slate-800 dark:text-slate-200 font-semibold">
                        ${formatPrice(item.optimalEntry)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">SL</div>
                      <div className="text-rose-500 font-semibold">${formatPrice(item.stopLoss)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">TP1</div>
                      <div className="text-emerald-500 font-semibold">${formatPrice(item.tp1)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">TP2</div>
                      <div className="text-emerald-400 font-semibold">${formatPrice(item.tp2)}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono-num whitespace-nowrap">
                      {t.takerBuy}: {Math.round(item.takerBuyRatio * 100)}% · FR {formatFunding(item.fundingRate)}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 ms-auto">
                      {onLogSignal && item.direction !== 'NEUTRAL' && (
                        <button
                          type="button"
                          onClick={() => onLogSignal(item)}
                          disabled={isLogged}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors whitespace-nowrap min-h-[32px] ${
                            isLogged
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
                          }`}
                        >
                          <BookOpenCheck className="w-3.5 h-3.5" />
                          <span>{isLogged ? t.loggedDone : t.logToJournal}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectSymbol(item.symbol)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-[11px] font-semibold hover:bg-slate-800 dark:hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0 min-h-[32px]"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>{t.analyzeBtn}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono-num">
            {t.showingRows} {visibleOpportunities.length} {t.ofRows} {filtered.length}
          </span>
          {visibleOpportunities.length < filtered.length && (
            <button
              type="button"
              onClick={() => setLimit((prev) => prev + 60)}
              className="tp-panel px-4 py-2 rounded-lg text-slate-700 dark:text-slate-200 font-semibold hover:border-sky-500 hover:text-sky-500 transition-colors min-h-[38px]"
            >
              {t.loadMore} ({filtered.length - visibleOpportunities.length})
            </button>
          )}
        </div>
      )}
    </section>
  );
};
