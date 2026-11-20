import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlertEvent, AnalysisResult, IndicatorSnapshot, MtfSummary, TradePlan } from '../types/futures';
import {
  classifyAlertSide,
  estimateAlertFallbackMove,
  estimateExpectedPriceMove,
  evaluateAlertQualification,
  filterAlertsByMinProbability,
  getAlertProbability,
  isPeggedStablecoin,
  splitAndSortAlerts,
} from './alerts';

function makeAlert(overrides: Partial<AlertEvent>): AlertEvent {
  return {
    id: overrides.id ?? 'id-1',
    timestamp: overrides.timestamp ?? 1_760_000_000_000,
    symbol: overrides.symbol ?? 'BTC-SWAP-USDT',
    baseAsset: overrides.baseAsset ?? 'BTC',
    timeframe: overrides.timeframe ?? '1h',
    phase: overrides.phase ?? 'PRE_PUMP',
    direction: overrides.direction ?? 'LONG',
    confidence: overrides.confidence ?? 75,
    pumpProbability: overrides.pumpProbability,
    dumpProbability: overrides.dumpProbability,
    price: overrides.price ?? 95000,
    optimalEntry: overrides.optimalEntry,
    tp1: overrides.tp1,
    tp2: overrides.tp2,
    tp3: overrides.tp3,
    volumeZScore: overrides.volumeZScore ?? 2.4,
    qualityGrade: overrides.qualityGrade,
    qualityScore: overrides.qualityScore,
    expectedMoveMinPct: overrides.expectedMoveMinPct,
    expectedMoveMaxPct: overrides.expectedMoveMaxPct,
    expectedHorizonHoursMin: overrides.expectedHorizonHoursMin,
    expectedHorizonHoursMax: overrides.expectedHorizonHoursMax,
    expectedWindowEn: overrides.expectedWindowEn,
    expectedWindowFa: overrides.expectedWindowFa,
    reasonEn: 'Reason',
    reasonFa: 'دلیل',
  };
}

function makeIndicators(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    rsi14: 58,
    stochK: 64,
    stochD: 56,
    macdLine: 0.45,
    macdSignal: 0.25,
    macdHist: 0.2,
    ema9: 101,
    ema21: 99,
    ema50: 96,
    ema200: 90,
    bbUpper: 106,
    bbMiddle: 100,
    bbLower: 94,
    bbWidthPct: 4.2,
    bbWidthPercentile: 18,
    ttmSqueeze: true,
    squeezeBars: 5,
    ttmMomentum: 0.85,
    atr14: 2.2,
    atrPct: 2.2,
    atrExpansionRatio: 1.35,
    vwap: 99.5,
    adx14: 27,
    plusDi: 28,
    minusDi: 14,
    obvSlope: 1.8,
    cvdDivergence: 'BULLISH',
    obvBreakout: 'BULLISH',
    donchianPos: 0.72,
    superTrendDir: 'BULLISH',
    superTrendValue: 97,
    ichimokuState: 'ABOVE_KUMO',
    cmf20: 0.16,
    mfi14: 61,
    smcZone: 'DISCOUNT',
    support1: 98,
    support2: 95,
    resistance1: 106,
    resistance2: 112,
    wickSignal: 'NONE',
    ...overrides,
  };
}

function makeTradePlan(overrides: Partial<TradePlan> = {}): TradePlan {
  return {
    action: 'LONG',
    entryZoneLow: 99,
    entryZoneHigh: 101,
    optimalEntry: 100,
    stopLoss: 96,
    slDistancePct: 4,
    tp1: 106,
    tp2: 112,
    tp3: 118,
    riskReward1: 1.5,
    riskReward2: 3.0,
    riskReward3: 4.5,
    suggestedMaxLeverage: 5,
    invalidationEn: 'Close below 96',
    invalidationFa: 'بسته شدن زیر 96',
    ...overrides,
  };
}

