import React, { useMemo } from 'react';
import type { Language } from '../types/futures';
import { getConfidenceGaugeMetrics } from '../utils/confidenceGauge';

interface ConfidenceGaugeProps {
  score: number;
  lang: Language;
  label?: string;
  size?: number;
  strokeWidth?: number;
}

export const ConfidenceGauge: React.FC<ConfidenceGaugeProps> = ({
  score,
  lang,
  label,
  size = 84,
  strokeWidth = 7,
}) => {
  const center = size / 2;
  const radius = Math.max(8, center - strokeWidth);

  const metrics = useMemo(() => getConfidenceGaugeMetrics(score, radius), [score, radius]);
  const tierLabel = lang === 'fa' ? metrics.labelFa : metrics.labelEn;

  return (
    <div
      data-testid="confidence-gauge"
      data-tier={metrics.tier}
      className="flex flex-col items-center justify-center shrink-0 select-none"
      role="progressbar"
      aria-label={label ?? (lang === 'fa' ? 'درصد اطمینان سیگنال' : 'Signal Confidence')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={metrics.score}
    >
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          {/* Background Track */}
          <circle
            cx={center}
            cy={center}
            r={metrics.radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-slate-200 dark:text-slate-800"
          />
          {/* Intensity Progress Arc */}
          <circle
            data-testid="confidence-gauge-arc"
            cx={center}
            cy={center}
            r={metrics.radius}
            fill="none"
            stroke={metrics.strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={metrics.circumference}
            strokeDashoffset={metrics.strokeDashoffset}
            className="transition-[stroke-dashoffset,stroke] duration-500 ease-out"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span
            dir="ltr"
            data-testid="confidence-gauge-value"
            className={`font-mono-num text-base font-extrabold ${metrics.textColorClass}`}
          >
            {metrics.score}%
          </span>
          <span className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            {tierLabel}
          </span>
        </div>
      </div>
    </div>
  );
};
