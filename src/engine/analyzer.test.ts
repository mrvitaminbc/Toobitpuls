import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle, JournalEntry } from '../types/futures';
import { analyzeFuturesSymbol } from './analyzer';
import {
  calcBollingerBands,
  calcCMF,
  calcCVDDivergence,
  calcDonchianBreakout,
  calcEMA,
  calcIchimoku,
  calcMFI,
  calcOBVBreakout,
  calcRangeCompressionRatio,
  calcRSI,
  calcSuperTrend,
  calcTTMSqueeze,
  calcVolumeMetrics,
} from './indicators';
import { analyzeSmcAndChartPatterns, detectCandlestickPatterns } from './patterns';
import { computeJournalStats, evaluateJournalEntry } from './journal';

function generateBullishPrePumpCandles(count = 100, stepMs = 3_600_000): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  const startTime = 1700000000000;

  for (let i = 0; i < count; i++) {
    const isCompressionPhase = i >= count - 25 && i < count - 3;
    const isAccumulationSpike = i >= count - 3;

    const drift = isCompressionPhase ? 0.08 : isAccumulationSpike ? 0.45 : (i % 4 === 0 ? -0.1 : 0.18);
    const spread = isCompressionPhase ? 0.18 : 0.6;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + spread * 0.5;
    const low = Math.min(open, close) - spread * 0.5;

    const baseVol = isAccumulationSpike ? 210000 : 28000;
    const takerBuyShare = isAccumulationSpike ? 0.74 : isCompressionPhase ? 0.59 : 0.53;

    candles.push({
      time: startTime + i * stepMs,
      open,
      high,
      low,
      close,
      volume: baseVol / close,
      quoteVolume: baseVol,
      tradesCount: isAccumulationSpike ? 2600 : 320,
      takerBuyBaseVol: (baseVol * takerBuyShare) / close,
      takerBuyQuoteVol: baseVol * takerBuyShare,
    });

    price = close;
  }
  return candles;
}

function generateBearishPreDumpCandles(count = 100, stepMs = 3_600_000): Candle[] {
  const candles: Candle[] = [];
  let price = 140;
  const startTime = 1700000000000;

  for (let i = 0; i < count; i++) {
    const isDistributionSpike = i >= count - 4;
    const drift = isDistributionSpike ? -0.52 : (i % 5 === 0 ? 0.1 : -0.22);
    const spread = 0.55;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + spread * 0.7;
    const low = Math.min(open, close) - spread * 0.3;

    const baseVol = isDistributionSpike ? 220000 : 30000;
    const takerBuyShare = isDistributionSpike ? 0.25 : 0.43;

    candles.push({
      time: startTime + i * stepMs,
      open,
      high,
      low,
      close,
      volume: baseVol / close,
      quoteVolume: baseVol,
      tradesCount: isDistributionSpike ? 2800 : 350,
      takerBuyBaseVol: (baseVol * takerBuyShare) / close,
      takerBuyQuoteVol: baseVol * takerBuyShare,
    });

    price = close;
  }
  return candles;
}

function generateSteadyTrendCandles(direction: 'UP' | 'DOWN', count = 90, stepMs = 14_400_000): Candle[] {
  const candles: Candle[] = [];
  let price = direction === 'UP' ? 100 : 200;
  const startTime = 1700000000000;
  for (let i = 0; i < count; i++) {
    const drift = direction === 'UP' ? (i % 5 === 0 ? -0.2 : 0.65) : (i % 5 === 0 ? 0.2 : -0.65);
    const open = price;
    const close = Math.max(5, price + drift);
    const high = Math.max(open, close) + 0.35;
    const low = Math.min(open, close) - 0.35;
    const vol = 45000;
    const buyShare = direction === 'UP' ? 0.62 : 0.38;
    candles.push({
      time: startTime + i * stepMs,
      open,
      high,
      low,
      close,
      volume: vol / close,
      quoteVolume: vol,
      tradesCount: 420,
      takerBuyBaseVol: (vol * buyShare) / close,
      takerBuyQuoteVol: vol * buyShare,
    });
    price = close;
  }
  return candles;
}

