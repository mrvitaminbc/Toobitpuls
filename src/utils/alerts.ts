import type {
  AlertEvent,
  AlertQualityGrade,
  AnalysisResult,
  Timeframe,
} from '../types/futures';

export type AlertSide = 'PUMP' | 'DUMP';

const PEGGED_STABLECOINS = new Set([
  'USDT',
  'USDC',
  'FDUSD',
  'TUSD',
  'DAI',
  'BUSD',
  'USDE',
  'PYUSD',
  'USDP',
  'EURC',
  'EURT',
  'USDD',
  'RLUSD',
  'USTC',
  'FRAX',
  'LUSD',
  'GUSD',
  'CRVUSD',
  'PAXG_STABLE',
]);

export function isPeggedStablecoin(baseAsset: string): boolean {
  const clean = baseAsset.trim().toUpperCase().replace(/^1000/, '');
  return PEGGED_STABLECOINS.has(clean);
}

export function classifyAlertSide(alert: AlertEvent): AlertSide {
  if (alert.phase === 'PRE_PUMP' || alert.phase === 'PUMP_ACTIVE') return 'PUMP';
  if (alert.phase === 'PRE_DUMP' || alert.phase === 'DUMP_ACTIVE') return 'DUMP';
  if (alert.direction === 'LONG') return 'PUMP';
  if (alert.direction === 'SHORT') return 'DUMP';

  const pumpProb = alert.pumpProbability ?? 0;
  const dumpProb = alert.dumpProbability ?? 0;
  return pumpProb >= dumpProb ? 'PUMP' : 'DUMP';
}

export function getAlertProbability(alert: AlertEvent): number {
  const side = classifyAlertSide(alert);
  if (side === 'PUMP') {
    const raw = alert.pumpProbability;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : alert.confidence;
  }
  const raw = alert.dumpProbability;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : alert.confidence;
}

export function filterAlertsByMinProbability(
  alerts: AlertEvent[],
  minProbabilityExclusive = 50,
): AlertEvent[] {
  return alerts.filter((al) => {
    if (isPeggedStablecoin(al.baseAsset)) return false;
    return getAlertProbability(al) > minProbabilityExclusive;
  });
}

export function splitAndSortAlerts(
  alerts: AlertEvent[],
  minProbabilityExclusive = 50,
): {
  pumpAlerts: AlertEvent[];
  dumpAlerts: AlertEvent[];
} {
  const pumpAlerts: AlertEvent[] = [];
  const dumpAlerts: AlertEvent[] = [];

  for (const al of filterAlertsByMinProbability(alerts, minProbabilityExclusive)) {
    if (classifyAlertSide(al) === 'PUMP') {
      pumpAlerts.push(al);
    } else {
      dumpAlerts.push(al);
    }
  }

  const sortByProbDesc = (a: AlertEvent, b: AlertEvent): number => {
    const diff = getAlertProbability(b) - getAlertProbability(a);
    if (diff !== 0) return diff;
    const gradeDiff = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
    if (gradeDiff !== 0) return gradeDiff;
    const confDiff = b.confidence - a.confidence;
    if (confDiff !== 0) return confDiff;
    return b.timestamp - a.timestamp;
  };

  pumpAlerts.sort(sortByProbDesc);
  dumpAlerts.sort(sortByProbDesc);

  return { pumpAlerts, dumpAlerts };
}

export interface TimeframeHorizonSpec {
  barsMin: number;
  barsMax: number;
  hoursMin: number;
  hoursMax: number;
  windowEn: string;
  windowFa: string;
}

