import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMacdSparklineGeometry, buildRsiSparklineGeometry } from './sparkline';

test('buildRsiSparklineGeometry maps 0..100 RSI values and threshold guide lines cleanly', () => {
  const rsi = [null, null, 28, 35, 48, 56, 68, 74, 71];
  const geom = buildRsiSparklineGeometry(rsi, 280, 76, 48);

  assert.ok(geom.y70 < geom.y50 && geom.y50 < geom.y30, 'y70 should sit above y50 and y30 in SVG coordinates');
  assert.ok(geom.polylinePoints.split(' ').length === 7, 'Should include all 7 non-null RSI points');
  assert.ok(geom.areaPath.startsWith('M ') && geom.areaPath.endsWith(' Z'));
  assert.equal(geom.lastPoint?.value, 71);
  assert.equal(geom.minVal, 28);
  assert.equal(geom.maxVal, 74);
});

test('buildMacdSparklineGeometry aligns bars around zeroY and plots MACD/Signal lines', () => {
  const macdLine = [null, -0.5, -0.2, 0.1, 0.4, 0.7];
  const signalLine = [null, -0.3, -0.25, -0.1, 0.15, 0.4];
  const hist = [null, -0.2, 0.05, 0.2, 0.25, 0.3];

  const geom = buildMacdSparklineGeometry(macdLine, signalLine, hist, 280, 76, 48);
  assert.equal(geom.zeroY, 38);
  assert.equal(geom.bars.length, 5);
  assert.equal(geom.bars[0].positive, false);
  assert.equal(geom.bars[4].positive, true);
  assert.ok(geom.bars[0].y >= geom.zeroY, 'Negative bar starts at or below zeroY');
  assert.ok(geom.bars[4].y < geom.zeroY, 'Positive bar extends above zeroY');
  assert.ok(geom.macdPoints.split(' ').length === 5);
  assert.ok(geom.signalPoints.split(' ').length === 5);
  assert.equal(geom.lastMacd?.value, 0.7);
});
