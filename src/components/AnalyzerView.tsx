import React, { useMemo, useState } from 'react';
import { BookOpenCheck, Compass, Flame, Layers, RefreshCw, Star } from 'lucide-react';
import { getDirectionLabel, getPhaseLabel, translations } from '../i18n/translations';
import type { AnalysisResult, Language, MarketTicker, Timeframe } from '../types/futures';
import { formatCompactUsd, formatFunding, formatPercent, formatPrice, formatTime } from '../utils/formatters';
import { getPairAssets } from '../utils/futuresContracts';
import { estimateLiquidationClusters } from '../utils/liquidationClusters';
import { ConfidenceGauge } from './ConfidenceGauge';
import { FuturesChart } from './FuturesChart';
import { OscillatorSparklines } from './OscillatorSparklines';
import { PairSelectorDropdown } from './PairSelectorDropdown';
import { AiCryptoInsightCard } from './AiCryptoInsightCard';
import { SocialSentimentCard } from './SocialSentimentCard';
import { VolumeProfilePanel } from './VolumeProfilePanel';

interface AnalyzerViewProps {
  symbol: string;
  timeframe: Timeframe;
  analysis: AnalysisResult | null;
  liveTicker?: MarketTicker;
  loading: boolean;
  error: string | null;
  tickers: MarketTicker[];
  lang: Language;
  watchlist: string[];
  isLogged?: boolean;
  aiTriggerToken?: number;
  onToggleWatchlist: (symbol: string) => void;
  onChangeSymbol: (symbol: string) => void;
  onChangeTimeframe: (tf: Timeframe) => void;
  onRefresh: () => void;
  onLogSignal?: (analysis: AnalysisResult, capitalUsd: number, riskPct: number) => void;
}

