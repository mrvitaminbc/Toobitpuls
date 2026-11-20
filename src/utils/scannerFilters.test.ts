import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ScannerOpportunity } from '../types/futures';
import {
  DEFAULT_ADVANCED_FILTERS,
  countActiveAdvancedFilters,
  isNearPriceLevel,
  matchesAdvancedFilters,
} from './scannerFilters';

function makeOpp(overrides: Partial<ScannerOpportunity> = {}): ScannerOpportunity {
  return {
    symbol: 'BTC-SWAP-USDT',
    baseAsset: 'BTC',
    timeframe: '1h',
    lastPrice: 65000,
    markPrice: 65005,
    priceChangePct: 2.1,
    quoteVolume24h: 150_000_000,
    openInterestUsd: 80_000_000,
    oiDeltaPct: 3.4,
    fundingRate: 0.0001,
    takerBuyRatio: 0.56,
    pumpProbability: 74,
    dumpProbability: 22,
    suspiciousVolumeScore: 62,
    volumeZScore: 1.8,
    confidence: 78,
    phase: 'PRE_PUMP',
    direction: 'LONG',
    optimalEntry: 64900,
    stopLoss: 63500,
    tp1: 66500,
    tp2: 68200,
    tp3: 70000,
    riskReward2: 2.35,
    suggestedMaxLeverage: 10,
    volumeRatio20: 1.4,
    rsi14: 58,
    bbWidthPercentile: 35,
    isSqueeze: false,
    imbalanceRatio: 0.12,
    ttmSqueeze: false,
    alignedTimeframes: 2,
    support1: 64200,
    resistance1: 67800,
    smcZone: 'EQUILIBRIUM',
    summaryEn: 'Bullish accumulation above support.',
    summaryFa: 'انباشت صعودی بالای حمایت.',
    analyzedAt: Date.now(),
    ...overrides,
  };
}

describe('scannerFilters', () => {
  it('matches default filters and counts active filters accurately', () => {
    const opp = makeOpp();
    assert.equal(countActiveAdvancedFilters(DEFAULT_ADVANCED_FILTERS), 0);
    assert.equal(matchesAdvancedFilters(opp, DEFAULT_ADVANCED_FILTERS), true);

    const active = {
      ...DEFAULT_ADVANCED_FILTERS,
      rsiCondition: 'OVERBOUGHT_70' as const,
      minVolumeRatio: 2.0,
      onlyTtmSqueeze: true,
    };
    assert.equal(countActiveAdvancedFilters(active), 3);
  });

  it('filters RSI > 70, RSI < 30, and custom RSI ranges', () => {
    const hot = makeOpp({ rsi14: 74.5 });
    const neutral = makeOpp({ rsi14: 55 });
    const cold = makeOpp({ rsi14: 26.2 });

    assert.equal(
      matchesAdvancedFilters(hot, { ...DEFAULT_ADVANCED_FILTERS, rsiCondition: 'OVERBOUGHT_70' }),
      true,
    );
    assert.equal(
      matchesAdvancedFilters(neutral, { ...DEFAULT_ADVANCED_FILTERS, rsiCondition: 'OVERBOUGHT_70' }),
      false,
    );
    assert.equal(
      matchesAdvancedFilters(cold, { ...DEFAULT_ADVANCED_FILTERS, rsiCondition: 'OVERSOLD_30' }),
      true,
    );
    assert.equal(
      matchesAdvancedFilters(neutral, {
        ...DEFAULT_ADVANCED_FILTERS,
        rsiCondition: 'CUSTOM',
        rsiMin: 50,
        rsiMax: 60,
      }),
      true,
    );
  });

  it('filters Volume > 200% average (volumeRatio20 >= 2.0)', () => {
    const surge = makeOpp({ volumeRatio20: 2.45 });
    const normal = makeOpp({ volumeRatio20: 1.35 });

    const vol200Filter = { ...DEFAULT_ADVANCED_FILTERS, minVolumeRatio: 2.0 };
    assert.equal(matchesAdvancedFilters(surge, vol200Filter), true);
    assert.equal(matchesAdvancedFilters(normal, vol200Filter), false);
  });

  it('detects price near support via support1 and SMC discount fallback', () => {
    assert.equal(isNearPriceLevel(100, 98.2, 2.5), true);
    assert.equal(isNearPriceLevel(100, 94.0, 2.5), false);

    const nearSup = makeOpp({ lastPrice: 100, support1: 98.4 });
    const farSup = makeOpp({ lastPrice: 100, support1: 92.0, smcZone: 'PREMIUM' });
    const discountFallback = makeOpp({
      lastPrice: 100,
      support1: undefined,
      smcZone: 'DISCOUNT',
      optimalEntry: 98.5,
    });

    const supFilter = {
      ...DEFAULT_ADVANCED_FILTERS,
      proximityFilter: 'NEAR_SUPPORT' as const,
      proximityThresholdPct: 2.5,
    };

    assert.equal(matchesAdvancedFilters(nearSup, supFilter), true);
    assert.equal(matchesAdvancedFilters(farSup, supFilter), false);
    assert.equal(matchesAdvancedFilters(discountFallback, supFilter), true);
  });

  it('filters near resistance, discount zone, MTF, TTM squeeze, confidence, and funding bias', () => {
    const opp = makeOpp({
      lastPrice: 100,
      resistance1: 101.5,
      smcZone: 'DISCOUNT',
      confidence: 82,
      alignedTimeframes: 3,
      ttmSqueeze: true,
      fundingRate: -0.0004,
    });

    assert.equal(
      matchesAdvancedFilters(opp, {
        ...DEFAULT_ADVANCED_FILTERS,
        proximityFilter: 'NEAR_RESISTANCE',
        proximityThresholdPct: 2.0,
        minConfidence: 75,
        minAlignedTimeframes: 3,
        onlyTtmSqueeze: true,
        fundingBias: 'NEGATIVE',
      }),
      true,
    );

    assert.equal(
      matchesAdvancedFilters(opp, {
        ...DEFAULT_ADVANCED_FILTERS,
        fundingBias: 'POSITIVE',
      }),
      false,
    );
  });
});