test('EMA, RSI, SuperTrend, Ichimoku, CMF, and MFI compute valid directional states', () => {
  const risingCandles = generateSteadyTrendCandles('UP', 85);
  const closes = risingCandles.map((c) => c.close);
  const ema = calcEMA(closes, 9);
  const rsi = calcRSI(closes, 14);
  const st = calcSuperTrend(risingCandles, 10, 3);
  const ichi = calcIchimoku(risingCandles);
  const cmf = calcCMF(risingCandles, 20);
  const mfi = calcMFI(risingCandles, 14);

  assert.ok(ema[84] !== null && (ema[84] as number) > 120);
  assert.ok(rsi[84] !== null && (rsi[84] as number) > 65);
  assert.equal(st.direction, 'BULLISH');
  assert.equal(ichi.cloudState, 'ABOVE_KUMO');
  assert.ok(cmf > 0);
  assert.ok(mfi > 50);
});

test('Bollinger Squeeze detects compressed volatility', () => {
  const prices = [
    ...Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 4),
    ...Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 0.15),
  ];
  const bb = calcBollingerBands(prices, 20, 2);
  assert.ok(bb.widthPercentile <= 20, `Expected low width percentile, got ${bb.widthPercentile}`);
});

test('Candlestick & SMC pattern engine detects Bullish Engulfing and BOS', () => {
  const base = generateSteadyTrendCandles('UP', 40);
  const last = base[base.length - 1];
  const t = last.time;
  const candles: Candle[] = [
    ...base.slice(0, -2),
    {
      time: t - 3600_000,
      open: last.close + 0.5,
      high: last.close + 0.7,
      low: last.close - 0.8,
      close: last.close - 0.6,
      volume: 1000,
      quoteVolume: 100000,
      tradesCount: 500,
      takerBuyBaseVol: 400,
      takerBuyQuoteVol: 40000,
    },
    {
      time: t,
      open: last.close - 0.8,
      high: last.close + 3.2,
      low: last.close - 0.9,
      close: last.close + 3.0,
      volume: 1800,
      quoteVolume: 180000,
      tradesCount: 900,
      takerBuyBaseVol: 1300,
      takerBuyQuoteVol: 130000,
    },
  ];
  const pats = detectCandlestickPatterns(candles);
  assert.ok(pats.some((p) => p.id === 'bullish_engulfing'), 'Expected Bullish Engulfing pattern');

  const rsiArr = calcRSI(candles.map((c) => c.close), 14);
  const smc = analyzeSmcAndChartPatterns(candles, rsiArr, new Array(candles.length).fill(0));
  assert.ok(smc.patterns.length > 0);
});

test('Pre-Pump 1h candles with aligned 4h & 1d MTF trigger LONG / PRE_PUMP with 5-part verdict', () => {
  const tf1h = generateBullishPrePumpCandles(100, 3_600_000);
  const tf4h = generateSteadyTrendCandles('UP', 90, 14_400_000);
  const tf1d = generateSteadyTrendCandles('UP', 90, 86_400_000);
  const volStats = calcVolumeMetrics(tf1h);
  assert.ok(volStats.suspiciousScore >= 40);

  const result = analyzeFuturesSymbol({
    symbol: 'TEST-SWAP-USDT',
    baseAsset: 'TEST',
    timeframe: '1h',
    candles: tf1h,
    mtfCandles: { tf1h, tf4h, tf1d },
    fundingRate: -0.00035,
    oiDeltaPct: 3.4,
  });

  assert.equal(result.direction, 'LONG');
  assert.equal(result.phase, 'PRE_PUMP');
  assert.ok(result.mtf !== null && result.mtf.alignedTimeframes >= 2);
  assert.equal(result.indicators.superTrendDir, 'BULLISH');
  assert.ok(result.conclusionEn.includes('5. Final Verdict'));
  assert.ok(result.conclusionFa.includes('۵. جمع‌بندی نهایی'));
  assert.ok(result.tradePlan.stopLoss < result.tradePlan.optimalEntry);
  assert.ok(result.tradePlan.tp1 > result.tradePlan.optimalEntry);
  assert.equal(result.series.rsi.length, tf1h.length);
  assert.equal(result.series.macdLine.length, tf1h.length);
  assert.equal(result.series.macdSignal.length, tf1h.length);
  assert.equal(result.series.macdHist.length, tf1h.length);
  assert.ok(result.series.rsi[tf1h.length - 1] !== null);
  assert.ok(result.series.macdLine[tf1h.length - 1] !== null);
  assert.ok(result.series.macdSignal[tf1h.length - 1] !== null);
  assert.ok(result.series.macdHist[tf1h.length - 1] !== null);
});

