import React, { useMemo } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpenCheck,
  Flame,
  Radar,
  Star,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  getDirectionLabel,
  getJournalStatusLabel,
  getPhaseLabel,
  translations,
} from '../i18n/translations';
import type {
  AlertAccuracySummary,
  AlertEvent,
  JournalEntry,
  Language,
  MarketTicker,
  ScannerOpportunity,
} from '../types/futures';
import {
  buildMiniJournalSnapshot,
  computeMarketOverviewSummary,
  selectTopHighConfidenceSignals,
} from '../utils/dashboard';
import { formatCompactUsd, formatFunding, formatPercent, formatPrice } from '../utils/formatters';
import { getPairAssets } from '../utils/futuresContracts';
import { evaluateCrowdedSqueeze } from '../utils/liquidationClusters';

export type DashboardTargetTab = 'radar' | 'signals' | 'journal' | 'market' | 'alerts';

interface DashboardViewProps {
  tickers: MarketTicker[];
  opportunities: ScannerOpportunity[];
  alerts: AlertEvent[];
  accuracy?: AlertAccuracySummary;
  journalEntries: JournalEntry[];
  watchlist: string[];
  loggedSymbols: Set<string>;
  minVolume24h: number;
  loadingMarket: boolean;
  loadingScan: boolean;
  lang: Language;
  onSelectSymbol: (symbol: string) => void;
  onToggleWatchlist: (symbol: string) => void;
  onLogSignal: (opp: ScannerOpportunity) => void;
  onNavigate: (tab: DashboardTargetTab) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  tickers,
  opportunities,
  alerts,
  accuracy,
  journalEntries,
  watchlist,
  loggedSymbols,
  minVolume24h,
  loadingMarket,
  loadingScan,
  lang,
  onSelectSymbol,
  onToggleWatchlist,
  onLogSignal,
  onNavigate,
}) => {
  const t = translations[lang];

  const livePriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tk of tickers) {
      map[tk.symbol] = tk.lastPrice;
    }
    return map;
  }, [tickers]);

  const marketSummary = useMemo(
    () => computeMarketOverviewSummary(tickers, opportunities),
    [tickers, opportunities],
  );

  const topSignals = useMemo(
    () => selectTopHighConfidenceSignals(opportunities, minVolume24h, 3),
    [opportunities, minVolume24h],
  );

  const miniJournal = useMemo(
    () => buildMiniJournalSnapshot(journalEntries, livePriceMap, 4),
    [journalEntries, livePriceMap],
  );

  const crowdedSqueezeCount = useMemo(
    () => opportunities.filter((o) => evaluateCrowdedSqueeze(o).isCrowded).length,
    [opportunities],
  );

  return (
    <section className="space-y-5" data-testid="dashboard-view">
      {/* Executive Header + Primary Radar CTA */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t.dashboardTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t.dashboardSubtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {alerts.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('alerts')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0C121E] px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-amber-500/50 transition-colors whitespace-nowrap min-h-[38px]"
            >
              <Bell className="w-3.5 h-3.5 text-amber-500" />
              <span>{t.dashAlertsShortcut}</span>
              <span dir="ltr" className="font-mono-num text-amber-500 font-bold">
                ({alerts.length})
              </span>
              {accuracy && accuracy.resolvedCount > 0 && (
                <span dir="ltr" className="font-mono-num text-emerald-500 font-semibold">
                  · {accuracy.overallWinRatePct}%
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('radar')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition-colors whitespace-nowrap min-h-[38px]"
          >
            <Radar className="w-3.5 h-3.5" />
            <span>{t.openFullRadar}</span>
          </button>
        </div>
      </div>

      {/* High-Level Market Summary Strip (Unified Single-Elevation Hairline Bar) */}
      <div
        data-testid="dashboard-market-kpis"
        className="tp-panel rounded-xl grid grid-cols-2 lg:grid-cols-4 overflow-hidden"
      >
        <div className="p-4 border-e border-b lg:border-b-0 border-slate-200/80 dark:border-slate-800/80 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t.dashTotalVolume}
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-extrabold font-mono-num text-slate-900 dark:text-slate-100">
              {marketSummary.totalVolume24hUsd > 0
                ? formatCompactUsd(marketSummary.totalVolume24hUsd)
                : '—'}
            </div>
            <div className="mt-1 text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
              <span dir="ltr">{marketSummary.totalContracts}</span> {t.liveContracts}
            </div>
          </div>
          <BarChart3 className="w-4 h-4 text-sky-500/75 shrink-0 mt-0.5" />
        </div>

        <div className="p-4 border-b lg:border-b-0 lg:border-e border-slate-200/80 dark:border-slate-800/80 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t.dashOpenInterest}
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-extrabold font-mono-num text-slate-900 dark:text-slate-100">
              {marketSummary.totalOpenInterestUsd > 0
                ? formatCompactUsd(marketSummary.totalOpenInterestUsd)
                : '—'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t.dashAvgFunding}:</span>
              <span
                dir="ltr"
                className={`font-mono-num font-semibold ${
                  marketSummary.avgFundingRate >= 0 ? 'text-emerald-500' : 'text-rose-500'
                }`}
              >
                {formatFunding(marketSummary.avgFundingRate)}
              </span>
            </div>
          </div>
          <TrendingUp className="w-4 h-4 text-emerald-500/75 shrink-0 mt-0.5" />
        </div>

        <div className="p-4 border-e border-slate-200/80 dark:border-slate-800/80 flex flex-col justify-between gap-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t.dashMarketBreadth}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span
                  dir="ltr"
                  className={`text-xl sm:text-2xl font-extrabold font-mono-num ${
                    marketSummary.breadthBullPct >= 50
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {marketSummary.breadthBullPct}%
                </span>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t.dashBullishRatio}
                </span>
              </div>
            </div>
            <Activity className="w-4 h-4 text-sky-500/75 shrink-0 mt-0.5" />
          </div>
          <div>
            <div
              className="h-1.5 w-full rounded-full bg-rose-500/35 overflow-hidden flex"
              dir="ltr"
            >
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${marketSummary.breadthBullPct}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
              <span dir="ltr" className="text-emerald-500 font-semibold">
                {marketSummary.advancersCount} ↑
              </span>
              <span dir="ltr" className="text-rose-500 font-semibold">
                {marketSummary.declinersCount} ↓
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t.dashScannerPulse}
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono-num">
              <span dir="ltr" className="text-xl sm:text-2xl font-extrabold text-emerald-500">
                {marketSummary.prePumpCount}
              </span>
              <span className="text-slate-400 text-xs">/</span>
              <span dir="ltr" className="text-xl sm:text-2xl font-extrabold text-rose-500">
                {marketSummary.preDumpCount}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                {t.dashSqueezeLabel}:{' '}
                <strong dir="ltr" className="font-mono-num text-amber-500">
                  {marketSummary.squeezeCount}
                </strong>
              </span>
              <span className="hidden sm:inline" aria-hidden="true">·</span>
              <span>
                {t.filterSqueezeRadar}:{' '}
                <strong dir="ltr" className="font-mono-num text-sky-500">
                  {crowdedSqueezeCount}
                </strong>
              </span>
            </div>
          </div>
          <Flame className="w-4 h-4 text-amber-500/75 shrink-0 mt-0.5" />
        </div>
      </div>

      {/* Focal Section: Top 3 High-Confidence Signals */}
      <div data-testid="dashboard-top-signals" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.dashTopSignalsTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t.dashTopSignalsSub}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('signals')}
            className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
          >
            {t.dashViewAllSignals}
          </button>
        </div>

        {loadingScan && topSignals.length === 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="tp-panel h-52 rounded-xl animate-pulse p-4" />
            ))}
          </div>
        ) : topSignals.length === 0 ? (
          <div className="tp-panel rounded-xl p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            {t.dashTopSignalsEmpty}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {topSignals.map((sig, idx) => {
              const isLong = sig.direction === 'LONG';
              const isLogged = loggedSymbols.has(sig.symbol);
              const isWatched = watchlist.includes(sig.symbol);
              const { quoteAsset } = getPairAssets(sig.symbol);
              const prob = isLong ? sig.pumpProbability : sig.dumpProbability;

              return (
                <article
                  key={sig.symbol}
                  data-testid="dashboard-signal-card"
                  className="tp-panel tp-panel-interactive relative overflow-hidden rounded-xl p-4 flex flex-col justify-between gap-3"
                >
                  <div
                    aria-hidden="true"
                    className={`absolute inset-x-0 top-0 h-[2px] ${
                      isLong
                        ? 'bg-gradient-to-r from-emerald-500/85 via-emerald-400/40 to-transparent'
                        : 'bg-gradient-to-r from-rose-500/85 via-rose-400/40 to-transparent'
                    }`}
                  />

                  <div className="space-y-2.5">
                    {/* Top Row: Rank + Pair + Confidence Score */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span dir="ltr" className="font-mono-num font-bold text-slate-400">
                            0{idx + 1}.
                          </span>
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(sig.symbol)}
                            className="text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100 hover:text-sky-500 transition-colors truncate"
                          >
                            {sig.baseAsset}
                            <span className="text-xs font-normal text-slate-400">/{quoteAsset}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleWatchlist(sig.symbol)}
                            aria-label={`${isWatched ? 'Remove' : 'Add'} ${sig.symbol} watchlist`}
                            className="text-slate-400 hover:text-amber-400 p-0.5"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                isWatched ? 'fill-amber-400 text-amber-400' : ''
                              }`}
                            />
                          </button>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono-num">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            ${formatPrice(sig.lastPrice)}
                          </span>
                          <span
                            dir="ltr"
                            className={`font-semibold ${
                              sig.priceChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                          >
                            {formatPercent(sig.priceChangePct)}
                          </span>
                          <span className="text-slate-400" aria-hidden="true">·</span>
                          <span dir="ltr" className="text-slate-500 dark:text-slate-400">
                            {sig.timeframe}
                          </span>
                        </div>
                      </div>

                      <div className="text-end shrink-0">
                        <div
                          dir="ltr"
                          className={`text-xl font-extrabold font-mono-num leading-none ${
                            isLong ? 'text-emerald-500' : 'text-rose-500'
                          }`}
                        >
                          {sig.confidence}%
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                          {t.confidence}
                        </div>
                      </div>
                    </div>

                    {/* Direction + Phase + MTF / Prob line */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/80 text-xs">
                      <div className="flex items-center gap-1.5 font-bold">
                        {isLong ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        )}
                        <span className={isLong ? 'text-emerald-500' : 'text-rose-500'}>
                          {getDirectionLabel(sig.direction, lang)}
                        </span>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="text-slate-700 dark:text-slate-200">
                          {getPhaseLabel(sig.phase, lang)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                        {typeof sig.alignedTimeframes === 'number' && sig.alignedTimeframes > 0 && (
                          <span dir="ltr" className="text-sky-500 font-semibold">
                            MTF {sig.alignedTimeframes}/3
                          </span>
                        )}
                        <span dir="ltr" className={isLong ? 'text-emerald-500 font-semibold' : 'text-rose-500 font-semibold'}>
                          {prob}%
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                      {lang === 'fa' ? sig.summaryFa : sig.summaryEn}
                    </p>
                  </div>

                  {/* Levels + Action Buttons */}
                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5">
                    <div className="grid grid-cols-4 gap-1.5 text-[11px] font-mono-num">
                      <div>
                        <div className="text-slate-400">{t.entry}</div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          ${formatPrice(sig.optimalEntry)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-400">SL</div>
                        <div className="font-semibold text-rose-500">${formatPrice(sig.stopLoss)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400">TP1</div>
                        <div className="font-semibold text-emerald-500">${formatPrice(sig.tp1)}</div>
                      </div>
                      <div>
                        <div className="text-slate-400">{t.rr}</div>
                        <div className="font-semibold text-sky-500">1:{sig.riskReward2}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onLogSignal(sig)}
                        disabled={isLogged}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap min-h-[34px] ${
                          isLogged
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/70 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
                        }`}
                      >
                        <BookOpenCheck className="w-3.5 h-3.5" />
                        <span>{isLogged ? t.loggedDone : t.logToJournal}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectSymbol(sig.symbol)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500 transition-colors whitespace-nowrap min-h-[34px]"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>{t.analyzeBtn}</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom 2-Column Split: Market Benchmark Summary + Mini-Journal Widget */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Market Summary Table Widget */}
        <div
          data-testid="dashboard-market-summary"
          className="tp-panel rounded-xl lg:col-span-7 flex flex-col justify-between overflow-hidden"
        >
          <div>
            <div className="px-4 py-3.5 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.dashMarketSummaryTitle}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.dashMarketSummarySub}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('market')}
                className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
              >
                {t.dashViewAllMarket}
              </button>
            </div>

            {/* 24h Extreme Movers Hairline Strip */}
            {(marketSummary.topGainer || marketSummary.topLoser) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 border-b border-slate-200/80 dark:border-slate-800/80 text-xs">
                {marketSummary.topGainer && (
                  <button
                    type="button"
                    onClick={() => onSelectSymbol(marketSummary.topGainer!.symbol)}
                    className="px-4 py-2.5 flex items-center justify-between gap-2 sm:border-e border-b sm:border-b-0 border-slate-200/80 dark:border-slate-800/80 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors text-start"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="text-slate-500 dark:text-slate-400 truncate">
                        {t.dashTopGainerLabel}:
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {marketSummary.topGainer.baseAsset}
                      </span>
                    </div>
                    <span dir="ltr" className="font-mono-num font-bold text-emerald-500 shrink-0">
                      {formatPercent(marketSummary.topGainer.priceChangePct)}
                    </span>
                  </button>
                )}

                {marketSummary.topLoser && (
                  <button
                    type="button"
                    onClick={() => onSelectSymbol(marketSummary.topLoser!.symbol)}
                    className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors text-start"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ArrowDownRight className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span className="text-slate-500 dark:text-slate-400 truncate">
                        {t.dashTopLoserLabel}:
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {marketSummary.topLoser.baseAsset}
                      </span>
                    </div>
                    <span dir="ltr" className="font-mono-num font-bold text-rose-500 shrink-0">
                      {formatPercent(marketSummary.topLoser.priceChangePct)}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Benchmark Perpetual Contracts Table */}
            {loadingMarket && marketSummary.marketBenchmarks.length === 0 ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-9 rounded bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/45 text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-3 text-start font-semibold whitespace-nowrap">{t.colPair}</th>
                      <th className="py-2.5 px-3 text-end font-semibold whitespace-nowrap">{t.colPrice}</th>
                      <th className="py-2.5 px-3 text-end font-semibold whitespace-nowrap">{t.colChange24h}</th>
                      <th className="py-2.5 px-3 text-end font-semibold whitespace-nowrap hidden sm:table-cell">{t.colVol24h}</th>
                      <th className="py-2.5 px-3 text-end font-semibold whitespace-nowrap hidden md:table-cell">{t.colOpenInterest}</th>
                      <th className="py-2.5 px-3 text-end font-semibold whitespace-nowrap hidden xl:table-cell">{t.colFunding}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {marketSummary.marketBenchmarks.map((tk) => {
                      const isWatched = watchlist.includes(tk.symbol);
                      const { quoteAsset } = getPairAssets(tk.symbol);
                      return (
                        <tr
                          key={tk.symbol}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/35 transition-colors"
                        >
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onToggleWatchlist(tk.symbol)}
                                aria-label={`${isWatched ? 'Remove' : 'Add'} ${tk.symbol} watchlist`}
                                className="text-slate-400 hover:text-amber-400"
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${
                                    isWatched ? 'fill-amber-400 text-amber-400' : ''
                                  }`}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => onSelectSymbol(tk.symbol)}
                                className="font-bold text-slate-900 dark:text-slate-100 hover:text-sky-500 transition-colors"
                              >
                                {tk.baseAsset}
                                <span className="text-slate-400 font-normal">/{quoteAsset}</span>
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-end font-mono-num font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            ${formatPrice(tk.lastPrice)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-end font-mono-num font-semibold whitespace-nowrap ${
                              tk.priceChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                          >
                            <span dir="ltr">{formatPercent(tk.priceChangePct)}</span>
                          </td>
                          <td className="py-2.5 px-3 text-end font-mono-num text-slate-600 dark:text-slate-300 whitespace-nowrap hidden sm:table-cell">
                            {formatCompactUsd(tk.quoteVolume24h)}
                          </td>
                          <td className="py-2.5 px-3 text-end font-mono-num text-slate-600 dark:text-slate-300 whitespace-nowrap hidden md:table-cell">
                            {tk.openInterestUsd > 0 ? formatCompactUsd(tk.openInterestUsd) : '—'}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-end font-mono-num font-semibold whitespace-nowrap hidden xl:table-cell ${
                              tk.fundingRate >= 0 ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                          >
                            <span dir="ltr">{formatFunding(tk.fundingRate)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Mini-Journal Widget */}
        <div
          data-testid="dashboard-mini-journal"
          className="tp-panel rounded-xl lg:col-span-5 flex flex-col justify-between overflow-hidden"
        >
          <div>
            <div className="px-4 py-3.5 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                  {t.dashMiniJournalTitle}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.dashMiniJournalSub}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('journal')}
                className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
              >
                {t.dashOpenFullJournal}
              </button>
            </div>

            {/* 4-Metric Hairline Strip */}
            <div className="grid grid-cols-4 border-b border-slate-200/80 dark:border-slate-800/80 text-xs">
              <div className="p-3 border-e border-slate-200/80 dark:border-slate-800/80">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t.journalFilterOpen}
                </div>
                <div dir="ltr" className="mt-0.5 text-sm font-extrabold font-mono-num text-sky-500">
                  {miniJournal.stats.openCount}
                </div>
              </div>
              <div className="p-3 border-e border-slate-200/80 dark:border-slate-800/80">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t.journalKpiWinRate}
                </div>
                <div dir="ltr" className="mt-0.5 text-sm font-extrabold font-mono-num text-emerald-500">
                  {miniJournal.stats.winRatePct}%
                </div>
              </div>
              <div className="p-3 border-e border-slate-200/80 dark:border-slate-800/80">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t.journalRMultiple}
                </div>
                <div
                  dir="ltr"
                  className={`mt-0.5 text-sm font-extrabold font-mono-num ${
                    miniJournal.stats.avgRMultiple >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {miniJournal.stats.avgRMultiple >= 0 ? '+' : ''}
                  {miniJournal.stats.avgRMultiple}R
                </div>
              </div>
              <div className="p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {t.journalPnlUsd}
                </div>
                <div
                  dir="ltr"
                  className={`mt-0.5 text-sm font-extrabold font-mono-num ${
                    miniJournal.stats.netPnlUsd >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {miniJournal.stats.netPnlUsd >= 0 ? '+' : '-'}$
                  {Math.abs(miniJournal.stats.netPnlUsd).toFixed(0)}
                </div>
              </div>
            </div>

            {miniJournal.recentRows.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <BookOpenCheck className="w-7 h-7 mx-auto text-slate-400 opacity-60" />
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
                  {t.dashMiniJournalEmpty}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('signals')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500 transition-colors"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>{t.dashBrowseSignals}</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {miniJournal.recentRows.map(({ entry, metrics }) => {
                  const isLong = entry.direction === 'LONG';
                  const isPositive = metrics.pnlUsd >= 0;
                  const { quoteAsset } = getPairAssets(entry.symbol);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onSelectSymbol(entry.symbol)}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/75 dark:hover:bg-slate-800/35 transition-colors text-start"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-bold text-slate-900 dark:text-slate-100">
                            {entry.baseAsset}/{quoteAsset}
                          </span>
                          <span className="text-slate-400" aria-hidden="true">·</span>
                          <span className={isLong ? 'font-semibold text-emerald-500' : 'font-semibold text-rose-500'}>
                            {getDirectionLabel(entry.direction, lang)}
                          </span>
                          <span className="text-slate-400" aria-hidden="true">·</span>
                          <span dir="ltr" className="font-mono-num text-slate-400">
                            {entry.leverage}x
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <span>{getJournalStatusLabel(entry.status, lang)}</span>
                          <span aria-hidden="true">·</span>
                          <span dir="ltr" className="font-mono-num">
                            ${formatPrice(entry.entryPrice)} → ${formatPrice(metrics.currentPrice)}
                          </span>
                        </div>
                      </div>

                      <div className="text-end font-mono-num shrink-0">
                        <div
                          dir="ltr"
                          className={`text-xs font-extrabold ${
                            isPositive ? 'text-emerald-500' : 'text-rose-500'
                          }`}
                        >
                          {metrics.leveragedPnlPct >= 0 ? '+' : ''}
                          {metrics.leveragedPnlPct}%
                        </div>
                        <div
                          dir="ltr"
                          className={`text-[11px] ${
                            isPositive ? 'text-emerald-500/80' : 'text-rose-500/80'
                          }`}
                        >
                          {metrics.pnlUsd >= 0 ? '+' : '-'}${Math.abs(metrics.pnlUsd).toFixed(2)} (
                          {metrics.rMultiple >= 0 ? '+' : ''}
                          {metrics.rMultiple}R)
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
