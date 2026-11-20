export type ConfidenceTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ConfidenceGaugeMetrics {
  score: number;
  tier: ConfidenceTier;
  strokeColor: string;
  textColorClass: string;
  labelEn: string;
  labelFa: string;
  radius: number;
  circumference: number;
  strokeDashoffset: number;
}

export function clampConfidence(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.min(100, Math.max(0, score)));
}

export function getConfidenceGaugeMetrics(rawScore: number, radius = 34): ConfidenceGaugeMetrics {
  const score = clampConfidence(rawScore);
  const safeRadius = Math.max(8, radius);
  const circumference = 2 * Math.PI * safeRadius;
  const strokeDashoffset = circumference * (1 - score / 100);

  if (score >= 70) {
    return {
      score,
      tier: 'HIGH',
      strokeColor: '#10b981',
      textColorClass: 'text-emerald-600 dark:text-emerald-400',
      labelEn: 'High',
      labelFa: 'قدرتمند',
      radius: safeRadius,
      circumference: Number(circumference.toFixed(3)),
      strokeDashoffset: Number(strokeDashoffset.toFixed(3)),
    };
  }

  if (score >= 45) {
    return {
      score,
      tier: 'MEDIUM',
      strokeColor: '#f97316',
      textColorClass: 'text-orange-500 dark:text-orange-400',
      labelEn: 'Moderate',
      labelFa: 'متوسط',
      radius: safeRadius,
      circumference: Number(circumference.toFixed(3)),
      strokeDashoffset: Number(strokeDashoffset.toFixed(3)),
    };
  }

  return {
    score,
    tier: 'LOW',
    strokeColor: '#ef4444',
    textColorClass: 'text-red-500 dark:text-red-400',
    labelEn: 'Weak',
    labelFa: 'ضعیف',
    radius: safeRadius,
    circumference: Number(circumference.toFixed(3)),
    strokeDashoffset: Number(strokeDashoffset.toFixed(3)),
  };
}