export const AnalyzerView: React.FC<AnalyzerViewProps> = ({
  symbol,
  timeframe,
  analysis,
  liveTicker,
  loading,
  error,
  tickers,
  lang,
  watchlist,
  isLogged,
  aiTriggerToken = 0,
  onToggleWatchlist,
  onChangeSymbol,
  onChangeTimeframe,
  onRefresh,
  onLogSignal,
}) => {
  const t = translations[lang];
  const [capital, setCapital] = useState<string>('1000');
  const [riskPct, setRiskPct] = useState<string>('2');
  const [leverageInput, setLeverageInput] = useState<string>('10');

  const livePrice = liveTicker?.lastPrice ?? analysis?.lastPrice ?? 0;
  const liveChangePct = liveTicker?.priceChangePct ?? analysis?.priceChangePct ?? 0;
  const liveOiUsd = liveTicker?.openInterestUsd ?? analysis?.openInterestUsd ?? 0;
  const liveFunding = liveTicker?.fundingRate ?? analysis?.fundingRate ?? 0;

  const calcMetrics = useMemo(() => {
    if (!analysis) return null;
    const cap = Math.max(0, Number(capital) || 0);
    const rPct = Math.max(0, Math.min(100, Number(riskPct) || 0));
    const lev = Math.max(1, Math.min(100, Number(leverageInput) || 1));

    const entry = analysis.tradePlan.optimalEntry || livePrice;
    const sl = analysis.tradePlan.stopLoss;
    const slDist = Math.abs(entry - sl);
    const slPct = entry > 0 ? slDist / entry : 0.015;

    const maxLossUsd = cap * (rPct / 100);
    const posSizeUsd = slPct > 0 ? maxLossUsd / slPct : 0;
    const marginReqUsd = lev > 0 ? posSizeUsd / lev : posSizeUsd;

    const calcTpProfit = (tp: number) => {
      if (entry <= 0) return 0;
      const movePct = Math.abs(tp - entry) / entry;
      return posSizeUsd * movePct;
    };

    return {
      maxLossUsd,
      posSizeUsd,
      marginReqUsd,
      profitTp1: calcTpProfit(analysis.tradePlan.tp1),
      profitTp2: calcTpProfit(analysis.tradePlan.tp2),
      profitTp3: calcTpProfit(analysis.tradePlan.tp3),
    };
  }, [analysis, livePrice, capital, riskPct, leverageInput]);

  const isWatched = watchlist.includes(symbol);
  const conclusionLines = useMemo(() => {
    if (!analysis) return [];
    const text = lang === 'fa' ? analysis.conclusionFa : analysis.conclusionEn;
    return text.split('\n').filter(Boolean);
  }, [analysis, lang]);

  const liquidationClusters = useMemo(() => {
    if (!analysis) return [];
    return estimateLiquidationClusters(analysis.candles, livePrice, liveOiUsd);
  }, [analysis, livePrice, liveOiUsd]);

  return (
    <section className="space-y-5">
      {/* Analyzer Command Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t.analyzerTitle}
          </h1>
          <button
            type="button"
            onClick={() => onToggleWatchlist(symbol)}
            aria-label={`${isWatched ? 'Remove' : 'Add'} ${symbol} watchlist`}
            className="tp-panel min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-400"
          >
            <Star className={`w-4 h-4 ${isWatched ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PairSelectorDropdown
            value={symbol}
            tickers={tickers}
            lang={lang}
            watchlist={watchlist}
            onToggleWatchlist={onToggleWatchlist}
            onChange={onChangeSymbol}
            ariaLabel={t.selectPair}
          />

          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh analysis"
            className="tp-panel inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500/40 min-h-[40px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading && !analysis ? (
        <div className="space-y-4">
          <div className="tp-panel h-28 rounded-xl animate-pulse" />
          <div className="tp-panel h-96 rounded-xl animate-pulse" />
        </div>
      ) : analysis ? (
        <>
          {/* Unified 4-Column Hairline Executive Telemetry Deck */}
          <div
            data-testid="analyzer-telemetry-grid"
            className="tp-panel rounded-xl grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 xl:divide-x rtl:xl:divide-x-reverse divide-slate-200/80 dark:divide-slate-800/80 overflow-hidden"
          >
            {/* Segment 1: Market & Derivatives */}
            <div className="p-4 space-y-2">
              <div className="text-[11px] font-bold text-slate-400 pb-1.5 border-b border-slate-100 dark:border-slate-800/70 flex items-center justify-between">
                <span>{t.telemMarketCat}</span>
                <span dir="ltr" className="font-mono-num text-slate-700 dark:text-slate-200">
                  {analysis.baseAsset}/{getPairAssets(analysis.symbol).quoteAsset}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.colPrice}</span>
                <span className="font-mono-num font-extrabold text-sm text-slate-900 dark:text-slate-100">
                  ${formatPrice(livePrice)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.colChange24h}</span>
                <span className={`font-mono-num font-bold ${liveChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {formatPercent(liveChangePct)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.colOpenInterest}</span>
                <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                  {formatCompactUsd(liveOiUsd)} · {formatFunding(liveFunding)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.smcZoneLabel}</span>
                <span
                  className={`font-mono-num font-bold ${
                    analysis.indicators.smcZone === 'DISCOUNT'
                      ? 'text-emerald-500'
                      : analysis.indicators.smcZone === 'PREMIUM'
                        ? 'text-rose-500'
                        : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {analysis.indicators.smcZone}
                </span>
              </div>
            </div>

            {/* Segment 2: Volume & Liquidity */}
            <div className="p-4 space-y-2">
              <div className="text-[11px] font-bold text-slate-400 pb-1.5 border-b border-slate-100 dark:border-slate-800/70">
                {t.telemVolumeCat}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.suspiciousVol}</span>
                <span className="font-mono-num font-bold text-sm text-amber-600 dark:text-amber-400">
                  {analysis.suspiciousVolumeScore}/100
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.telemVolRatio}</span>
                <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                  {analysis.volumeRatio20}x · Z {analysis.volumeZScore}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.takerBuy}</span>
                <span
                  className={`font-mono-num font-bold ${
                    analysis.takerBuyRatio >= 0.54
                      ? 'text-emerald-500'
                      : analysis.takerBuyRatio <= 0.46
                        ? 'text-rose-500'
                        : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {Math.round(analysis.takerBuyRatio * 100)}%
                  {analysis.indicators.cvdDivergence !== 'NONE' && (
                    <span dir="ltr" className="ms-1 text-[11px]">
                      · CVD{analysis.indicators.cvdDivergence === 'BULLISH' ? '+' : '-'}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.cmfMfiLabel}</span>
                <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                  {analysis.indicators.cmf20 >= 0 ? `+${analysis.indicators.cmf20}` : analysis.indicators.cmf20} · {analysis.indicators.mfi14}
                </span>
              </div>
            </div>

            {/* Segment 3: Pump / Dump & Sharp Move Matrix */}
            <div className="p-4 space-y-2">
              <div className="text-[11px] font-bold text-slate-400 pb-1.5 border-b border-slate-100 dark:border-slate-800/70">
                {t.telemProbCat}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.pumpProb}</span>
                <span className="font-mono-num font-bold text-sm text-emerald-600 dark:text-emerald-400">
                  {analysis.pumpProbability}%
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.dumpProb}</span>
                <span className="font-mono-num font-bold text-sm text-rose-600 dark:text-rose-400">
                  {analysis.dumpProbability}%
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.sharpMoveLabel}</span>
                <span
                  className={`font-mono-num font-bold ${
                    analysis.sharpMoveBias === 'PUMP_20_PLUS'
                      ? 'text-emerald-500'
                      : analysis.sharpMoveBias === 'DUMP_20_PLUS'
                        ? 'text-rose-500'
                        : 'text-amber-500'
                  }`}
                >
                  {analysis.sharpMoveScore}/100
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-500 dark:text-slate-400">{t.ttmSqueezeLabel}</span>
                <span
                  dir="ltr"
                  className={`font-mono-num font-semibold ${
                    analysis.indicators.ttmSqueeze
                      ? 'text-amber-500'
                      : analysis.indicators.atrExpansionRatio <= 0.68
                        ? 'text-sky-500'
                        : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {analysis.indicators.ttmSqueeze
                    ? `ON (${analysis.indicators.squeezeBars}b)`
                    : `ATR ${analysis.indicators.atrExpansionRatio}x`}
                </span>
              </div>
            </div>

            {/* Segment 4: Signal & Circular Confidence Gauge */}
            <div className="p-4 flex flex-col justify-between gap-2 bg-gradient-to-br from-sky-500/[0.04] via-transparent to-transparent">
              <div className="text-[11px] font-bold text-slate-400 pb-1.5 border-b border-slate-100 dark:border-slate-800/70 flex items-center justify-between gap-2">
                <span>{t.telemSignalCat}</span>
                <span className="font-mono-num text-slate-500 dark:text-slate-400">{t.confidence}</span>
              </div>
              <div className="flex items-center justify-between gap-3 flex-1">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">{t.telemSignalSide}</span>
                    <span
                      className={`font-extrabold text-sm truncate ${
                        analysis.direction === 'LONG'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : analysis.direction === 'SHORT'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {getDirectionLabel(analysis.direction, lang)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">{t.telemPhase}</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {getPhaseLabel(analysis.phase, lang)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs py-0.5">
                    <span className="text-slate-500 dark:text-slate-400 shrink-0">{t.superTrendLabel}</span>
                    <span
                      className={`font-mono-num font-bold shrink-0 ${
                        analysis.indicators.superTrendDir === 'BULLISH' ? 'text-emerald-500' : 'text-rose-500'
                      }`}
                    >
                      {analysis.indicators.superTrendDir}
                    </span>
                  </div>
                </div>

                <ConfidenceGauge
                  score={analysis.confidence}
                  lang={lang}
                  label={t.confidence}
                  size={84}
                  strokeWidth={7}
                />
              </div>
            </div>
          </div>

          {/* Primary Chart + Trade Execution Ticket Split */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            {/* Main Left/Start Column: Chart + Oscillators + Volume Profile + MTF + Verdict + Patterns + Factors */}
            <div className="xl:col-span-8 space-y-5">
              <FuturesChart
                analysis={analysis}
                livePrice={livePrice}
                timeframe={timeframe}
                liquidationClusters={liquidationClusters}
                loading={loading}
                lang={lang}
                onChangeTimeframe={onChangeTimeframe}
              />

              {/* RSI & MACD Oscillator Sparklines */}
              <OscillatorSparklines analysis={analysis} lang={lang} />

              {/* Historical Price-Volume Distribution */}
              <VolumeProfilePanel analysis={analysis} livePrice={livePrice} lang={lang} />

              {/* Multi-Timeframe Confluence Strip (Hairline 3-Col Row, Zero Nested Boxes) */}
              {analysis.mtf && (
                <div data-testid="mtf-confluence-bar" className="tp-panel rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-sky-500 shrink-0" />
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {t.mtfBarTitle}
                      </h2>
                    </div>
                    <div className="text-xs font-mono-num font-bold">
                      <span
                        className={
                          analysis.mtf.alignmentScore >= 20
                            ? 'text-emerald-500'
                            : analysis.mtf.alignmentScore <= -20
                              ? 'text-rose-500'
                              : 'text-amber-500'
                        }
                      >
                        {analysis.mtf.alignmentLabel.replace('_', ' ')} ({analysis.mtf.alignedTimeframes}/3 ·{' '}
                        {analysis.mtf.alignmentScore > 0 ? `+${analysis.mtf.alignmentScore}` : analysis.mtf.alignmentScore})
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x rtl:md:divide-x-reverse divide-slate-200/70 dark:divide-slate-800/80">
                    {[analysis.mtf.tf1h, analysis.mtf.tf4h, analysis.mtf.tf1d].map((snap, idx) => {
                      const tfLabel = idx === 0 ? '1H' : idx === 1 ? '4H' : '1D';
                      if (!snap) {
                        return (
                          <div key={tfLabel} className="p-3.5 text-xs text-slate-400">
                            <div className="font-mono-num font-bold">{tfLabel}</div>
                            <div className="mt-1">—</div>
                          </div>
                        );
                      }
                      const isBull = snap.direction === 'LONG';
                      const isBear = snap.direction === 'SHORT';
                      return (
                        <div key={snap.timeframe} className="p-3.5 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span dir="ltr" className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                              {snap.timeframe.toUpperCase()}
                            </span>
                            <span
                              className={`font-mono-num font-bold ${
                                isBull ? 'text-emerald-500' : isBear ? 'text-rose-500' : 'text-amber-500'
                              }`}
                            >
                              {getDirectionLabel(snap.direction, lang)} ({snap.score > 0 ? `+${snap.score}` : snap.score})
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                            <span>ST: {snap.superTrend === 'BULLISH' ? 'Bull' : 'Bear'}</span>
                            <span>Kumo: {snap.ichimoku.replace('_KUMO', '')}</span>
                            <span>ADX {snap.adx14}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Comprehensive Multi-Factor Verdict */}
              <div
                className="tp-panel rounded-xl p-4 space-y-2.5 bg-gradient-to-br from-sky-500/[0.04] via-transparent to-transparent"
                data-testid="comprehensive-conclusion"
              >
                <div className="flex items-center gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
                  <BookOpenCheck className="w-4 h-4 text-sky-500 shrink-0" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t.conclusionTitle}
                  </h2>
                </div>
                <div className="space-y-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {conclusionLines.map((line, i) => (
                    <p
                      key={i}
                      className={
                        i === conclusionLines.length - 1
                          ? 'font-semibold text-slate-900 dark:text-slate-100 pt-1'
                          : ''
                      }
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>

              {/* Detected Patterns (Clean Hairline 2-Col Ledger) */}
              <div data-testid="detected-patterns-panel" className="tp-panel rounded-xl overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <Compass className="w-4 h-4 text-sky-500 shrink-0" />
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {t.patternsTitle}
                    </h2>
                  </div>
                  <span className="text-xs font-mono-num text-slate-500">{analysis.patterns.length}</span>
                </div>

                {analysis.patterns.length === 0 ? (
                  <p className="p-4 text-xs text-slate-500 dark:text-slate-400">{t.noPatterns}</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-x rtl:md:divide-x-reverse divide-slate-200/70 dark:divide-slate-800/70">
                    {analysis.patterns.map((pat) => {
                      const isBull = pat.bias === 'BULLISH';
                      const isBear = pat.bias === 'BEARISH';
                      return (
                        <div key={pat.id} className="p-3.5 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {lang === 'fa' ? pat.nameFa : pat.nameEn}
                            </span>
                            <span
                              className={`font-mono-num font-bold shrink-0 ${
                                isBull ? 'text-emerald-500' : isBear ? 'text-rose-500' : 'text-amber-500'
                              }`}
                            >
                              {pat.category} · {pat.strength}%
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                            {lang === 'fa' ? pat.detailFa : pat.detailEn}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 12-Factor Institutional & Sharp-Move Audit */}
              <div className="tp-panel rounded-xl p-4">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
                  {t.factorsTitle}
                </h2>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3.5">
                  {analysis.factors.map((f) => {
                    const barPct = Math.min(100, Math.abs(f.score));
                    const isBull = f.bias === 'BULLISH';
                    const isBear = f.bias === 'BEARISH';
                    return (
                      <div key={f.id} className="pb-3 border-b border-slate-100 dark:border-slate-800/70 last:border-b-0">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {lang === 'fa' ? f.labelFa : f.labelEn}
                          </span>
                          <span
                            className={`font-mono-num font-bold ${
                              isBull
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : isBear
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-500'
                            }`}
                          >
                            {f.valueText} ({f.score > 0 ? `+${f.score}` : f.score})
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              isBull ? 'bg-emerald-500' : isBear ? 'bg-rose-500' : 'bg-slate-400'
                            }`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {lang === 'fa' ? f.detailFa : f.detailEn}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right/End Execution Column: Unified Execution & Calculator + Sentiment + Orderbook + Backtest */}
            <div className="xl:col-span-4 space-y-5">
              {/* Integrated Execution Plan + Position Size Calculator */}
              <div className="tp-panel rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {t.tradePlanTitle}
                  </h2>
                  <span
                    className={`text-xs font-extrabold font-mono-num ${
                      analysis.tradePlan.action === 'LONG'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : analysis.tradePlan.action === 'SHORT'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-amber-500'
                    }`}
                  >
                    {analysis.tradePlan.action} · {analysis.tradePlan.suggestedMaxLeverage}x
                  </span>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {lang === 'fa' ? analysis.summaryFa : analysis.summaryEn}
                </p>

                <div className="grid grid-cols-2 gap-3 text-xs font-mono-num">
                  <div>
                    <div className="text-[11px] text-slate-400">{t.entryZone}</div>
                    <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                      ${formatPrice(analysis.tradePlan.entryZoneLow)} – ${formatPrice(analysis.tradePlan.entryZoneHigh)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">{t.optimalEntry}</div>
                    <div className="mt-0.5 font-bold text-sky-600 dark:text-sky-400">
                      ${formatPrice(analysis.tradePlan.optimalEntry)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">{t.stopLoss}</div>
                    <div className="mt-0.5 font-bold text-rose-600 dark:text-rose-400">
                      ${formatPrice(analysis.tradePlan.stopLoss)} (-{analysis.tradePlan.slDistancePct}%)
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">{t.tp1} (1:{analysis.tradePlan.riskReward1})</div>
                    <div className="mt-0.5 font-bold text-emerald-600 dark:text-emerald-400">
                      ${formatPrice(analysis.tradePlan.tp1)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">{t.tp2} (1:{analysis.tradePlan.riskReward2})</div>
                    <div className="mt-0.5 font-bold text-emerald-500">
                      ${formatPrice(analysis.tradePlan.tp2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">{t.tp3} (1:{analysis.tradePlan.riskReward3})</div>
                    <div className="mt-0.5 font-bold text-emerald-400">
                      ${formatPrice(analysis.tradePlan.tp3)}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{t.invalidation}: </span>
                  {lang === 'fa' ? analysis.tradePlan.invalidationFa : analysis.tradePlan.invalidationEn}
                </div>

                {onLogSignal && analysis.direction !== 'NEUTRAL' && (
                  <button
                    type="button"
                    onClick={() => onLogSignal(analysis, Number(capital) || 1000, Number(riskPct) || 2)}
                    className={`w-full py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                      isLogged
                        ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                        : 'bg-sky-600 text-white hover:bg-sky-500'
                    }`}
                  >
                    {isLogged ? t.loggedDone : t.logToJournal}
                  </button>
                )}

                {/* Hairline-Separated Risk Sizing Section */}
                <div className="pt-3.5 border-t border-slate-200/80 dark:border-slate-800/80 space-y-3">
                  <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {t.calculatorTitle}
                  </h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <label htmlFor="calc-capital" className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        {t.accountBalance}
                      </label>
                      <input
                        id="calc-capital"
                        type="number"
                        min={10}
                        value={capital}
                        onChange={(e) => setCapital(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-1.5 font-mono-num text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label htmlFor="calc-risk" className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        {t.riskPct}
                      </label>
                      <input
                        id="calc-risk"
                        type="number"
                        min={0.2}
                        max={25}
                        step={0.5}
                        value={riskPct}
                        onChange={(e) => setRiskPct(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-1.5 font-mono-num text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label htmlFor="calc-lev" className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        {t.calcLeverage}
                      </label>
                      <input
                        id="calc-lev"
                        type="number"
                        min={1}
                        max={50}
                        value={leverageInput}
                        onChange={(e) => setLeverageInput(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-1.5 font-mono-num text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  {calcMetrics && (
                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono-num" data-testid="calc-outputs">
                      <div>
                        <div className="text-[11px] text-slate-400">{t.posSizeUsdt}</div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          ${calcMetrics.posSizeUsd.toFixed(0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">{t.marginReq}</div>
                        <div className="font-bold text-sky-600 dark:text-sky-400">
                          ${calcMetrics.marginReqUsd.toFixed(1)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">{t.maxLossUsd}</div>
                        <div className="font-bold text-rose-500">-${calcMetrics.maxLossUsd.toFixed(1)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">{t.profitTp1}</div>
                        <div className="font-semibold text-emerald-500">+${calcMetrics.profitTp1.toFixed(1)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">{t.profitTp2}</div>
                        <div className="font-semibold text-emerald-500">+${calcMetrics.profitTp2.toFixed(1)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">{t.profitTp3}</div>
                        <div className="font-semibold text-emerald-400">+${calcMetrics.profitTp3.toFixed(1)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Free Gemini AI Second-Opinion Crypto Audit */}
              <AiCryptoInsightCard
                symbol={analysis.symbol}
                timeframe={timeframe}
                lang={lang}
                autoTriggerToken={aiTriggerToken}
              />

              {/* Aggregated Crypto Social Sentiment Card */}
              <SocialSentimentCard
                symbol={analysis.symbol}
                techDirection={analysis.direction}
                lang={lang}
              />

              {/* Live Orderbook Depth & Whale Tape */}
              {analysis.orderBook && (
                <div className="tp-panel rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                      {t.orderBookTitle}
                    </h2>
                    <span className="text-xs font-mono-num text-slate-500 shrink-0 whitespace-nowrap">
                      {t.imbalance}: {analysis.orderBook.imbalanceRatio}x
                    </span>
                  </div>

                  {/* Bid vs Ask Split Meter */}
                  {(() => {
                    const totalDepth = Math.max(
                      1,
                      analysis.orderBook.bidDepthUsd + analysis.orderBook.askDepthUsd,
                    );
                    const bidPct = (analysis.orderBook.bidDepthUsd / totalDepth) * 100;
                    return (
                      <div className="h-1.5 w-full rounded-full bg-rose-500/25 overflow-hidden flex" dir="ltr">
                        <div className="h-full bg-emerald-500" style={{ width: `${bidPct}%` }} />
                        <div className="h-full bg-rose-500" style={{ width: `${100 - bidPct}%` }} />
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono-num">
                    <div>
                      <div className="text-[11px] text-slate-400">{t.bidDepth}</div>
                      <div className="font-semibold text-emerald-500">
                        {formatCompactUsd(analysis.orderBook.bidDepthUsd)}
                      </div>
                      {analysis.orderBook.largestBidWall && (
                        <div className="text-[11px] text-slate-500">
                          {t.largestBid}: ${formatPrice(analysis.orderBook.largestBidWall.price)}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t.askDepth}</div>
                      <div className="font-semibold text-rose-500">
                        {formatCompactUsd(analysis.orderBook.askDepthUsd)}
                      </div>
                      {analysis.orderBook.largestAskWall && (
                        <div className="text-[11px] text-slate-500">
                          {t.largestAsk}: ${formatPrice(analysis.orderBook.largestAskWall.price)}
                        </div>
                      )}
                    </div>
                  </div>

                  {analysis.recentTrades.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
                      <div className="text-[11px] font-semibold text-slate-500 mb-1.5">{t.recentTrades}</div>
                      <div className="space-y-1 max-h-36 overflow-y-auto text-[11px] font-mono-num">
                        {analysis.recentTrades.slice(0, 8).map((tr, idx) => (
                          <div key={`${tr.time}-${idx}`} className="flex items-center justify-between">
                            <span className={tr.isBuyerMaker ? 'text-rose-500' : 'text-emerald-500'}>
                              ${formatPrice(tr.price)}
                            </span>
                            <span className="text-slate-600 dark:text-slate-300">
                              {formatCompactUsd(tr.quoteUsd)}
                            </span>
                            <span className="text-slate-400">{formatTime(tr.time)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Estimated Liquidation Clusters (Stop-Hunt Pools) */}
              {liquidationClusters.length > 0 && (
                <div data-testid="liquidation-clusters-card" className="tp-panel rounded-xl p-4 space-y-3">
                  <div className="pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
                    <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                      <Flame className="w-4 h-4 text-amber-500 shrink-0" />
                      <h2>{t.liqClustersTitle}</h2>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {t.liqClustersSub}
                    </p>
                  </div>

                  <div className="space-y-1.5 text-xs font-mono-num">
                    {liquidationClusters.map((cl) => {
                      const isShortLiq = cl.side === 'SHORT_LIQ';
                      return (
                        <div key={cl.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800/60 last:border-b-0">
                          <div className="flex items-center gap-1.5 font-sans">
                            <span className={`font-bold ${isShortLiq ? 'text-rose-500' : 'text-emerald-500'}`}>
                              {isShortLiq ? t.liqShortPool : t.liqLongPool}
                            </span>
                            <span dir="ltr" className="font-mono-num text-[11px] text-slate-400">
                              {cl.leverageTier}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5" dir="ltr">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              ${formatPrice(cl.price)}
                            </span>
                            <span className={`text-[11px] font-semibold ${cl.distancePct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {cl.distancePct >= 0 ? '+' : ''}{cl.distancePct}%
                            </span>
                            <div className="w-10 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full ${isShortLiq ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                style={{ width: `${cl.intensity}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Historical Klines Backtest + Trade Replay Log */}
              <div className="tp-panel rounded-xl p-4 space-y-3" data-testid="analyzer-backtest-card">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
                  {t.backtestTitle}
                </h2>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono-num">
                  <div>
                    <div className="text-[11px] text-slate-400">{t.tradesCount}</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">{analysis.backtest.tradesCount}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">{t.winRate}</div>
                    <div className="font-bold text-sky-500">{analysis.backtest.winRatePct}%</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">{t.avgRr}</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">{analysis.backtest.avgRr}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">{t.netReturn}</div>
                    <div className={`font-bold ${analysis.backtest.netReturnPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {formatPercent(analysis.backtest.netReturnPct)}
                    </div>
                  </div>
                </div>

                {analysis.backtest.trades && analysis.backtest.trades.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {t.backtestReplayTitle} ({analysis.backtest.trades.length})
                    </div>
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 text-[11px] font-mono-num">
                      {analysis.backtest.trades.slice().reverse().slice(0, 10).map((tr) => (
                        <div key={tr.id} className="py-1.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-bold ${tr.direction === 'LONG' ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {tr.direction}
                            </span>
                            <span className="text-slate-400" dir="ltr">
                              ${formatPrice(tr.entryPrice)} → ${formatPrice(tr.exitPrice)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0" dir="ltr">
                            <span className={`font-bold ${tr.outcome === 'WIN' ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {tr.rMultiple >= 0 ? `+${tr.rMultiple}R` : `${tr.rMultiple}R`}
                            </span>
                            <span className="text-slate-400">
                              {tr.pnlPct >= 0 ? `+${tr.pnlPct}%` : `${tr.pnlPct}%`}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};
