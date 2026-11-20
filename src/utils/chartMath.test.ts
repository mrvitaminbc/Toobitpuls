import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../types/futures';
import { clampChartViewport, computeHeikinAshi, computeMacdSeries, formatChartAxisTime } from './chartMath';

function makeCandles(count: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + i * 0.5;
    out.push({
      time: 1700000000000 + i * 60_000,
      open: base,
      high: base + 2,
      low: base - 1,
      close: base + 1,
      volume: 1000,
      quoteVolume: 100000,
      tradesCount: 50,
      takerBuyBaseVol: 600,
      takerBuyQuoteVol: 60000,
    });
  }
  return out;
}

test('computeHeikinAshi smooths candle open/close bounds properly', () => {
  const candles = makeCandles(10);
  const ha = computeHeikinAshi(candles);
  assert.equal(ha.length, 10);
  for (const c of ha) {
    assert.ok(c.high >= Math.max(c.open, c.close));
    assert.ok(c.low <= Math.min(c.open, c.close));
  }
});

test('computeMacdSeries produces valid MACD, signal, and positive histogram on uptrend', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 1.2);
  const macd = computeMacdSeries(closes);
  assert.equal(macd.length, 60);
  const last = macd[macd.length - 1];
  assert.ok(last.macd !== null && last.macd > 0);
  assert.ok(last.signal !== null && last.signal > 0);
  assert.ok(last.hist !== null);
});

test('clampChartViewport respects min/max visible candles and pan boundaries', () => {
  const vp1 = clampChartViewport({ totalCandles: 260, visibleCount: 80, rightOffset: 500 });
  assert.equal(vp1.visibleCount, 80);
  assert.equal(vp1.rightOffset, 180);
  assert.equal(vp1.startIdx, 0);
  assert.equal(vp1.endIdx, 80);

  const vp2 = clampChartViewport({ totalCandles: 260, visibleCount: 5, rightOffset: -10 });
  assert.equal(vp2.visibleCount, 20);
  assert.equal(vp2.rightOffset, 0);
  assert.equal(vp2.endIdx, 260);
});

test('formatChartAxisTime formats intraday vs daily/monthly labels', () => {
  const ts = Date.UTC(2025, 3, 15, 14, 30);
  const daily = formatChartAxisTime(ts, '1d');
  assert.ok(/^\d{2}\/\d{2}$/.test(daily));
  const monthly = formatChartAxisTime(ts, '1M');
  assert.ok(/^\d{2}\/\d{2}$/.test(monthly));
  const intraday = formatChartAxisTime(ts, '15m');
  assert.ok(/^\d{2}:\d{2}$/.test(intraday));
});
