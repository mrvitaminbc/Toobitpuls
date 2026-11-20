import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlertEvent, JournalEntry, ScannerOpportunity } from '../types/futures';
import {
  applyLivePriceToJournalEntry,
  buildJournalEquityCurve,
  computeJournalStats,
  computePortfolioHeat,
  createJournalFromAlert,
  evaluateJournalEntry,
  resolveCloseReasonFromStatus,
} from './journal';

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'SOL-SWAP-USDT-1h-1000',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    symbol: 'SOL-SWAP-USDT',
    baseAsset: 'SOL',
    timeframe: '1h',
    direction: 'LONG',
    phase: 'PRE_PUMP',
    confidence: 80,
    entryPrice: 100,
    stopLoss: 98, // 2% stop distance
    tp1: 104,
    tp2: 108,
    tp3: 112,
    leverage: 10,
    capitalUsd: 1000,
    riskPct: 2, // $20 risk -> $1000 notional position
    status: 'OPEN',
    notes: 'Test entry',
    autoLogged: false,
    ...overrides,
  };
}

test('evaluateJournalEntry computes exact USD PnL and leveraged percentage', () => {
  const longWin = evaluateJournalEntry(makeEntry(), 104);
  assert.equal(longWin.rawMovePct, 4);
  assert.equal(longWin.leveragedPnlPct, 40);
  assert.equal(longWin.pnlUsd, 40);
  assert.equal(longWin.suggestedStatus, 'TP1_HIT');

  const longLoss = evaluateJournalEntry(makeEntry(), 98);
  assert.equal(longLoss.rawMovePct, -2);
  assert.equal(longLoss.leveragedPnlPct, -20);
  assert.equal(longLoss.pnlUsd, -20);
  assert.equal(longLoss.suggestedStatus, 'SL_HIT');
});

test('applyLivePriceToJournalEntry always auto-closes OPEN trades on Stop Loss hit with closedAt and closeReason', () => {
  const longEntry = makeEntry({ direction: 'LONG', entryPrice: 100, stopLoss: 98 });
  const closedLong = applyLivePriceToJournalEntry(longEntry, 97.9, {
    autoCloseOnTakeProfit: false,
    now: 1_760_003_600_000,
  });

  assert.equal(closedLong.status, 'SL_HIT');
  assert.equal(closedLong.closeReason, 'STOP_LOSS');
  assert.equal(closedLong.exitPrice, 97.9);
  assert.equal(closedLong.closedAt, 1_760_003_600_000);

  const shortEntry = makeEntry({
    direction: 'SHORT',
    entryPrice: 100,
    stopLoss: 102,
    tp1: 96,
    tp2: 92,
    tp3: 88,
  });
  const closedShort = applyLivePriceToJournalEntry(shortEntry, 102.2, {
    autoCloseOnTakeProfit: false,
    now: 1_760_004_000_000,
  });
  assert.equal(closedShort.status, 'SL_HIT');
  assert.equal(closedShort.closeReason, 'STOP_LOSS');
  assert.equal(closedShort.exitPrice, 102.2);
});

test('applyLivePriceToJournalEntry respects autoCloseOnTakeProfit and moves SL to breakeven on TP1', () => {
  const entry = makeEntry();
  const keptOpen = applyLivePriceToJournalEntry(entry, 104.5, {
    autoCloseOnTakeProfit: false,
    now: 1_760_005_000_000,
  });
  assert.equal(keptOpen.status, 'OPEN');
  assert.equal(keptOpen.stopLoss, 98);

  const movedBe = applyLivePriceToJournalEntry(entry, 104.5, {
    autoCloseOnTakeProfit: false,
    moveStopToBreakevenOnTp1: true,
    now: 1_760_005_000_000,
  });
  assert.equal(movedBe.status, 'OPEN');
  assert.equal(movedBe.stopLoss, 100);
  assert.equal(movedBe.movedToBreakeven, true);

  const closedTp = applyLivePriceToJournalEntry(entry, 104.5, {
    autoCloseOnTakeProfit: true,
    now: 1_760_005_000_000,
  });
  assert.equal(closedTp.status, 'TP1_HIT');
  assert.equal(closedTp.closeReason, 'TP1');
  assert.equal(closedTp.closedAt, 1_760_005_000_000);
  assert.equal(resolveCloseReasonFromStatus('CLOSED'), 'MANUAL');
});

test('computeJournalStats aggregates netPnlUsd accurately across open and closed trades', () => {
  const entries: JournalEntry[] = [
    makeEntry({ id: '1', status: 'TP1_HIT', exitPrice: 104 }), // +$40
    makeEntry({ id: '2', status: 'SL_HIT', exitPrice: 98 }), // -$20
  ];
  const stats = computeJournalStats(entries, {});
  assert.equal(stats.closedCount, 2);
  assert.equal(stats.netPnlUsd, 20);
  assert.equal(stats.winRatePct, 50);
});

