import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { translations } from '../i18n/translations';
import type { AnalysisResult, Language } from '../types/futures';
import { formatCompactUsd, formatPrice } from '../utils/formatters';
import { computeVolumeProfile, type VolumeProfileBin } from '../utils/volumeProfile';

interface VolumeProfilePanelProps {
  analysis: AnalysisResult;
  livePrice: number;
  lang: Language;
}

type LookbackOption = 'ALL' | 80 | 40;

export const VolumeProfilePanel: React.FC<VolumeProfilePanelProps> = ({
  analysis,
  livePrice,
  lang,
}) => {
  const t = translations[lang];
  const [lookback, setLookback] = useState<LookbackOption>('ALL');
  const [activeBinIdx, setActiveBinIdx] = useState<number | null>(null);

  const effectivePrice = livePrice > 0 ? livePrice : analysis.lastPrice;

  const profile = useMemo(
    () =>
      computeVolumeProfile(analysis.candles, effectivePrice, {
        binsCount: 22,
        valueAreaRatio: 0.7,
        lookbackBars: lookback === 'ALL' ? undefined : lookback,
      }),
    [analysis.candles, effectivePrice, lookback],
  );

  const inspectedBin: VolumeProfileBin | null = useMemo(() => {
    if (profile.bins.length === 0) return null;
    if (activeBinIdx !== null) {
      const found = profile.bins.find((b) => b.index === activeBinIdx);
      if (found) return found;
    }
    return profile.bins.find((b) => b.isPoc) ?? profile.bins[0];
  }, [profile.bins, activeBinIdx]);

  const strongestSupport = profile.supportLevels.find((l) => l.kind === 'HVN_SUPPORT') ?? profile.supportLevels[0];
  const strongestResistance =
    profile.resistanceLevels.find((l) => l.kind === 'HVN_RESISTANCE') ?? profile.resistanceLevels[0];

  const distPct = (levelPrice: number) => {
    if (effectivePrice <= 0) return '0.0%';
    const pct = ((levelPrice - effectivePrice) / effectivePrice) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  };

  const getRoleLabel = (bin: VolumeProfileBin) => {
    if (bin.role === 'POC') return 'POC';
    if (bin.role === 'RESISTANCE_HVN') return t.vpKeyResistance;
    if (bin.role === 'SUPPORT_HVN') return t.vpKeySupport;
    if (bin.role === 'LVN') return t.vpLowLiquidity;
    return bin.inValueArea ? t.vpValueAreaLabel : t.vpSubtitle;
  };

  const lookbackButtons: { id: LookbackOption; label: string }[] = [
    { id: 'ALL', label: `${t.vpAllBars} (${analysis.candles.length})` },
    { id: 80, label: t.vpRecent80 },
    { id: 40, label: t.vpRecent40 },
  ];

  return (
    <div
      data-testid="volume-profile-panel"
      className="tp-panel rounded-xl p-4 space-y-3.5"
    >
      {/* Header & Lookback Window Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="w-4 h-4 text-sky-500 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
            {t.volumeProfileTitle}
          </h2>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#070B13] border border-slate-200/70 dark:border-slate-800/80 p-0.5 rounded-lg">
          {lookbackButtons.map((btn) => (
            <button
              key={String(btn.id)}
              type="button"
              onClick={() => {
                setLookback(btn.id);
                setActiveBinIdx(null);
              }}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-[28px] ${
                lookback === btn.id
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {profile.bins.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">{t.vpNoData}</p>
      ) : (
        <>
          {/* Key Derived S/R Strip (Unboxed Tabular Numerals) */}
          <div
            data-testid="volume-profile-levels"
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pb-3 border-b border-slate-100 dark:border-slate-800/80 text-xs"
          >
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.vpVahLabel}</div>
              <div dir="ltr" className="mt-0.5 font-mono-num font-bold text-rose-500">
                ${formatPrice(profile.vahPrice)}{' '}
                <span className="text-[10px] font-normal text-slate-400">({distPct(profile.vahPrice)})</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.vpPocLabel}</div>
              <div dir="ltr" className="mt-0.5 font-mono-num font-bold text-amber-500">
                ${formatPrice(profile.pocPrice)}{' '}
                <span className="text-[10px] font-normal text-slate-400">({distPct(profile.pocPrice)})</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.vpValLabel}</div>
              <div dir="ltr" className="mt-0.5 font-mono-num font-bold text-emerald-500">
                ${formatPrice(profile.valPrice)}{' '}
                <span className="text-[10px] font-normal text-slate-400">({distPct(profile.valPrice)})</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.vpKeyResistance}</div>
              <div dir="ltr" className="mt-0.5 font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                {strongestResistance ? `$${formatPrice(strongestResistance.price)}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.vpKeySupport}</div>
              <div dir="ltr" className="mt-0.5 font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                {strongestSupport ? `$${formatPrice(strongestSupport.price)}` : '—'}
              </div>
            </div>
          </div>

          {/* Interactive Inspected Bin Telemetry Bar (Clean Unboxed Inline Metadata) */}
          {inspectedBin && (
            <div
              data-testid="vp-inspected-readout"
              className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-num text-slate-600 dark:text-slate-300"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span
                  className={`font-semibold ${
                    inspectedBin.isPoc
                      ? 'text-amber-500'
                      : inspectedBin.role === 'RESISTANCE_HVN'
                        ? 'text-rose-500'
                        : inspectedBin.role === 'SUPPORT_HVN'
                          ? 'text-emerald-500'
                          : 'text-sky-500'
                  }`}
                >
                  {getRoleLabel(inspectedBin)}
                </span>
                <span aria-hidden="true">·</span>
                <span dir="ltr">
                  ${formatPrice(inspectedBin.priceLow)} – ${formatPrice(inspectedBin.priceHigh)}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatCompactUsd(inspectedBin.totalVolumeUsd)}</span>
                <span aria-hidden="true">({inspectedBin.volumeSharePct}%)</span>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-emerald-500">
                  <span dir="ltr">{Math.round(inspectedBin.buyPct)}%</span> {t.vpBuyWord}
                </span>
                <span aria-hidden="true">/</span>
                <span className="text-rose-500">
                  <span dir="ltr">{Math.round(100 - inspectedBin.buyPct)}%</span> {t.vpSellWord}
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-slate-400">
                  {t.vpTotalVol}:{' '}
                  <span dir="ltr" className="inline-block">
                    {formatCompactUsd(profile.totalVolumeUsd)}
                  </span>{' '}
                  <span dir="ltr" className="inline-block">
                    ({profile.valueAreaVolumePct}% VA)
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Vertical Price-by-Volume Histogram (LTR layout for strict price-ladder alignment) */}
          <div
            dir="ltr"
            data-testid="volume-profile-bins"
            className="space-y-0.5 pt-1"
            role="list"
            aria-label={t.volumeProfileTitle}
          >
            {profile.bins.map((bin) => {
              const buyWidth = (bin.volumePctOfMax * bin.buyPct) / 100;
              const sellWidth = Math.max(0, bin.volumePctOfMax - buyWidth);
              const isSelected = inspectedBin?.index === bin.index;

              return (
                <button
                  key={bin.index}
                  type="button"
                  role="listitem"
                  onMouseEnter={() => setActiveBinIdx(bin.index)}
                  onFocus={() => setActiveBinIdx(bin.index)}
                  onClick={() => setActiveBinIdx(bin.index)}
                  aria-label={`Price $${formatPrice(bin.midPrice)}, Volume ${formatCompactUsd(bin.totalVolumeUsd)}, ${bin.role}`}
                  className={`w-full grid grid-cols-[88px_1fr_72px] sm:grid-cols-[100px_1fr_84px] items-center gap-2 px-1.5 py-0.5 rounded text-left transition-colors ${
                    bin.isPoc
                      ? 'bg-amber-500/12 hover:bg-amber-500/18'
                      : isSelected
                        ? 'bg-sky-500/10'
                        : bin.inValueArea
                          ? 'bg-slate-500/[0.03] hover:bg-slate-500/10'
                          : 'hover:bg-slate-500/10'
                  }`}
                >
                  {/* Price Tick Label */}
                  <span
                    className={`font-mono-num text-[11px] tabular-nums truncate ${
                      bin.isPoc
                        ? 'font-bold text-amber-500'
                        : bin.isCurrentPriceBin
                          ? 'font-bold text-sky-500'
                          : bin.role === 'RESISTANCE_HVN'
                            ? 'font-semibold text-rose-500 dark:text-rose-400'
                            : bin.role === 'SUPPORT_HVN'
                              ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {bin.isCurrentPriceBin ? '▸ ' : ''}
                    ${formatPrice(bin.midPrice)}
                  </span>

                  {/* Stacked Buy (Emerald) + Sell (Rose) Volume Bar */}
                  <div className="relative h-3.5 w-full rounded-xs bg-slate-100 dark:bg-slate-800/60 overflow-hidden flex items-center">
                    <div
                      className={`h-full transition-all duration-150 ${
                        bin.inValueArea ? 'bg-emerald-500/80' : 'bg-emerald-500/45'
                      }`}
                      style={{ width: `${buyWidth}%` }}
                    />
                    <div
                      className={`h-full transition-all duration-150 ${
                        bin.inValueArea ? 'bg-rose-500/80' : 'bg-rose-500/45'
                      }`}
                      style={{ width: `${sellWidth}%` }}
                    />
                    {bin.isPoc && (
                      <span className="absolute right-1.5 text-[9px] font-mono-num font-bold text-amber-500">
                        POC
                      </span>
                    )}
                  </div>

                  {/* Bin Volume USD + Role Indicator */}
                  <span className="font-mono-num text-[10px] text-right tabular-nums text-slate-500 dark:text-slate-400 truncate">
                    {formatCompactUsd(bin.totalVolumeUsd)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
