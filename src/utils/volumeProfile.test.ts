import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../types/futures';
import { computeVolumeProfile } from './volumeProfile';

function makeBar(
  idx: number,
  low: number,
  high: number,
  quoteVolume: number,
  buyShare = 0.55,
): Candle {
  const open = (low + high) / 2;
  const close = buyShare >= 0.5 ? open + (high - low) * 0.15 : open - (high - low) * 0.15;
  return {
    time: 1700000000000 + idx * 3_600_000,
    open,
    high,
    low,
    close,
    volume: quoteVolume / Math.max(close, 1),
    quoteVolume,
    tradesCount: 500,
    takerBuyBaseVol: (quoteVolume * buyShare) / Math.max(close, 1),
    takerBuyQuoteVol: quoteVolume * buyShare,
  };
}

test('computeVolumeProfile handles empty or single candle safely', () => {
  const empty = computeVolumeProfile([], 100);
  assert.equal(empty.bins.length, 0);
  assert.equal(empty.totalVolumeUsd, 0);
  assert.equal(empty.pocPrice, 100);

  const one = computeVolumeProfile([makeBar(0, 98, 102, 50000)], 101);
  assert.equal(one.bins.length, 0);
  assert.equal(one.candleCount, 1);
});

test('computeVolumeProfile anchors POC on heaviest historical price-volume cluster and derives VAH/VAL & S/R nodes', () => {
  const candles: Candle[] = [
    // Strong Support HVN shelf cluster around $100-$102
    makeBar(0, 100, 102, 260000, 0.72),
    makeBar(1, 100, 102, 240000, 0.68),
    // Low volume air pocket around $104-$112
    makeBar(2, 104, 112, 25000, 0.55),
    // Dominant POC volume shelf around $114-$116
    makeBar(3, 114, 116, 420000, 0.61),
    makeBar(4, 114, 116, 390000, 0.58),
    // Resistance shelf around $124-$126
    makeBar(5, 124, 126, 280000, 0.34),
    makeBar(6, 124, 126, 250000, 0.31),
  ];

  const vp = computeVolumeProfile(candles, 115, { binsCount: 20, valueAreaRatio: 0.7 });

  assert.equal(vp.bins.length, 20);
  // Ordered top (highest price) to bottom (lowest price)
  assert.ok(vp.bins[0].midPrice > vp.bins[vp.bins.length - 1].midPrice);

  // POC should fall directly inside the $114-$116 dominant volume cluster
  assert.ok(vp.pocPrice >= 113.5 && vp.pocPrice <= 116.5, `Expected POC in 113.5..116.5, got ${vp.pocPrice}`);
  assert.ok(vp.vahPrice >= vp.pocPrice);
  assert.ok(vp.valPrice <= vp.pocPrice);
  assert.ok(vp.valueAreaVolumePct >= 68, `Expected ~70% Value Area, got ${vp.valueAreaVolumePct}`);

  const pocBins = vp.bins.filter((b) => b.isPoc);
  assert.equal(pocBins.length, 1);
  assert.equal(pocBins[0].role, 'POC');

  // Buy + Sell splits sum cleanly to total volume
  const sumBuySell = vp.bins.reduce((acc, b) => acc + b.buyVolumeUsd + b.sellVolumeUsd, 0);
  assert.ok(Math.abs(sumBuySell - vp.totalVolumeUsd) < 1e-4);

  // Support HVN exists below 115 and Resistance HVN exists above 115
  assert.ok(vp.supportLevels.some((l) => l.kind === 'HVN_SUPPORT' && l.price < 115));
  assert.ok(vp.resistanceLevels.some((l) => l.kind === 'HVN_RESISTANCE' && l.price > 115));
});

test('computeVolumeProfile supports flat price candles and lookback slicing without NaN', () => {
  const flatCandles: Candle[] = Array.from({ length: 10 }, (_, i) => makeBar(i, 50, 50, 10000, 0.5));
  const vp = computeVolumeProfile(flatCandles, 50, { binsCount: 16, lookbackBars: 5 });
  assert.equal(vp.candleCount, 5);
  assert.equal(vp.bins.length, 16);
  assert.ok(Number.isFinite(vp.pocPrice));
  assert.ok(Math.abs(vp.totalVolumeUsd - 50000) < 1e-3);
});