test('Pre-Dump 1h candles with bearish MTF trigger SHORT with SL above entry and TPs below entry', () => {
  const tf1h = generateBearishPreDumpCandles(100, 3_600_000);
  const tf4h = generateSteadyTrendCandles('DOWN', 90, 14_400_000);
  const tf1d = generateSteadyTrendCandles('DOWN', 90, 86_400_000);

  const result = analyzeFuturesSymbol({
    symbol: 'DUMP-SWAP-USDT',
    baseAsset: 'DUMP',
    timeframe: '1h',
    candles: tf1h,
    mtfCandles: { tf1h, tf4h, tf1d },
    fundingRate: 0.00055,
    oiDeltaPct: 4.1,
  });

  assert.equal(result.direction, 'SHORT');
  assert.ok(result.phase === 'PRE_DUMP' || result.phase === 'DUMP_ACTIVE');
  assert.equal(result.indicators.superTrendDir, 'BEARISH');
  assert.ok(result.tradePlan.stopLoss > result.tradePlan.optimalEntry);
  assert.ok(result.tradePlan.tp1 < result.tradePlan.optimalEntry);
});

test('MTF Anti-Noise Conflict Gate blocks counter-trend 1h LONG when 4h and 1d are strongly bearish', () => {
  // Construct mild 1h upward drift without reversal divergence/CHoCH
  const tf1h = generateSteadyTrendCandles('UP', 80, 3_600_000);
  const tf4h = generateSteadyTrendCandles('DOWN', 90, 14_400_000);
  const tf1d = generateSteadyTrendCandles('DOWN', 90, 86_400_000);

  const result = analyzeFuturesSymbol({
    symbol: 'COUNTER-SWAP-USDT',
    baseAsset: 'COUNTER',
    timeframe: '1h',
    candles: tf1h,
    mtfCandles: { tf1h, tf4h, tf1d },
  });

  assert.equal(result.direction, 'NEUTRAL');
  assert.equal(result.tradePlan.action, 'WAIT');
  assert.ok(
    result.conclusionEn.includes('Filter Gate:') || result.conclusionEn.includes('NEUTRAL / WAIT'),
    `Expected gate/neutral explanation, got: ${result.conclusionEn}`,
  );
});

test('Signal Journal evaluates live PnL, R-multiple, and TP/SL hit detection', () => {
  const longEntry: JournalEntry = {
    id: '1',
    createdAt: 1000,
    updatedAt: 1000,
    symbol: 'BTC-SWAP-USDT',
    baseAsset: 'BTC',
    timeframe: '1h',
    direction: 'LONG',
    phase: 'PRE_PUMP',
    confidence: 82,
    entryPrice: 100,
    stopLoss: 98,
    tp1: 103,
    tp2: 105,
    tp3: 108,
    leverage: 10,
    capitalUsd: 1000,
    riskPct: 2,
    status: 'OPEN',
    notes: 'Test long',
  };

  const atTp1 = evaluateJournalEntry(longEntry, 103.5);
  assert.equal(atTp1.suggestedStatus, 'TP1_HIT');
  assert.equal(atTp1.rawMovePct, 3.5);
  assert.equal(atTp1.leveragedPnlPct, 35);
  assert.equal(atTp1.rMultiple, 1.75);

  const atSl = evaluateJournalEntry(longEntry, 97.5);
  assert.equal(atSl.suggestedStatus, 'SL_HIT');
  assert.equal(atSl.isWin, false);

  const stats = computeJournalStats([longEntry], { 'BTC-SWAP-USDT': 103.5 });
  assert.equal(stats.total, 1);
  assert.equal(stats.winRatePct, 100);
  assert.equal(stats.netLeveragedPnlPct, 35);
});

