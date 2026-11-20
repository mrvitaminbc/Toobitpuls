import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { translations } from '../i18n/translations';
import type { AnalysisResult, Language, LiquidationCluster, Timeframe } from '../types/futures';
import {
  type ChartStyle,
  clampChartViewport,
  computeHeikinAshi,
  computeMacdSeries,
  formatChartAxisTime,
} from '../utils/chartMath';
import { formatCandleTime, formatCompactUsd, formatPercent, formatPrice } from '../utils/formatters';
import { getPairAssets } from '../utils/futuresContracts';

interface FuturesChartProps {
  analysis: AnalysisResult;
  livePrice?: number;
  timeframe: Timeframe;
  liquidationClusters?: LiquidationCluster[];
  loading?: boolean;
  lang: Language;
  onChangeTimeframe?: (tf: Timeframe) => void;
}

const CHART_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

export const FuturesChart: React.FC<FuturesChartProps> = ({
  analysis,
  livePrice,
  timeframe,
  liquidationClusters = [],
  loading,
  lang,
  onChangeTimeframe,
}) => {
  const t = translations[lang];
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles');
  const [showEma, setShowEma] = useState(true);
  const [showBb, setShowBb] = useState(true);
  const [showVwap, setShowVwap] = useState(false);
  const [showSr, setShowSr] = useState(true);
  const [showPlan, setShowPlan] = useState(true);
  const [showLiquidation, setShowLiquidation] = useState(false);
  const [showBacktestMarkers, setShowBacktestMarkers] = useState(false);
  const [lowerPane, setLowerPane] = useState<'volume' | 'rsi' | 'macd'>('volume');
  const [isExpanded, setIsExpanded] = useState(false);

  const [visibleCount, setVisibleCount] = useState<number>(90);
  const [rightOffset, setRightOffset] = useState<number>(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ active: boolean; startX: number; startOffset: number }>({
    active: false,
    startX: 0,
    startOffset: 0,
  });

  // Reset pan to latest candle when switching symbol or timeframe
  useEffect(() => {
    setRightOffset(0);
    setHoverIdx(null);
  }, [analysis.symbol, timeframe]);

  // Close expanded chart on Escape
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isExpanded]);

  const rawCandles = analysis.candles;
  const displayCandlesFull = useMemo(
    () => (chartStyle === 'heikin' ? computeHeikinAshi(rawCandles) : rawCandles),
    [rawCandles, chartStyle],
  );

  const macdFull = useMemo(
    () => computeMacdSeries(rawCandles.map((c) => c.close)),
    [rawCandles],
  );

  const viewport = useMemo(
    () =>
      clampChartViewport({
        totalCandles: displayCandlesFull.length,
        visibleCount,
        rightOffset,
      }),
    [displayCandlesFull.length, visibleCount, rightOffset],
  );

  // Attach non-passive wheel listener on chart container so wheel zoom doesn't scroll page
  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 12 : -12;
      setVisibleCount((prev) =>
        clampChartViewport({
          totalCandles: displayCandlesFull.length,
          visibleCount: prev + delta,
          rightOffset,
        }).visibleCount,
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [displayCandlesFull.length, rightOffset]);

  const sliceData = useMemo(() => {
    const { startIdx, endIdx } = viewport;
    const candles = displayCandlesFull.slice(startIdx, endIdx);
    const rawSlice = rawCandles.slice(startIdx, endIdx);
    const ema9 = analysis.series.ema9.slice(startIdx, endIdx);
    const ema21 = analysis.series.ema21.slice(startIdx, endIdx);
    const ema50 = analysis.series.ema50.slice(startIdx, endIdx);
    const bbUpper = analysis.series.bbUpper.slice(startIdx, endIdx);
    const bbLower = analysis.series.bbLower.slice(startIdx, endIdx);
    const vwap = analysis.series.vwap.slice(startIdx, endIdx);
    const rsi = analysis.series.rsi.slice(startIdx, endIdx);
    const macd = macdFull.slice(startIdx, endIdx);
    return { candles, rawSlice, ema9, ema21, ema50, bbUpper, bbLower, vwap, rsi, macd };
  }, [displayCandlesFull, rawCandles, analysis.series, macdFull, viewport]);

  const width = 960;
  const priceTop = 18;
  const priceHeight = 288;
  const lowerTop = 324;
  const lowerHeight = 86;
  const axisBottomY = lowerTop + lowerHeight + 18;
  const totalHeight = axisBottomY + 10;
  const padLeft = 14;
  const padRight = 114;
  const plotW = width - padLeft - padRight;

  const currentLivePrice = livePrice && livePrice > 0 ? livePrice : analysis.lastPrice;

  const priceBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < sliceData.candles.length; i++) {
      const c = sliceData.candles[i];
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
      if (showBb) {
        const u = sliceData.bbUpper[i];
        const l = sliceData.bbLower[i];
        if (u !== null && u > max) max = u;
        if (l !== null && l < min) min = l;
      }
    }

    if (showPlan && analysis.tradePlan.action !== 'WAIT') {
      min = Math.min(min, analysis.tradePlan.stopLoss, analysis.tradePlan.tp1);
      max = Math.max(max, analysis.tradePlan.stopLoss, analysis.tradePlan.tp2);
    }

    if (currentLivePrice > 0 && rightOffset === 0) {
      min = Math.min(min, currentLivePrice);
      max = Math.max(max, currentLivePrice);
    }

    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return { min: 0, max: 1 };
    }
    const pad = (max - min) * 0.08;
    return { min: min - pad, max: max + pad };
  }, [sliceData, showBb, showPlan, analysis.tradePlan, currentLivePrice, rightOffset]);

  const maxVol = useMemo(() => {
    let m = 1;
    for (const c of sliceData.rawSlice) {
      const v = c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close;
      if (v > m) m = v;
    }
    return m;
  }, [sliceData.rawSlice]);

  const macdBounds = useMemo(() => {
    let maxAbs = 0.000001;
    for (const pt of sliceData.macd) {
      if (pt.macd !== null) maxAbs = Math.max(maxAbs, Math.abs(pt.macd));
      if (pt.signal !== null) maxAbs = Math.max(maxAbs, Math.abs(pt.signal));
      if (pt.hist !== null) maxAbs = Math.max(maxAbs, Math.abs(pt.hist));
    }
    return maxAbs * 1.15;
  }, [sliceData.macd]);

  const xForIdx = (i: number) => {
    const step = plotW / Math.max(1, sliceData.candles.length);
    return padLeft + i * step + step * 0.5;
  };

  const yForPrice = (p: number) => {
    const span = priceBounds.max - priceBounds.min || 1;
    return priceTop + (1 - (p - priceBounds.min) / span) * (priceHeight - 10);
  };

  const priceForY = (y: number) => {
    const span = priceBounds.max - priceBounds.min || 1;
    const ratio = 1 - (y - priceTop) / (priceHeight - 10);
    return priceBounds.min + ratio * span;
  };

  const buildPolyline = (arr: (number | null)[]) => {
    const pts: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === null) continue;
      pts.push(`${xForIdx(i).toFixed(1)},${yForPrice(v).toFixed(1)}`);
    }
    return pts.join(' ');
  };

  const bbChannelPolygon = useMemo(() => {
    if (!showBb) return '';
    const topPts: string[] = [];
    const botPts: string[] = [];
    for (let i = 0; i < sliceData.bbUpper.length; i++) {
      const u = sliceData.bbUpper[i];
      const l = sliceData.bbLower[i];
      if (u === null || l === null) continue;
      const x = xForIdx(i).toFixed(1);
      topPts.push(`${x},${yForPrice(u).toFixed(1)}`);
      botPts.unshift(`${x},${yForPrice(l).toFixed(1)}`);
    }
    if (topPts.length < 2) return '';
    return [...topPts, ...botPts].join(' ');
  }, [showBb, sliceData.bbUpper, sliceData.bbLower, priceBounds]);

  const areaPath = useMemo(() => {
    if (chartStyle !== 'area' || sliceData.candles.length < 2) return { line: '', fill: '' };
    const pts = sliceData.candles.map((c, i) => `${xForIdx(i).toFixed(1)},${yForPrice(c.close).toFixed(1)}`);
    const firstX = xForIdx(0).toFixed(1);
    const lastX = xForIdx(sliceData.candles.length - 1).toFixed(1);
    const baseY = (priceTop + priceHeight).toFixed(1);
    return {
      line: pts.join(' '),
      fill: `M ${firstX},${baseY} L ${pts.join(' L ')} L ${lastX},${baseY} Z`,
    };
  }, [chartStyle, sliceData.candles, priceBounds]);

  const stepW = plotW / Math.max(1, sliceData.candles.length);
  const candleW = Math.max(2, Math.min(11, stepW * 0.66));

  const activeIdx =
    hoverIdx !== null && hoverIdx < sliceData.candles.length
      ? hoverIdx
      : sliceData.candles.length - 1;
  const activeCandle = sliceData.candles[activeIdx];
  const activeRaw = sliceData.rawSlice[activeIdx];
  const activeRsi = sliceData.rsi[activeIdx];
  const activeMacd = sliceData.macd[activeIdx];

  const activeChangePct =
    activeRaw && activeRaw.open > 0
      ? ((activeRaw.close - activeRaw.open) / activeRaw.open) * 100
      : 0;

  const activeTakerPct = activeRaw
    ? activeRaw.quoteVolume > 0
      ? (activeRaw.takerBuyQuoteVol / activeRaw.quoteVolume) * 100
      : 50
    : 50;

  const priceTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let k = 0; k <= 5; k++) {
      ticks.push(priceBounds.min + ((priceBounds.max - priceBounds.min) * k) / 5);
    }
    return ticks;
  }, [priceBounds]);

  const timeTicks = useMemo(() => {
    const len = sliceData.candles.length;
    if (len < 2) return [];
    const count = Math.min(6, len);
    const indices: number[] = [];
    for (let k = 0; k < count; k++) {
      const idx = Math.round((k * (len - 1)) / Math.max(1, count - 1));
      if (!indices.includes(idx)) indices.push(idx);
    }
    return indices.map((idx) => ({
      idx,
      x: xForIdx(idx),
      label: formatChartAxisTime(sliceData.candles[idx].time, timeframe),
    }));
  }, [sliceData.candles, timeframe]);

  const overlayLines = useMemo(() => {
    const raw: { label: string; price: number; color: string; dashed: string }[] = [];
    if (showPlan && analysis.tradePlan.action !== 'WAIT') {
      raw.push(
        { label: 'ENTRY', price: analysis.tradePlan.optimalEntry, color: '#0EA5E9', dashed: '5 4' },
        { label: 'SL', price: analysis.tradePlan.stopLoss, color: '#EF4444', dashed: '5 4' },
        { label: 'TP1', price: analysis.tradePlan.tp1, color: '#10B981', dashed: '5 4' },
        { label: 'TP2', price: analysis.tradePlan.tp2, color: '#34D399', dashed: '5 4' },
      );
    }
    if (showSr) {
      if (analysis.indicators.resistance1 > 0) {
        raw.push({ label: 'R1', price: analysis.indicators.resistance1, color: '#F97316', dashed: '2 4' });
      }
      if (analysis.indicators.support1 > 0) {
        raw.push({ label: 'S1', price: analysis.indicators.support1, color: '#22C55E', dashed: '2 4' });
      }
    }
    if (showLiquidation && liquidationClusters.length > 0) {
      for (const cl of liquidationClusters) {
        raw.push({
          label: `${cl.side === 'SHORT_LIQ' ? 'SLIQ' : 'LLIQ'} ${cl.leverageTier}`,
          price: cl.price,
          color: cl.side === 'SHORT_LIQ' ? '#F43F5E' : '#14B8A6',
          dashed: '1 3',
        });
      }
    }
    return raw.filter((l) => l.price >= priceBounds.min && l.price <= priceBounds.max);
  }, [showPlan, showSr, showLiquidation, liquidationClusters, analysis.tradePlan, analysis.indicators, priceBounds]);

  const visibleBacktestTrades = useMemo(() => {
    if (!showBacktestMarkers || !analysis.backtest.trades?.length || sliceData.rawSlice.length === 0) {
      return [];
    }
    const timeToIdx = new Map<number, number>();
    sliceData.rawSlice.forEach((c, idx) => timeToIdx.set(c.time, idx));
    return analysis.backtest.trades
      .map((tr) => {
        const entryIdx = timeToIdx.get(tr.entryTime);
        const exitIdx = timeToIdx.get(tr.exitTime);
        if (entryIdx === undefined && exitIdx === undefined) return null;
        return {
          ...tr,
          entryIdx,
          exitIdx,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [showBacktestMarkers, analysis.backtest.trades, sliceData.rawSlice]);

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    if (dragStateRef.current.active) {
      const dxPx = e.clientX - dragStateRef.current.startX;
      const pxPerCandle = (rect.width * (plotW / width)) / Math.max(1, sliceData.candles.length);
      const candleShift = Math.round(dxPx / Math.max(3, pxPerCandle));
      const clamped = clampChartViewport({
        totalCandles: displayCandlesFull.length,
        visibleCount,
        rightOffset: dragStateRef.current.startOffset + candleShift,
      });
      setRightOffset(clamped.rightOffset);
      return;
    }

    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const svgY = ((e.clientY - rect.top) / rect.height) * totalHeight;
    if (svgX >= padLeft && svgX <= width - padRight && sliceData.candles.length > 0) {
      const idx = Math.max(
        0,
        Math.min(sliceData.candles.length - 1, Math.floor(((svgX - padLeft) / plotW) * sliceData.candles.length)),
      );
      setHoverIdx(idx);
      setHoverY(svgY >= priceTop && svgY <= priceTop + priceHeight ? svgY : null);
    } else {
      setHoverIdx(null);
      setHoverY(null);
    }
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startOffset: rightOffset,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    dragStateRef.current.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const handleZoom = (delta: number) => {
    setVisibleCount((prev) =>
      clampChartViewport({
        totalCandles: displayCandlesFull.length,
        visibleCount: prev + delta,
        rightOffset,
      }).visibleCount,
    );
  };

  const handleResetView = () => {
    setVisibleCount(90);
    setRightOffset(0);
    setHoverIdx(null);
  };

  const liveY = yForPrice(currentLivePrice);
  const showLiveLine =
    currentLivePrice >= priceBounds.min && currentLivePrice <= priceBounds.max;
  const lastRaw = sliceData.rawSlice[sliceData.rawSlice.length - 1];
  const liveIsBull = lastRaw ? currentLivePrice >= lastRaw.open : true;

  const hoverPrice = hoverY !== null ? priceForY(hoverY) : null;

  return (
    <div
      data-testid="pro-chart-container"
      className={
        isExpanded
          ? 'fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-50 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#090D16] p-4 shadow-2xl flex flex-col justify-between overflow-y-auto'
          : 'tp-panel rounded-xl p-4'
      }
    >
      {/* Top Exchange Chart Toolbar: Timeframes + Chart Styles + Zoom + Fullscreen */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
        {/* 9 Exchange Timeframes (1m -> 1M) */}
        <div
          data-testid="chart-timeframe-bar"
          className="flex items-center flex-wrap gap-0.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-[#070B13] p-0.5"
          dir="ltr"
        >
          {CHART_TIMEFRAMES.map((tf) => {
            const active = timeframe === tf;
            return (
              <button
                key={tf}
                type="button"
                data-testid={`chart-tf-${tf}`}
                onClick={() => onChangeTimeframe?.(tf)}
                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/70 dark:hover:bg-slate-800/80'
                }`}
              >
                {tf}
              </button>
            );
          })}
          {loading && (
            <span className="px-1.5 text-[10px] font-semibold text-sky-500 animate-pulse">...</span>
          )}
        </div>

        {/* Chart Type + Zoom + Expand */}
        <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-[#070B13] p-0.5">
            {(
              [
                { id: 'candles', label: t.chartStyleCandles },
                { id: 'hollow', label: t.chartStyleHollow },
                { id: 'heikin', label: t.chartStyleHeikin },
                { id: 'area', label: t.chartStyleArea },
              ] as { id: ChartStyle; label: string }[]
            ).map((st) => (
              <button
                key={st.id}
                type="button"
                data-testid={`chart-style-${st.id}`}
                onClick={() => setChartStyle(st.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  chartStyle === st.id
                    ? 'bg-slate-900 dark:bg-slate-700 text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => handleZoom(-20)}
            aria-label="Zoom in"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B13] text-slate-600 dark:text-slate-300 hover:border-sky-500 transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(20)}
            aria-label="Zoom out"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B13] text-slate-600 dark:text-slate-300 hover:border-sky-500 transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            aria-label={t.chartResetZoom}
            title={t.chartResetZoom}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B13] text-slate-600 dark:text-slate-300 hover:border-sky-500 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            aria-label={isExpanded ? t.chartExitFullscreen : t.chartFullscreen}
            title={isExpanded ? t.chartExitFullscreen : t.chartFullscreen}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070B13] text-slate-600 dark:text-slate-300 hover:border-sky-500 transition-colors"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Second Bar: OHLCV Telemetry + Overlays & Lower Pane Switches */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 py-2.5 border-b border-slate-100 dark:border-slate-800/80">
        {activeCandle && activeRaw && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono-num text-slate-600 dark:text-slate-300" dir="ltr">
            <span className="font-bold text-slate-900 dark:text-slate-100">
              {analysis.baseAsset}/{getPairAssets(analysis.symbol).quoteAsset} · {timeframe}
            </span>
            <span className="text-slate-400">{formatCandleTime(activeRaw.time)}</span>
            <span>O {formatPrice(activeRaw.open)}</span>
            <span>H {formatPrice(activeRaw.high)}</span>
            <span>L {formatPrice(activeRaw.low)}</span>
            <span className={activeRaw.close >= activeRaw.open ? 'text-emerald-500 font-semibold' : 'text-rose-500 font-semibold'}>
              C {formatPrice(activeRaw.close)} ({formatPercent(activeChangePct)})
            </span>
            <span>Vol {formatCompactUsd(activeRaw.quoteVolume)}</span>
            <span className={activeTakerPct >= 52 ? 'text-emerald-500' : activeTakerPct <= 48 ? 'text-rose-500' : 'text-slate-400'}>
              Buy {activeTakerPct.toFixed(0)}%
            </span>
            {activeRsi !== null && <span className="text-sky-500">RSI {activeRsi.toFixed(1)}</span>}
            {activeMacd?.macd !== null && activeMacd?.macd !== undefined && (
              <span className="text-purple-400">MACD {activeMacd.macd.toFixed(2)}</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1" dir="ltr">
          <button
            type="button"
            onClick={() => setShowEma((v) => !v)}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              showEma
                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent'
            }`}
          >
            EMA 9/21/50
          </button>
          <button
            type="button"
            onClick={() => setShowBb((v) => !v)}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              showBb
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent'
            }`}
          >
            Bollinger
          </button>
          <button
            type="button"
            onClick={() => setShowVwap((v) => !v)}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              showVwap
                ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent'
            }`}
          >
            VWAP
          </button>
          <button
            type="button"
            onClick={() => setShowSr((v) => !v)}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              showSr
                ? 'bg-orange-500/15 text-orange-500 border border-orange-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent'
            }`}
          >
            {t.srLevels}
          </button>
          <button
            type="button"
            onClick={() => setShowPlan((v) => !v)}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              showPlan
                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent'
            }`}
          >
            {t.tradePlanOverlay}
          </button>
          <button
            type="button"
            data-testid="chart-toggle-liq"
            onClick={() => setShowLiquidation((v) => !v)}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              showLiquidation
                ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent'
            }`}
          >
            {t.liqOverlayToggle}
          </button>
          <button
            type="button"
            data-testid="chart-toggle-bt"
            onClick={() => setShowBacktestMarkers((v) => !v)}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              showBacktestMarkers
                ? 'bg-sky-500/15 text-sky-500 border border-sky-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent'
            }`}
          >
            {t.backtestMarkersToggle}
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

          <button
            type="button"
            onClick={() => setLowerPane('volume')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              lowerPane === 'volume'
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t.volumePane}
          </button>
          <button
            type="button"
            onClick={() => setLowerPane('rsi')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              lowerPane === 'rsi'
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t.rsiPane}
          </button>
          <button
            type="button"
            data-testid="chart-pane-macd"
            onClick={() => setLowerPane('macd')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
              lowerPane === 'macd'
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t.macdPane}
          </button>
        </div>
      </div>

      {/* Main Interactive SVG Chart */}
      <div ref={chartBoxRef} className="mt-2 w-full overflow-hidden flex-1" dir="ltr">
        <svg
          ref={svgRef}
          data-testid="futures-chart-svg"
          viewBox={`0 0 ${width} ${totalHeight}`}
          className="w-full h-auto select-none cursor-crosshair touch-pan-y"
          onPointerMove={handleSvgPointerMove}
          onPointerDown={handleSvgPointerDown}
          onPointerUp={handleSvgPointerUp}
          onPointerCancel={handleSvgPointerUp}
          onMouseLeave={() => {
            setHoverIdx(null);
            setHoverY(null);
          }}
        >
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal Price Grid + Y-axis labels */}
          {priceTicks.map((tick, idx) => {
            const y = yForPrice(tick);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="currentColor"
                  className="text-slate-200 dark:text-slate-800/75"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={width - padRight + 8}
                  y={y + 4}
                  fontSize="10.5"
                  className="fill-slate-500 dark:fill-slate-400 font-mono-num"
                >
                  {formatPrice(tick)}
                </text>
              </g>
            );
          })}

          {/* Vertical Time Grid Lines + X-axis Time Labels */}
          {timeTicks.map((tk) => (
            <g key={tk.idx}>
              <line
                x1={tk.x}
                y1={priceTop}
                x2={tk.x}
                y2={lowerTop + lowerHeight}
                stroke="currentColor"
                className="text-slate-200/70 dark:text-slate-800/50"
                strokeDasharray="2 4"
                strokeWidth="1"
              />
              <text
                x={tk.x}
                y={axisBottomY}
                textAnchor="middle"
                fontSize="10"
                className="fill-slate-400 font-mono-num"
              >
                {tk.label}
              </text>
            </g>
          ))}

          {/* Bollinger Channel Fill + Lines */}
          {showBb && bbChannelPolygon && (
            <polygon points={bbChannelPolygon} fill="#F59E0B" fillOpacity="0.06" />
          )}
          {showBb && (
            <>
              <polyline
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.2"
                strokeOpacity="0.7"
                points={buildPolyline(sliceData.bbUpper)}
              />
              <polyline
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.2"
                strokeOpacity="0.7"
                points={buildPolyline(sliceData.bbLower)}
              />
            </>
          )}

          {/* VWAP */}
          {showVwap && (
            <polyline
              fill="none"
              stroke="#A855F7"
              strokeWidth="1.5"
              strokeDasharray="4 2"
              points={buildPolyline(sliceData.vwap)}
            />
          )}

          {/* EMAs */}
          {showEma && (
            <>
              <polyline fill="none" stroke="#38BDF8" strokeWidth="1.4" points={buildPolyline(sliceData.ema9)} />
              <polyline fill="none" stroke="#FBBF24" strokeWidth="1.4" points={buildPolyline(sliceData.ema21)} />
              <polyline fill="none" stroke="#94A3B8" strokeWidth="1.2" points={buildPolyline(sliceData.ema50)} />
            </>
          )}

          {/* Overlay Levels (Entry / SL / TP1 / TP2 / S1 / R1) */}
          {overlayLines.map((line) => {
            const y = yForPrice(line.price);
            return (
              <g key={line.label}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke={line.color}
                  strokeWidth="1.15"
                  strokeDasharray={line.dashed}
                  opacity="0.82"
                />
                <rect
                  x={width - padRight + 2}
                  y={y - 8.5}
                  width={108}
                  height={17}
                  rx={3}
                  fill={line.color}
                />
                <text
                  x={width - padRight + 6}
                  y={y + 3}
                  fontSize="9.5"
                  fontWeight="600"
                  fill="#ffffff"
                  className="font-mono-num"
                >
                  {line.label} {formatPrice(line.price)}
                </text>
              </g>
            );
          })}

          {/* Price Geometry: Area OR Candlesticks / Hollow / Heikin-Ashi */}
          {chartStyle === 'area' ? (
            <g>
              {areaPath.fill && <path d={areaPath.fill} fill="url(#areaGrad)" />}
              {areaPath.line && (
                <polyline fill="none" stroke="#0EA5E9" strokeWidth="2" points={areaPath.line} />
              )}
            </g>
          ) : (
            sliceData.candles.map((c, i) => {
              const x = xForIdx(i);
              const isBull = c.close >= c.open;
              const color = isBull ? '#10B981' : '#EF4444';
              const yHigh = yForPrice(c.high);
              const yLow = yForPrice(c.low);
              const yOpen = yForPrice(c.open);
              const yClose = yForPrice(c.close);
              const bodyTop = Math.min(yOpen, yClose);
              const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));
              const isHollow = chartStyle === 'hollow' && isBull;

              return (
                <g key={c.time}>
                  <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.2" />
                  <rect
                    x={x - candleW / 2}
                    y={bodyTop}
                    width={candleW}
                    height={bodyHeight}
                    fill={isHollow ? '#0B0F17' : color}
                    stroke={color}
                    strokeWidth={isHollow ? '1.2' : '0'}
                    rx={0.5}
                  />
                </g>
              );
            })
          )}

          {/* Backtest Entry & Exit Replay Markers */}
          {visibleBacktestTrades.map((tr) => {
            const winColor = tr.outcome === 'WIN' ? '#10B981' : '#EF4444';
            const hasBoth = tr.entryIdx !== undefined && tr.exitIdx !== undefined;
            const ex = tr.entryIdx !== undefined ? xForIdx(tr.entryIdx) : null;
            const ey = yForPrice(tr.entryPrice);
            const xx = tr.exitIdx !== undefined ? xForIdx(tr.exitIdx) : null;
            const xy = yForPrice(tr.exitPrice);

            return (
              <g key={tr.id} data-testid="chart-backtest-marker">
                {hasBoth && ex !== null && xx !== null && (
                  <line
                    x1={ex}
                    y1={ey}
                    x2={xx}
                    y2={xy}
                    stroke={winColor}
                    strokeWidth="1.2"
                    strokeDasharray="3 2"
                    opacity="0.75"
                  />
                )}
                {ex !== null && (
                  <polygon
                    points={
                      tr.direction === 'LONG'
                        ? `${ex},${ey - 5} ${ex - 4},${ey + 3} ${ex + 4},${ey + 3}`
                        : `${ex},${ey + 5} ${ex - 4},${ey - 3} ${ex + 4},${ey - 3}`
                    }
                    fill={tr.direction === 'LONG' ? '#0EA5E9' : '#F59E0B'}
                    stroke="#090D16"
                    strokeWidth="0.8"
                  />
                )}
                {xx !== null && (
                  <circle
                    cx={xx}
                    cy={xy}
                    r="3.5"
                    fill={winColor}
                    stroke="#090D16"
                    strokeWidth="0.9"
                  />
                )}
              </g>
            );
          })}

          {/* Live Price Line & Right-Axis Highlight Tag */}
          {showLiveLine && (
            <g>
              <line
                x1={padLeft}
                y1={liveY}
                x2={width - padRight}
                y2={liveY}
                stroke={liveIsBull ? '#10B981' : '#EF4444'}
                strokeWidth="1.2"
                strokeDasharray="2 2"
                opacity="0.95"
              />
              <rect
                x={width - padRight + 2}
                y={liveY - 9.5}
                width={108}
                height={19}
                rx={4}
                fill={liveIsBull ? '#059669' : '#DC2626'}
              />
              <text
                x={width - padRight + 7}
                y={liveY + 3.5}
                fontSize="10"
                fontWeight="700"
                fill="#ffffff"
                className="font-mono-num"
              >
                LIVE {formatPrice(currentLivePrice)}
              </text>
            </g>
          )}

          {/* Divider between Price and Lower Pane */}
          <line
            x1={padLeft}
            y1={lowerTop - 10}
            x2={width - padRight}
            y2={lowerTop - 10}
            stroke="currentColor"
            className="text-slate-200 dark:text-slate-800"
            strokeWidth="1"
          />

          {/* Lower Pane: Volume + Taker Delta | RSI | MACD */}
          {lowerPane === 'volume' &&
            sliceData.rawSlice.map((c, i) => {
              const x = xForIdx(i);
              const vol = c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close;
              const h = Math.max(2, (vol / maxVol) * (lowerHeight - 6));
              const buyRatio = vol > 0 && c.takerBuyQuoteVol > 0 ? c.takerBuyQuoteVol / vol : 0.5;
              const barColor = buyRatio >= 0.52 ? '#10B981' : buyRatio <= 0.48 ? '#EF4444' : '#64748B';
              return (
                <rect
                  key={`vol-${c.time}`}
                  x={x - candleW / 2}
                  y={lowerTop + lowerHeight - h}
                  width={candleW}
                  height={h}
                  fill={barColor}
                  opacity="0.82"
                  rx={0.5}
                />
              );
            })}

          {lowerPane === 'rsi' && (
            <g>
              {/* Overbought / Oversold subtle band */}
              <rect
                x={padLeft}
                y={lowerTop + (1 - 70 / 100) * lowerHeight}
                width={plotW}
                height={((70 - 30) / 100) * lowerHeight}
                fill="#0EA5E9"
                fillOpacity="0.05"
              />
              {[70, 50, 30].map((lvl) => {
                const y = lowerTop + (1 - lvl / 100) * lowerHeight;
                return (
                  <g key={lvl}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke="currentColor"
                      className="text-slate-300 dark:text-slate-700"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text x={width - padRight + 8} y={y + 3} fontSize="10" className="fill-slate-400 font-mono-num">
                      {lvl}
                    </text>
                  </g>
                );
              })}
              <polyline
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="1.6"
                points={sliceData.rsi
                  .map((v, i) =>
                    v === null ? null : `${xForIdx(i).toFixed(1)},${(lowerTop + (1 - v / 100) * lowerHeight).toFixed(1)}`,
                  )
                  .filter((p): p is string => p !== null)
                  .join(' ')}
              />
            </g>
          )}

          {lowerPane === 'macd' && (
            <g>
              {(() => {
                const zeroY = lowerTop + lowerHeight / 2;
                const yForMacd = (v: number) => zeroY - (v / macdBounds) * (lowerHeight / 2 - 4);
                const macdPts: string[] = [];
                const sigPts: string[] = [];
                sliceData.macd.forEach((pt, i) => {
                  const x = xForIdx(i).toFixed(1);
                  if (pt.macd !== null) macdPts.push(`${x},${yForMacd(pt.macd).toFixed(1)}`);
                  if (pt.signal !== null) sigPts.push(`${x},${yForMacd(pt.signal).toFixed(1)}`);
                });
                return (
                  <>
                    <line
                      x1={padLeft}
                      y1={zeroY}
                      x2={width - padRight}
                      y2={zeroY}
                      stroke="currentColor"
                      className="text-slate-300 dark:text-slate-700"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text x={width - padRight + 8} y={zeroY + 3} fontSize="10" className="fill-slate-400 font-mono-num">
                      0
                    </text>
                    {sliceData.macd.map((pt, i) => {
                      if (pt.hist === null) return null;
                      const x = xForIdx(i);
                      const yVal = yForMacd(pt.hist);
                      const h = Math.max(1, Math.abs(yVal - zeroY));
                      const y = pt.hist >= 0 ? zeroY - h : zeroY;
                      return (
                        <rect
                          key={`hist-${i}`}
                          x={x - candleW / 2}
                          y={y}
                          width={candleW}
                          height={h}
                          fill={pt.hist >= 0 ? '#10B981' : '#EF4444'}
                          opacity="0.7"
                        />
                      );
                    })}
                    {macdPts.length > 1 && (
                      <polyline fill="none" stroke="#38BDF8" strokeWidth="1.4" points={macdPts.join(' ')} />
                    )}
                    {sigPts.length > 1 && (
                      <polyline fill="none" stroke="#F59E0B" strokeWidth="1.3" points={sigPts.join(' ')} />
                    )}
                  </>
                );
              })()}
            </g>
          )}

          {/* 2D Crosshair + Floating Price & Time Tags */}
          {hoverIdx !== null && hoverIdx < sliceData.candles.length && (
            <g pointerEvents="none">
              <line
                x1={xForIdx(hoverIdx)}
                y1={priceTop}
                x2={xForIdx(hoverIdx)}
                y2={lowerTop + lowerHeight}
                stroke="#64748B"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.75"
              />
              {hoverY !== null && hoverPrice !== null && (
                <>
                  <line
                    x1={padLeft}
                    y1={hoverY}
                    x2={width - padRight}
                    y2={hoverY}
                    stroke="#64748B"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity="0.75"
                  />
                  <rect
                    x={width - padRight + 2}
                    y={hoverY - 9}
                    width={108}
                    height={18}
                    rx={3}
                    fill="#334155"
                  />
                  <text
                    x={width - padRight + 8}
                    y={hoverY + 3.5}
                    fontSize="10"
                    fontWeight="600"
                    fill="#F8FAFC"
                    className="font-mono-num"
                  >
                    {formatPrice(hoverPrice)}
                  </text>
                </>
              )}
              {activeRaw && (
                <>
                  <rect
                    x={Math.max(padLeft, Math.min(width - padRight - 72, xForIdx(hoverIdx) - 36))}
                    y={lowerTop + lowerHeight + 4}
                    width={72}
                    height={17}
                    rx={3}
                    fill="#334155"
                  />
                  <text
                    x={Math.max(padLeft + 36, Math.min(width - padRight - 36, xForIdx(hoverIdx)))}
                    y={lowerTop + lowerHeight + 16}
                    textAnchor="middle"
                    fontSize="9.5"
                    fontWeight="600"
                    fill="#F8FAFC"
                    className="font-mono-num"
                  >
                    {formatChartAxisTime(activeRaw.time, timeframe)}
                  </text>
                </>
              )}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
