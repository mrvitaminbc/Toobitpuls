import type {
  AnalysisResult,
  BacktestSummary,
  Candle,
  DetectedPattern,
  MarketPhase,
  MtfSummary,
  MtfTimeframeSnapshot,
  OrderBookSnapshot,
  RecentTrade,
  SignalDirection,
  SignalFactor,
  Timeframe,
  TradePlan,
} from '../types/futures';
import {
  calcADX,
  calcATR,
  calcBollingerBands,
  calcCMF,
  calcCVDDivergence,
  calcCVDSeries,
  calcDonchianBreakout,
  calcEMA,
  calcIchimoku,
  calcMACD,
  calcMACDSeries,
  calcMFI,
  calcOBVBreakout,
  calcOBVSlope,
  calcRSI,
  calcRangeCompressionRatio,
  calcStochRSI,
  calcSuperTrend,
  calcTTMSqueeze,
  calcVWAPSeries,
  calcVolumeMetrics,
  clamp,
  detectLiquidityWick,
  detectPivotLevels,
} from './indicators';
import { analyzeSmcAndChartPatterns } from './patterns';

export interface AnalyzeInput {
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  candles: Candle[];
  mtfCandles?: {
    tf1h?: Candle[];
    tf4h?: Candle[];
    tf1d?: Candle[];
  };
  markPrice?: number;
  indexBasisPct?: number;
  priceChangePct?: number;
  quoteVolume24h?: number;
  openInterestUsd?: number;
  oiDeltaPct?: number;
  fundingRate?: number;
  orderBook?: OrderBookSnapshot | null;
  recentTrades?: RecentTrade[];
}

export function roundPrice(value: number, refPrice: number): number {
  if (!Number.isFinite(value)) return 0;
  if (refPrice >= 1000) return Number(value.toFixed(2));
  if (refPrice >= 10) return Number(value.toFixed(3));
  if (refPrice >= 0.1) return Number(value.toFixed(4));
  if (refPrice >= 0.001) return Number(value.toFixed(6));
  return Number(value.toFixed(8));
}

export function evaluateTimeframeRegime(
  candles: Candle[] | undefined,
  timeframe: '1h' | '4h' | '1d',
): MtfTimeframeSnapshot | null {
  if (!candles || candles.length < 20) return null;

  const closes = candles.map((c) => c.close);
  const lastIdx = candles.length - 1;
  const lastPrice = closes[lastIdx];
  const ema9 = calcEMA(closes, 9)[lastIdx] ?? lastPrice;
  const ema21 = calcEMA(closes, 21)[lastIdx] ?? lastPrice;
  const ema50 = calcEMA(closes, Math.min(50, Math.max(21, Math.floor(candles.length * 0.7))))[lastIdx] ?? ema21;
  const ema200 = calcEMA(closes, Math.min(200, Math.max(50, candles.length - 2)))[lastIdx] ?? ema50;

  const superTrend = calcSuperTrend(candles, 10, 3);
  const ichimoku = calcIchimoku(candles);
  const adxInfo = calcADX(candles, 14);
  const rsiArr = calcRSI(closes, 14);
  const rsi14 = rsiArr[lastIdx] ?? 50;
  const macd = calcMACD(closes, 12, 26, 9);
  const macdHistSeries = calcMACDSeries(closes, 12, 26, 9).histogram;
  const smc = analyzeSmcAndChartPatterns(candles, rsiArr, macdHistSeries);

  let score = 0;

  // EMA Alignment (±30)
  score += ema9 > ema21 ? 10 : -10;
  score += ema21 > ema50 ? 10 : -10;
  score += lastPrice > ema50 ? 5 : -5;
  score += lastPrice > ema200 ? 5 : -5;

  // SuperTrend (±24)
  score += superTrend.direction === 'BULLISH' ? 24 : -24;

  // Ichimoku Cloud + TK Cross (±22)
  if (ichimoku.cloudState === 'ABOVE_KUMO') score += 16;
  else if (ichimoku.cloudState === 'BELOW_KUMO') score -= 16;
  score += ichimoku.tkCross === 'BULLISH' ? 6 : -6;

  // ADX & DI (±12)
  if (adxInfo.adx >= 19) {
    score += adxInfo.plusDi >= adxInfo.minusDi ? 12 : -12;
  }

  // MACD & RSI Momentum (±12)
  score += macd.histogram >= 0 ? 6 : -6;
  if (rsi14 >= 54) score += 6;
  else if (rsi14 <= 46) score -= 6;

  // SMC Structural Bias adjustment
  if (smc.smcStructure === 'BULLISH') score += 6;
  else if (smc.smcStructure === 'BEARISH') score -= 6;

  score = Math.round(clamp(score, -100, 100));
  const direction: SignalDirection = score >= 18 ? 'LONG' : score <= -18 ? 'SHORT' : 'NEUTRAL';

  let structure: 'BULLISH' | 'BEARISH' | 'RANGING' = smc.smcStructure;
  if (structure === 'RANGING') {
    if (score >= 30 && adxInfo.adx >= 18) structure = 'BULLISH';
    else if (score <= -30 && adxInfo.adx >= 18) structure = 'BEARISH';
  }

  return {
    timeframe,
    direction,
    score,
    superTrend: superTrend.direction,
    ichimoku: ichimoku.cloudState,
    adx14: Number(adxInfo.adx.toFixed(1)),
    rsi14: Number(rsi14.toFixed(1)),
    structure,
  };
}

export function buildMtfSummary(params: {
  timeframe: Timeframe;
  candles: Candle[];
  mtfCandles?: {
    tf1h?: Candle[];
    tf4h?: Candle[];
    tf1d?: Candle[];
  };
}): MtfSummary | null {
  const { timeframe, candles, mtfCandles } = params;

  const candles1h = mtfCandles?.tf1h ?? (timeframe === '1h' ? candles : undefined);
  const candles4h = mtfCandles?.tf4h ?? (timeframe === '4h' ? candles : undefined);
  const candles1d = mtfCandles?.tf1d ?? (timeframe === '1d' ? candles : undefined);

  const tf1h = evaluateTimeframeRegime(candles1h, '1h');
  const tf4h = evaluateTimeframeRegime(candles4h, '4h');
  const tf1d = evaluateTimeframeRegime(candles1d, '1d');

  const snapshots = [
    { snap: tf1d, weight: 0.4 },
    { snap: tf4h, weight: 0.35 },
    { snap: tf1h, weight: 0.25 },
  ].filter((item): item is { snap: MtfTimeframeSnapshot; weight: number } => item.snap !== null);

  if (snapshots.length === 0) return null;

  const weightSum = snapshots.reduce((acc, s) => acc + s.weight, 0);
  const alignmentScore = Math.round(
    clamp(
      snapshots.reduce((acc, s) => acc + s.snap.score * (s.weight / weightSum), 0),
      -100,
      100,
    ),
  );

  const bullCount = snapshots.filter((s) => s.snap.direction === 'LONG').length;
  const bearCount = snapshots.filter((s) => s.snap.direction === 'SHORT').length;
  const alignedTimeframes = alignmentScore >= 0 ? bullCount : bearCount;

  let alignmentLabel: MtfSummary['alignmentLabel'] = 'CONFLICT';
  if (bullCount === 3 || (bullCount >= 2 && bearCount === 0 && alignmentScore >= 46)) {
    alignmentLabel = 'STRONG_BULL';
  } else if (bearCount === 3 || (bearCount >= 2 && bullCount === 0 && alignmentScore <= -46)) {
    alignmentLabel = 'STRONG_BEAR';
  } else if (alignmentScore >= 18 && bullCount >= bearCount) {
    alignmentLabel = 'BULL_CONFLUENCE';
  } else if (alignmentScore <= -18 && bearCount >= bullCount) {
    alignmentLabel = 'BEAR_CONFLUENCE';
  }

  return {
    tf1h,
    tf4h,
    tf1d,
    alignmentScore,
    alignmentLabel,
    alignedTimeframes,
  };
}

export function buildTradePlan(params: {
  direction: SignalDirection;
  lastPrice: number;
  atr: number;
  support1: number;
  resistance1: number;
  smcZone?: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  isExplosivePreMove?: boolean;
  gateReasonEn?: string;
  gateReasonFa?: string;
}): TradePlan {
  const {
    direction,
    lastPrice,
    atr,
    support1,
    resistance1,
    smcZone,
    isExplosivePreMove = false,
    gateReasonEn,
    gateReasonFa,
  } = params;
  const safeAtr = atr > 0 ? atr : lastPrice * 0.014;

  if (direction === 'LONG') {
    const pullbackAdj = smcZone === 'PREMIUM' ? 0.28 : 0.14;
    const entryLow = roundPrice(lastPrice - safeAtr * (pullbackAdj + 0.25), lastPrice);
    const entryHigh = roundPrice(lastPrice + safeAtr * 0.1, lastPrice);
    const optimalEntry = roundPrice(lastPrice - safeAtr * pullbackAdj, lastPrice);

    const structStop = Math.min(
      lastPrice - safeAtr * 1.4,
      Math.max(support1 * 0.994, lastPrice - safeAtr * 2.45),
    );
    const stopLoss = roundPrice(Math.min(structStop, optimalEntry - safeAtr * 1.25), lastPrice);
    const risk = Math.max(optimalEntry - stopLoss, lastPrice * 0.004);

    const tp3Mult = isExplosivePreMove ? 4.8 : 3.8;
    const tp1 = roundPrice(optimalEntry + risk * 1.5, lastPrice);
    const tp2 = roundPrice(optimalEntry + risk * (isExplosivePreMove ? 2.8 : 2.5), lastPrice);
    const tp3 = roundPrice(
      Math.max(optimalEntry + risk * tp3Mult, resistance1 * (isExplosivePreMove ? 1.035 : 1.015)),
      lastPrice,
    );
    const slDistancePct = Number((((optimalEntry - stopLoss) / optimalEntry) * 100).toFixed(2));
    const suggestedMaxLeverage = clamp(Math.floor(36 / Math.max(slDistancePct, 1.0)), 2, 15);

    return {
      action: 'LONG',
      entryZoneLow: entryLow,
      entryZoneHigh: entryHigh,
      optimalEntry,
      stopLoss,
      slDistancePct,
      tp1,
      tp2,
      tp3,
      riskReward1: 1.5,
      riskReward2: isExplosivePreMove ? 2.8 : 2.5,
      riskReward3: Number(((tp3 - optimalEntry) / risk).toFixed(2)),
      suggestedMaxLeverage,
      invalidationEn: `HTF/Primary candle close below $${stopLoss} invalidates the bullish setup.`,
      invalidationFa: `تثبیت کندل زیر $${stopLoss} سناریوی صعودی و ساختار تقاضا را باطل می‌کند.`,
    };
  }

  if (direction === 'SHORT') {
    const pullbackAdj = smcZone === 'DISCOUNT' ? 0.28 : 0.14;
    const entryLow = roundPrice(lastPrice - safeAtr * 0.1, lastPrice);
    const entryHigh = roundPrice(lastPrice + safeAtr * (pullbackAdj + 0.25), lastPrice);
    const optimalEntry = roundPrice(lastPrice + safeAtr * pullbackAdj, lastPrice);

    const structStop = Math.max(
      lastPrice + safeAtr * 1.4,
      Math.min(resistance1 * 1.006, lastPrice + safeAtr * 2.45),
    );
    const stopLoss = roundPrice(Math.max(structStop, optimalEntry + safeAtr * 1.25), lastPrice);
    const risk = Math.max(stopLoss - optimalEntry, lastPrice * 0.004);

    const tp3Mult = isExplosivePreMove ? 4.8 : 3.8;
    const tp1 = roundPrice(optimalEntry - risk * 1.5, lastPrice);
    const tp2 = roundPrice(optimalEntry - risk * (isExplosivePreMove ? 2.8 : 2.5), lastPrice);
    const tp3 = roundPrice(
      Math.max(
        optimalEntry * 0.2,
        Math.min(optimalEntry - risk * tp3Mult, support1 * (isExplosivePreMove ? 0.965 : 0.985)),
      ),
      lastPrice,
    );
    const slDistancePct = Number((((stopLoss - optimalEntry) / optimalEntry) * 100).toFixed(2));
    const suggestedMaxLeverage = clamp(Math.floor(36 / Math.max(slDistancePct, 1.0)), 2, 15);

    return {
      action: 'SHORT',
      entryZoneLow: entryLow,
      entryZoneHigh: entryHigh,
      optimalEntry,
      stopLoss,
      slDistancePct,
      tp1,
      tp2,
      tp3,
      riskReward1: 1.5,
      riskReward2: isExplosivePreMove ? 2.8 : 2.5,
      riskReward3: Number(((optimalEntry - tp3) / risk).toFixed(2)),
      suggestedMaxLeverage,
      invalidationEn: `Candle close above $${stopLoss} invalidates the bearish distribution breakdown.`,
      invalidationFa: `تثبیت کندل بالای $${stopLoss} سناریوی نزولی و شکست عرضه را باطل می‌کند.`,
    };
  }

  return {
    action: 'WAIT',
    entryZoneLow: roundPrice(support1, lastPrice),
    entryZoneHigh: roundPrice(resistance1, lastPrice),
    optimalEntry: roundPrice(lastPrice, lastPrice),
    stopLoss: roundPrice(lastPrice - safeAtr * 1.5, lastPrice),
    slDistancePct: Number((((safeAtr * 1.5) / Math.max(lastPrice, 1e-8)) * 100).toFixed(2)),
    tp1: roundPrice(resistance1, lastPrice),
    tp2: roundPrice(resistance1 + safeAtr * 1.5, lastPrice),
    tp3: roundPrice(resistance1 + safeAtr * 3.0, lastPrice),
    riskReward1: 1.0,
    riskReward2: 2.2,
    riskReward3: 3.2,
    suggestedMaxLeverage: 3,
    invalidationEn: gateReasonEn || 'Waiting for 1H/4H/1D timeframe alignment and volume breakout confirmation.',
    invalidationFa: gateReasonFa || 'در انتظار هم‌گرایی تایم‌فریم‌های 1H/4H/1D و تایید حجم شکست.',
  };
}