test('computePortfolioHeat excludes breakeven trades from open risk and flags >6% heat or 3+ directional skew', () => {
  const entries: JournalEntry[] = [
    makeEntry({ id: 'o1', riskPct: 3, direction: 'LONG' }),
    makeEntry({ id: 'o2', riskPct: 4, direction: 'LONG' }),
    makeEntry({ id: 'o3', riskPct: 2, direction: 'LONG', movedToBreakeven: true, stopLoss: 100 }),
    makeEntry({ id: 'c1', status: 'TP1_HIT', riskPct: 5, exitPrice: 104 }),
  ];
  const heat = computePortfolioHeat(entries, 6);
  assert.equal(heat.openCount, 3);
  assert.equal(heat.totalOpenRiskPct, 7);
  assert.equal(heat.isOverheated, true);
  assert.equal(heat.isDirectionSkewed, true);
  assert.equal(heat.dominantDirection, 'LONG');
});

test('buildJournalEquityCurve computes cumulative PnL, drawdown, profit factor, and R-buckets', () => {
  const entries: JournalEntry[] = [
    makeEntry({ id: 't1', status: 'TP1_HIT', exitPrice: 104, closedAt: 1000 }), // +$40, +2R
    makeEntry({ id: 't2', status: 'SL_HIT', exitPrice: 98, closedAt: 2000 }), // -$20, -1R
    makeEntry({ id: 't3', status: 'TP2_HIT', exitPrice: 108, closedAt: 3000 }), // +$80, +4R
  ];
  const eq = buildJournalEquityCurve(entries, {});
  assert.equal(eq.points.length, 3);
  assert.equal(eq.points[2].cumulativePnlUsd, 100);
  assert.equal(eq.maxDrawdownUsd, 20);
  assert.equal(eq.profitFactor, 6);
  assert.equal(eq.buckets.find((b) => b.label === '2R+')?.count, 2);
});

test('createJournalFromAlert prioritizes alert trade levels, then matching opportunity, then directional fallback', () => {
  const alertWithPlan: AlertEvent = {
    id: 'al-1',
    timestamp: 1_760_000_000_000,
    symbol: 'SOL-SWAP-USDT',
    baseAsset: 'SOL',
    timeframe: '1h',
    phase: 'PRE_PUMP',
    direction: 'LONG',
    confidence: 82,
    pumpProbability: 78,
    dumpProbability: 12,
    price: 150,
    volumeZScore: 2.9,
    reasonEn: 'Pre-pump breakout build',
    reasonFa: 'آماده پامپ',
    optimalEntry: 149.5,
    stopLoss: 144,
    tp1: 158,
    tp2: 165,
    tp3: 175,
    suggestedMaxLeverage: 8,
  };

  const fromAlert = createJournalFromAlert(alertWithPlan);
  assert.equal(fromAlert.direction, 'LONG');
  assert.equal(fromAlert.entryPrice, 149.5);
  assert.equal(fromAlert.stopLoss, 144);
  assert.equal(fromAlert.tp1, 158);
  assert.equal(fromAlert.leverage, 8);
  assert.equal(fromAlert.autoLogged, false);

  const bareNeutralDumpAlert: AlertEvent = {
    id: 'al-2',
    timestamp: 1_760_000_000_000,
    symbol: 'DOGE-SWAP-USDT',
    baseAsset: 'DOGE',
    timeframe: '4h',
    phase: 'SQUEEZE_WATCH',
    direction: 'NEUTRAL',
    confidence: 69,
    pumpProbability: 22,
    dumpProbability: 74,
    price: 0.2,
    volumeZScore: 2.1,
    reasonEn: 'Exhaustion dump watch',
    reasonFa: 'هشدار ریزش',
  };

  const matchingOpp = {
    symbol: 'DOGE-SWAP-USDT',
    optimalEntry: 0.201,
    stopLoss: 0.209,
    tp1: 0.19,
    tp2: 0.18,
    tp3: 0.17,
    suggestedMaxLeverage: 6,
  } as ScannerOpportunity;

  const fromOpp = createJournalFromAlert(bareNeutralDumpAlert, matchingOpp);
  assert.equal(fromOpp.direction, 'SHORT');
  assert.equal(fromOpp.entryPrice, 0.201);
  assert.equal(fromOpp.stopLoss, 0.209);
  assert.equal(fromOpp.tp1, 0.19);
  assert.equal(fromOpp.leverage, 6);

  const fallbackEntry = createJournalFromAlert(bareNeutralDumpAlert);
  assert.equal(fallbackEntry.direction, 'SHORT');
  assert.equal(fallbackEntry.entryPrice, 0.2);
  assert.equal(fallbackEntry.stopLoss, 0.204);
  assert.equal(fallbackEntry.tp1, 0.193);
  assert.equal(fallbackEntry.leverage, 5);
});
