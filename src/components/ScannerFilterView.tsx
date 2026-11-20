import React from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { translations } from '../i18n/translations';
import type { Language } from '../types/futures';
import {
  type AdvancedScannerFilters,
  type FundingBiasMode,
  type ProximityFilterMode,
  type RsiFilterMode,
  countActiveAdvancedFilters,
} from '../utils/scannerFilters';

interface ScannerFilterViewProps {
  filters: AdvancedScannerFilters;
  onChange: (next: AdvancedScannerFilters) => void;
  onReset: () => void;
  matchedCount: number;
  totalCount: number;
  lang: Language;
}

export const ScannerFilterView: React.FC<ScannerFilterViewProps> = ({
  filters,
  onChange,
  onReset,
  matchedCount,
  totalCount,
  lang,
}) => {
  const t = translations[lang];
  const activeCount = countActiveAdvancedFilters(filters);

  const isRsi70Preset = filters.rsiCondition === 'OVERBOUGHT_70';
  const isVol200Preset = filters.minVolumeRatio === 2.0;
  const isNearSupportPreset = filters.proximityFilter === 'NEAR_SUPPORT';
  const isMtfSqueezePreset = filters.onlyTtmSqueeze && filters.minAlignedTimeframes >= 2;

  const update = (patch: Partial<AdvancedScannerFilters>) => {
    onChange({ ...filters, ...patch });
  };

  return (
    <div
      className="tp-panel rounded-xl p-4 space-y-4"
      data-testid="scanner-filter-view"
    >
      {/* Header Row: Title, Live Match Count, Quick Presets & Reset */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SlidersHorizontal className="w-4 h-4 text-sky-500 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {t.scannerFilterTitle}
            </h2>
            <span
              className="text-xs font-mono-num font-semibold text-sky-600 dark:text-sky-400"
              data-testid="scanner-filter-match-count"
            >
              {t.scannerFilterMatched}: {matchedCount} / {totalCount}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t.scannerFilterSub}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="preset-rsi-70"
            aria-pressed={isRsi70Preset}
            onClick={() =>
              update({ rsiCondition: isRsi70Preset ? 'ANY' : 'OVERBOUGHT_70' })
            }
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap min-h-[32px] ${
              isRsi70Preset
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
            }`}
          >
            {t.scannerFilterPresetRsi70}
          </button>

          <button
            type="button"
            data-testid="preset-vol-200"
            aria-pressed={isVol200Preset}
            onClick={() =>
              update({ minVolumeRatio: isVol200Preset ? 0 : 2.0 })
            }
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap min-h-[32px] ${
              isVol200Preset
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
            }`}
          >
            {t.scannerFilterPresetVol200}
          </button>

          <button
            type="button"
            data-testid="preset-near-support"
            aria-pressed={isNearSupportPreset}
            onClick={() =>
              update({
                proximityFilter: isNearSupportPreset ? 'ANY' : 'NEAR_SUPPORT',
              })
            }
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap min-h-[32px] ${
              isNearSupportPreset
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
            }`}
          >
            {t.scannerFilterPresetSupport}
          </button>

          <button
            type="button"
            data-testid="preset-mtf-squeeze"
            aria-pressed={isMtfSqueezePreset}
            onClick={() =>
              update(
                isMtfSqueezePreset
                  ? { onlyTtmSqueeze: false, minAlignedTimeframes: 0 }
                  : { onlyTtmSqueeze: true, minAlignedTimeframes: 2 },
              )
            }
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap min-h-[32px] ${
              isMtfSqueezePreset
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 hover:border-sky-500 hover:text-sky-500'
            }`}
          >
            {t.scannerFilterPresetMtfSqueeze}
          </button>

          <button
            type="button"
            data-testid="filter-ttm-squeeze"
            aria-pressed={filters.onlyTtmSqueeze}
            onClick={() => update({ onlyTtmSqueeze: !filters.onlyTtmSqueeze })}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap min-h-[32px] ${
              filters.onlyTtmSqueeze
                ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 hover:border-amber-500/60'
            }`}
          >
            {t.scannerFilterSqueezeOnly}
          </button>

          {activeCount > 0 && (
            <button
              type="button"
              data-testid="scanner-filter-reset"
              onClick={onReset}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-semibold hover:bg-rose-500/20 transition-colors whitespace-nowrap min-h-[32px]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t.scannerFilterReset}</span>
            </button>
          )}
        </div>
      </div>

      {/* Technical Filter Controls Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* 1. RSI (14) Regime */}
        <div className="space-y-1.5">
          <label
            htmlFor="filter-rsi-select"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            {t.scannerFilterRsiLabel}
          </label>
          <select
            id="filter-rsi-select"
            data-testid="filter-rsi-select"
            value={filters.rsiCondition}
            onChange={(e) => update({ rsiCondition: e.target.value as RsiFilterMode })}
            className="w-full rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 min-h-[38px]"
          >
            <option value="ANY">{t.scannerFilterRsiAny}</option>
            <option value="OVERBOUGHT_70">{t.scannerFilterRsiOverbought}</option>
            <option value="OVERSOLD_30">{t.scannerFilterRsiOversold}</option>
            <option value="BULL_ZONE">{t.scannerFilterRsiBull}</option>
            <option value="BEAR_ZONE">{t.scannerFilterRsiBear}</option>
            <option value="CUSTOM">{t.scannerFilterRsiCustom}</option>
          </select>

          {filters.rsiCondition === 'CUSTOM' && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <input
                type="number"
                min={0}
                max={100}
                aria-label="Min RSI"
                data-testid="filter-rsi-min"
                value={filters.rsiMin}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                  update({ rsiMin: val });
                }}
                className="w-full rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2 py-1 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
              <input
                type="number"
                min={0}
                max={100}
                aria-label="Max RSI"
                data-testid="filter-rsi-max"
                value={filters.rsiMax}
                onChange={(e) => {
                  const val = Math.max(0, Math.min(100, Number(e.target.value) || 100));
                  update({ rsiMax: val });
                }}
                className="w-full rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2 py-1 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          )}
        </div>

        {/* 2. Volume vs 20-bar Average */}
        <div className="space-y-1.5">
          <label
            htmlFor="filter-vol-select"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            {t.scannerFilterVolLabel}
          </label>
          <select
            id="filter-vol-select"
            data-testid="filter-vol-select"
            value={String(filters.minVolumeRatio)}
            onChange={(e) => update({ minVolumeRatio: Number(e.target.value) })}
            className="w-full rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 min-h-[38px]"
          >
            <option value="0">{t.scannerFilterVolAny}</option>
            <option value="1.5">{t.scannerFilterVol150}</option>
            <option value="2">{t.scannerFilterVol200}</option>
            <option value="3">{t.scannerFilterVol300}</option>
            <option value="5">{t.scannerFilterVol500}</option>
          </select>
        </div>

        {/* 3. Structural Price Proximity */}
        <div className="space-y-1.5">
          <label
            htmlFor="filter-proximity-select"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            {t.scannerFilterProxLabel}
          </label>
          <select
            id="filter-proximity-select"
            data-testid="filter-proximity-select"
            value={filters.proximityFilter}
            onChange={(e) =>
              update({ proximityFilter: e.target.value as ProximityFilterMode })
            }
            className="w-full rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 min-h-[38px]"
          >
            <option value="ANY">{t.scannerFilterProxAny}</option>
            <option value="NEAR_SUPPORT">{t.scannerFilterProxSupport}</option>
            <option value="NEAR_RESISTANCE">{t.scannerFilterProxResistance}</option>
            <option value="DISCOUNT_ZONE">{t.scannerFilterProxDiscount}</option>
          </select>

          {(filters.proximityFilter === 'NEAR_SUPPORT' ||
            filters.proximityFilter === 'NEAR_RESISTANCE') && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <label
                htmlFor="filter-proximity-pct"
                className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap"
              >
                {t.scannerFilterProxDist}
              </label>
              <input
                id="filter-proximity-pct"
                data-testid="filter-proximity-pct"
                type="number"
                step={0.5}
                min={0.5}
                max={10}
                value={filters.proximityThresholdPct}
                onChange={(e) => {
                  const val = Math.max(0.5, Math.min(10, Number(e.target.value) || 2.5));
                  update({ proximityThresholdPct: val });
                }}
                className="w-20 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2 py-1 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          )}
        </div>

        {/* 4. Minimum Confidence Floor */}
        <div className="space-y-1.5">
          <label
            htmlFor="filter-min-conf"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            {t.scannerFilterMinConf}
          </label>
          <select
            id="filter-min-conf"
            data-testid="filter-min-conf"
            value={String(filters.minConfidence)}
            onChange={(e) => update({ minConfidence: Number(e.target.value) })}
            className="w-full rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2.5 py-2 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 min-h-[38px]"
          >
            <option value="0">0%+</option>
            <option value="55">55%+</option>
            <option value="65">65%+</option>
            <option value="75">75%+</option>
            <option value="85">85%+</option>
          </select>
        </div>

        {/* 5. MTF Alignment & Funding Bias */}
        <div className="space-y-1.5">
          <label
            htmlFor="filter-mtf-select"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            {t.scannerFilterMtfLabel}
          </label>
          <select
            id="filter-mtf-select"
            data-testid="filter-mtf-select"
            value={String(filters.minAlignedTimeframes)}
            onChange={(e) => update({ minAlignedTimeframes: Number(e.target.value) })}
            className="w-full rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2.5 py-2 text-xs font-mono-num text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 min-h-[38px]"
          >
            <option value="0">0/3+</option>
            <option value="1">1/3+</option>
            <option value="2">2/3+</option>
            <option value="3">3/3</option>
          </select>
        </div>

        {/* 6. Funding Bias */}
        <div className="space-y-1.5">
          <label
            htmlFor="filter-funding-select"
            className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400"
          >
            {t.scannerFilterFundingLabel}
          </label>
          <select
            id="filter-funding-select"
            data-testid="filter-funding-select"
            value={filters.fundingBias}
            onChange={(e) => update({ fundingBias: e.target.value as FundingBiasMode })}
            className="w-full rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B111E] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500 min-h-[38px]"
          >
            <option value="ANY">{t.scannerFilterFundingAny}</option>
            <option value="NEGATIVE">{t.scannerFilterFundingNeg}</option>
            <option value="POSITIVE">{t.scannerFilterFundingPos}</option>
          </select>
        </div>
      </div>
    </div>
  );
};