test('TTM Squeeze, VCP Compression, and Wyckoff Absorption detect pre-explosion coil', () => {
  const candles: Candle[] = [];
  const startTime = 1700000000000;
  let price = 50;

  // First 38 volatile wide-range bars to establish high Keltner/ATR baseline
  for (let i = 0; i < 38; i++) {
    const open = price;
    const close = i % 2 === 0 ? price + 1.8 : price - 1.6;
    candles.push({
      time: startTime + i * 3_600_000,
      open,
      high: Math.max(open, close) + 1.2,
      low: Math.min(open, close) - 1.2,
      close,
      volume: 1000,
      quoteVolume: 50000,
      tradesCount: 300,
      takerBuyBaseVol: 500,
      takerBuyQuoteVol: 25000,
    });
    price = close;
  }

  // Followed by 12 medium contraction bars (38..49) + 8 ultra-tight box bars (50..57) with last 3 absorption bars (55..57)
  const boxMid = price;
  for (let i = 38; i < 58; i++) {
    const isTight = i >= 50;
    const isAbsBar = i >= 55;
    const offset = i === 57 ? 0.24 : i % 2 === 0 ? (isTight ? 0.03 : 0.08) : isTight ? -0.03 : -0.08;
    const wick = isTight ? 0.09 : 0.35;
    const open = boxMid;
    const close = boxMid + offset;
    const qVol = isAbsBar ? 140000 : 35000;
    candles.push({
      time: startTime + i * 3_600_000,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      volume: qVol / close,
      quoteVolume: qVol,
      tradesCount: isAbsBar ? 1600 : 280,
      takerBuyBaseVol: (qVol * 0.72) / close,
      takerBuyQuoteVol: qVol * 0.72,
    });
  }

  const ttm = calcTTMSqueeze(candles);
  assert.equal(ttm.isSqueeze, true);
  assert.ok(ttm.squeezeBars >= 4, `Expected squeezeBars >= 4, got ${ttm.squeezeBars}`);
  assert.ok(ttm.momentum > 0, `Expected positive squeeze momentum, got ${ttm.momentum}`);

  const comp = calcRangeCompressionRatio(candles);
  assert.ok(comp.atrExpansionRatio < 0.7, `Expected compressed ATR ratio, got ${comp.atrExpansionRatio}`);
  assert.equal(comp.isVcpTightening, true);
  assert.equal(comp.isAbsorption, true);
});

test('CVD Divergence, Leading OBV Breakout, and Donchian Position identify stealth accumulation', () => {
  const candles: Candle[] = [];
  const cvdSeries: number[] = [];
  const startTime = 1700000000000;
  let cvd = 0;

  for (let i = 0; i < 35; i++) {
    // Sideways/slightly lower price in bars 22..33 with heavy volume on up-bars (stealth OBV/CVD build), then bar 34 nudges near top
    const isSecondHalf = i >= 22;
    const isUpBar = i === 34 || (isSecondHalf && i % 2 === 0);
    const base = isSecondHalf ? 100.1 : 100.5;
    const close = i === 34 ? 100.72 : isUpBar ? base + 0.04 : base - 0.05;
    const open = base;
    const qVol = i === 34 ? 120000 : isUpBar && isSecondHalf ? 85000 : 35000;
    const buyShare = isSecondHalf ? 0.76 : 0.49;
    const delta = qVol * (2 * buyShare - 1);
    cvd += delta;
    cvdSeries.push(cvd);

    candles.push({
      time: startTime + i * 3_600_000,
      open,
      high: Math.max(open, close) + 0.15,
      low: Math.min(open, close) - 0.15,
      close,
      volume: qVol / close,
      quoteVolume: qVol,
      tradesCount: 400,
      takerBuyBaseVol: (qVol * buyShare) / close,
      takerBuyQuoteVol: qVol * buyShare,
    });
  }

  assert.equal(calcCVDDivergence(candles, cvdSeries, 20), 'BULLISH');
  assert.equal(calcOBVBreakout(candles, 20), 'BULLISH');
  const dc = calcDonchianBreakout(candles, 20, 0.5);
  assert.ok(dc.posPct >= 75, `Expected high Donchian posPct, got ${dc.posPct}`);
  assert.equal(dc.nearHighBreakout, true);
});

