import test from 'node:test';
import assert from 'node:assert/strict';
import { clampConfidence, getConfidenceGaugeMetrics } from './confidenceGauge';

test('clampConfidence bounds scores safely to 0..100', () => {
  assert.equal(clampConfidence(-10), 0);
  assert.equal(clampConfidence(145), 100);
  assert.equal(clampConfidence(Number.NaN), 0);
  assert.equal(clampConfidence(72.6), 73);
});

test('getConfidenceGaugeMetrics maps Red, Orange, and Green color tiers accurately', () => {
  const low = getConfidenceGaugeMetrics(25, 34);
  assert.equal(low.tier, 'LOW');
  assert.equal(low.strokeColor, '#ef4444');
  assert.ok(low.strokeDashoffset > low.circumference * 0.7);

  const med = getConfidenceGaugeMetrics(55, 34);
  assert.equal(med.tier, 'MEDIUM');
  assert.equal(med.strokeColor, '#f97316');
  assert.ok(med.strokeDashoffset < med.circumference * 0.5);

  const high = getConfidenceGaugeMetrics(85, 34);
  assert.equal(high.tier, 'HIGH');
  assert.equal(high.strokeColor, '#10b981');
  assert.ok(high.strokeDashoffset < med.strokeDashoffset);
});

test('getConfidenceGaugeMetrics computes exact endpoints for 0% and 100%', () => {
  const zero = getConfidenceGaugeMetrics(0, 34);
  const full = getConfidenceGaugeMetrics(100, 34);

  assert.equal(zero.strokeDashoffset, zero.circumference);
  assert.equal(full.strokeDashoffset, 0);
});
