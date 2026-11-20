import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  Bot,
  CheckCircle2,
  Crosshair,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { getDirectionLabel, getPhaseLabel, translations } from '../i18n/translations';
import type { Language, ScannerOpportunity, SignalQualificationSummary } from '../types/futures';
import { formatFunding, formatPercent, formatPrice } from '../utils/formatters';
import { getPairAssets } from '../utils/futuresContracts';
import { evaluateSignalQualification } from '../utils/signalQualification';

interface SignalsViewProps {
  opportunities: ScannerOpportunity[];
  minConfidence: number;
  lang: Language;
  loggedSymbols?: Set<string>;
  onSelectSymbol: (symbol: string) => void;
  onSelectSymbolWithAi?: (symbol: string) => void;
  onLogSignal?: (opp: ScannerOpportunity) => void;
}

interface QualifiedEntry {
  opp: ScannerOpportunity;
  qual: SignalQualificationSummary;
}

export const SignalsView: React.FC<SignalsViewProps> = ({
  opportunities,
  minConfidence,
  lang,
  loggedSymbols,
  onSelectSymbol,
  onSelectSymbolWithAi,
  onLogSignal,
}) => {
  const t = translations[lang];
  const [sideFilter, setSideFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [minCriteria, setMinCriteria] = useState<5 | 6>(5);
  const [confFloor, setConfFloor] = useState<number>(minConfidence);
  const [limit, setLimit] = useState(60);

  const { qualifiedEntries, counts, filteredOutCount } = useMemo(() => {
    const passed: QualifiedEntry[] = [];
    let longCount = 0;
    let shortCount = 0;
    let rawDirectional = 0;

    for (const opp of opportunities) {
      if (opp.direction === 'NEUTRAL') continue;
      rawDirectional++;
      const qual = evaluateSignalQualification(opp, {
        minCriteriaRequired: minCriteria,
        minConfidence: confFloor,
      });
      if (!qual.qualified) continue;
      if (opp.direction === 'LONG') longCount++;
      else if (opp.direction === 'SHORT') shortCount++;
      passed.push({ opp, qual });
    }

    return {
      qualifiedEntries: passed,
      counts: { all: longCount + shortCount, long: longCount, short: shortCount },
      filteredOutCount: Math.max(0, rawDirectional - passed.length),
    };
  }, [opportunities, minCriteria, confFloor]);

  const signals = useMemo(() => {
    return qualifiedEntries
      .filter(({ opp }) => sideFilter === 'ALL' || opp.direction === sideFilter)
      .sort((a, b) => {
        const countDiff = b.qual.passedCount - a.qual.passedCount;
        if (countDiff !== 0) return countDiff;
        const scoreDiff = b.qual.compositeScore - a.qual.compositeScore;
        if (scoreDiff !== 0) return scoreDiff;
        return b.opp.riskReward2 - a.opp.riskReward2;
      });
  }, [qualifiedEntries, sideFilter]);

  const visibleSignals = signals.slice(0, limit);

  return (
    <section className="space-y-5">
      {/* Header & Single-Line Filter Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t.signalsTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t.signalsSubtitle}
          </p>
        </div>

        {/* Segmented Direction, Criteria Gate & Confidence Controls */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0C121E]">
            {([5, 6] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => {
                  setMinCriteria(tier);
                  setLimit(60);
                }}
                data-testid={`signals-mode-${tier}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                  minCriteria === tier
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>{tier === 5 ? t.signalsModeStandard : t.signalsModeSniper}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0C121E]">
            {(['ALL', 'LONG', 'SHORT'] as const).map((side) => {
              const count =
                side === 'ALL' ? counts.all : side === 'LONG' ? counts.long : counts.short;
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => {
                    setSideFilter(side);
                    setLimit(60);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                    sideFilter === side
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span>
                    {side === 'ALL' ? t.allDirections : side === 'LONG' ? t.longOnly : t.shortOnly}
                  </span>
                  <span
                    className={`font-mono-num text-[11px] ${
                      sideFilter === side ? 'text-sky-100' : 'text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="tp-panel rounded-xl px-3.5 py-2 flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300 min-h-[44px]">
            <label htmlFor="signal-conf-range" className="whitespace-nowrap font-medium">
              {t.minConfLabel}:{' '}
              <span className="font-mono-num font-bold text-sky-600 dark:text-sky-400">
                {confFloor}%
              </span>
            </label>
            <input
              id="signal-conf-range"
              type="range"
              min={45}
              max={85}
              step={5}
              value={confFloor}
              onChange={(e) => {
                setConfFloor(Number(e.target.value));
                setLimit(60);
              }}
              className="w-24 sm:w-28 accent-sky-500 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Institutional Multi-Criteria Gate Banner */}
      <div
        data-testid="signals-gate-banner"
        className="tp-panel rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-gradient-to-r from-emerald-500/[0.06] via-sky-500/[0.04] to-transparent border-emerald-500/25"
      >
        <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200 leading-relaxed">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{t.signalsGateBanner.replace('{min}', String(minCriteria))}</span>
        </div>
        {filteredOutCount > 0 && (
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0">
            {t.signalsFilteredCount.replace('{count}', String(filteredOutCount))}
          </span>
        )}
      </div>

      {signals.length === 0 ? (
        <div className="tp-panel rounded-xl p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t.signalsEmptyStrict
              .replace('{min}', String(minCriteria))
              .replace('{conf}', String(confFloor))}
          </p>
          <button
            type="button"
            onClick={() => {
              setSideFilter('ALL');
              setMinCriteria(5);
              setConfFloor(50);
            }}
            className="mt-4 px-4 py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500"
          >
            {t.resetFilters}
          </button>
        </div>
      ) : (
        /* Distinct Framed Signal Cards Grid */
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-testid="signals-list">
          {visibleSignals.map(({ opp: sig, qual }) => {
            const isLong = sig.direction === 'LONG';
            const isLogged = loggedSymbols?.has(sig.symbol);
            const { quoteAsset } = getPairAssets(sig.symbol);
            const minLvl = Math.min(sig.stopLoss, sig.tp3);
            const maxLvl = Math.max(sig.stopLoss, sig.tp3);
            const span = Math.max(1e-9, maxLvl - minLvl);
            const entryPct = Math.max(6, Math.min(94, ((sig.optimalEntry - minLvl) / span) * 100));
            const patternText = lang === 'fa' ? sig.topPatternFa : sig.topPatternEn;

            return (
              <article
                key={sig.symbol}
                data-testid="signal-card"
                className={`relative overflow-hidden rounded-xl border transition-all duration-150 flex flex-col justify-between bg-white dark:bg-[#0B1221] ${
                  isLong
                    ? 'border-emerald-500/35 dark:border-emerald-400/30 hover:border-emerald-500/70 shadow-[0_2px_14px_-6px_rgba(16,185,129,0.22)]'
                    : 'border-rose-500/35 dark:border-rose-400/30 hover:border-rose-500/70 shadow-[0_2px_14px_-6px_rgba(244,63,94,0.22)]'
                }`}
              >
                {/* Top Directional Accent Hairline */}
                <div
                  aria-hidden="true"
                  className={`h-[2px] w-full ${
                    isLong
                      ? 'bg-gradient-to-r from-emerald-500 via-emerald-400/50 to-transparent'
                      : 'bg-gradient-to-r from-rose-500 via-rose-400/50 to-transparent'
                  }`}
                />

                {/* Card Header Band */}
                <div
                  className={`px-4 py-3 border-b flex items-start justify-between gap-3 ${
                    isLong
                      ? 'border-emerald-500/15 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.045]'
                      : 'border-rose-500/15 bg-rose-500/[0.04] dark:bg-rose-500/[0.045]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isLong ? (
                        <ArrowUpRight className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4 text-rose-500 shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectSymbol(sig.symbol)}
                        className="text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100 hover:text-sky-500 transition-colors"
                      >
                        {sig.baseAsset}
                        <span className="text-xs font-normal text-slate-400">/{quoteAsset}</span>
                      </button>
                      <span
                        className={`text-xs font-bold whitespace-nowrap ${
                          isLong
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {getDirectionLabel(sig.direction, lang)}
                      </span>
                      <span className="text-slate-400" aria-hidden="true">·</span>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {getPhaseLabel(sig.phase, lang)}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span dir="ltr" className="font-mono-num font-semibold text-slate-800 dark:text-slate-200 shrink-0">
                        ${formatPrice(sig.lastPrice)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        dir="ltr"
                        className={`font-mono-num font-semibold shrink-0 ${
                          sig.priceChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        {formatPercent(sig.priceChangePct)}
                      </span>
                      {typeof sig.alignedTimeframes === 'number' && sig.alignedTimeframes > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span dir="ltr" className="font-mono-num font-semibold text-sky-600 dark:text-sky-400 shrink-0">
                            MTF {sig.alignedTimeframes}/3
                          </span>
                        </>
                      )}
                    </div>
                    {patternText && (
                      <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 line-clamp-1">
                        {patternText}
                      </p>
                    )}
                  </div>

                  {/* Reliability Grade + Criteria Count + Confidence */}
                  <div className="flex items-start gap-3 shrink-0">
                    <div className="text-end">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {t.alertsGradeLabel}
                      </div>
                      <div
                        data-testid="signal-grade-score"
                        className="font-mono-num text-sm font-extrabold text-amber-500 leading-tight"
                      >
                        {qual.grade}{' '}
                        <span className="text-xs text-emerald-500">
                          {qual.passedCount}/{qual.totalCount}
                        </span>
                      </div>
                    </div>

                    <div className="text-end">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {t.confidence}
                      </div>
                      <div
                        className={`text-lg font-extrabold font-mono-num leading-tight ${
                          isLong
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {sig.confidence}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Body: Trade Plan + Geometry Track + 7-Criteria Scorecard */}
                <div className="px-4 py-3.5 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-2.5 gap-y-2">
                    <div className="col-span-2 sm:col-span-1 min-w-0 flex items-center justify-between sm:block rounded-lg bg-slate-50/70 dark:bg-slate-900/45 sm:bg-transparent px-2.5 py-1.5 sm:p-0">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                        {t.entry}
                      </div>
                      <div dir="ltr" className="sm:mt-0.5 font-mono-num text-xs sm:text-[13px] font-bold text-sky-600 dark:text-sky-400 truncate text-start">
                        ${formatPrice(sig.optimalEntry)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                        {t.stopLoss}
                      </div>
                      <div dir="ltr" className="mt-0.5 font-mono-num text-xs sm:text-[13px] font-bold text-rose-600 dark:text-rose-400 truncate text-start">
                        ${formatPrice(sig.stopLoss)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                        {t.tp1}
                      </div>
                      <div dir="ltr" className="mt-0.5 font-mono-num text-xs sm:text-[13px] font-bold text-emerald-600 dark:text-emerald-400 truncate text-start">
                        ${formatPrice(sig.tp1)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                        {t.tp2}
                      </div>
                      <div dir="ltr" className="mt-0.5 font-mono-num text-xs sm:text-[13px] font-bold text-emerald-500 truncate text-start">
                        ${formatPrice(sig.tp2)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                        {t.tp3}
                      </div>
                      <div dir="ltr" className="mt-0.5 font-mono-num text-xs sm:text-[13px] font-bold text-emerald-400 truncate text-start">
                        ${formatPrice(sig.tp3)}
                      </div>
                    </div>
                  </div>

                  {/* Proportional SL <-> Entry <-> TP3 Geometry Track */}
                  <div
                    className="relative h-1.5 rounded-full bg-slate-100 dark:bg-slate-800/90 overflow-hidden"
                    dir="ltr"
                  >
                    <div
                      className="absolute inset-y-0 bg-rose-500/45"
                      style={{
                        left: isLong ? '0%' : `${entryPct}%`,
                        width: isLong ? `${entryPct}%` : `${100 - entryPct}%`,
                      }}
                    />
                    <div
                      className="absolute inset-y-0 bg-emerald-500/65"
                      style={{
                        left: isLong ? `${entryPct}%` : '0%',
                        width: isLong ? `${100 - entryPct}%` : `${entryPct}%`,
                      }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-1 bg-sky-400"
                      style={{ left: `calc(${entryPct}% - 2px)` }}
                    />
                  </div>

                  {/* Compact 7-Criteria Verification Matrix (Zero Pills) */}
                  <div
                    data-testid="signal-criteria-matrix"
                    className="pt-2 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-[11px]"
                  >
                    {qual.criteria.map((c) => (
                      <div
                        key={c.id}
                        title={lang === 'fa' ? c.detailFa : c.detailEn}
                        className="flex items-center gap-1 min-w-0"
                      >
                        {c.passed ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="w-3 h-3 text-slate-400 dark:text-slate-600 shrink-0" />
                        )}
                        <span
                          className={`truncate ${
                            c.passed
                              ? 'text-slate-700 dark:text-slate-200 font-medium'
                              : 'text-slate-400 dark:text-slate-500 line-through'
                          }`}
                        >
                          {lang === 'fa' ? c.labelFa : c.labelEn}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Card Footer: Risk Telemetry + Action Buttons */}
                <div className="px-4 py-2.5 border-t border-slate-200/70 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/35 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      {t.rr}:{' '}
                      <strong className="font-mono-num text-slate-800 dark:text-slate-200">
                        1:{sig.riskReward2.toFixed(1)}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t.leverage}:{' '}
                      <strong className="font-mono-num text-slate-800 dark:text-slate-200">
                        {sig.suggestedMaxLeverage}x
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">
                      FR {formatFunding(sig.fundingRate)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ms-auto">
                    {onSelectSymbolWithAi && (
                      <button
                        type="button"
                        onClick={() => onSelectSymbolWithAi(sig.symbol)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-400 text-xs font-semibold hover:bg-sky-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
                      >
                        <Bot className="w-3.5 h-3.5" />
                        <span>{t.signalsAiAnalyzeBtn}</span>
                      </button>
                    )}

                    {onLogSignal && (
                      <button
                        type="button"
                        onClick={() => onLogSignal(sig)}
                        disabled={isLogged}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
                          isLogged
                            ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                            : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
                        }`}
                      >
                        <BookOpenCheck className="w-3.5 h-3.5" />
                        <span>{isLogged ? t.loggedDone : t.logToJournal}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectSymbol(sig.symbol)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      <span>{t.analyzeBtn}</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {signals.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono-num">
            {t.showingRows} {visibleSignals.length} {t.ofRows} {signals.length}
          </span>
          {visibleSignals.length < signals.length && (
            <button
              type="button"
              onClick={() => setLimit((prev) => prev + 60)}
              className="tp-panel px-4 py-2 rounded-lg text-slate-700 dark:text-slate-200 font-semibold hover:border-sky-500 hover:text-sky-500 transition-colors min-h-[38px]"
            >
              {t.loadMore} ({signals.length - visibleSignals.length})
            </button>
          )}
        </div>
      )}
    </section>
  );
};