test('Wyckoff Spring & UTAD liquidity sweeps are detected by SMC pattern suite', () => {
  const base = generateSteadyTrendCandles('UP', 35, 3_600_000);
  const priorRange = base.slice(-20, -2);
  const rangeLow = Math.min(...priorRange.map((c) => c.low));
  const rangeHigh = Math.max(...priorRange.map((c) => c.high));

  const springCandles: Candle[] = [
    ...base.slice(0, -1),
    {
      time: base[base.length - 1].time,
      open: rangeLow + 0.6,
      high: rangeLow + 1.4,
      low: rangeLow - 1.5, // sweeps stops cleanly below 18-bar range low
      close: rangeLow + 1.1, // reclaims back inside range
      volume: 1200,
      quoteVolume: 120000, // >= 1.25x avg volume
      tradesCount: 950,
      takerBuyBaseVol: 850,
      takerBuyQuoteVol: 85000,
    },
  ];

  const springSuite = analyzeSmcAndChartPatterns(
    springCandles,
    new Array(springCandles.length).fill(48),
    new Array(springCandles.length).fill(0.1),
  );
  assert.ok(
    springSuite.patterns.some((p) => p.id === 'wyckoff_spring'),
    'Expected wyckoff_spring pattern',
  );

  const utadCandles: Candle[] = [
    ...base.slice(0, -1),
    {
      time: base[base.length - 1].time,
      open: rangeHigh - 0.5,
      high: rangeHigh + 1.8, // sweeps stops above 18-bar range high
      low: rangeHigh - 1.0,
      close: rangeHigh - 0.8, // rejects back below range high
      volume: 1200,
      quoteVolume: 120000,
      tradesCount: 950,
      takerBuyBaseVol: 350,
      takerBuyQuoteVol: 35000,
    },
  ];

  const utadSuite = analyzeSmcAndChartPatterns(
    utadCandles,
    new Array(utadCandles.length).fill(66),
    new Array(utadCandles.length).fill(-0.1),
  );
  assert.ok(
    utadSuite.patterns.some((p) => p.id === 'wyckoff_utad'),
    'Expected wyckoff_utad pattern',
  );
});

test('Coiled early pre-pump setup triggers 12-factor PRE_PUMP, while quiet mega-cap stays damped & +24% coin is anti-chase capped', () => {
  // 1. Coiled high-conviction early accumulation setup
  const tf1h = generateBullishPrePumpCandles(100, 3_600_000);
  const tf4h = generateSteadyTrendCandles('UP', 90, 14_400_000);
  const tf1d = generateSteadyTrendCandles('UP', 90, 86_400_000);

  const coiled = analyzeFuturesSymbol({
    symbol: 'COIL-SWAP-USDT',
    baseAsset: 'COIL',
    timeframe: '1h',
    candles: tf1h,
    mtfCandles: { tf1h, tf4h, tf1d },
    fundingRate: -0.00045,
    indexBasisPct: -0.08,
    oiDeltaPct: 4.5,
    priceChangePct: 3.1,
  });

  assert.equal(coiled.factors.length, 12);
  assert.ok(coiled.sharpMoveScore >= 60, `Expected high sharpMoveScore, got ${coiled.sharpMoveScore}`);
  assert.equal(coiled.sharpMoveBias, 'PUMP_20_PLUS');
  assert.ok(coiled.pumpProbability >= 65, `Expected high pumpProbability, got ${coiled.pumpProbability}`);

  // 2. Quiet low-ATR steady asset (calm mega-cap) stays damped in pump/dump prob
  const quiet1h = generateSteadyTrendCandles('UP', 100, 3_600_000).map((c) => ({
    ...c,
    high: Math.max(c.open, c.close) + 0.08,
    low: Math.min(c.open, c.close) - 0.08,
    takerBuyBaseVol: (c.quoteVolume * 0.505) / c.close,
    takerBuyQuoteVol: c.quoteVolume * 0.505,
  }));
  const quiet = analyzeFuturesSymbol({
    symbol: 'BTC-SWAP-USDT',
    baseAsset: 'BTC',
    timeframe: '1h',
    candles: quiet1h,
    mtfCandles: { tf1h: quiet1h, tf4h, tf1d },
    fundingRate: 0.00005,
    priceChangePct: 0.8,
  });
  assert.ok(quiet.pumpProbability < 55, `Expected damped pumpProbability on calm mega-cap, got ${quiet.pumpProbability}`);

  // 3. Already +24% exploded move gets anti-chase capped (not PRE_PUMP)
  const chased = analyzeFuturesSymbol({
    symbol: 'PUMPED-SWAP-USDT',
    baseAsset: 'PUMPED',
    timeframe: '1h',
    candles: tf1h,
    mtfCandles: { tf1h, tf4h, tf1d },
    priceChangePct: 24.5,
  });
  assert.ok(chased.pumpProbability <= 54, `Expected anti-chase cap <= 54, got ${chased.pumpProbability}`);
  assert.notEqual(chased.phase, 'PRE_PUMP');
});