export function runQuickBacktest(candles: Candle[]): BacktestSummary {
  if (candles.length < 70) {
    return { tradesCount: 0, winRatePct: 0, avgRr: 0, netReturnPct: 0, trades: [] };
  }

  const closes = candles.map((c) => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes, 14);

  let wins = 0;
  let losses = 0;
  let netReturnPct = 0;
  let totalRr = 0;
  const trades: NonNullable<BacktestSummary['trades']> = [];

  let i = 52;
  while (i < candles.length - 12) {
    const e9 = ema9[i];
    const e21 = ema21[i];
    const e50 = ema50[i];
    const prevE9 = ema9[i - 1];
    const prevE21 = ema21[i - 1];
    const r = rsi[i];
    const curr = candles[i];

    if (e9 === null || e21 === null || e50 === null || prevE9 === null || prevE21 === null || r === null) {
      i++;
      continue;
    }

    const totalVol = curr.quoteVolume > 0 ? curr.quoteVolume : curr.volume * curr.close;
    const buyRatio = totalVol > 0 && curr.takerBuyQuoteVol > 0 ? curr.takerBuyQuoteVol / totalVol : 0.5;
    const cmfLocal = calcCMF(candles.slice(Math.max(0, i - 19), i + 1), 20);

    let side: 'LONG' | 'SHORT' | null = null;
    if (
      (prevE9 <= prevE21 && e9 > e21 && curr.close > e50 && r < 68 && cmfLocal >= -0.05) ||
      (r < 34 && buyRatio > 0.55 && cmfLocal > 0)
    ) {
      side = 'LONG';
    } else if (
      (prevE9 >= prevE21 && e9 < e21 && curr.close < e50 && r > 32 && cmfLocal <= 0.05) ||
      (r > 68 && buyRatio < 0.45 && cmfLocal < 0)
    ) {
      side = 'SHORT';
    }

    if (!side) {
      i++;
      continue;
    }

    const localSlice = candles.slice(i - 15, i + 1);
    const atr = calcATR(localSlice, 14) || curr.close * 0.012;
    const entry = curr.close;
    const slDist = atr * 1.4;
    const tpDist = slDist * 2.2;

    const sl = side === 'LONG' ? entry - slDist : entry + slDist;
    const tp = side === 'LONG' ? entry + tpDist : entry - tpDist;

    let outcome: 'WIN' | 'LOSS' | 'SCRATCH' = 'SCRATCH';
    let exitBar = Math.min(i + 12, candles.length - 1);
    let exitPrice = candles[exitBar].close;

    for (let j = i + 1; j <= Math.min(i + 16, candles.length - 1); j++) {
      const bar = candles[j];
      if (side === 'LONG') {
        if (bar.low <= sl) {
          outcome = 'LOSS';
          exitBar = j;
          exitPrice = sl;
          break;
        }
        if (bar.high >= tp) {
          outcome = 'WIN';
          exitBar = j;
          exitPrice = tp;
          break;
        }
      } else {
        if (bar.high >= sl) {
          outcome = 'LOSS';
          exitBar = j;
          exitPrice = sl;
          break;
        }
        if (bar.low <= tp) {
          outcome = 'WIN';
          exitBar = j;
          exitPrice = tp;
          break;
        }
      }
    }

    let tradePnlPct = 0;
    let tradeRr = 0;
    if (outcome === 'WIN') {
      wins++;
      tradePnlPct = (tpDist / entry) * 100;
      tradeRr = 2.2;
    } else if (outcome === 'LOSS') {
      losses++;
      tradePnlPct = -(slDist / entry) * 100;
      tradeRr = -1.0;
    } else {
      const pct = side === 'LONG' ? ((exitPrice - entry) / entry) * 100 : ((entry - exitPrice) / entry) * 100;
      if (pct > 0) wins++;
      else losses++;
      tradePnlPct = pct;
      tradeRr = pct > 0 ? 0.6 : -0.5;
    }

    netReturnPct += tradePnlPct;
    totalRr += tradeRr;

    trades.push({
      id: `bt-${i}-${side}`,
      direction: side,
      entryTime: curr.time,
      exitTime: candles[exitBar].time,
      entryPrice: roundPrice(entry, entry),
      exitPrice: roundPrice(exitPrice, entry),
      stopLoss: roundPrice(sl, entry),
      takeProfit: roundPrice(tp, entry),
      outcome: tradePnlPct > 0 ? 'WIN' : 'LOSS',
      rMultiple: Number(tradeRr.toFixed(2)),
      pnlPct: Number(tradePnlPct.toFixed(2)),
    });

    i = exitBar + 1;
  }

  const tradesCount = wins + losses;
  return {
    tradesCount,
    winRatePct: tradesCount > 0 ? Math.round((wins / tradesCount) * 100) : 0,
    avgRr: tradesCount > 0 ? Number((totalRr / tradesCount).toFixed(2)) : 0,
    netReturnPct: Number(netReturnPct.toFixed(2)),
    trades: trades.slice(-24),
  };
}

function formatMtfSnapshotLabel(snap: MtfTimeframeSnapshot | null, lang: 'en' | 'fa'): string {
  if (!snap) return 'N/A';
  const dir =
    snap.direction === 'LONG'
      ? lang === 'fa'
        ? 'صعودی'
        : 'BULL'
      : snap.direction === 'SHORT'
        ? lang === 'fa'
          ? 'نزولی'
          : 'BEAR'
        : lang === 'fa'
          ? 'خنثی'
          : 'FLAT';
  return `${snap.timeframe.toUpperCase()}: ${dir} (${snap.score > 0 ? `+${snap.score}` : snap.score}, ST=${snap.superTrend === 'BULLISH' ? 'Bull' : 'Bear'})`;
}