function makeMtf(overrides: Partial<MtfSummary> = {}): MtfSummary {
  return {
    tf1h: {
      timeframe: '1h',
      direction: 'LONG',
      score: 68,
      superTrend: 'BULLISH',
      ichimoku: 'ABOVE_KUMO',
      adx14: 26,
      rsi14: 58,
      structure: 'BULLISH',
    },
    tf4h: {
      timeframe: '4h',
      direction: 'LONG',
      score: 64,
      superTrend: 'BULLISH',
      ichimoku: 'ABOVE_KUMO',
      adx14: 24,
      rsi14: 56,
      structure: 'BULLISH',
    },
    tf1d: {
      timeframe: '1d',
      direction: 'LONG',
      score: 52,
      superTrend: 'BULLISH',
      ichimoku: 'ABOVE_KUMO',
      adx14: 21,
      rsi14: 55,
      structure: 'BULLISH',
    },
    alignmentScore: 62,
    alignmentLabel: 'STRONG_BULL',
    alignedTimeframes: 3,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const { indicators: indOv, tradePlan: tpOv, mtf: mtfOv, ...rest } = overrides;
  return {
    symbol: 'SOL-SWAP-USDT',
    baseAsset: 'SOL',
    timeframe: '1h',
    lastPrice: 100,
    markPrice: 100.05,
    priceChangePct: 3.8,
    quoteVolume24h: 25_000_000,
    openInterestUsd: 12_000_000,
    oiDeltaPct: 6.2,
    fundingRate: 0.0001,
    direction: 'LONG',
    phase: 'PRE_PUMP',
    confidence: 82,
    pumpProbability: 84,
    dumpProbability: 18,
    sharpMoveScore: 78,
    sharpMoveBias: 'PUMP_20_PLUS',
    suspiciousVolumeScore: 68,
    volumeZScore: 2.8,
    volumeRatio20: 2.1,
    takerBuyRatio: 0.59,
    cvdTrend: 'ACCUMULATION',
    isSqueeze: true,
    indicators: makeIndicators(indOv),
    patterns: [],
    mtf: mtfOv === undefined ? makeMtf() : mtfOv,
    tradePlan: makeTradePlan(tpOv),
    factors: [],
    summaryEn: 'Strong institutional accumulation setup.',
    summaryFa: 'الگوی انباشت قدرتمند.',
    conclusionEn: 'Bullish breakout bias.',
    conclusionFa: 'سوگیری صعودی.',
    candles: [],
    series: {
      ema9: [],
      ema21: [],
      ema50: [],
      bbUpper: [],
      bbLower: [],
      vwap: [],
      rsi: [],
      macdLine: [],
      macdSignal: [],
      macdHist: [],
      cvd: [],
    },
    orderBook: {
      bids: [],
      asks: [],
      bidDepthUsd: 240_000,
      askDepthUsd: 110_000,
      imbalanceRatio: 2.18,
      spreadPct: 0.06,
      largestBidWall: null,
      largestAskWall: null,
      updatedAt: 1_760_000_000_000,
    },
    recentTrades: [],
    backtest: { tradesCount: 24, winRatePct: 67, avgRr: 2.1, netReturnPct: 28 },
    analyzedAt: 1_760_000_000_000,
    ...rest,
  };
}

test('classifyAlertSide separates pump and dump alerts cleanly', () => {
  assert.equal(classifyAlertSide(makeAlert({ phase: 'PRE_PUMP', direction: 'LONG' })), 'PUMP');
  assert.equal(classifyAlertSide(makeAlert({ phase: 'PUMP_ACTIVE', direction: 'LONG' })), 'PUMP');
  assert.equal(classifyAlertSide(makeAlert({ phase: 'PRE_DUMP', direction: 'SHORT' })), 'DUMP');
  assert.equal(classifyAlertSide(makeAlert({ phase: 'DUMP_ACTIVE', direction: 'SHORT' })), 'DUMP');
  assert.equal(
    classifyAlertSide(
      makeAlert({ phase: 'SQUEEZE_WATCH', direction: 'NEUTRAL', pumpProbability: 30, dumpProbability: 74 }),
    ),
    'DUMP',
  );
});

test('isPeggedStablecoin detects stablecoins and excludes them from alert lists', () => {
  assert.equal(isPeggedStablecoin('USDC'), true);
  assert.equal(isPeggedStablecoin('usdt'), true);
  assert.equal(isPeggedStablecoin('FDUSD'), true);
  assert.equal(isPeggedStablecoin('1000USDC'), true);
  assert.equal(isPeggedStablecoin('SOL'), false);
  assert.equal(isPeggedStablecoin('BTC'), false);

  const filtered = filterAlertsByMinProbability([
    makeAlert({ id: 'stable-1', symbol: 'USDC-SWAP-USDT', baseAsset: 'USDC', pumpProbability: 96 }),
    makeAlert({ id: 'real-1', symbol: 'ETH-SWAP-USDT', baseAsset: 'ETH', pumpProbability: 74 }),
  ]);
  assert.deepEqual(
    filtered.map((a) => a.id),
    ['real-1'],
  );
});

test('splitAndSortAlerts splits into pumpAlerts and dumpAlerts sorted descending by probability and excludes <= 50%', () => {
  const alerts: AlertEvent[] = [
    makeAlert({ id: 'p-low', symbol: 'ADA-SWAP-USDT', baseAsset: 'ADA', phase: 'PRE_PUMP', direction: 'LONG', pumpProbability: 62 }),
    makeAlert({ id: 'p-boundary', symbol: 'LINK-SWAP-USDT', baseAsset: 'LINK', phase: 'PRE_PUMP', direction: 'LONG', pumpProbability: 50 }),
    makeAlert({ id: 'd-under', symbol: 'AVAX-SWAP-USDT', baseAsset: 'AVAX', phase: 'PRE_DUMP', direction: 'SHORT', dumpProbability: 44 }),
    makeAlert({ id: 'd-mid', symbol: 'DOGE-SWAP-USDT', baseAsset: 'DOGE', phase: 'PRE_DUMP', direction: 'SHORT', dumpProbability: 77 }),
    makeAlert({ id: 'p-high', symbol: 'SOL-SWAP-USDT', baseAsset: 'SOL', phase: 'PRE_PUMP', direction: 'LONG', pumpProbability: 91 }),
    makeAlert({ id: 'd-high', symbol: 'XRP-SWAP-USDT', baseAsset: 'XRP', phase: 'DUMP_ACTIVE', direction: 'SHORT', dumpProbability: 88 }),
    makeAlert({ id: 'p-mid', symbol: 'ETH-SWAP-USDT', baseAsset: 'ETH', phase: 'PUMP_ACTIVE', direction: 'LONG', pumpProbability: 79 }),
    makeAlert({ id: 'd-low', symbol: 'ARB-SWAP-USDT', baseAsset: 'ARB', phase: 'PRE_DUMP', direction: 'SHORT', dumpProbability: 51 }),
    makeAlert({ id: 'stable-spam', symbol: 'USDC-SWAP-USDT', baseAsset: 'USDC', phase: 'PRE_PUMP', direction: 'LONG', pumpProbability: 98 }),
  ];

  assert.deepEqual(
    filterAlertsByMinProbability(alerts).map((a) => a.id),
    ['p-low', 'd-mid', 'p-high', 'd-high', 'p-mid', 'd-low'],
  );

  const { pumpAlerts, dumpAlerts } = splitAndSortAlerts(alerts);

  assert.deepEqual(
    pumpAlerts.map((a) => `${a.id}:${getAlertProbability(a)}`),
    ['p-high:91', 'p-mid:79', 'p-low:62'],
  );

  assert.deepEqual(
    dumpAlerts.map((a) => `${a.id}:${getAlertProbability(a)}`),
    ['d-high:88', 'd-mid:77', 'd-low:51'],
  );
});

test('estimateExpectedPriceMove computes realistic signed percentage moves and timeframe horizons', () => {
  const pump1h = estimateExpectedPriceMove(makeAnalysis({ timeframe: '1h', direction: 'LONG', phase: 'PRE_PUMP' }));
  assert.equal(pump1h.expectedWindowEn, '4–12h');
  assert.equal(pump1h.expectedHorizonHoursMin, 4);
  assert.equal(pump1h.expectedHorizonHoursMax, 12);
  assert.ok(pump1h.expectedMoveMinPct > 0 && pump1h.expectedMoveMaxPct > pump1h.expectedMoveMinPct);

  const dump4h = estimateExpectedPriceMove(
    makeAnalysis({
      timeframe: '4h',
      direction: 'SHORT',
      phase: 'PRE_DUMP',
      pumpProbability: 20,
      dumpProbability: 83,
      tradePlan: makeTradePlan({
        action: 'SHORT',
        optimalEntry: 100,
        stopLoss: 104,
        tp1: 93,
        tp2: 86,
        tp3: 78,
      }),
    }),
  );
  assert.equal(dump4h.expectedWindowEn, '12–36h');
  assert.ok(dump4h.expectedMoveMinPct < 0);
  assert.ok(dump4h.expectedMoveMaxPct < dump4h.expectedMoveMinPct);

  const squeezeMove = estimateExpectedPriceMove(
    makeAnalysis({ indicators: makeIndicators({ ttmSqueeze: true, squeezeBars: 8 }) }),
  );
  const nonSqueezeMove = estimateExpectedPriceMove(
    makeAnalysis({ indicators: makeIndicators({ ttmSqueeze: false, bbWidthPercentile: 75 }) }),
  );
  assert.ok(squeezeMove.expectedMoveMaxPct > nonSqueezeMove.expectedMoveMaxPct);

  const fallback = estimateAlertFallbackMove(
    makeAlert({
      timeframe: '1d',
      phase: 'PRE_DUMP',
      direction: 'SHORT',
      dumpProbability: 80,
      price: 100,
      optimalEntry: 100,
      tp1: 90,
      tp2: 82,
      tp3: 74,
    }),
  );
  assert.equal(fallback.expectedWindowEn, '24–72h');
  assert.equal(fallback.expectedMoveMinPct, -10);
  assert.equal(fallback.expectedMoveMaxPct, -22);
});

test('evaluateAlertQualification approves institutional-grade pump and dump setups with quality grades', () => {
  const pumpQual = evaluateAlertQualification(makeAnalysis());
  assert.equal(pumpQual.qualified, true);
  assert.equal(pumpQual.side, 'PUMP');
  assert.ok(pumpQual.qualityGrade === 'A+' || pumpQual.qualityGrade === 'A');
  assert.ok(pumpQual.qualityScore >= 75);
  assert.equal(pumpQual.alignedTimeframes, 3);
  assert.ok(pumpQual.expectedMove.expectedMoveMinPct > 0);

  const dumpQual = evaluateAlertQualification(
    makeAnalysis({
      direction: 'SHORT',
      phase: 'PRE_DUMP',
      pumpProbability: 16,
      dumpProbability: 85,
      takerBuyRatio: 0.41,
      indicators: makeIndicators({
        superTrendDir: 'BEARISH',
        cvdDivergence: 'BEARISH',
        obvBreakout: 'BEARISH',
        rsi14: 38,
        cmf20: -0.18,
      }),
      mtf: makeMtf({
        alignmentLabel: 'STRONG_BEAR',
        alignmentScore: -64,
        alignedTimeframes: 3,
      }),
      tradePlan: makeTradePlan({
        action: 'SHORT',
        optimalEntry: 100,
        stopLoss: 104,
        tp1: 94,
        tp2: 88,
        tp3: 82,
        riskReward1: 1.5,
        riskReward2: 3.0,
        riskReward3: 4.5,
      }),
    }),
  );
  assert.equal(dumpQual.qualified, true);
  assert.equal(dumpQual.side, 'DUMP');
  assert.ok(dumpQual.expectedMove.expectedMoveMinPct < 0);
});

test('evaluateAlertQualification blocks pegged stablecoins, counter-HTF traps, illiquid books, weak edge, and exhausted candles', () => {
  const stableReject = evaluateAlertQualification(
    makeAnalysis({ symbol: 'USDC-SWAP-USDT', baseAsset: 'USDC', confidence: 98, pumpProbability: 98 }),
  );
  assert.equal(stableReject.qualified, false);
  assert.equal(stableReject.rejectReason, 'pegged_stablecoin');

  const counterHtfReject = evaluateAlertQualification(
    makeAnalysis({
      mtf: makeMtf({ alignmentLabel: 'STRONG_BEAR', alignedTimeframes: 1 }),
    }),
  );
  assert.equal(counterHtfReject.qualified, false);
  assert.equal(counterHtfReject.rejectReason, 'counter_htf_bear');

  const lowLiquidityReject = evaluateAlertQualification(
    makeAnalysis({ quoteVolume24h: 120_000 }),
  );
  assert.equal(lowLiquidityReject.qualified, false);
  assert.equal(lowLiquidityReject.rejectReason, 'low_liquidity');

  const wideSpreadReject = evaluateAlertQualification(
    makeAnalysis({
      orderBook: {
        bids: [],
        asks: [],
        bidDepthUsd: 1000,
        askDepthUsd: 1000,
        imbalanceRatio: 1,
        spreadPct: 0.9,
        largestBidWall: null,
        largestAskWall: null,
        updatedAt: 0,
      },
    }),
  );
  assert.equal(wideSpreadReject.qualified, false);
  assert.equal(wideSpreadReject.rejectReason, 'wide_spread');

  const weakEdgeReject = evaluateAlertQualification(
    makeAnalysis({ pumpProbability: 64, dumpProbability: 55 }),
  );
  assert.equal(weakEdgeReject.qualified, false);
  assert.equal(weakEdgeReject.rejectReason, 'weak_directional_edge');

  const negativeFlowReject = evaluateAlertQualification(
    makeAnalysis({
      takerBuyRatio: 0.44,
      indicators: makeIndicators({ cvdDivergence: 'NONE' }),
    }),
  );
  assert.equal(negativeFlowReject.qualified, false);
  assert.equal(negativeFlowReject.rejectReason, 'negative_taker_flow_for_pump');

  const exhaustedTopReject = evaluateAlertQualification(
    makeAnalysis({ priceChangePct: 28 }),
  );
  assert.equal(exhaustedTopReject.qualified, false);
  assert.equal(exhaustedTopReject.rejectReason, 'pump_exhausted_top');

  const poorRrReject = evaluateAlertQualification(
    makeAnalysis({ tradePlan: makeTradePlan({ riskReward1: 0.8, riskReward2: 1.2 }) }),
  );
  assert.equal(poorRrReject.qualified, false);
  assert.equal(poorRrReject.rejectReason, 'poor_risk_reward');
});