export function getTimeframeHorizon(timeframe: Timeframe): TimeframeHorizonSpec {
  switch (timeframe) {
    case '1m':
      return {
        barsMin: 30,
        barsMax: 90,
        hoursMin: 0.5,
        hoursMax: 1.5,
        windowEn: '30–90m',
        windowFa: '۳۰ تا ۹۰ دقیقه آینده',
      };
    case '5m':
      return {
        barsMin: 12,
        barsMax: 48,
        hoursMin: 1,
        hoursMax: 4,
        windowEn: '1–4h',
        windowFa: '۱ تا ۴ ساعت آینده',
      };
    case '15m':
      return {
        barsMin: 8,
        barsMax: 24,
        hoursMin: 2,
        hoursMax: 6,
        windowEn: '2–6h',
        windowFa: '۲ تا ۶ ساعت آینده',
      };
    case '30m':
      return {
        barsMin: 6,
        barsMax: 16,
        hoursMin: 3,
        hoursMax: 8,
        windowEn: '3–8h',
        windowFa: '۳ تا ۸ ساعت آینده',
      };
    case '1h':
      return {
        barsMin: 4,
        barsMax: 12,
        hoursMin: 4,
        hoursMax: 12,
        windowEn: '4–12h',
        windowFa: '۴ تا ۱۲ ساعت آینده',
      };
    case '4h':
      return {
        barsMin: 3,
        barsMax: 9,
        hoursMin: 12,
        hoursMax: 36,
        windowEn: '12–36h',
        windowFa: '۱۲ تا ۳۶ ساعت آینده',
      };
    case '1d':
      return {
        barsMin: 1,
        barsMax: 3,
        hoursMin: 24,
        hoursMax: 72,
        windowEn: '24–72h',
        windowFa: '۱ تا ۳ روز آینده',
      };
    case '1w':
      return {
        barsMin: 1,
        barsMax: 2,
        hoursMin: 72,
        hoursMax: 168,
        windowEn: '3–7d',
        windowFa: '۳ تا ۷ روز آینده',
      };
    case '1M':
      return {
        barsMin: 1,
        barsMax: 2,
        hoursMin: 168,
        hoursMax: 360,
        windowEn: '7–15d',
        windowFa: '۱ تا ۲ هفته آینده',
      };
    default:
      return {
        barsMin: 4,
        barsMax: 12,
        hoursMin: 4,
        hoursMax: 12,
        windowEn: '4–12h',
        windowFa: '۴ تا ۱۲ ساعت آینده',
      };
  }
}

export interface ExpectedPriceMoveEstimate {
  expectedMoveMinPct: number;
  expectedMoveMaxPct: number;
  expectedHorizonHoursMin: number;
  expectedHorizonHoursMax: number;
  expectedWindowEn: string;
  expectedWindowFa: string;
}

