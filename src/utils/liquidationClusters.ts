import type {
  Candle,
  CrowdedSqueezeInfo,
  LiquidationCluster,
  ScannerOpportunity,
} from '../types/futures';
import { clamp } from '../engine/indicators';

function roundLiqPrice(value: number, refPrice: number): number {
  if (!Number.isFinite(value)) return 0;
  if (refPrice >= 1000) return Number(value.toFixed(2));
  if (refPrice >= 10) return Number(value.toFixed(3));
  if (refPrice >= 0.1) return Number(value.toFixed(4));
  return Number(value.toFixed(6));
}

/**
 * Estimates structural high-leverage stop-hunt & liquidation pools above recent
 * swing highs (Short liquidations) and below recent swing lows (Long liquidations).
 */
export function estimateLiquidationClusters(
  candles: Candle[],
  currentPrice: number,
  openInterestUsd = 0,
): LiquidationCluster[] {
  if (!candles || candles.length < 15 || currentPrice <= 0) {
    return [];
  }

  const window = candles.slice(-72);
  const swingHighs: { price: number; recency: number }[] = [];
  const swingLows: { price: number; recency: number }[] = [];

  for (let i = 2; i < window.length - 2; i++) {
    const c = window[i];
    if (
      c.high >= window[i - 1].high &&
      c.high >= window[i - 2].high &&
      c.high >= window[i + 1].high &&
      c.high >= window[i + 2].high &&
      c.high >= currentPrice * 0.995
    ) {
      swingHighs.push({ price: c.high, recency: (i + 1) / window.length });
    }
    if (
      c.low <= window[i - 1].low &&
      c.low <= window[i - 2].low &&
      c.low <= window[i + 1].low &&
      c.low <= window[i + 2].low &&
      c.low <= currentPrice * 1.005
    ) {
      swingLows.push({ price: c.low, recency: (i + 1) / window.length });
    }
  }

  // Fallback anchors to range high/low if pivot count is small
  if (swingHighs.length === 0) {
    const maxH = Math.max(...window.map((c) => c.high));
    swingHighs.push({ price: maxH, recency: 0.7 });
  }
  if (swingLows.length === 0) {
    const minL = Math.min(...window.map((c) => c.low));
    swingLows.push({ price: minL, recency: 0.7 });
  }

  const topHigh = [...swingHighs].sort((a, b) => b.price - a.price)[0];
  const topLow = [...swingLows].sort((a, b) => a.price - b.price)[0];
  const oiWeight = openInterestUsd >= 50_000_000 ? 12 : openInterestUsd >= 10_000_000 ? 7 : 2;

  const tiers: { tier: '100x' | '50x' | '25x'; offsetRatio: number; baseWeight: number }[] = [
    { tier: '100x', offsetRatio: 0.0085, baseWeight: 82 },
    { tier: '50x', offsetRatio: 0.0175, baseWeight: 74 },
    { tier: '25x', offsetRatio: 0.034, baseWeight: 63 },
  ];

  const clusters: LiquidationCluster[] = [];

  for (const t of tiers) {
    const shortLiqPrice = roundLiqPrice(topHigh.price * (1 + t.offsetRatio), currentPrice);
    const shortDistPct = Number((((shortLiqPrice - currentPrice) / currentPrice) * 100).toFixed(2));
    clusters.push({
      id: `short-liq-${t.tier}`,
      price: shortLiqPrice,
      side: 'SHORT_LIQ',
      leverageTier: t.tier,
      distancePct: shortDistPct,
      intensity: Math.round(clamp(t.baseWeight + topHigh.recency * 10 + oiWeight, 35, 99)),
      anchorSwingPrice: roundLiqPrice(topHigh.price, currentPrice),
    });

    const longLiqPrice = roundLiqPrice(topLow.price * (1 - t.offsetRatio), currentPrice);
    const longDistPct = Number((((longLiqPrice - currentPrice) / currentPrice) * 100).toFixed(2));
    clusters.push({
      id: `long-liq-${t.tier}`,
      price: longLiqPrice,
      side: 'LONG_LIQ',
      leverageTier: t.tier,
      distancePct: longDistPct,
      intensity: Math.round(clamp(t.baseWeight + topLow.recency * 10 + oiWeight, 35, 99)),
      anchorSwingPrice: roundLiqPrice(topLow.price, currentPrice),
    });
  }

  return clusters.sort((a, b) => b.price - a.price);
}

/**
 * Evaluates whether a perpetual contract sits in a crowded leverage squeeze regime
 * (Extreme funding + rising Open Interest + Volatility Compression / TTM Squeeze).
 */
export function evaluateCrowdedSqueeze(opp: ScannerOpportunity): CrowdedSqueezeInfo {
  const frAbs = Math.abs(opp.fundingRate);
  const hasCompression = Boolean(opp.ttmSqueeze || opp.isSqueeze);
  const oiRising = opp.oiDeltaPct >= 0.4;

  // Negative funding + compression/oi -> crowded shorts vulnerable to Short Squeeze
  if (
    opp.fundingRate <= -0.00018 &&
    (hasCompression || oiRising || opp.pumpProbability >= 60)
  ) {
    const score = Math.round(
      clamp(
        42 +
          Math.min(28, (frAbs / 0.0006) * 28) +
          (hasCompression ? 16 : 0) +
          (oiRising ? 10 : 0) +
          (opp.takerBuyRatio >= 0.52 ? 8 : 0),
        0,
        99,
      ),
    );
    return {
      isCrowded: score >= 58,
      squeezeType: 'SHORT_SQUEEZE',
      squeezeScore: score,
      labelEn: `Short Squeeze Fuel (${score}/100)`,
      labelFa: `پتانسیل شورت‌اسکوئیز (${score}/100)`,
    };
  }

  // Positive crowded funding + compression/oi -> crowded longs vulnerable to Long Squeeze
  if (
    opp.fundingRate >= 0.00022 &&
    (hasCompression || oiRising || opp.dumpProbability >= 60)
  ) {
    const score = Math.round(
      clamp(
        42 +
          Math.min(28, (frAbs / 0.0006) * 28) +
          (hasCompression ? 16 : 0) +
          (oiRising ? 10 : 0) +
          (opp.takerBuyRatio <= 0.48 ? 8 : 0),
        0,
        99,
      ),
    );
    return {
      isCrowded: score >= 58,
      squeezeType: 'LONG_SQUEEZE',
      squeezeScore: score,
      labelEn: `Long Squeeze Risk (${score}/100)`,
      labelFa: `ریسک لانگ‌اسکوئیز (${score}/100)`,
    };
  }

  // Tight coil without extreme funding yet
  if (opp.ttmSqueeze && (opp.squeezeBars ?? 0) >= 5 && opp.oiDeltaPct >= 0.8) {
    return {
      isCrowded: true,
      squeezeType: opp.pumpProbability >= opp.dumpProbability ? 'SHORT_SQUEEZE' : 'LONG_SQUEEZE',
      squeezeScore: 64,
      labelEn: `OI Coil Squeeze (${opp.squeezeBars}b)`,
      labelFa: `فشردگی اهرمی (${opp.squeezeBars} کندل)`,
    };
  }

  return {
    isCrowded: false,
    squeezeType: 'NONE',
    squeezeScore: 0,
    labelEn: 'Balanced Leverage',
    labelFa: 'اهرم متعادل',
  };
}
