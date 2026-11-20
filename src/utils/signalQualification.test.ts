import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScannerOpportunity } from '../types/futures';
import { evaluateSignalQualification } from './signalQualification';

function makeOpp(overrides: Partial<ScannerOpportunity> = {}): ScannerOpportunity {
  return {
    symbol: overrides.symbol ?? 'ETH-SWAP-USDT',
    baseAsset: overrides.baseAsset ?? 'ETH',
    timeframe: overrides.timeframe ?? '1h',
    lastPrice: overrides.lastPrice ?? 3200,
    markPrice: overrides.markPrice ?? 3200,
    priceChangePct: overrides.priceChangePct ?? 3.4,
    quoteVolume24h: overrides.quoteVolume24h ?? 85_000_000,
    openInterestUsd: overrides.openInterestUsd ?? 35_000_000,
    oiDeltaPct: overrides.oiDeltaPct ?? 2.4,
    fundingRate: overrides.fundingRate ?? 0.0001,
    direction: overrides.direction ?? 'LONG',
    phase: overrides.phase ?? 'PRE_PUMP',
    confidence: overrides.confidence ?? 80,
    pumpProbability: overrides.pumpProbability ?? 82,
    dumpProbability: overrides.dumpProbability ?? 18,
    suspiciousVolumeScore: overrides.suspiciousVolumeScore ?? 58,
    volumeZScore: overrides.volumeZScore ?? 2.3,
    volumeRatio20: overrides.volumeRatio20 ?? 1.85,
    takerBuyRatio: overrides.takerBuyRatio ?? 0.59,
    rsi14: overrides.rsi14 ?? 56,
    adx14: overrides.adx14 ?? 28,
    vwapDistPct: overrides.vwapDistPct ?? 1.1,
    cmf20: overrides.cmf20 ?? 0.14,
    atrPct: overrides.atrPct ?? 1.9,
    bbWidthPercentile: overrides.bbWidthPercentile ?? 18,
    isSqueeze: overrides.isSqueeze ?? true,
    ttmSqueeze: overrides.ttmSqueeze ?? true,
    imbalanceRatio: overrides.imbalanceRatio ?? 1.25,
    spreadPct: overrides.spreadPct ?? 0.04,
    mtfAlignment: overrides.mtfAlignment ?? 'STRONG_BULL',
    alignedTimeframes: overrides.alignedTimeframes ?? 3,
    optimalEntry: overrides.optimalEntry ?? 3200,
    stopLoss: overrides.stopLoss ?? 3110,
    tp1: overrides.tp1 ?? 3310,
    tp2: overrides.tp2 ?? 3420,
    tp3: overrides.tp3 ?? 3560,
    riskReward2: overrides.riskReward2 ?? 2.44,
    suggestedMaxLeverage: overrides.suggestedMaxLeverage ?? 6,
    summaryEn: 'Bullish institutional confluence',
    summaryFa: 'هم‌گرایی صعودی نهادی',
    analyzedAt: overrides.analyzedAt ?? 1_760_000_000_000,
  };
}

test('evaluateSignalQualification passes A+ institutional 7/7 LONG setup', () => {
  const res = evaluateSignalQualification(makeOpp(), { minCriteriaRequired: 5, minConfidence: 55 });
  assert.equal(res.qualified, true);
  assert.equal(res.hardBlocked, false);
  assert.equal(res.passedCount, 7);
  assert.equal(res.totalCount, 7);
  assert.equal(res.grade, 'A+');
  assert.ok(res.compositeScore >= 75);
});

test('evaluateSignalQualification rejects single-timeframe low-ADX choppy setups lacking confluence', () => {
  const choppy = makeOpp({
    alignedTimeframes: 0,
    mtfAlignment: null,
    adx14: 13.5,
    ttmSqueeze: false,
    volumeRatio20: 0.72,
    suspiciousVolumeScore: 15,
    takerBuyRatio: 0.49,
    riskReward2: 1.45,
    confidence: 58,
  });

  const res = evaluateSignalQualification(choppy, { minCriteriaRequired: 5, minConfidence: 55 });
  assert.equal(res.qualified, false);
  assert.ok(res.passedCount <= 3, `Expected <= 3 passed criteria on choppy pair, got ${res.passedCount}`);
});

test('evaluateSignalQualification hard-blocks pegged stablecoins, counter-HTF conflicts, and +25% blow-off spikes', () => {
  const stable = evaluateSignalQualification(makeOpp({ baseAsset: 'USDC', symbol: 'USDC-SWAP-USDT' }));
  assert.equal(stable.qualified, false);
  assert.equal(stable.hardBlocked, true);
  assert.equal(stable.hardBlockReason, 'pegged_stablecoin');

  const counterHtf = evaluateSignalQualification(
    makeOpp({ direction: 'LONG', mtfAlignment: 'STRONG_BEAR', alignedTimeframes: 2 }),
  );
  assert.equal(counterHtf.qualified, false);
  assert.equal(counterHtf.hardBlocked, true);
  assert.equal(counterHtf.hardBlockReason, 'counter_htf_conflict');

  const blowOff = evaluateSignalQualification(
    makeOpp({ direction: 'LONG', priceChangePct: 26.5, rsi14: 81, vwapDistPct: 11.4 }),
  );
  assert.equal(blowOff.qualified, false);
  assert.equal(blowOff.hardBlocked, true);
  assert.equal(blowOff.hardBlockReason, 'exhausted_24h_extension');
});

test('evaluateSignalQualification respects sniper mode requiring >= 6/7 criteria', () => {
  const borderline = makeOpp({
    adx14: 16,
    ttmSqueeze: false, // fails trendOrSqueeze
    fundingRate: 0.00075, // fails derivatives crowding guard
    confidence: 70,
  });

  const standard = evaluateSignalQualification(borderline, { minCriteriaRequired: 5, minConfidence: 55 });
  const sniper = evaluateSignalQualification(borderline, { minCriteriaRequired: 6, minConfidence: 55 });

  assert.equal(standard.passedCount, 5);
  assert.equal(standard.qualified, true);
  assert.equal(sniper.qualified, false);
});
