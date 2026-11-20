import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScannerOpportunity, WatchlistAlertRule } from '../types/futures';
import {
  doesRuleMatchOpportunity,
  evaluateRuleCondition,
  evaluateWatchlistRules,
  formatRuleConditionLabel,
} from './customRules';

function makeOpp(overrides: Partial<ScannerOpportunity> = {}): ScannerOpportunity {
  return {
    symbol: 'SUI-SWAP-USDT',
    baseAsset: 'SUI',
    timeframe: '1h',
    lastPrice: 2.1,
    markPrice: 2.1,
    priceChangePct: 4.5,
    quoteVolume24h: 25_000_000,
    openInterestUsd: 12_000_000,
    oiDeltaPct: 2.4,
    fundingRate: -0.00035, // -0.035%
    direction: 'LONG',
    phase: 'PRE_PUMP',
    confidence: 82,
    pumpProbability: 79,
    dumpProbability: 12,
    ttmSqueeze: true,
    squeezeBars: 6,
    suspiciousVolumeScore: 76,
    volumeZScore: 2.8,
    volumeRatio20: 3.1,
    takerBuyRatio: 0.61,
    rsi14: 58,
    bbWidthPercentile: 18,
    isSqueeze: true,
    imbalanceRatio: 1.4,
    alignedTimeframes: 3,
    optimalEntry: 2.08,
    stopLoss: 2.0,
    tp1: 2.18,
    tp2: 2.28,
    tp3: 2.4,
    riskReward2: 2.5,
    suggestedMaxLeverage: 7,
    summaryEn: 'Pre-pump coil',
    summaryFa: 'آماده پامپ',
    analyzedAt: 1_760_000_000_000,
    ...overrides,
  };
}

test('evaluateRuleCondition and doesRuleMatchOpportunity handle ALL vs ANY and symbol scoping', () => {
  const opp = makeOpp();
  assert.equal(evaluateRuleCondition(opp, { metric: 'MTF_ALIGNED', threshold: 3 }), true);
  assert.equal(evaluateRuleCondition(opp, { metric: 'TTM_SQUEEZE_BARS', threshold: 5 }), true);
  assert.equal(evaluateRuleCondition(opp, { metric: 'FUNDING_LTE', threshold: -0.02 }), true);
  assert.equal(evaluateRuleCondition(opp, { metric: 'VOL_RATIO_GTE', threshold: 4 }), false);

  const allRule: WatchlistAlertRule = {
    id: 'r1',
    name: 'MTF + Squeeze',
    symbol: '*',
    matchMode: 'ALL',
    conditions: [
      { metric: 'MTF_ALIGNED', threshold: 3 },
      { metric: 'VOL_RATIO_GTE', threshold: 4 },
    ],
    enabled: true,
    cooldownMinutes: 15,
    createdAt: 1000,
  };
  assert.equal(doesRuleMatchOpportunity(opp, allRule), false);

  const anyRule: WatchlistAlertRule = { ...allRule, matchMode: 'ANY' };
  assert.equal(doesRuleMatchOpportunity(opp, anyRule), true);

  const specificRule: WatchlistAlertRule = { ...anyRule, symbol: 'BTC-SWAP-USDT' };
  assert.equal(doesRuleMatchOpportunity(opp, specificRule), false);
});

test('evaluateWatchlistRules fires AlertEvents and enforces cooldown', () => {
  const opp = makeOpp();
  const rule: WatchlistAlertRule = {
    id: 'r-squeeze',
    name: 'Negative Funding Coil',
    symbol: '*',
    matchMode: 'ALL',
    conditions: [
      { metric: 'FUNDING_LTE', threshold: -0.02 },
      { metric: 'TTM_SQUEEZE_BARS', threshold: 4 },
      { metric: 'PUMP_PROB_GTE', threshold: 70 },
    ],
    enabled: true,
    cooldownMinutes: 30,
    createdAt: 1000,
  };

  const t0 = 1_760_000_000_000;
  const firstRun = evaluateWatchlistRules([opp], [rule], t0);
  assert.equal(firstRun.triggeredAlerts.length, 1);
  assert.equal(firstRun.triggeredAlerts[0].symbol, 'SUI-SWAP-USDT');
  assert.ok(firstRun.triggeredAlerts[0].reasonEn.includes('Negative Funding Coil'));
  assert.equal(firstRun.updatedRules[0].lastTriggeredAt, t0);

  // Within 30m cooldown -> suppressed
  const secondRun = evaluateWatchlistRules([opp], firstRun.updatedRules, t0 + 5 * 60_000);
  assert.equal(secondRun.triggeredAlerts.length, 0);

  // After 31m -> triggers again
  const thirdRun = evaluateWatchlistRules([opp], firstRun.updatedRules, t0 + 31 * 60_000);
  assert.equal(thirdRun.triggeredAlerts.length, 1);

  assert.ok(formatRuleConditionLabel({ metric: 'MTF_ALIGNED', threshold: 2 }, 'fa').includes('2/3'));
});