function buildComprehensiveConclusion(params: {
  baseAsset: string;
  timeframe: Timeframe;
  lastPrice: number;
  direction: SignalDirection;
  phase: MarketPhase;
  confidence: number;
  pumpProbability: number;
  dumpProbability: number;
  sharpMoveScore: number;
  sharpMoveBias: 'PUMP_20_PLUS' | 'DUMP_20_PLUS' | 'BALANCED';
  suspiciousScore: number;
  volumeRatio20: number;
  volumeZScore: number;
  takerBuyRatio: number;
  cvdTrend: 'ACCUMULATION' | 'DISTRIBUTION' | 'BALANCED';
  cvdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  obvBreakout: 'BULLISH' | 'BEARISH' | 'NONE';
  isSqueeze: boolean;
  ttmSqueeze: boolean;
  squeezeBars: number;
  atrExpansionRatio: number;
  isVcpTightening: boolean;
  isAbsorption: boolean;
  donchianPos: number;
  bbWidthPercentile: number;
  rsi14: number;
  stochK: number;
  stochD: number;
  macdHist: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  vwap: number;
  adx14: number;
  plusDi: number;
  minusDi: number;
  superTrendDir: 'BULLISH' | 'BEARISH';
  ichimokuState: 'ABOVE_KUMO' | 'INSIDE_KUMO' | 'BELOW_KUMO';
  cmf20: number;
  mfi14: number;
  smcZone: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  smcStructure: 'BULLISH' | 'BEARISH' | 'RANGING';
  patterns: DetectedPattern[];
  mtf: MtfSummary | null;
  gateReasonEn?: string;
  gateReasonFa?: string;
  fundingRate: number;
  oiDeltaPct: number;
  orderBook: OrderBookSnapshot | null;
  wickSignal: 'BULLISH_ABSORPTION' | 'BEARISH_REJECTION' | 'NONE';
  support1: number;
  resistance1: number;
  tradePlan: TradePlan;
}): { conclusionEn: string; conclusionFa: string } {
  const {
    timeframe,
    lastPrice,
    direction,
    phase,
    confidence,
    pumpProbability,
    dumpProbability,
    sharpMoveScore,
    sharpMoveBias,
    suspiciousScore,
    volumeRatio20,
    volumeZScore,
    takerBuyRatio,
    cvdTrend,
    cvdDivergence,
    obvBreakout,
    isSqueeze,
    ttmSqueeze,
    squeezeBars,
    atrExpansionRatio,
    isVcpTightening,
    isAbsorption,
    donchianPos,
    bbWidthPercentile,
    rsi14,
    stochK,
    stochD,
    macdHist,
    ema9,
    ema21,
    ema50,
    ema200,
    vwap,
    adx14,
    plusDi,
    minusDi,
    superTrendDir,
    ichimokuState,
    cmf20,
    mfi14,
    smcZone,
    smcStructure,
    patterns,
    mtf,
    gateReasonEn,
    gateReasonFa,
    fundingRate,
    oiDeltaPct,
    orderBook,
    wickSignal,
    support1,
    resistance1,
    tradePlan,
  } = params;

  // 1. Multi-Timeframe Regime (1H / 4H / 1D)
  const mtfLineEn = mtf
    ? `1. MTF Regime (1H/4H/1D): Overall ${mtf.alignmentLabel.replace('_', ' ')} (Score ${mtf.alignmentScore > 0 ? `+${mtf.alignmentScore}` : mtf.alignmentScore}, ${mtf.alignedTimeframes}/3 aligned) — [${formatMtfSnapshotLabel(mtf.tf1h, 'en')} | ${formatMtfSnapshotLabel(mtf.tf4h, 'en')} | ${formatMtfSnapshotLabel(mtf.tf1d, 'en')}].`
    : `1. Structural Regime (${timeframe.toUpperCase()}): Single-timeframe evaluation (EMA200 $${roundPrice(ema200, lastPrice)}, SMC ${smcStructure}).`;

  const mtfLineFa = mtf
    ? `۱. هم‌گرایی تایم‌فریم‌ها (1H / 4H / 1D): وضعیت کلی ${mtf.alignmentLabel === 'STRONG_BULL' ? 'روند صعودی قدرتمند' : mtf.alignmentLabel === 'BULL_CONFLUENCE' ? 'هم‌سویی صعودی' : mtf.alignmentLabel === 'STRONG_BEAR' ? 'روند نزولی قدرتمند' : mtf.alignmentLabel === 'BEAR_CONFLUENCE' ? 'هم‌سویی نزولی' : 'تضاد تایم‌فریم‌ها'} (امتیاز ${mtf.alignmentScore > 0 ? `+${mtf.alignmentScore}` : mtf.alignmentScore}، هم‌گرایی ${mtf.alignedTimeframes}/3) — [${formatMtfSnapshotLabel(mtf.tf1h, 'fa')} | ${formatMtfSnapshotLabel(mtf.tf4h, 'fa')} | ${formatMtfSnapshotLabel(mtf.tf1d, 'fa')}].`
    : `۱. ساختار کلان (${timeframe.toUpperCase()}): تحلیل تک‌تایم‌فریم با مرجع EMA200 ($${roundPrice(ema200, lastPrice)}) و ساختار ${smcStructure}.`;

  // 2. Sharp Move (>=20%) Compression, Patterns & SMC
  const patEn =
    patterns.length > 0
      ? patterns
          .slice(0, 4)
          .map((p) => `${p.nameEn} (${p.bias})`)
          .join(', ')
      : 'No extreme reversal/continuation chart pattern active yet';
  const patFa =
    patterns.length > 0
      ? patterns
          .slice(0, 4)
          .map((p) => p.nameFa)
          .join('، ')
      : 'الگوی کلاسیک یا کندلی بازگشتی قطعی در این کندل ثبت نشده';

  const smcZoneEn =
    smcZone === 'DISCOUNT'
      ? 'Discount (institutional demand zone)'
      : smcZone === 'PREMIUM'
        ? 'Premium (institutional supply zone)'
        : 'Equilibrium mid-range';
  const smcZoneFa =
    smcZone === 'DISCOUNT'
      ? 'ناحیه ارزان‌فروشی/تقاضا (Discount)'
      : smcZone === 'PREMIUM'
        ? 'ناحیه گران‌فروشی/عرضه (Premium)'
        : 'محدوده تعادل (Equilibrium)';

  const sharpBiasEn =
    sharpMoveBias === 'PUMP_20_PLUS'
      ? '+20% Pre-Pump Bias'
      : sharpMoveBias === 'DUMP_20_PLUS'
        ? '-20% Pre-Dump Bias'
        : 'Neutral Expansion';
  const sharpBiasFa =
    sharpMoveBias === 'PUMP_20_PLUS'
      ? 'مستعد پامپ شارپ (+۲۰٪)'
      : sharpMoveBias === 'DUMP_20_PLUS'
        ? 'مستعد دامپ شارپ (-۲۰٪)'
        : 'بدون سوگیری انفجاری قطعی';

  const ttmStatusEn = ttmSqueeze
    ? `TTM Squeeze ACTIVE (${squeezeBars} bars inside Keltner)`
    : isSqueeze
      ? `BB Squeeze P${bbWidthPercentile}`
      : `BB P${bbWidthPercentile}`;
  const ttmStatusFa = ttmSqueeze
    ? `فشردگی TTM فعال (${squeezeBars} کندل داخل کانال کلتنر)`
    : isSqueeze
      ? `فشردگی بولینگر (صدک ${bbWidthPercentile})`
      : `پهنای باند در صدک ${bbWidthPercentile}`;

  const patternsLineEn = `2. Sharp-Move Coil (≥20% Readiness: ${sharpMoveScore}/100 · ${sharpBiasEn}) & SMC: ${ttmStatusEn}, ATR compression ${atrExpansionRatio}x${isVcpTightening ? ' (VCP tightening)' : ''}, Donchian pos ${donchianPos}%. Price sits in ${smcZoneEn} (${smcStructure}). Patterns: ${patEn}.`;
  const patternsLineFa = `۲. آمادگی حرکت شارپ (+۲۰٪: امتیاز ${sharpMoveScore}/100 · ${sharpBiasFa}) و الگوها: ${ttmStatusFa}، نسبت فشردگی نوسان ${atrExpansionRatio}x${isVcpTightening ? ' (تراکم VCP فعال)' : ''}، موقعیت دانچین ${donchianPos}٪. قیمت در ${smcZoneFa} با ساختار ${smcStructure === 'BULLISH' ? 'صعودی' : smcStructure === 'BEARISH' ? 'نزولی' : 'رنج'} است. الگوها: ${patFa}.`;

  // 3. Institutional Indicators Matrix
  const ichiEn =
    ichimokuState === 'ABOVE_KUMO'
      ? 'above Ichimoku Kumo'
      : ichimokuState === 'BELOW_KUMO'
        ? 'below Ichimoku Kumo'
        : 'inside Ichimoku Kumo';
  const ichiFa =
    ichimokuState === 'ABOVE_KUMO'
      ? 'بالای ابر کومو ایچیموکو'
      : ichimokuState === 'BELOW_KUMO'
        ? 'زیر ابر کومو ایچیموکو'
        : 'درون ابر کومو (ناحیه تردید)';

  const emaStateEn =
    ema9 > ema21 && ema21 > ema50
      ? 'bullish EMA 9/21/50 stack'
      : ema9 < ema21 && ema21 < ema50
        ? 'bearish EMA 9/21/50 stack'
        : 'mixed EMA transition';
  const emaStateFa =
    ema9 > ema21 && ema21 > ema50
      ? 'آرایش صعودی EMA 9/21/50'
      : ema9 < ema21 && ema21 < ema50
        ? 'آرایش نزولی EMA 9/21/50'
        : 'فاز انتقالی میانگین‌های EMA';

  const adxStateEn =
    adx14 >= 22
      ? `trending ADX ${adx14.toFixed(1)} (${plusDi >= minusDi ? 'DI+' : 'DI-'} leading)`
      : `coiling/low-ADX (${adx14.toFixed(1)})`;
  const adxStateFa =
    adx14 >= 22
      ? `روند فعال ADX=${adx14.toFixed(1)} (برتری ${plusDi >= minusDi ? 'DI+' : 'DI-'})`
      : `فاز تراکم/کم‌رمق (ADX=${adx14.toFixed(1)})`;

  const indicatorsLineEn = `3. Core Indicators: SuperTrend(10,3) is ${superTrendDir}, price sits ${ichiEn} & ${lastPrice >= vwap ? 'above' : 'below'} VWAP inside a ${emaStateEn} (${adxStateEn}). RSI(14)=${rsi14.toFixed(1)}, Stoch=${stochK.toFixed(0)}/${stochD.toFixed(0)}, MACD hist ${macdHist >= 0 ? 'positive' : 'negative'}, CMF(20)=${cmf20.toFixed(2)}, MFI(14)=${mfi14.toFixed(0)}.`;
  const indicatorsLineFa = `۳. اندیکاتورهای تخصصی: سوپرترند (SuperTrend 10,3) در وضعیت ${superTrendDir === 'BULLISH' ? 'صعودی' : 'نزولی'}، قیمت ${ichiFa} و ${lastPrice >= vwap ? 'بالای' : 'زیر'} VWAP در ${emaStateFa} با ${adxStateFa} قرار دارد. شاخص‌های RSI=${rsi14.toFixed(1)}، استوکستیک ${stochK.toFixed(0)}/${stochD.toFixed(0)}، مکدی ${macdHist >= 0 ? 'مثبت' : 'منفی'}، جریان نقدینگی CMF=${cmf20.toFixed(2)} و MFI=${mfi14.toFixed(0)} است.`;

  // 4. Smart Money Volume, CVD Divergence, Derivatives & Orderbook
  const takerBuyPct = Math.round(takerBuyRatio * 100);
  const cvdEn =
    cvdTrend === 'ACCUMULATION'
      ? `buyer accumulation (${takerBuyPct}% taker buys)`
      : cvdTrend === 'DISTRIBUTION'
        ? `seller distribution (${100 - takerBuyPct}% taker sells)`
        : `balanced orderflow (${takerBuyPct}% buys)`;
  const cvdFa =
    cvdTrend === 'ACCUMULATION'
      ? `انباشت تهاجمی خریداران (${takerBuyPct}٪ خرید مارکت)`
      : cvdTrend === 'DISTRIBUTION'
        ? `توزیع و فشار فروش تهاجمی (${100 - takerBuyPct}٪ فروش مارکت)`
        : `تعادل جریان سفارشات (${takerBuyPct}٪ خرید مارکت)`;

  const divTagsEn = [
    cvdDivergence !== 'NONE' ? `CVD ${cvdDivergence} Divergence` : null,
    obvBreakout !== 'NONE' ? `Leading OBV ${obvBreakout} Breakout` : null,
    isAbsorption ? 'Wyckoff Volume Absorption' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const divTagsFa = [
    cvdDivergence === 'BULLISH'
      ? 'واگرایی پنهان انباشت CVD'
      : cvdDivergence === 'BEARISH'
        ? 'واگرایی پنهان توزیع CVD'
        : null,
    obvBreakout === 'BULLISH'
      ? 'شکست پیش‌دستانه OBV صعودی'
      : obvBreakout === 'BEARISH'
        ? 'شکست پیش‌دستانه OBV نزولی'
        : null,
    isAbsorption ? 'جذب پنهان حجم (Wyckoff Absorption)' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const obEn = orderBook
    ? `Orderbook bid/ask ratio ${orderBook.imbalanceRatio.toFixed(2)}x.`
    : 'Live depth snapshot pending.';
  const obFa = orderBook
    ? `نسبت خرید به فروش دفتر سفارشات ${orderBook.imbalanceRatio.toFixed(2)}x.`
    : 'داده عمق لحظه‌ای بدون دیوار خاص.';

  const fundingPct = (fundingRate * 100).toFixed(4);
  const flowLineEn = `4. Orderflow, Absorption & Squeeze Fuel: Suspicious Volume=${suspiciousScore}/100 (${volumeRatio20}x avg, Z=${volumeZScore}) with ${cvdEn}${divTagsEn ? ` [${divTagsEn}]` : ''}. Funding=${fundingPct}%, OI delta=${oiDeltaPct >= 0 ? '+' : ''}${oiDeltaPct.toFixed(2)}%. ${obEn} Wick=${wickSignal}. S1=$${support1} / R1=$${resistance1}.`;
  const flowLineFa = `۴. جریان نقدینگی، واگرایی CVD و مشتقات: امتیاز حجم مشکوک ${suspiciousScore}/100 (${volumeRatio20} برابر میانگین، Z=${volumeZScore}) همراه با ${cvdFa}${divTagsFa ? ` [${divTagsFa}]` : ''}. فاندینگ ریت ${fundingPct}٪ و تغییر سود باز (OI) برابر ${oiDeltaPct >= 0 ? '+' : ''}${oiDeltaPct.toFixed(2)}٪ است. ${obFa} حمایت کلیدی $${support1} و مقاومت $${resistance1} است.`;

  // 5. Final Verdict & Execution
  const verdictEn =
    direction === 'LONG'
      ? `5. Final Verdict: Confirmed LONG (${confidence}% confidence · Phase: ${phase} · Pre-Pump ≥20% ${pumpProbability}% vs Dump ${dumpProbability}%). Optimal Entry ~$${tradePlan.optimalEntry}, Stop Loss $${tradePlan.stopLoss} (-${tradePlan.slDistancePct}%), Targets $${tradePlan.tp1} / $${tradePlan.tp2} / $${tradePlan.tp3} (max ${tradePlan.suggestedMaxLeverage}x).`
      : direction === 'SHORT'
        ? `5. Final Verdict: Confirmed SHORT (${confidence}% confidence · Phase: ${phase} · Pre-Dump ≥20% ${dumpProbability}% vs Pump ${pumpProbability}%). Optimal Entry ~$${tradePlan.optimalEntry}, Stop Loss $${tradePlan.stopLoss} (-${tradePlan.slDistancePct}%), Targets $${tradePlan.tp1} / $${tradePlan.tp2} / $${tradePlan.tp3} (max ${tradePlan.suggestedMaxLeverage}x).`
        : `5. Final Verdict: NEUTRAL / WAIT (${confidence}% score · Sharp-Move Readiness ${sharpMoveScore}/100 · Pump ${pumpProbability}% vs Dump ${dumpProbability}%). ${gateReasonEn ? `Filter Gate: ${gateReasonEn}. ` : ''}Wait for confirmed 1H/4H alignment and RVOL breakout past resistance $${resistance1} or support $${support1}.`;

  const verdictFa =
    direction === 'LONG'
      ? `۵. جمع‌بندی نهایی و پلن معامله: تایید سیگنال لانگ (خرید) با اطمینان ${confidence}٪ در فاز ${phase} (احتمال پامپ شارپ ${pumpProbability}٪ در برابر دامپ ${dumpProbability}٪). ورود بهینه $${tradePlan.optimalEntry}، حد ضرر $${tradePlan.stopLoss} (-${tradePlan.slDistancePct}٪) و تارگت‌های $${tradePlan.tp1}، $${tradePlan.tp2} و $${tradePlan.tp3} با حداکثر اهرم ${tradePlan.suggestedMaxLeverage}x.`
      : direction === 'SHORT'
        ? `۵. جمع‌بندی نهایی و پلن معامله: تایید سیگنال شورت (فروش) با اطمینان ${confidence}٪ در فاز ${phase} (احتمال دامپ شارپ ${dumpProbability}٪ در برابر پامپ ${pumpProbability}٪). ورود بهینه $${tradePlan.optimalEntry}، حد ضرر $${tradePlan.stopLoss} (-${tradePlan.slDistancePct}٪) و تارگت‌های $${tradePlan.tp1}، $${tradePlan.tp2} و $${tradePlan.tp3} با حداکثر اهرم ${tradePlan.suggestedMaxLeverage}x.`
        : `۵. جمع‌بندی نهایی و پلن معامله: وضعیت خنثی / انتظار (امتیاز حرکت شارپ ${sharpMoveScore}/100 · احتمال پامپ ${pumpProbability}٪ در برابر دامپ ${dumpProbability}٪). ${gateReasonFa ? `فیلتر ضدخطا: ${gateReasonFa}. ` : ''}تا زمان هم‌گرایی تایم‌فریم‌های ۱ و ۴ ساعته یا شکست معتبر مقاومت $${resistance1} / حمایت $${support1} با جهش حجم وارد نشوید.`;

  return {
    conclusionEn: [mtfLineEn, patternsLineEn, indicatorsLineEn, flowLineEn, verdictEn].join('\n'),
    conclusionFa: [mtfLineFa, patternsLineFa, indicatorsLineFa, flowLineFa, verdictFa].join('\n'),
  };
}

export function analyzeFuturesSymbol(input: AnalyzeInput): AnalysisResult {
  const {
    symbol,
    baseAsset,
    timeframe,
    candles,
    mtfCandles,
    markPrice: providedMarkPrice,
    indexBasisPct = 0,
    priceChangePct = 0,
    quoteVolume24h = 0,
    openInterestUsd = 0,
    oiDeltaPct = 0,
    fundingRate = 0,
    orderBook = null,
    recentTrades = [],
  } = input;

  const closes = candles.map((c) => c.close);
  const lastIdx = candles.length - 1;
  const lastPrice = lastIdx >= 0 ? closes[lastIdx] : 0;
  const markPrice = providedMarkPrice ?? lastPrice;

  const ema9Arr = calcEMA(closes, 9);
  const ema21Arr = calcEMA(closes, 21);
  const ema50Arr = calcEMA(closes, 50);
  const ema200Arr = calcEMA(closes, 200);
  const rsiArr = calcRSI(closes, 14);
  const stoch = calcStochRSI(rsiArr, 14, 3, 3);
  const macd = calcMACD(closes, 12, 26, 9);
  const macdSeries = calcMACDSeries(closes, 12, 26, 9);
  const bb = calcBollingerBands(closes, 20, 2);
  const atr14 = calcATR(candles, 14);
  const adxInfo = calcADX(candles, 14);
  const vwapArr = calcVWAPSeries(candles, 48);
  const obvSlope = calcOBVSlope(candles, 12);
  const volMetrics = calcVolumeMetrics(candles);
  const cvdInfo = calcCVDSeries(candles);
  const wickSignal = detectLiquidityWick(candles);
  const pivots = detectPivotLevels(candles, lastPrice);

  // Institutional pre-explosion + Pattern / SMC Suite + 1H/4H/1D MTF alignment
  const superTrend = calcSuperTrend(candles, 10, 3);
  const ichimoku = calcIchimoku(candles);
  const cmf20 = calcCMF(candles, 20);
  const mfi14 = calcMFI(candles, 14);
  const ttm = calcTTMSqueeze(candles);
  const compression = calcRangeCompressionRatio(candles);
  const cvdDivergence = calcCVDDivergence(candles, cvdInfo.series, 20);
  const obvBreakout = calcOBVBreakout(candles, 20);
  const donchian = calcDonchianBreakout(candles, 20, atr14);

  const patternSuite = analyzeSmcAndChartPatterns(candles, rsiArr, macdSeries.histogram);
  const mtf = buildMtfSummary({ timeframe, candles, mtfCandles });

  // Inject institutional squeeze / divergence catalysts into detected patterns list
  const extraPatterns: DetectedPattern[] = [];
  if (ttm.isSqueeze && ttm.squeezeBars >= 4) {
    extraPatterns.push({
      id: 'ttm_squeeze_coil',
      category: 'CHART',
      bias: ttm.momentum > 0.08 ? 'BULLISH' : ttm.momentum < -0.08 ? 'BEARISH' : 'NEUTRAL',
      strength: Math.min(90, 72 + ttm.squeezeBars * 2),
      nameEn: `TTM Volatility Squeeze (${ttm.squeezeBars} bars)`,
      nameFa: `فشردگی انفجاری TTM Squeeze (${ttm.squeezeBars} کندل)`,
      detailEn: `Bollinger Bands compressed inside Keltner Channels for ${ttm.squeezeBars} bars — coiled for a sharp expansion move.`,
      detailFa: `باند بولینگر به مدت ${ttm.squeezeBars} کندل داخل کانال کلتنر فشرده شده؛ انرژی آماده پرتاب قیمت است.`,
    });
  }
  if (cvdDivergence === 'BULLISH') {
    extraPatterns.push({
      id: 'cvd_bull_accumulation',
      category: 'DIVERGENCE',
      bias: 'BULLISH',
      strength: 83,
      nameEn: 'Stealth CVD Accumulation Divergence',
      nameFa: 'واگرایی پنهان انباشت نهنگ‌ها (CVD Accumulation)',
      detailEn: 'Cumulative Volume Delta surged positively while price remained flat/compressed — hidden buyer absorption.',
      detailFa: 'دلتای تجمعی خریداران در سکوت قیمتی به‌شدت صعود کرده است (نشانگر پیش‌تولید پامپ).',
    });
  } else if (cvdDivergence === 'BEARISH') {
    extraPatterns.push({
      id: 'cvd_bear_distribution',
      category: 'DIVERGENCE',
      bias: 'BEARISH',
      strength: 83,
      nameEn: 'Stealth CVD Distribution Divergence',
      nameFa: 'واگرایی پنهان توزیع عرضه (CVD Distribution)',
      detailEn: 'Aggressive seller delta accelerated downward despite price holding range highs — institutional distribution.',
      detailFa: 'جریان سفارش فروشندگان به‌صورت پنهانی در حال تخلیه نقدینگی است (هشدار دامپ شارپ).',
    });
  }
  if (obvBreakout === 'BULLISH') {
    extraPatterns.push({
      id: 'obv_bull_breakout',
      category: 'CHART',
      bias: 'BULLISH',
      strength: 78,
      nameEn: 'Leading OBV Volume Breakout',
      nameFa: 'شکست پیش‌دستانه حجم تجمعی (OBV Breakout)',
      detailEn: 'On-Balance Volume cleared its 20-bar peak ahead of price breakout.',
      detailFa: 'حجم تجمعی OBV پیش از شکست قیمتی از سقف ۲۰ کندل اخیر عبور کرده است.',
    });
  } else if (obvBreakout === 'BEARISH') {
    extraPatterns.push({
      id: 'obv_bear_breakdown',
      category: 'CHART',
      bias: 'BEARISH',
      strength: 78,
      nameEn: 'Leading OBV Volume Breakdown',
      nameFa: 'شکست نزولی پیش‌دستانه حجم (OBV Breakdown)',
      detailEn: 'On-Balance Volume dropped below 20-bar lows ahead of structural support failure.',
      detailFa: 'حجم تجمعی OBV پیش از شکست حمایت قیمتی به کف ۲۰ کندل نفوذ کرده است.',
    });
  }

  const allPatterns = [...patternSuite.patterns, ...extraPatterns]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 8);

  const ema9 = ema9Arr[lastIdx] ?? lastPrice;
  const ema21 = ema21Arr[lastIdx] ?? lastPrice;
  const ema50 = ema50Arr[lastIdx] ?? lastPrice;
  const ema200 = ema200Arr[lastIdx] ?? ema50;
  const rsi14 = rsiArr[lastIdx] ?? 50;
  const bbUpper = bb.upper[lastIdx] ?? lastPrice * 1.02;
  const bbMiddle = bb.middle[lastIdx] ?? lastPrice;
  const bbLower = bb.lower[lastIdx] ?? lastPrice * 0.98;
  const bbWidthPct = bb.widthPct[lastIdx] ?? 2.5;
  const vwap = vwapArr[lastIdx] ?? lastPrice;
  const atrPct = lastPrice > 0 ? (atr14 / lastPrice) * 100 : 1.0;
  const isSqueeze = ttm.isSqueeze || bb.widthPercentile <= 30;

  const price3Ago = candles.length >= 4 ? candles[candles.length - 4].close : lastPrice;
  const priceMove3Pct = price3Ago > 0 ? ((lastPrice - price3Ago) / price3Ago) * 100 : 0;

  // --- 12 Institutional Quantitative & Sharp-Move Factors (Total Weight = 1.00) ---

  // 1. MTF Confluence (1H · 4H · 1D) — Weight 0.14
  let mtfFactorScore = 0;
  if (mtf) {
    mtfFactorScore = mtf.alignmentScore;
  } else {
    mtfFactorScore += superTrend.direction === 'BULLISH' ? 35 : -35;
    mtfFactorScore += ichimoku.cloudState === 'ABOVE_KUMO' ? 35 : ichimoku.cloudState === 'BELOW_KUMO' ? -35 : 0;
    mtfFactorScore += lastPrice > ema50 ? 20 : -20;
    mtfFactorScore = clamp(mtfFactorScore, -100, 100);
  }

  // 2. SuperTrend(10,3), Ichimoku Kumo & EMA 9/21/50/200 — Weight 0.10
  let trendStackScore = 0;
  trendStackScore += superTrend.direction === 'BULLISH' ? 32 : -32;
  if (superTrend.flippedRecently) {
    trendStackScore += superTrend.direction === 'BULLISH' ? 12 : -12;
  }
  if (ichimoku.cloudState === 'ABOVE_KUMO') trendStackScore += 24;
  else if (ichimoku.cloudState === 'BELOW_KUMO') trendStackScore -= 24;
  trendStackScore += ichimoku.tkCross === 'BULLISH' ? 10 : -10;
  trendStackScore += ema9 > ema21 ? 10 : -10;
  trendStackScore += ema21 > ema50 ? 12 : -12;
  trendStackScore = clamp(trendStackScore, -100, 100);

  // 3. TTM Squeeze (BB < KC) & VCP Volatility Compression — Weight 0.11
  let ttmCompressionScore = 0;
  const compressionIntensity =
    (ttm.isSqueeze ? 36 + Math.min(24, ttm.squeezeBars * 3) : ttm.squeezeFired ? 44 : 0) +
    (compression.isVcpTightening ? 20 : 0) +
    (compression.atrExpansionRatio <= 0.65 ? 20 : bb.widthPercentile <= 28 ? 14 : 0);
  if (compressionIntensity > 0) {
    let dirBias = 0;
    if (ttm.momentum > 0.08) dirBias += 0.45;
    else if (ttm.momentum < -0.08) dirBias -= 0.45;
    if (ttm.momentum > ttm.prevMomentum) dirBias += 0.2;
    else if (ttm.momentum < ttm.prevMomentum) dirBias -= 0.2;
    if (cvdInfo.takerBuyRatio >= 0.53) dirBias += 0.35;
    else if (cvdInfo.takerBuyRatio <= 0.47) dirBias -= 0.35;
    if (cvdDivergence === 'BULLISH') dirBias += 0.35;
    else if (cvdDivergence === 'BEARISH') dirBias -= 0.35;
    ttmCompressionScore = clamp(compressionIntensity * clamp(dirBias, -1, 1), -100, 100);
  }

  // 4. Smart Money Structure (BOS / CHoCH / FVG / Order Block / Spring-UTAD / Zone) — Weight 0.10
  const smcFactorScore = patternSuite.smcScore;

  // 5. Classical Chart Patterns, Candlestick & RSI/MACD Divergences — Weight 0.09
  const patternFactorScore = patternSuite.candlestickAndChartScore;

  // 6. Suspicious Volume Z-Score & Wyckoff Absorption — Weight 0.10
  let volumeAnomalyScore = 0;
  const effectiveSuspicious = Math.min(100, volMetrics.suspiciousScore + (compression.isAbsorption ? 15 : 0));
  if (effectiveSuspicious > 16) {
    const dirSign =
      cvdInfo.takerBuyRatio >= 0.52 || cmf20 >= 0.08 || cvdDivergence === 'BULLISH'
        ? 1
        : cvdInfo.takerBuyRatio <= 0.48 || cmf20 <= -0.08 || cvdDivergence === 'BEARISH'
          ? -1
          : priceMove3Pct >= 0
            ? 0.45
            : -0.45;
    volumeAnomalyScore = clamp(effectiveSuspicious * dirSign, -100, 100);
  }

  // 7. CVD Divergence, Leading OBV Breakout, Taker Delta, CMF(20) & MFI(14) — Weight 0.10
  const takerBias = (cvdInfo.takerBuyRatio - 0.5) * 180;
  const cvdBias = clamp(cvdInfo.cvdSlopePct * 1.15, -35, 35);
  const cmfBias = clamp(cmf20 * 110, -35, 35);
  const mfiBias = mfi14 >= 65 ? 12 : mfi14 <= 35 ? -12 : 0;
  const divBoost = cvdDivergence === 'BULLISH' ? 32 : cvdDivergence === 'BEARISH' ? -32 : 0;
  const obvBoost = obvBreakout === 'BULLISH' ? 18 : obvBreakout === 'BEARISH' ? -18 : 0;
  const volBoost = effectiveSuspicious >= 40 ? 1.2 : 1.0;
  const orderflowScore = clamp(
    (takerBias * 0.45 + cvdBias * 0.3 + cmfBias * 0.4 + mfiBias * 0.3 + divBoost + obvBoost) * volBoost,
    -100,
    100,
  );

  // 8. RSI(14), StochRSI & MACD Momentum — Weight 0.07
  const strongBearTrend = adxInfo.adx >= 26 && adxInfo.minusDi > adxInfo.plusDi + 6;
  const strongBullTrend = adxInfo.adx >= 26 && adxInfo.plusDi > adxInfo.minusDi + 6;

  let momentumScore = 0;
  if (rsi14 <= 32) momentumScore += strongBearTrend && cvdInfo.takerBuyRatio < 0.52 ? 18 : 55;
  else if (rsi14 <= 44 && stoch.k > stoch.d) momentumScore += 32;
  else if (rsi14 >= 72) momentumScore -= strongBullTrend && cvdInfo.takerBuyRatio > 0.48 ? 18 : 55;
  else if (rsi14 >= 58 && stoch.k < stoch.d) momentumScore -= 32;
  else if (rsi14 > 52) momentumScore += 14;
  else if (rsi14 < 48) momentumScore -= 14;

  if (macd.prevHistogram <= 0 && macd.histogram > 0) momentumScore += 42;
  else if (macd.prevHistogram >= 0 && macd.histogram < 0) momentumScore -= 42;
  else if (macd.histogram > 0 && macd.histogram > macd.prevHistogram) momentumScore += 28;
  else if (macd.histogram < 0 && macd.histogram < macd.prevHistogram) momentumScore -= 28;
  momentumScore = clamp(momentumScore, -100, 100);

  // 9. Donchian Breakout Proximity & VWAP Institutional Anchor — Weight 0.06
  let breakoutProxScore = 0;
  const vwapDistPct = vwap > 0 ? ((lastPrice - vwap) / vwap) * 100 : 0;
  if (vwapDistPct >= 7.5 && priceChangePct >= 15) {
    // Blow-off extension far above institutional VWAP: penalize chasing longs
    breakoutProxScore -= 28;
  } else if (vwapDistPct <= -7.5 && priceChangePct <= -15) {
    // Capitulation extension far below institutional VWAP: penalize chasing shorts
    breakoutProxScore += 28;
  } else if (vwapDistPct > 0.15) {
    breakoutProxScore += 26;
  } else if (vwapDistPct < -0.15) {
    breakoutProxScore -= 26;
  }

  if (donchian.nearHighBreakout && (cvdInfo.takerBuyRatio >= 0.51 || obvBreakout === 'BULLISH')) {
    breakoutProxScore += 52;
  } else if (donchian.nearLowBreakdown && (cvdInfo.takerBuyRatio <= 0.49 || obvBreakout === 'BEARISH')) {
    breakoutProxScore -= 52;
  } else if (lastPrice < bbLower && !strongBearTrend) {
    breakoutProxScore += 30;
  } else if (lastPrice > bbUpper && !strongBullTrend) {
    breakoutProxScore -= 30;
  }
  breakoutProxScore = clamp(breakoutProxScore, -100, 100);

  // 10. Derivatives (Funding Squeeze + Perp Index Basis + OI + Price Regime) — Weight 0.06
  let derivativesScore = 0;
  if (fundingRate <= -0.0003) derivativesScore += 52;
  else if (fundingRate <= -0.0001) derivativesScore += 24;
  else if (fundingRate >= 0.0005) derivativesScore -= 52;
  else if (fundingRate >= 0.0002) derivativesScore -= 24;

  if (indexBasisPct <= -0.06) derivativesScore += 22;
  else if (indexBasisPct >= 0.06) derivativesScore -= 22;

  if (oiDeltaPct > 1.0) {
    // Rising OI + Rising price/buy flow = fresh long capital; Rising OI + falling price/sell flow = fresh short buildup
    derivativesScore += cvdInfo.takerBuyRatio >= 0.51 || priceMove3Pct >= 0 ? 32 : -32;
  } else if (oiDeltaPct < -1.2) {
    // Falling OI indicates short covering or long liquidation unwinding (lower conviction trend continuation)
    derivativesScore += priceMove3Pct >= 0 ? -12 : 12;
  }
  derivativesScore = clamp(derivativesScore, -100, 100);

  // 11. Orderbook Depth & Liquidity Wicks — Weight 0.04
  let microstructureScore = 0;
  if (orderBook) {
    if (orderBook.imbalanceRatio >= 1.35) microstructureScore += 60;
    else if (orderBook.imbalanceRatio >= 1.12) microstructureScore += 30;
    else if (orderBook.imbalanceRatio <= 0.74) microstructureScore -= 60;
    else if (orderBook.imbalanceRatio <= 0.89) microstructureScore -= 30;
  }
  if (wickSignal === 'BULLISH_ABSORPTION') microstructureScore += 40;
  if (wickSignal === 'BEARISH_REJECTION') microstructureScore -= 40;
  microstructureScore = clamp(microstructureScore, -100, 100);

  // 12. Volatility Expansion & Overextension Filter — Weight 0.03
  let volExpansionScore = 0;
  if (priceChangePct >= 22 && rsi14 >= 72) {
    volExpansionScore = -60; // Exhausted vertical pump risk
  } else if (priceChangePct <= -22 && rsi14 <= 28) {
    volExpansionScore = 60; // Exhausted capitulation bounce risk
  } else if (compression.atrExpansionRatio <= 0.65) {
    volExpansionScore = cvdInfo.takerBuyRatio >= 0.52 ? 45 : cvdInfo.takerBuyRatio <= 0.48 ? -45 : 0;
  }
  volExpansionScore = clamp(volExpansionScore, -100, 100);

  const factors: SignalFactor[] = [
    {
      id: 'mtf_confluence',
      labelEn: 'MTF Confluence (1H/4H/1D)',
      labelFa: 'هم‌گرایی مولتی‌تایم‌فریم (1H/4H/1D)',
      score: Math.round(mtfFactorScore),
      weight: 0.14,
      valueText: mtf ? `${mtf.alignedTimeframes}/3 · ${mtf.alignmentScore > 0 ? `+${mtf.alignmentScore}` : mtf.alignmentScore}` : `${timeframe.toUpperCase()} Regime`,
      bias: mtfFactorScore > 15 ? 'BULLISH' : mtfFactorScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: mtf
        ? `1H(${mtf.tf1h?.score ?? '-'}) / 4H(${mtf.tf4h?.score ?? '-'}) / 1D(${mtf.tf1d?.score ?? '-'}) alignment.`
        : `Single-timeframe structural alignment (${timeframe}).`,
      detailFa: mtf
        ? `هم‌سویی تایم‌فریم‌های 1H (${mtf.tf1h?.score ?? '-'})، 4H (${mtf.tf4h?.score ?? '-'}) و 1D (${mtf.tf1d?.score ?? '-'}).`
        : `هم‌سویی ساختاری تایم‌فریم ${timeframe}.`,
    },
    {
      id: 'trend_ichimoku_supertrend',
      labelEn: 'SuperTrend & Ichimoku Kumo',
      labelFa: 'سوپرترند، ابر ایچیموکو و EMA',
      score: Math.round(trendStackScore),
      weight: 0.1,
      valueText: `${superTrend.direction === 'BULLISH' ? 'ST Bull' : 'ST Bear'} · ${ichimoku.cloudState.replace('_KUMO', '')}`,
      bias: trendStackScore > 15 ? 'BULLISH' : trendStackScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: `SuperTrend(10,3) ${superTrend.direction}, Ichimoku ${ichimoku.cloudState.replace('_', ' ')}, EMA9 ${ema9 > ema21 ? '>' : '<'} EMA21.`,
      detailFa: `سوپرترند ${superTrend.direction === 'BULLISH' ? 'صعودی' : 'نزولی'}، ابر کومو ${ichimoku.cloudState === 'ABOVE_KUMO' ? 'زیر قیمت' : ichimoku.cloudState === 'BELOW_KUMO' ? 'بالای قیمت' : 'خنثی'}.`,
    },
    {
      id: 'ttm_squeeze_vcp',
      labelEn: 'TTM Squeeze & VCP Coil',
      labelFa: 'فشردگی TTM و تراکم VCP',
      score: Math.round(ttmCompressionScore),
      weight: 0.11,
      valueText: ttm.isSqueeze
        ? `TTM ${ttm.squeezeBars}b · ATR ${compression.atrExpansionRatio}x`
        : `ATR ${compression.atrExpansionRatio}x · P${Math.round(bb.widthPercentile)}`,
      bias: ttmCompressionScore > 12 ? 'BULLISH' : ttmCompressionScore < -12 ? 'BEARISH' : 'NEUTRAL',
      detailEn: ttm.isSqueeze
        ? `BB contracted inside Keltner Channels (${ttm.squeezeBars} bars); momentum ${ttm.momentum >= 0 ? '+' : ''}${ttm.momentum}.`
        : `Volatility ratio ${compression.atrExpansionRatio}x of 36-bar peak${compression.isVcpTightening ? ' with VCP tightening' : ''}.`,
      detailFa: ttm.isSqueeze
        ? `باند بولینگر داخل کانال کلتنر (${ttm.squeezeBars} کندل) با مومنتوم ${ttm.momentum >= 0 ? '+' : ''}${ttm.momentum} فشرده شده است.`
        : `نسبت نوسان به اوج ۳۶ کندل برابر ${compression.atrExpansionRatio}x${compression.isVcpTightening ? ' (تراکم VCP فعال)' : ''}.`,
    },
    {
      id: 'smc_structure',
      labelEn: 'SMC Structure & Wyckoff',
      labelFa: 'ساختار اسمارت‌مانی و وایکوف',
      score: Math.round(smcFactorScore),
      weight: 0.1,
      valueText: `${patternSuite.smcStructure} · ${patternSuite.smcZone}`,
      bias: smcFactorScore > 15 ? 'BULLISH' : smcFactorScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: `Smart Money structure is ${patternSuite.smcStructure} inside ${patternSuite.smcZone} pricing zone.`,
      detailFa: `ساختار بازار ${patternSuite.smcStructure === 'BULLISH' ? 'صعودی' : patternSuite.smcStructure === 'BEARISH' ? 'نزولی' : 'رنج'} در ناحیه ${patternSuite.smcZone}.`,
    },
    {
      id: 'chart_candle_patterns',
      labelEn: 'Chart Patterns & Divergences',
      labelFa: 'الگوهای کلاسیک، کندلی و واگرایی',
      score: Math.round(patternFactorScore),
      weight: 0.09,
      valueText: `${allPatterns.length} Active`,
      bias: patternFactorScore > 12 ? 'BULLISH' : patternFactorScore < -12 ? 'BEARISH' : 'NEUTRAL',
      detailEn:
        allPatterns.length > 0
          ? allPatterns.slice(0, 2).map((p) => p.nameEn).join(' + ')
          : 'No active candlestick/chart breakout or RSI divergence.',
      detailFa:
        allPatterns.length > 0
          ? allPatterns.slice(0, 2).map((p) => p.nameFa).join(' + ')
          : 'الگوی کندلی، کلاسیک یا واگرایی فعال شناسایی نشد.',
    },
    {
      id: 'volume_anomaly',
      labelEn: 'RVOL Z-Score & Absorption',
      labelFa: 'ناهنجاری حجم و جذب نقدینگی',
      score: Math.round(volumeAnomalyScore),
      weight: 0.1,
      valueText: `Z ${volMetrics.zScore} (${volMetrics.ratio20}x)${compression.isAbsorption ? ' · Abs' : ''}`,
      bias: volumeAnomalyScore > 15 ? 'BULLISH' : volumeAnomalyScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: `Volume is ${volMetrics.ratio20}x 20-bar average (Z=${volMetrics.zScore})${compression.isAbsorption ? ' with Wyckoff stealth absorption' : ''}.`,
      detailFa: `حجم معاملات ${volMetrics.ratio20} برابر میانگین ۲۰ کندل است (Z=${volMetrics.zScore})${compression.isAbsorption ? ' همراه با جذب پنهان وایکوف' : ''}.`,
    },
    {
      id: 'cvd_orderflow',
      labelEn: 'CVD Div, OBV & CMF/MFI Flow',
      labelFa: 'واگرایی CVD، OBV و جریان پول',
      score: Math.round(orderflowScore),
      weight: 0.1,
      valueText: `${Math.round(cvdInfo.takerBuyRatio * 100)}% Buy · CMF ${cmf20.toFixed(2)}`,
      bias: orderflowScore > 15 ? 'BULLISH' : orderflowScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: `Taker buy ${(cvdInfo.takerBuyRatio * 100).toFixed(1)}%, CVD Div=${cvdDivergence}, OBV=${obvBreakout}, CMF=${cmf20.toFixed(2)}.`,
      detailFa: `خرید مارکت ${(cvdInfo.takerBuyRatio * 100).toFixed(1)}٪، واگرایی CVD=${cvdDivergence}، شکست OBV=${obvBreakout}، CMF=${cmf20.toFixed(2)}.`,
    },
    {
      id: 'momentum_macd_rsi',
      labelEn: 'RSI(14), StochRSI & MACD',
      labelFa: 'مومنتوم RSI، استوکستیک و مکدی',
      score: Math.round(momentumScore),
      weight: 0.07,
      valueText: `RSI ${rsi14.toFixed(1)} · ${macd.histogram >= 0 ? '+MACD' : '-MACD'}`,
      bias: momentumScore > 15 ? 'BULLISH' : momentumScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: `RSI ${rsi14.toFixed(1)}, Stoch ${stoch.k.toFixed(0)}/${stoch.d.toFixed(0)}, MACD hist ${macd.histogram >= macd.prevHistogram ? 'rising' : 'falling'}.`,
      detailFa: `RSI روی ${rsi14.toFixed(1)}، استوکستیک ${stoch.k.toFixed(0)}/${stoch.d.toFixed(0)} و مکدی ${macd.histogram >= macd.prevHistogram ? 'رو به رشد' : 'رو به افت'}.`,
    },
    {
      id: 'breakout_proximity',
      labelEn: 'Donchian Breakout & VWAP',
      labelFa: 'آستانه شکست دانچین و VWAP',
      score: Math.round(breakoutProxScore),
      weight: 0.06,
      valueText: `DC ${donchian.posPct}% · ${vwapDistPct >= 0 ? '+' : ''}${vwapDistPct.toFixed(2)}% VWAP`,
      bias: breakoutProxScore > 15 ? 'BULLISH' : breakoutProxScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: `Donchian 20-bar position ${donchian.posPct}%; price is ${Math.abs(vwapDistPct).toFixed(2)}% ${vwapDistPct >= 0 ? 'above' : 'below'} VWAP.`,
      detailFa: `موقعیت در کانال ۲۰ کندلی دانچین ${donchian.posPct}٪ و فاصله از VWAP برابر ${Math.abs(vwapDistPct).toFixed(2)}٪.`,
    },
    {
      id: 'derivatives_oi',
      labelEn: 'Funding Squeeze, Basis & OI',
      labelFa: 'فاندینگ اسکوئیز، بیس و سود باز',
      score: Math.round(derivativesScore),
      weight: 0.06,
      valueText: `FR ${(fundingRate * 100).toFixed(4)}%`,
      bias: derivativesScore > 15 ? 'BULLISH' : derivativesScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: `Funding ${(fundingRate * 100).toFixed(4)}%, basis ${indexBasisPct.toFixed(3)}%, OI delta ${oiDeltaPct >= 0 ? '+' : ''}${oiDeltaPct.toFixed(2)}%.`,
      detailFa: `فاندینگ ${(fundingRate * 100).toFixed(4)}٪، اختلاف مارک ${indexBasisPct.toFixed(3)}٪ و تغییر OI برابر ${oiDeltaPct.toFixed(2)}٪.`,
    },
    {
      id: 'orderbook_depth',
      labelEn: 'Orderbook & Liquidity Wicks',
      labelFa: 'عمق سفارشات و شدوی نقدینگی',
      score: Math.round(microstructureScore),
      weight: 0.04,
      valueText: orderBook ? `${orderBook.imbalanceRatio.toFixed(2)}x Bid/Ask` : wickSignal,
      bias: microstructureScore > 15 ? 'BULLISH' : microstructureScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: orderBook
        ? `Orderbook bid/ask ratio ${orderBook.imbalanceRatio.toFixed(2)}x, wick: ${wickSignal}.`
        : `Candle microstructure wick signal: ${wickSignal}.`,
      detailFa: orderBook
        ? `نسبت خرید به فروش دفتر سفارش ${orderBook.imbalanceRatio.toFixed(2)}x و شدو: ${wickSignal}.`
        : `الگوی شدوی نقدینگی کندل: ${wickSignal}.`,
    },
    {
      id: 'volatility_expansion',
      labelEn: '≥20% Move Readiness & Exhaustion',
      labelFa: 'ظرفیت حرکت +۲۰٪ و فیلتر اشباع',
      score: Math.round(volExpansionScore),
      weight: 0.03,
      valueText: `ATR ${atrPct.toFixed(2)}% · ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(1)}% 24h`,
      bias: volExpansionScore > 15 ? 'BULLISH' : volExpansionScore < -15 ? 'BEARISH' : 'NEUTRAL',
      detailEn: `Hourly ATR=${atrPct.toFixed(2)}% (expansion ratio ${compression.atrExpansionRatio}x), 24h move=${priceChangePct.toFixed(1)}%.`,
      detailFa: `ATR ساعتی ${atrPct.toFixed(2)}٪ (نسبت فشردگی ${compression.atrExpansionRatio}x) و تغییر ۲۴ ساعته ${priceChangePct.toFixed(1)}٪.`,
    },
  ];

  let netScore = 0;
  for (const f of factors) {
    netScore += f.score * f.weight;
  }

  const obvConfirm = clamp(obvSlope * 1.4, -40, 40) + (adxInfo.adx >= 21 ? (adxInfo.plusDi > adxInfo.minusDi ? 20 : -20) : 0);
  netScore = clamp(netScore + obvConfirm * 0.05, -100, 100);

  let direction: SignalDirection = 'NEUTRAL';
  if (netScore >= 21) direction = 'LONG';
  else if (netScore <= -21) direction = 'SHORT';

  // --- Anti-False-Signal Gate (MTF HTF Conflict + Early Institutional Reversal Exception) ---
  let gateReasonEn: string | undefined;
  let gateReasonFa: string | undefined;

  const hasWyckoffSpring = allPatterns.some((p) => p.id === 'wyckoff_spring');
  const hasWyckoffUtad = allPatterns.some((p) => p.id === 'wyckoff_utad');
  const hasBullChartReversal = allPatterns.some(
    (p) =>
      p.bias === 'BULLISH' &&
      (p.category === 'DIVERGENCE' ||
        p.id === 'smc_bull_choch' ||
        p.id === 'wyckoff_spring' ||
        p.id === 'inverse_head_and_shoulders' ||
        p.id === 'falling_wedge') &&
      p.strength >= 74,
  );
  const hasBearChartReversal = allPatterns.some(
    (p) =>
      p.bias === 'BEARISH' &&
      (p.category === 'DIVERGENCE' ||
        p.id === 'smc_bear_choch' ||
        p.id === 'wyckoff_utad' ||
        p.id === 'head_and_shoulders' ||
        p.id === 'rising_wedge') &&
      p.strength >= 74,
  );

  // Early institutional pre-explosion exception: allow 1H squeeze/accumulation reversal ahead of lagging 4H/1D EMAs
  const earlyReversalBull =
    netScore >= 26 &&
    ((hasBullChartReversal && netScore >= 40) ||
      (hasWyckoffSpring && cvdInfo.takerBuyRatio >= 0.52) ||
      (cvdDivergence === 'BULLISH' && (ttm.isSqueeze || compression.isVcpTightening) && effectiveSuspicious >= 34) ||
      (ttm.isSqueeze && ttm.momentum > 0 && derivativesScore >= 30 && orderflowScore >= 24));

  const earlyReversalBear =
    netScore <= -26 &&
    ((hasBearChartReversal && netScore <= -40) ||
      (hasWyckoffUtad && cvdInfo.takerBuyRatio <= 0.48) ||
      (cvdDivergence === 'BEARISH' && (ttm.isSqueeze || rsi14 >= 62 || compression.isAbsorption) && effectiveSuspicious >= 30) ||
      (fundingRate >= 0.0004 && rsi14 >= 66 && orderflowScore <= -24));

  if (mtf && direction === 'LONG') {
    const strongBearHtf =
      (mtf.tf4h && mtf.tf4h.score < -25 && mtf.tf1d && mtf.tf1d.score < -25) ||
      (mtf.tf1d && mtf.tf1d.score < -35 && mtf.tf4h && mtf.tf4h.score < -15);
    if (strongBearHtf && !earlyReversalBull) {
      direction = 'NEUTRAL';
      gateReasonEn = `Suppressed counter-trend LONG against bearish 4H (${mtf.tf4h?.score}) & 1D (${mtf.tf1d?.score}) structure`;
      gateReasonFa = `جلوگیری از سیگنال لانگ خلاف روند تایم‌فریم‌های 4H (${mtf.tf4h?.score}) و 1D (${mtf.tf1d?.score})`;
    }
  } else if (mtf && direction === 'SHORT') {
    const strongBullHtf =
      (mtf.tf4h && mtf.tf4h.score > 25 && mtf.tf1d && mtf.tf1d.score > 25) ||
      (mtf.tf1d && mtf.tf1d.score > 35 && mtf.tf4h && mtf.tf4h.score > 15);
    if (strongBullHtf && !earlyReversalBear) {
      direction = 'NEUTRAL';
      gateReasonEn = `Suppressed counter-trend SHORT against bullish 4H (${mtf.tf4h?.score}) & 1D (${mtf.tf1d?.score}) structure`;
      gateReasonFa = `جلوگیری از سیگنال شورت خلاف روند تایم‌فریم‌های 4H (${mtf.tf4h?.score}) و 1D (${mtf.tf1d?.score})`;
    }
  }

  // Suppress sideways chop EXCEPT when TTM Squeeze coil has built energy with directional flow
  if (
    direction !== 'NEUTRAL' &&
    adxInfo.adx < 17 &&
    !(ttm.isSqueeze && ttm.squeezeBars >= 4) &&
    effectiveSuspicious < 40 &&
    allPatterns.length === 0 &&
    Math.abs(netScore) < 32
  ) {
    direction = 'NEUTRAL';
    gateReasonEn = `Suppressed weak signal in sideways low-ADX (${adxInfo.adx.toFixed(1)}) chop without squeeze/volume catalyst`;
    gateReasonFa = `حذف سیگنال ضعیف در بازار رنج (ADX=${adxInfo.adx.toFixed(1)}) بدون فشردگی TTM یا حجم مشکوک`;
  }

  const directionalStrength = Math.abs(netScore);
  const confluenceAlignment = factors.filter(
    (f) =>
      (direction === 'LONG' && f.score > 10) ||
      (direction === 'SHORT' && f.score < -10),
  ).length;

  const mtfBonus =
    mtf && direction === 'LONG' && mtf.alignmentScore > 25
      ? Math.min(10, mtf.alignedTimeframes * 3)
      : mtf && direction === 'SHORT' && mtf.alignmentScore < -25
        ? Math.min(10, mtf.alignedTimeframes * 3)
        : 0;

  const rawConfidence =
    direction === 'NEUTRAL'
      ? Math.max(12, Math.round(directionalStrength * 1.15))
      : Math.round(clamp(42 + directionalStrength * 0.56 + confluenceAlignment * 2.2 + mtfBonus, 30, 98));

  // --- Sharp Move (>=20% Daily) Pre-Pump / Pre-Dump Probability Calibration ---
  const compressionPts =
    (ttm.isSqueeze ? 12 + Math.min(8, ttm.squeezeBars * 1.2) : ttm.squeezeFired ? 14 : bb.widthPercentile <= 30 ? 8 : 0) +
    (compression.atrExpansionRatio <= 0.68 ? 6 : 0) +
    (compression.isVcpTightening ? 4 : 0);

  const alreadyExplodedUp = priceChangePct >= 20 || priceMove3Pct >= 9;
  const alreadyExplodedDown = priceChangePct <= -20 || priceMove3Pct <= -9;
  const notYetExplodedUp = !alreadyExplodedUp && Math.abs(priceMove3Pct) < 5.5;
  const notYetExplodedDown = !alreadyExplodedDown && Math.abs(priceMove3Pct) < 5.5;

  const isQuietMegaCap =
    !ttm.isSqueeze &&
    !ttm.squeezeFired &&
    !compression.isVcpTightening &&
    atrPct < 1.15 &&
    volMetrics.suspiciousScore < 35 &&
    cvdDivergence === 'NONE' &&
    Math.abs(fundingRate) < 0.0003;

  const mtfBullBoost = mtf && mtf.alignmentScore > 15 ? mtf.alignmentScore * 0.14 : 0;
  const mtfBearBoost = mtf && mtf.alignmentScore < -15 ? Math.abs(mtf.alignmentScore) * 0.14 : 0;

  const bullVolAbsorption =
    volMetrics.suspiciousScore * 0.28 +
    (compression.isAbsorption && (cvdInfo.takerBuyRatio >= 0.52 || cvdDivergence === 'BULLISH') ? 10 : 0);
  const bearVolAbsorption =
    volMetrics.suspiciousScore * 0.28 +
    (compression.isAbsorption && (cvdInfo.takerBuyRatio <= 0.48 || cvdDivergence === 'BEARISH') ? 10 : 0);

  const bullFlowFuel =
    (cvdDivergence === 'BULLISH' ? 14 : 0) +
    (obvBreakout === 'BULLISH' ? 8 : 0) +
    (cvdInfo.takerBuyRatio > 0.525 ? (cvdInfo.takerBuyRatio - 0.5) * 95 : 0) +
    (cmf20 > 0.07 ? 6 : 0);

  const bearFlowFuel =
    (cvdDivergence === 'BEARISH' ? 14 : 0) +
    (obvBreakout === 'BEARISH' ? 8 : 0) +
    (cvdInfo.takerBuyRatio < 0.475 ? (0.5 - cvdInfo.takerBuyRatio) * 95 : 0) +
    (cmf20 < -0.07 ? 6 : 0);

  const bullDerivFuel =
    (fundingRate <= -0.0002 ? 12 : fundingRate < -0.00005 ? 5 : 0) +
    (oiDeltaPct > 1.0 && priceMove3Pct >= -1.5 ? 7 : 0) +
    (indexBasisPct <= -0.05 ? 4 : 0);

  const bearDerivFuel =
    (fundingRate >= 0.0003 ? 12 : fundingRate > 0.00015 ? 5 : 0) +
    (oiDeltaPct > 1.0 && priceMove3Pct <= 1.5 ? 7 : 0) +
    (indexBasisPct >= 0.05 ? 4 : 0);

  const bullTrigger =
    (donchian.nearHighBreakout && cvdInfo.takerBuyRatio >= 0.51 ? 7 : 0) +
    (ttm.momentum > 0 && ttm.momentum > ttm.prevMomentum ? 6 : 0) +
    (hasWyckoffSpring || hasBullChartReversal ? 8 : 0) +
    (alreadyExplodedDown && (rsi14 <= 28 || cvdDivergence === 'BULLISH') ? 12 : 0);

  const bearTrigger =
    (donchian.nearLowBreakdown && cvdInfo.takerBuyRatio <= 0.49 ? 7 : 0) +
    (ttm.momentum < 0 && ttm.momentum < ttm.prevMomentum ? 6 : 0) +
    (hasWyckoffUtad || hasBearChartReversal ? 8 : 0) +
    (alreadyExplodedUp && (rsi14 >= 72 || cvdDivergence === 'BEARISH') ? 14 : 0);

  let rawPump =
    (netScore > 0 ? netScore * 0.42 : 4) +
    mtfBullBoost +
    bullVolAbsorption +
    bullFlowFuel +
    bullDerivFuel +
    bullTrigger +
    (netScore >= 0 || cvdDivergence === 'BULLISH' || fundingRate <= -0.00015 ? compressionPts * 0.8 : 0);

  let rawDump =
    (netScore < 0 ? Math.abs(netScore) * 0.42 : 4) +
    mtfBearBoost +
    bearVolAbsorption +
    bearFlowFuel +
    bearDerivFuel +
    bearTrigger +
    (netScore <= 0 || cvdDivergence === 'BEARISH' || fundingRate >= 0.00025 ? compressionPts * 0.8 : 0);

  if (isQuietMegaCap) {
    rawPump *= 0.58;
    rawDump *= 0.58;
  }
  if (alreadyExplodedUp) {
    rawPump = Math.min(rawPump, 54);
  }
  if (alreadyExplodedDown) {
    rawDump = Math.min(rawDump, 54);
  }

  const pumpProbability = Math.round(clamp(rawPump, 2, 98));
  const dumpProbability = Math.round(clamp(rawDump, 2, 98));

  const sharpMoveScore = Math.round(
    clamp(
      Math.max(pumpProbability, dumpProbability) * 0.62 +
        compressionPts * 0.85 +
        volMetrics.suspiciousScore * 0.18,
      2,
      98,
    ),
  );
  const sharpMoveBias: 'PUMP_20_PLUS' | 'DUMP_20_PLUS' | 'BALANCED' =
    pumpProbability >= dumpProbability + 10
      ? 'PUMP_20_PLUS'
      : dumpProbability >= pumpProbability + 10
        ? 'DUMP_20_PLUS'
        : 'BALANCED';

  let phase: MarketPhase = 'CONSOLIDATION';
  if (
    direction === 'LONG' &&
    notYetExplodedUp &&
    (volMetrics.suspiciousScore >= 30 || ttm.isSqueeze || isSqueeze || cvdDivergence === 'BULLISH' || compression.isVcpTightening)
  ) {
    phase = 'PRE_PUMP';
  } else if (
    direction === 'SHORT' &&
    notYetExplodedDown &&
    (volMetrics.suspiciousScore >= 30 || ttm.isSqueeze || isSqueeze || cvdDivergence === 'BEARISH' || compression.isVcpTightening)
  ) {
    phase = 'PRE_DUMP';
  } else if (direction === 'LONG' && (priceMove3Pct >= 2.5 || alreadyExplodedUp)) {
    phase = 'PUMP_ACTIVE';
  } else if (direction === 'SHORT' && (priceMove3Pct <= -2.5 || alreadyExplodedDown)) {
    phase = 'DUMP_ACTIVE';
  } else if (ttm.isSqueeze || isSqueeze) {
    phase = 'SQUEEZE_WATCH';
  }

  const cvdTrend: 'ACCUMULATION' | 'DISTRIBUTION' | 'BALANCED' =
    cvdInfo.takerBuyRatio >= 0.54
      ? 'ACCUMULATION'
      : cvdInfo.takerBuyRatio <= 0.46
        ? 'DISTRIBUTION'
        : 'BALANCED';

  const tradePlan = buildTradePlan({
    direction,
    lastPrice,
    atr: atr14,
    support1: pivots.support1,
    resistance1: pivots.resistance1,
    smcZone: patternSuite.smcZone,
    isExplosivePreMove: (phase === 'PRE_PUMP' || phase === 'PRE_DUMP') && sharpMoveScore >= 62,
    gateReasonEn,
    gateReasonFa,
  });

  const topPat = allPatterns[0];
  const mtfSummaryEn = mtf ? `MTF ${mtf.alignedTimeframes}/3 (${mtf.alignmentLabel.replace('_', ' ')})` : '';
  const mtfSummaryFa = mtf ? `تایید ${mtf.alignedTimeframes}/3 تایم‌فریم` : '';

  const summaryEn =
    phase === 'PRE_PUMP'
      ? `Pre-Pump ≥20% (${mtfSummaryEn || timeframe}): ${volMetrics.ratio20}x vol + ${Math.round(cvdInfo.takerBuyRatio * 100)}% buy${ttm.isSqueeze ? ` · TTM ${ttm.squeezeBars}b` : ''}${topPat ? ` · ${topPat.nameEn}` : ''}.`
      : phase === 'PRE_DUMP'
        ? `Pre-Dump ≥20% (${mtfSummaryEn || timeframe}): ${Math.round(100 - cvdInfo.takerBuyRatio * 100)}% sell delta + ${volMetrics.ratio20}x vol${ttm.isSqueeze ? ` · TTM ${ttm.squeezeBars}b` : ''}${topPat ? ` · ${topPat.nameEn}` : ''}.`
        : direction === 'LONG'
          ? `Bullish ${mtfSummaryEn || timeframe} confluence (${rawConfidence}%): SuperTrend/Kumo aligned${topPat ? ` with ${topPat.nameEn}` : ''}.`
          : direction === 'SHORT'
            ? `Bearish ${mtfSummaryEn || timeframe} confluence (${rawConfidence}%): Downside regime${topPat ? ` with ${topPat.nameEn}` : ''}.`
            : gateReasonEn
              ? `${gateReasonEn}.`
              : isSqueeze
                ? `Volatility squeeze (${ttm.isSqueeze ? `TTM ${ttm.squeezeBars}b` : `P${Math.round(bb.widthPercentile)}`}). Awaiting MTF & volume breakout trigger.`
                : `Balanced MTF regime; awaiting 1H/4H structure break or suspicious volume.`;

  const summaryFa =
    phase === 'PRE_PUMP'
      ? `هشدار پیش‌از‌پامپ +۲۰٪ (${mtfSummaryFa || timeframe}): حجم ${volMetrics.ratio20}x با ${Math.round(cvdInfo.takerBuyRatio * 100)}٪ خرید${ttm.isSqueeze ? ` · فشردگی ${ttm.squeezeBars} کندل` : ''}${topPat ? ` · ${topPat.nameFa}` : ''}.`
      : phase === 'PRE_DUMP'
        ? `هشدار پیش‌از‌دامپ -۲۰٪ (${mtfSummaryFa || timeframe}): فشار فروش ${Math.round(100 - cvdInfo.takerBuyRatio * 100)}٪ و حجم ${volMetrics.ratio20}x${ttm.isSqueeze ? ` · فشردگی ${ttm.squeezeBars} کندل` : ''}${topPat ? ` · ${topPat.nameFa}` : ''}.`
        : direction === 'LONG'
          ? `هم‌گرایی صعودی ${mtfSummaryFa || timeframe} (${rawConfidence}٪): سوپرترند و ایچیموکو هم‌جهت${topPat ? ` با ${topPat.nameFa}` : ''}.`
          : direction === 'SHORT'
            ? `هم‌گرایی نزولی ${mtfSummaryFa || timeframe} (${rawConfidence}٪): فشار ساختار نزولی${topPat ? ` با ${topPat.nameFa}` : ''}.`
            : gateReasonFa
              ? `${gateReasonFa}.`
              : isSqueeze
                ? `فشردگی نوسان (${ttm.isSqueeze ? `TTM ${ttm.squeezeBars} کندل` : `صدک ${Math.round(bb.widthPercentile)}`}) فعال؛ منتظر شکست هم‌زمان حجم و ساختار.`
                : `تعادل در تایم‌فریم‌های ۱ و ۴ ساعته؛ در انتظار تریگر شکست یا حجم مشکوک.`;

  const { conclusionEn, conclusionFa } = buildComprehensiveConclusion({
    baseAsset,
    timeframe,
    lastPrice,
    direction,
    phase,
    confidence: rawConfidence,
    pumpProbability,
    dumpProbability,
    sharpMoveScore,
    sharpMoveBias,
    suspiciousScore: volMetrics.suspiciousScore,
    volumeRatio20: volMetrics.ratio20,
    volumeZScore: volMetrics.zScore,
    takerBuyRatio: cvdInfo.takerBuyRatio,
    cvdTrend,
    cvdDivergence,
    obvBreakout,
    isSqueeze,
    ttmSqueeze: ttm.isSqueeze,
    squeezeBars: ttm.squeezeBars,
    atrExpansionRatio: compression.atrExpansionRatio,
    isVcpTightening: compression.isVcpTightening,
    isAbsorption: compression.isAbsorption,
    donchianPos: donchian.posPct,
    bbWidthPercentile: Math.round(bb.widthPercentile),
    rsi14,
    stochK: stoch.k,
    stochD: stoch.d,
    macdHist: macd.histogram,
    ema9,
    ema21,
    ema50,
    ema200,
    vwap,
    adx14: adxInfo.adx,
    plusDi: adxInfo.plusDi,
    minusDi: adxInfo.minusDi,
    superTrendDir: superTrend.direction,
    ichimokuState: ichimoku.cloudState,
    cmf20,
    mfi14,
    smcZone: patternSuite.smcZone,
    smcStructure: patternSuite.smcStructure,
    patterns: allPatterns,
    mtf,
    gateReasonEn,
    gateReasonFa,
    fundingRate,
    oiDeltaPct,
    orderBook,
    wickSignal,
    support1: roundPrice(pivots.support1, lastPrice),
    resistance1: roundPrice(pivots.resistance1, lastPrice),
    tradePlan,
  });

  const backtest = runQuickBacktest(candles);

  return {
    symbol,
    baseAsset,
    timeframe,
    lastPrice,
    markPrice,
    priceChangePct,
    quoteVolume24h,
    openInterestUsd,
    oiDeltaPct,
    fundingRate,
    direction,
    phase,
    confidence: rawConfidence,
    pumpProbability,
    dumpProbability,
    sharpMoveScore,
    sharpMoveBias,
    suspiciousVolumeScore: volMetrics.suspiciousScore,
    volumeZScore: volMetrics.zScore,
    volumeRatio20: volMetrics.ratio20,
    takerBuyRatio: Number(cvdInfo.takerBuyRatio.toFixed(3)),
    cvdTrend,
    isSqueeze,
    indicators: {
      rsi14: Number(rsi14.toFixed(2)),
      stochK: Number(stoch.k.toFixed(1)),
      stochD: Number(stoch.d.toFixed(1)),
      macdLine: macd.macdLine,
      macdSignal: macd.signalLine,
      macdHist: macd.histogram,
      ema9,
      ema21,
      ema50,
      ema200,
      bbUpper,
      bbMiddle,
      bbLower,
      bbWidthPct: Number(bbWidthPct.toFixed(2)),
      bbWidthPercentile: Math.round(bb.widthPercentile),
      ttmSqueeze: ttm.isSqueeze,
      squeezeBars: ttm.squeezeBars,
      ttmMomentum: ttm.momentum,
      atr14,
      atrPct: Number(atrPct.toFixed(2)),
      atrExpansionRatio: compression.atrExpansionRatio,
      vwap,
      adx14: Number(adxInfo.adx.toFixed(1)),
      plusDi: Number(adxInfo.plusDi.toFixed(1)),
      minusDi: Number(adxInfo.minusDi.toFixed(1)),
      obvSlope: Number(obvSlope.toFixed(2)),
      cvdDivergence,
      obvBreakout,
      donchianPos: donchian.posPct,
      superTrendDir: superTrend.direction,
      superTrendValue: roundPrice(superTrend.value, lastPrice),
      ichimokuState: ichimoku.cloudState,
      cmf20: Number(cmf20.toFixed(3)),
      mfi14: Number(mfi14.toFixed(1)),
      smcZone: patternSuite.smcZone,
      support1: roundPrice(pivots.support1, lastPrice),
      support2: roundPrice(pivots.support2, lastPrice),
      resistance1: roundPrice(pivots.resistance1, lastPrice),
      resistance2: roundPrice(pivots.resistance2, lastPrice),
      wickSignal,
    },
    patterns: allPatterns,
    mtf,
    tradePlan,
    factors,
    summaryEn,
    summaryFa,
    conclusionEn,
    conclusionFa,
    candles,
    series: {
      ema9: ema9Arr,
      ema21: ema21Arr,
      ema50: ema50Arr,
      bbUpper: bb.upper,
      bbLower: bb.lower,
      vwap: vwapArr,
      rsi: rsiArr,
      macdLine: macdSeries.macdLine,
      macdSignal: macdSeries.signalLine,
      macdHist: macdSeries.histogram,
      cvd: cvdInfo.series,
    },
    orderBook,
    recentTrades,
    backtest,
    analyzedAt: Date.now(),
  };
}
