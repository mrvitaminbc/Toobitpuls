import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlertEvent } from '../types/futures';
import {
  computeAlertAccuracySummary,
  evaluateAlertOutcomeWithPrice,
  initializeOutcomeFromAlert,
} from './alertTracker';

function makeAlert(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'SOL-SWAP-USDT-1760000000000',
    timestamp: 1_760_000_000_000,
    symbol: 'SOL-SWAP-USDT',
    baseAsset: 'SOL',
    timeframe: '1h',
    phase: 'PRE_PUMP',
    direction: 'LONG',
    confidence: 82,
    pumpProbability: 78,
    dumpProbability: 14,
    price: 100,
    optimalEntry: 100,
    stopLoss: 97,
    expectedMoveMinPct: 4,
    expectedMoveMaxPct: 8,
    expectedHorizonHoursMin: 4,
    expectedHorizonHoursMax: 12,
    qualityGrade: 'A+',
    volumeZScore: 2.6,
    reasonEn: 'Pre-pump coil',
    reasonFa: 'فشردگی پامپ',
    ...overrides,
  };
}

test('initializeOutcomeFromAlert sets expected SL, window, and TRACKING state', () => {
  const rec = initializeOutcomeFromAlert(makeAlert());
  assert.equal(rec.side, 'PUMP');
  assert.equal(rec.status, 'TRACKING');
  assert.equal(rec.qualityGrade, 'A+');
  assert.equal(rec.entryPrice, 100);
  assert.equal(rec.stopLoss, 97);
  assert.ok(rec.expectedMoveMinPct > 0);
  assert.equal(rec.expiresAt, 1_760_000_000_000 + 12 * 3_600_000);
});

test('evaluateAlertOutcomeWithPrice tracks MFE/MAE and resolves HIT_TARGET / INVALIDATED / EXPIRED_PROFIT', () => {
  const start = 1_760_000_000_000;
  let rec = initializeOutcomeFromAlert(makeAlert({ timestamp: start }));

  // Dip slightly -> MAE updates, stays TRACKING
  rec = evaluateAlertOutcomeWithPrice(rec, 98.5, start + 1_000_000);
  assert.equal(rec.status, 'TRACKING');
  assert.equal(rec.maePct, 1.5);
  assert.equal(rec.mfePct, 0);

  // Rally past expectedMoveMinPct -> HIT_TARGET
  const targetHit = evaluateAlertOutcomeWithPrice(rec, 109.5, start + 2_000_000);
  assert.equal(targetHit.status, 'HIT_TARGET');
  assert.equal(targetHit.mfePct, 9.5);
  assert.equal(targetHit.closedAt, start + 2_000_000);

  // SL hit -> INVALIDATED
  const slHit = evaluateAlertOutcomeWithPrice(rec, 96.8, start + 2_000_000);
  assert.equal(slHit.status, 'INVALIDATED');

  // Expiry in modest profit (>= 45% of min target & > 1.2%) -> EXPIRED_PROFIT
  const partialMove = evaluateAlertOutcomeWithPrice(rec, 104.5, start + 3_000_000);
  assert.equal(partialMove.status, 'TRACKING');
  const expiredProfit = evaluateAlertOutcomeWithPrice(partialMove, 102.5, rec.expiresAt + 1000);
  assert.equal(expiredProfit.status, 'EXPIRED_PROFIT');

  // Expiry underwater -> INVALIDATED
  const expiredLoss = evaluateAlertOutcomeWithPrice(rec, 99.0, rec.expiresAt + 1000);
  assert.equal(expiredLoss.status, 'INVALIDATED');
});

test('computeAlertAccuracySummary computes overall and per-grade win rates and MFE/MAE', () => {
  const start = 1_760_000_000_000;
  const a1 = evaluateAlertOutcomeWithPrice(
    initializeOutcomeFromAlert(makeAlert({ id: 'a1', qualityGrade: 'A+', timestamp: start })),
    112,
    start + 10_000,
  );
  const a2 = evaluateAlertOutcomeWithPrice(
    initializeOutcomeFromAlert(makeAlert({ id: 'a2', qualityGrade: 'A', timestamp: start })),
    96,
    start + 10_000,
  );
  const a3 = initializeOutcomeFromAlert(makeAlert({ id: 'a3', qualityGrade: 'B', timestamp: start }));

  const summary = computeAlertAccuracySummary([a1, a2, a3]);
  assert.equal(summary.totalTracked, 3);
  assert.equal(summary.resolvedCount, 2);
  assert.equal(summary.trackingCount, 1);
  assert.equal(summary.winsCount, 1);
  assert.equal(summary.overallWinRatePct, 50);

  const gradeAPlus = summary.byGrade.find((g) => g.grade === 'A+');
  const gradeA = summary.byGrade.find((g) => g.grade === 'A');
  assert.equal(gradeAPlus?.winRatePct, 100);
  assert.equal(gradeA?.winRatePct, 0);
});
