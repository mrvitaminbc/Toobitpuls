import type {
  AlertQualityGrade,
  AnalysisResult,
  ScannerOpportunity,
  SignalCriterionCheck,
  SignalQualificationSummary,
} from '../types/futures';
import { isPeggedStablecoin } from './alerts';

export interface SignalQualificationOptions {
  minConfidence?: number;
  minCriteriaRequired?: number; // out of 7 (default 5)
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function hasValidTradeGeometry(opp: ScannerOpportunity): boolean {
  if (opp.optimalEntry <= 0 || opp.stopLoss <= 0 || opp.tp1 <= 0 || opp.tp2 <= 0) {
    return false;
  }
  if (opp.direction === 'LONG') {
    return opp.stopLoss < opp.optimalEntry && opp.tp1 > opp.optimalEntry && opp.tp2 >= opp.tp1;
  }
  if (opp.direction === 'SHORT') {
    return opp.stopLoss > opp.optimalEntry && opp.tp1 < opp.optimalEntry && opp.tp2 <= opp.tp1;
  }
  return false;
}

/**
 * Evaluates a ScannerOpportunity against 7 institutional perpetual futures criteria
 * synthesized from multi-timeframe trend, ADX regime strength, VWAP value alignment,
 * CVD/taker orderflow, derivatives OI/funding crowding, R:R geometry, and liquidity.
 */
export function evaluateSignalQualification(
  opp: ScannerOpportunity,
  options: SignalQualificationOptions = {},
): SignalQualificationSummary {
  const minConfidence = options.minConfidence ?? 55;
  const minCriteriaRequired = clamp(Math.round(options.minCriteriaRequired ?? 5), 1, 7);

  const isLong = opp.direction === 'LONG';
  const isShort = opp.direction === 'SHORT';
  const alignedTf = opp.alignedTimeframes ?? 0;
  const takerPct = Math.round(opp.takerBuyRatio * 100);
  const fundingPctText = `${(opp.fundingRate * 100).toFixed(3)}%`;

  // 1. Liquidity & Execution Spread Gate
  const isStable = isPeggedStablecoin(opp.baseAsset);
  const spreadOk = opp.spreadPct == null || opp.spreadPct <= 0.45;
  const liquidityPass = !isStable && opp.quoteVolume24h >= 500_000 && spreadOk;

  // 2. Multi-Timeframe Confluence Gate (1H / 4H / 1D)
  const counterHtf =
    (isLong && (opp.mtfAlignment === 'STRONG_BEAR' || opp.mtfAlignment === 'BEAR_CONFLUENCE')) ||
    (isShort && (opp.mtfAlignment === 'STRONG_BULL' || opp.mtfAlignment === 'BULL_CONFLUENCE'));
  const mtfPass = alignedTf >= 2 && !counterHtf;

  // 3. Risk:Reward Asymmetry & Plan Geometry
  const geometryOk = hasValidTradeGeometry(opp);
  const rrPass = geometryOk && opp.riskReward2 >= 1.8;

  // 4. ADX Trend Regime Strength OR Active TTM Volatility Squeeze
  const adxPass =
    opp.adx14 != null ? opp.adx14 >= 20 : opp.confidence >= 68;
  const trendOrSqueezePass = adxPass || Boolean(opp.ttmSqueeze);

  // 5. Aggressive Orderflow (Taker Delta / CVD) & Relative Volume Confirmation
  const takerFlowAligned = isLong
    ? opp.takerBuyRatio >= 0.515 || (opp.cvdDivergence === 'BULLISH' && opp.takerBuyRatio >= 0.485)
    : isShort
      ? opp.takerBuyRatio <= 0.485 || (opp.cvdDivergence === 'BEARISH' && opp.takerBuyRatio <= 0.515)
      : false;
  const activeVolOrSqueeze =
    opp.volumeRatio20 >= 1.15 || opp.suspiciousVolumeScore >= 35 || Boolean(opp.ttmSqueeze);
  const orderflowPass = takerFlowAligned && activeVolOrSqueeze;

  // 6. Institutional VWAP Value & RSI Anti-Chase Guard
  const vwapOk =
    opp.vwapDistPct == null
      ? true
      : isLong
        ? opp.vwapDistPct >= -1.5 && opp.vwapDistPct <= 5.5
        : isShort
          ? opp.vwapDistPct <= 1.5 && opp.vwapDistPct >= -5.5
          : false;
  const rsiMomentumOk = isLong
    ? opp.rsi14 >= 34 && opp.rsi14 <= 72 && opp.priceChangePct < 20
    : isShort
      ? opp.rsi14 >= 28 && opp.rsi14 <= 68 && opp.priceChangePct > -20
      : false;
  const vwapMomentumPass = vwapOk && rsiMomentumOk;

  // 7. Derivatives Safety: Non-Crowded Funding + OI / Depth Confirmation
  const fundingSafe = isLong
    ? opp.fundingRate <= 0.0005
    : isShort
      ? opp.fundingRate >= -0.0005
      : false;
  const derivTailwind =
    opp.oiDeltaPct >= 0.25 ||
    (isLong ? opp.fundingRate <= 0.0001 : opp.fundingRate >= -0.0001) ||
    (opp.imbalanceRatio != null && (isLong ? opp.imbalanceRatio >= 1.05 : opp.imbalanceRatio <= 0.95));
  const derivativesPass = fundingSafe && derivTailwind;

  const criteria: SignalCriterionCheck[] = [
    {
      id: 'liquidity',
      labelEn: 'Liquidity & Spread',
      labelFa: 'نقدینگی و اسپرد',
      passed: liquidityPass,
      valueText:
        opp.spreadPct != null
          ? `$${(opp.quoteVolume24h / 1_000_000).toFixed(1)}M · ${opp.spreadPct.toFixed(2)}%`
          : `$${(opp.quoteVolume24h / 1_000_000).toFixed(1)}M`,
      detailEn: '24h futures volume ≥ $500K with executable spread ≤ 0.45%.',
      detailFa: 'حجم معاملات ۲۴س ≥ ۵۰۰ هزار دلار و اسپرد اجرایی ≤ ۰.۴۵٪.',
    },
    {
      id: 'mtf',
      labelEn: 'MTF Alignment',
      labelFa: 'هم‌گرایی MTF',
      passed: mtfPass,
      valueText: `${alignedTf}/3 TF`,
      detailEn: 'At least 2 of 3 higher timeframes (1H/4H/1D) aligned without HTF conflict.',
      detailFa: 'هم‌جهتی حداقل ۲ از ۳ تایم‌فریم کلیدی (1H/4H/1D) بدون تضاد با روند اصلی.',
    },
    {
      id: 'riskReward',
      labelEn: 'R:R ≥ 1.8',
      labelFa: 'ریسک به ریوارد',
      passed: rrPass,
      valueText: `1:${opp.riskReward2.toFixed(1)}`,
      detailEn: 'Asymmetric TP2 Risk:Reward ≥ 1:1.8 with coherent SL/TP ordering.',
      detailFa: 'نسبت ریسک به ریوارد تارگت دوم حداقل ۱:۱.۸ با چینش معتبر حد ضرر.',
    },
    {
      id: 'trendOrSqueeze',
      labelEn: 'ADX / TTM Coil',
      labelFa: 'روند ADX / فشردگی',
      passed: trendOrSqueezePass,
      valueText:
        opp.adx14 != null
          ? `ADX ${opp.adx14.toFixed(0)}${opp.ttmSqueeze ? ' · TTM' : ''}`
          : opp.ttmSqueeze
            ? 'TTM ON'
            : `Conf ${opp.confidence}%`,
      detailEn: 'ADX ≥ 20 directional regime or active TTM volatility squeeze.',
      detailFa: 'قدرت روند ADX ≥ 20 یا وجود فشردگی انفجاری TTM Squeeze.',
    },
    {
      id: 'orderflow',
      labelEn: 'Orderflow & Vol',
      labelFa: 'جریان سفارش و حجم',
      passed: orderflowPass,
      valueText: `${takerPct}% · ${opp.volumeRatio20.toFixed(1)}x`,
      detailEn: 'Aggressive taker delta aligned with entry plus ≥ 1.15x volume or squeeze.',
      detailFa: 'هم‌سویی قدرت خرید/فروش مارکت (Taker) همراه با حجم فعال ≥ ۱.۱۵ برابر.',
    },
    {
      id: 'vwapMomentum',
      labelEn: 'VWAP & RSI Zone',
      labelFa: 'تعادل VWAP و RSI',
      passed: vwapMomentumPass,
      valueText:
        opp.vwapDistPct != null
          ? `RSI ${opp.rsi14.toFixed(0)} · ${opp.vwapDistPct >= 0 ? '+' : ''}${opp.vwapDistPct.toFixed(1)}%`
          : `RSI ${opp.rsi14.toFixed(0)}`,
      detailEn: 'Healthy RSI window without vertical blow-off or extreme VWAP overextension.',
      detailFa: 'مومنتوم متعادل بدون اشباع خطرناک RSI و بدون فاصله افراطی از VWAP.',
    },
    {
      id: 'derivatives',
      labelEn: 'Funding & OI',
      labelFa: 'فاندینگ و سود باز',
      passed: derivativesPass,
      valueText: `${fundingPctText} · OI ${opp.oiDeltaPct >= 0 ? '+' : ''}${opp.oiDeltaPct.toFixed(1)}%`,
      detailEn: 'Avoids crowded funding traps while supported by OI or orderbook bias.',
      detailFa: 'بدون فاندینگ شلوغ و پرریسک، با حمایت سود باز (OI) یا دفتر سفارش.',
    },
  ];

  const passedCount = criteria.filter((c) => c.passed).length;

  // Hard Safety Disqualifiers
  let hardBlockReason: string | undefined;
  if (isStable) hardBlockReason = 'pegged_stablecoin';
  else if (opp.direction === 'NEUTRAL') hardBlockReason = 'neutral_direction';
  else if (opp.quoteVolume24h > 0 && opp.quoteVolume24h < 250_000) hardBlockReason = 'illiquid_contract';
  else if (counterHtf) hardBlockReason = 'counter_htf_conflict';
  else if ((isLong && opp.priceChangePct >= 24) || (isShort && opp.priceChangePct <= -24)) {
    hardBlockReason = 'exhausted_24h_extension';
  } else if (opp.riskReward2 < 1.35 || !geometryOk) {
    hardBlockReason = 'invalid_risk_reward';
  }

  const hardBlocked = Boolean(hardBlockReason);
  const qualified =
    !hardBlocked &&
    passedCount >= minCriteriaRequired &&
    opp.confidence >= minConfidence;

  const grade: AlertQualityGrade =
    passedCount >= 7 || (passedCount >= 6 && opp.confidence >= 76)
      ? 'A+'
      : passedCount >= 6 || opp.confidence >= 70
        ? 'A'
        : 'B';

  const sideProb = isLong ? opp.pumpProbability : isShort ? opp.dumpProbability : 0;
  const compositeScore = Math.round(
    clamp(
      (passedCount / 7) * 46 +
        opp.confidence * 0.34 +
        sideProb * 0.2 -
        (hardBlocked ? 40 : 0),
      0,
      99,
    ),
  );

  return {
    qualified,
    hardBlocked,
    hardBlockReason,
    passedCount,
    totalCount: criteria.length,
    grade,
    compositeScore,
    criteria,
  };
}

export function buildOpportunityFromAnalysisResult(
  analysis: AnalysisResult,
): ScannerOpportunity {
  const topPat = analysis.patterns[0];
  const vwap = analysis.indicators.vwap;
  const vwapDistPct =
    vwap > 0 ? Number((((analysis.lastPrice - vwap) / vwap) * 100).toFixed(2)) : 0;

  return {
    symbol: analysis.symbol,
    baseAsset: analysis.baseAsset,
    timeframe: analysis.timeframe,
    lastPrice: analysis.lastPrice,
    markPrice: analysis.markPrice,
    priceChangePct: analysis.priceChangePct,
    quoteVolume24h: analysis.quoteVolume24h,
    openInterestUsd: analysis.openInterestUsd,
    oiDeltaPct: analysis.oiDeltaPct,
    fundingRate: analysis.fundingRate,
    direction: analysis.direction,
    phase: analysis.phase,
    confidence: analysis.confidence,
    pumpProbability: analysis.pumpProbability,
    dumpProbability: analysis.dumpProbability,
    sharpMoveScore: analysis.sharpMoveScore,
    sharpMoveBias: analysis.sharpMoveBias,
    ttmSqueeze: analysis.indicators.ttmSqueeze,
    squeezeBars: analysis.indicators.squeezeBars,
    cvdDivergence: analysis.indicators.cvdDivergence,
    suspiciousVolumeScore: analysis.suspiciousVolumeScore,
    volumeZScore: analysis.volumeZScore,
    volumeRatio20: analysis.volumeRatio20,
    takerBuyRatio: analysis.takerBuyRatio,
    rsi14: analysis.indicators.rsi14,
    adx14: analysis.indicators.adx14,
    vwapDistPct,
    cmf20: analysis.indicators.cmf20,
    atrPct: analysis.indicators.atrPct,
    bbWidthPercentile: analysis.indicators.bbWidthPercentile,
    isSqueeze: analysis.isSqueeze,
    imbalanceRatio: analysis.orderBook ? analysis.orderBook.imbalanceRatio : null,
    spreadPct: analysis.orderBook ? analysis.orderBook.spreadPct : null,
    mtfAlignment: analysis.mtf?.alignmentLabel ?? null,
    alignedTimeframes: analysis.mtf?.alignedTimeframes ?? 0,
    topPatternEn: topPat?.nameEn ?? null,
    topPatternFa: topPat?.nameFa ?? null,
    optimalEntry: analysis.tradePlan.optimalEntry,
    stopLoss: analysis.tradePlan.stopLoss,
    tp1: analysis.tradePlan.tp1,
    tp2: analysis.tradePlan.tp2,
    tp3: analysis.tradePlan.tp3,
    support1: analysis.indicators.support1,
    resistance1: analysis.indicators.resistance1,
    smcZone: analysis.indicators.smcZone,
    riskReward2: analysis.tradePlan.riskReward2,
    suggestedMaxLeverage: analysis.tradePlan.suggestedMaxLeverage,
    summaryEn: analysis.summaryEn,
    summaryFa: analysis.summaryFa,
    analyzedAt: analysis.analyzedAt,
  };
}
