import assert from 'node:assert/strict';
import test from 'node:test';
import type { Candle, ScannerOpportunity } from '../types/futures';
import { estimateLiquidationClusters, evaluateCrowdedSqueeze } from './liquidationClusters';

function makeCandlesWithSwings(count = 40): Candle[] {
  const baseTime = 1_760_000_000_000;
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i / 4) * 3;
    const close = 100 + wave;
    const high = i === 15 ? 108 : close + 0.8;
    const low = i === 25 ? 92 : close - 0.8;
    candles.push({
      time: baseTime + i * 3_600_000,
      open: close - 0.2,
      high,
      low,
      close,
      volume: 1000,
      quoteVolume: 100_000,
      tradesCount: 200,
      takerBuyBaseVol: 520,
      takerBuyQuoteVol: 52_000,
    });
  }
  return candles;
}

test('estimateLiquidationClusters orders 25x/50x/100x SHORT_LIQ above and LONG_LIQ below currentPrice', () => {
  const candles = makeCandlesWithSwings(40);
  const clusters = estimateLiquidationClusters(candles, 100, 60_000_000);

  assert.equal(clusters.length, 6);
  // Sorted descending by price
  for (let i = 1; i < clusters.length; i++) {
    assert.ok(clusters[i - 1].price >= clusters[i].price);
  }

  const shortClusters = clusters.filter((c) => c.side === 'SHORT_LIQ');
  const longClusters = clusters.filter((c) => c.side === 'LONG_LIQ');
  assert.equal(shortClusters.length, 3);
  assert.equal(longClusters.length, 3);
  assert.ok(shortClusters.every((c) => c.price > 108 && c.distancePct > 0));
  assert.ok(longClusters.every((c) => c.price < 92 && c.distancePct < 0));
  assert.deepEqual(
    shortClusters.map((c) => c.leverageTier),
    ['25x', '50x', '100x'],
  );
  assert.deepEqual(
    longClusters.map((c) => c.leverageTier),
    ['100x', '50x', '25x'],
  );
});

test('evaluateCrowdedSqueeze identifies SHORT_SQUEEZE, LONG_SQUEEZE, and balanced NONE states', () => {
  const baseOpp = {
    fundingRate: -0.00045,
    oiDeltaPct: 3.2,
    ttmSqueeze: true,
    isSqueeze: true,
    squeezeBars: 6,
    pumpProbability: 74,
    dumpProbability: 20,
    takerBuyRatio: 0.57,
  } as ScannerOpportunity;

  const shortSq = evaluateCrowdedSqueeze(baseOpp);
  assert.equal(shortSq.squeezeType, 'SHORT_SQUEEZE');
  assert.equal(shortSq.isCrowded, true);
  assert.ok(shortSq.squeezeScore >= 70);

  const longSq = evaluateCrowdedSqueeze({
    ...baseOpp,
    fundingRate: 0.00055,
    pumpProbability: 18,
    dumpProbability: 76,
    takerBuyRatio: 0.41,
  });
  assert.equal(longSq.squeezeType, 'LONG_SQUEEZE');
  assert.equal(longSq.isCrowded, true);

  const balanced = evaluateCrowdedSqueeze({
    ...baseOpp,
    fundingRate: 0.00005,
    oiDeltaPct: 0.1,
    ttmSqueeze: false,
    isSqueeze: false,
    squeezeBars: 0,
    pumpProbability: 35,
    dumpProbability: 30,
  });
  assert.equal(balanced.squeezeType, 'NONE');
  assert.equal(balanced.isCrowded, false);
});