function clampVal(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function estimateExpectedPriceMove(analysis: AnalysisResult): ExpectedPriceMoveEstimate {
  const horizon = getTimeframeHorizon(analysis.timeframe);
  const isDump =
    analysis.phase === 'PRE_DUMP' ||
    analysis.phase === 'DUMP_ACTIVE' ||
    analysis.direction === 'SHORT' ||
    (analysis.direction === 'NEUTRAL' && analysis.dumpProbability > analysis.pumpProbability);
  const sign = isDump ? -1 : 1;

  const refPrice =
    analysis.tradePlan.optimalEntry > 0 ? analysis.tradePlan.optimalEntry : analysis.lastPrice;
  const safePrice = refPrice > 0 ? refPrice : 1;

  const atrPct = clampVal(
    analysis.indicators.atrPct > 0 ? analysis.indicators.atrPct : 1.4,
    0.25,
    14,
  );

  // Institutional volatility-impulse scaling: sqrt(N) dispersion scaled by squeeze/volume/MTF catalysts
  const squeezeFactor = analysis.indicators.ttmSqueeze
    ? 1.32 + Math.min(0.24, analysis.indicators.squeezeBars * 0.025)
    : analysis.indicators.bbWidthPercentile <= 25
      ? 1.24
      : 1.0;

  const volumeFactor = 1 + clampVal((analysis.volumeRatio20 - 1.1) * 0.16, 0, 0.48);
  const mtfAligned = analysis.mtf?.alignedTimeframes ?? 0;
  const mtfFactor = mtfAligned >= 3 ? 1.18 : mtfAligned === 2 ? 1.08 : 0.96;

  const catalystMult = clampVal(squeezeFactor * volumeFactor * mtfFactor, 0.9, 2.15);

  const volLow = atrPct * Math.sqrt(horizon.barsMin) * 0.85 * catalystMult;
  const volHigh = atrPct * Math.sqrt(horizon.barsMax) * 1.05 * catalystMult;

  // Blend with actual structural chart target distances (TP1 and TP2/TP3)
  const tp1Dist =
    analysis.tradePlan.tp1 > 0
      ? (Math.abs(analysis.tradePlan.tp1 - safePrice) / safePrice) * 100
      : volLow;
  const tp2Dist =
    analysis.tradePlan.tp2 > 0
      ? (Math.abs(analysis.tradePlan.tp2 - safePrice) / safePrice) * 100
      : volHigh * 0.85;
  const tp3Dist =
    analysis.tradePlan.tp3 > 0
      ? (Math.abs(analysis.tradePlan.tp3 - safePrice) / safePrice) * 100
      : volHigh * 1.15;

  const structuralHigh = tp2Dist * 0.5 + tp3Dist * 0.5;

  // Higher sharp-move readiness shifts blend toward explosive upper range
  const sharpWeight = clampVal((analysis.sharpMoveScore - 50) / 100, 0, 0.35);

  let absMin = clampVal(volLow * (0.55 - sharpWeight * 0.2) + tp1Dist * (0.45 + sharpWeight * 0.2), 0.8, 35);
  let absMax = clampVal(volHigh * (0.52 + sharpWeight * 0.15) + structuralHigh * (0.48 - sharpWeight * 0.15), absMin + 0.8, 65);

  absMin = round1(absMin);
  absMax = round1(Math.max(absMin + 0.6, absMax));

  return {
    expectedMoveMinPct: Number((sign * absMin).toFixed(1)),
    expectedMoveMaxPct: Number((sign * absMax).toFixed(1)),
    expectedHorizonHoursMin: horizon.hoursMin,
    expectedHorizonHoursMax: horizon.hoursMax,
    expectedWindowEn: horizon.windowEn,
    expectedWindowFa: horizon.windowFa,
  };
}

export function estimateAlertFallbackMove(alert: AlertEvent): ExpectedPriceMoveEstimate {
  if (
    typeof alert.expectedMoveMinPct === 'number' &&
    typeof alert.expectedMoveMaxPct === 'number' &&
    alert.expectedWindowEn &&
    alert.expectedWindowFa
  ) {
    return {
      expectedMoveMinPct: alert.expectedMoveMinPct,
      expectedMoveMaxPct: alert.expectedMoveMaxPct,
      expectedHorizonHoursMin: alert.expectedHorizonHoursMin ?? 4,
      expectedHorizonHoursMax: alert.expectedHorizonHoursMax ?? 12,
      expectedWindowEn: alert.expectedWindowEn,
      expectedWindowFa: alert.expectedWindowFa,
    };
  }

  const horizon = getTimeframeHorizon(alert.timeframe);
  const side = classifyAlertSide(alert);
  const sign = side === 'DUMP' ? -1 : 1;
  const ref = alert.optimalEntry && alert.optimalEntry > 0 ? alert.optimalEntry : alert.price;
  const safeRef = ref > 0 ? ref : 1;
  const prob = getAlertProbability(alert);

  const tp1Pct = alert.tp1 && alert.tp1 > 0 ? (Math.abs(alert.tp1 - safeRef) / safeRef) * 100 : clampVal(prob * 0.075, 2.5, 14);
  const tp2Pct = alert.tp2 && alert.tp2 > 0 ? (Math.abs(alert.tp2 - safeRef) / safeRef) * 100 : tp1Pct * 1.75;
  const tp3Pct = alert.tp3 && alert.tp3 > 0 ? (Math.abs(alert.tp3 - safeRef) / safeRef) * 100 : tp1Pct * 2.5;

  const minPct = round1(clampVal(tp1Pct, 0.8, 35));
  const maxPct = round1(clampVal((tp2Pct + tp3Pct) * 0.5, minPct + 0.8, 65));

  return {
    expectedMoveMinPct: Number((sign * minPct).toFixed(1)),
    expectedMoveMaxPct: Number((sign * maxPct).toFixed(1)),
    expectedHorizonHoursMin: horizon.hoursMin,
    expectedHorizonHoursMax: horizon.hoursMax,
    expectedWindowEn: horizon.windowEn,
    expectedWindowFa: horizon.windowFa,
  };
}

export interface AlertQualificationResult {
  qualified: boolean;
  side: AlertSide;
  probability: number;
  qualityGrade: AlertQualityGrade;
  qualityScore: number;
  alignedTimeframes: number;
  expectedMove: ExpectedPriceMoveEstimate;
  rejectReason?: string;
}

/**
 * Institutional multi-pillar alert qualification inspired by TradingView Multi-Condition,
 * Coinglass Derivatives Confluence, and Hyblock Orderflow desks:
 *  1. Pegged stablecoin & illiquid micro-cap filtering
 *  2. Directional TradePlan & asymmetric R:R verification
 *  3. Confidence + Probability Edge spread (>= 15 pts over opposing side)
 *  4. MTF 1H/4H/1D trend confluence (blocks counter-HTF alerts)
 *  5. Taker Buy/Sell orderflow & RVOL confirmation
 *  6. Anti-chase / exhaustion guard
 */
export function evaluateAlertQualification(analysis: AnalysisResult): AlertQualificationResult {
  const expectedMove = estimateExpectedPriceMove(analysis);
  const isDumpSide =
    analysis.phase === 'PRE_DUMP' ||
    analysis.phase === 'DUMP_ACTIVE' ||
    analysis.direction === 'SHORT';
  const side: AlertSide = isDumpSide ? 'DUMP' : 'PUMP';
  const sideProb = side === 'PUMP' ? analysis.pumpProbability : analysis.dumpProbability;
  const oppProb = side === 'PUMP' ? analysis.dumpProbability : analysis.pumpProbability;
  const probEdge = sideProb - oppProb;
  const alignedTimeframes = analysis.mtf?.alignedTimeframes ?? 0;

  const fail = (rejectReason: string): AlertQualificationResult => ({
    qualified: false,
    side,
    probability: sideProb,
    qualityGrade: 'B',
    qualityScore: 0,
    alignedTimeframes,
    expectedMove,
    rejectReason,
  });

  if (isPeggedStablecoin(analysis.baseAsset)) {
    return fail('pegged_stablecoin');
  }

  if (analysis.direction === 'NEUTRAL' || analysis.tradePlan.action === 'WAIT') {
    return fail('neutral_direction');
  }

  if (
    (side === 'PUMP' && analysis.direction !== 'LONG') ||
    (side === 'DUMP' && analysis.direction !== 'SHORT')
  ) {
    return fail('side_direction_mismatch');
  }

  // Require real futures liquidity ($400k+ 24h) and tight executable spread (<= 0.55%)
  if (analysis.quoteVolume24h > 0 && analysis.quoteVolume24h < 400_000) {
    return fail('low_liquidity');
  }
  if (analysis.orderBook && analysis.orderBook.spreadPct > 0.55) {
    return fail('wide_spread');
  }

  // Core probability, confidence, and edge thresholds
  if (analysis.confidence < 64) {
    return fail('low_confidence');
  }
  if (sideProb < 60) {
    return fail('low_side_probability');
  }
  if (probEdge < 15) {
    return fail('weak_directional_edge');
  }

  // Require reasonable Risk:Reward geometry
  if (analysis.tradePlan.riskReward1 < 1.1 || analysis.tradePlan.riskReward2 < 1.55) {
    return fail('poor_risk_reward');
  }

  // Multi-Timeframe Confluence Gate (when MTF klines are available)
  if (analysis.mtf) {
    const lbl = analysis.mtf.alignmentLabel;
    if (side === 'PUMP' && (lbl === 'STRONG_BEAR' || lbl === 'BEAR_CONFLUENCE')) {
      return fail('counter_htf_bear');
    }
    if (side === 'DUMP' && (lbl === 'STRONG_BULL' || lbl === 'BULL_CONFLUENCE')) {
      return fail('counter_htf_bull');
    }
    const isExplosiveBreakoutException =
      alignedTimeframes >= 1 &&
      analysis.sharpMoveScore >= 76 &&
      analysis.suspiciousVolumeScore >= 55 &&
      analysis.volumeRatio20 >= 1.8;

    if (alignedTimeframes < 2 && !isExplosiveBreakoutException) {
      return fail('insufficient_mtf_alignment');
    }
  }

  // Orderflow Taker Imbalance + Volume Catalyst Confirmation
  const takerBuy = analysis.takerBuyRatio;
  const hasVolumeOrSqueezeCatalyst =
    analysis.volumeRatio20 >= 1.2 ||
    analysis.suspiciousVolumeScore >= 40 ||
    analysis.indicators.ttmSqueeze ||
    analysis.indicators.obvBreakout === (side === 'PUMP' ? 'BULLISH' : 'BEARISH');

  if (!hasVolumeOrSqueezeCatalyst) {
    return fail('missing_volume_or_squeeze_catalyst');
  }

  if (side === 'PUMP') {
    const takerConfirmed =
      takerBuy >= 0.51 || (analysis.indicators.cvdDivergence === 'BULLISH' && takerBuy >= 0.485);
    if (!takerConfirmed) {
      return fail('negative_taker_flow_for_pump');
    }
    if (analysis.priceChangePct >= 24 || (analysis.indicators.rsi14 >= 82 && analysis.indicators.cmf20 < 0.05)) {
      return fail('pump_exhausted_top');
    }
  } else {
    const takerConfirmed =
      takerBuy <= 0.49 || (analysis.indicators.cvdDivergence === 'BEARISH' && takerBuy <= 0.515);
    if (!takerConfirmed) {
      return fail('positive_taker_flow_for_dump');
    }
    if (analysis.priceChangePct <= -24 || (analysis.indicators.rsi14 <= 18 && analysis.indicators.cmf20 > -0.05)) {
      return fail('dump_exhausted_bottom');
    }
  }

  // Institutional 5-Pillar Quality Score (0..100)
  const confPillar = clampVal((analysis.confidence - 55) * 0.75, 0, 28);
  const probPillar = clampVal((sideProb - 50) * 0.5 + Math.min(10, probEdge * 0.25), 0, 28);
  const mtfPillar = alignedTimeframes >= 3 ? 18 : alignedTimeframes === 2 ? 13 : 6;
  const flowImbalance = Math.abs(takerBuy - 0.5) * 100;
  const flowPillar = clampVal(
    (analysis.volumeRatio20 >= 2 ? 9 : analysis.volumeRatio20 >= 1.3 ? 6 : 3) +
      Math.min(7, flowImbalance * 0.6),
    0,
    16,
  );
  const rrPillar = clampVal((analysis.tradePlan.riskReward2 - 1.5) * 4, 0, 10);

  const qualityScore = Math.round(clampVal(confPillar + probPillar + mtfPillar + flowPillar + rrPillar, 50, 99));
  const qualityGrade: AlertQualityGrade = qualityScore >= 84 ? 'A+' : qualityScore >= 72 ? 'A' : 'B';

  return {
    qualified: true,
    side,
    probability: sideProb,
    qualityGrade,
    qualityScore,
    alignedTimeframes,
    expectedMove,
  };
}
