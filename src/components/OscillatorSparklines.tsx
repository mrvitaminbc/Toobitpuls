import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { translations } from '../i18n/translations';
import type { AnalysisResult, Language } from '../types/futures';
import { buildMacdSparklineGeometry, buildRsiSparklineGeometry } from '../utils/sparkline';

interface OscillatorSparklinesProps {
  analysis: AnalysisResult;
  lang: Language;
}

function formatOscVal(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs < 0.001) return value.toFixed(6);
  if (abs < 0.1) return value.toFixed(4);
  if (abs < 10) return value.toFixed(3);
  return value.toFixed(2);
}

export const OscillatorSparklines: React.FC<OscillatorSparklinesProps> = ({ analysis, lang }) => {
  const t = translations[lang];

  const rsiGeom = useMemo(
    () => buildRsiSparklineGeometry(analysis.series.rsi, 280, 76, 48),
    [analysis.series.rsi],
  );

  const macdGeom = useMemo(
    () =>
      buildMacdSparklineGeometry(
        analysis.series.macdLine,
        analysis.series.macdSignal,
        analysis.series.macdHist,
        280,
        76,
        48,
      ),
    [analysis.series.macdLine, analysis.series.macdSignal, analysis.series.macdHist],
  );

  const rsi = analysis.indicators.rsi14;
  const rsiStatus =
    rsi >= 70
      ? { label: t.oscOverbought, cls: 'text-rose-500', stroke: '#f43f5e' }
      : rsi <= 30
        ? { label: t.oscOversold, cls: 'text-emerald-500', stroke: '#10b981' }
        : rsi >= 50
          ? { label: t.oscBullishZone, cls: 'text-sky-500', stroke: '#38bdf8' }
          : { label: t.oscBearishZone, cls: 'text-amber-500', stroke: '#38bdf8' };

  const macdHist = analysis.indicators.macdHist;
  const macdLine = analysis.indicators.macdLine;
  const macdSignal = analysis.indicators.macdSignal;

  const recentHist = analysis.series.macdHist.filter((v): v is number => v !== null);
  const prevHist = recentHist.length >= 2 ? recentHist[recentHist.length - 2] : macdHist;
  const macdExpanding = Math.abs(macdHist) >= Math.abs(prevHist);
  const macdBull = macdHist >= 0;

  const macdStatusText = macdBull
    ? macdExpanding
      ? t.oscMacdBullExpand
      : t.oscMacdBullFade
    : macdExpanding
      ? t.oscMacdBearExpand
      : t.oscMacdBearFade;

  return (
    <div
      data-testid="oscillator-sparklines"
      className="tp-panel rounded-xl overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-white/[0.015]">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-sky-500 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {t.oscillatorsTitle}
          </h2>
        </div>
        <span className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
          {analysis.timeframe.toUpperCase()} · 48 {t.oscBarsLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x rtl:md:divide-x-reverse divide-slate-200/80 dark:divide-slate-800/80">
        {/* Pane 1: RSI (14) Sparkline */}
        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span dir="ltr" className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                RSI (14)
              </span>
              <span className={`font-semibold ${rsiStatus.cls}`}>{rsiStatus.label}</span>
            </div>
            <div dir="ltr" className="font-mono-num font-bold text-sm text-sky-600 dark:text-sky-400">
              {rsi.toFixed(1)}
            </div>
          </div>

          <div dir="ltr" className="w-full rounded-lg bg-slate-50/80 dark:bg-[#070B13]/80 px-2 py-1.5">
            <svg
              data-testid="rsi-sparkline-svg"
              viewBox="0 0 280 76"
              className="w-full h-[76px] overflow-visible"
              role="img"
              aria-label={`RSI 14 oscillator sparkline, current value ${rsi.toFixed(1)}`}
            >
              <defs>
                <linearGradient id="rsiSparkArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Threshold Lines: 70 Overbought / 50 Midline / 30 Oversold */}
              <line
                x1="4"
                y1={rsiGeom.y70}
                x2="276"
                y2={rsiGeom.y70}
                stroke="#f43f5e"
                strokeOpacity="0.45"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <line
                x1="4"
                y1={rsiGeom.y50}
                x2="276"
                y2={rsiGeom.y50}
                stroke="#64748b"
                strokeOpacity="0.35"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <line
                x1="4"
                y1={rsiGeom.y30}
                x2="276"
                y2={rsiGeom.y30}
                stroke="#10b981"
                strokeOpacity="0.45"
                strokeWidth="1"
                strokeDasharray="3 3"
              />

              <text x="6" y={Math.max(9, rsiGeom.y70 - 2)} fill="#f43f5e" fillOpacity="0.7" fontSize="8" fontFamily="monospace">
                70
              </text>
              <text x="6" y={Math.min(73, rsiGeom.y30 + 8)} fill="#10b981" fillOpacity="0.7" fontSize="8" fontFamily="monospace">
                30
              </text>

              {rsiGeom.areaPath && <path d={rsiGeom.areaPath} fill="url(#rsiSparkArea)" />}
              {rsiGeom.polylinePoints && (
                <polyline
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={rsiGeom.polylinePoints}
                />
              )}
              {rsiGeom.lastPoint && (
                <circle
                  cx={rsiGeom.lastPoint.x}
                  cy={rsiGeom.lastPoint.y}
                  r="3.2"
                  fill={rsiStatus.stroke}
                  stroke="#0B0F17"
                  strokeWidth="1.2"
                />
              )}
            </svg>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
            <span dir="ltr">
              Min {rsiGeom.minVal} / Max {rsiGeom.maxVal}
            </span>
            <span dir="ltr">
              Stoch K {analysis.indicators.stochK} / D {analysis.indicators.stochD}
            </span>
          </div>
        </div>

        {/* Pane 2: MACD (12, 26, 9) Sparkline */}
        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span dir="ltr" className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                MACD (12,26,9)
              </span>
              <span className={`font-semibold ${macdBull ? 'text-emerald-500' : 'text-rose-500'}`}>
                {macdStatusText}
              </span>
            </div>
            <div
              dir="ltr"
              className={`font-mono-num font-bold text-sm ${macdBull ? 'text-emerald-500' : 'text-rose-500'}`}
            >
              {macdHist >= 0 ? `+${formatOscVal(macdHist)}` : formatOscVal(macdHist)}
            </div>
          </div>

          <div dir="ltr" className="w-full rounded-lg bg-slate-50/80 dark:bg-[#070B13]/80 px-2 py-1.5">
            <svg
              data-testid="macd-sparkline-svg"
              viewBox="0 0 280 76"
              className="w-full h-[76px] overflow-visible"
              role="img"
              aria-label={`MACD 12 26 9 oscillator sparkline, histogram ${formatOscVal(macdHist)}`}
            >
              {/* Zero line */}
              <line
                x1="4"
                y1={macdGeom.zeroY}
                x2="276"
                y2={macdGeom.zeroY}
                stroke="#64748b"
                strokeOpacity="0.45"
                strokeWidth="1"
              />

              {/* Histogram bars */}
              {macdGeom.bars.map((bar, idx) => (
                <rect
                  key={idx}
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx="0.8"
                  fill={bar.positive ? '#10b981' : '#f43f5e'}
                  fillOpacity={idx === macdGeom.bars.length - 1 ? 0.92 : 0.48}
                />
              ))}

              {/* Signal line (amber) */}
              {macdGeom.signalPoints && (
                <polyline
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={macdGeom.signalPoints}
                />
              )}

              {/* MACD line (sky) */}
              {macdGeom.macdPoints && (
                <polyline
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={macdGeom.macdPoints}
                />
              )}

              {macdGeom.lastMacd && (
                <circle
                  cx={macdGeom.lastMacd.x}
                  cy={macdGeom.lastMacd.y}
                  r="3"
                  fill="#38bdf8"
                  stroke="#0B0F17"
                  strokeWidth="1.2"
                />
              )}
            </svg>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
            <span dir="ltr" className="text-sky-500">
              MACD {formatOscVal(macdLine)}
            </span>
            <span dir="ltr" className="text-amber-500">
              Signal {formatOscVal(macdSignal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
