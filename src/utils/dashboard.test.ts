import assert from 'node:assert/strict';
import test from 'node:test';
import type { JournalEntry, MarketTicker, ScannerOpportunity } from '../types/futures';
import {
  buildMiniJournalSnapshot,
  computeMarketOverviewSummary,
  selectTopHighConfidenceSignals,
} from './dashboard';

function makeTicker(overrides: Partial<MarketTicker>): MarketTicker {
  return {
    symbol: overrides.symbol ?? 'BTC-SWAP-USDT',
    baseAsset: overrides.baseAsset ?? 'BTC',
    quoteAsset: overrides.quoteAsset ?? 'USDT',
    lastPrice: overrides.lastPrice ?? 90000,
    markPrice: overrides.markPrice ?? 90000,
    indexBasisPct: overrides.indexBasisPct ?? 0,
    open24h: overrides.open24h ?? 88000,
    high24h: overrides.high24h ?? 91000,
    low24h: overrides.low24h ?? 87500,
    priceChange: overrides.priceChange ?? 2000,
    priceChangePct: overrides.priceChangePct ?? 2.27,
    volume24h: overrides.volume24h ?? 10000,
    quoteVolume24h: overrides.quoteVolume24h ?? 900_000_000,
    openInterest: overrides.openInterest ?? 5000,
    openInterestUsd: overrides.openInterestUsd ?? 450_000_000,
    oiDeltaPct: overrides.oiDeltaPct ?? 1.5,
    fundingRate: overrides.fundingRate ?? 0.0001,
    nextFundingTime: overrides.nextFundingTime ?? 1_760_000_000_000,
    volumeAccelPct: overrides.volumeAccelPct ?? 4.2,
    updatedAt: overrides.updatedAt ?? 1_760_000_000_000,
  };
}

function makeOpp(overrides: Partial<ScannerOpportunity>): ScannerOpportunity {
  return {
    symbol: overrides.symbol ?? 'SOL-SWAP-USDT',
    baseAsset: overrides.baseAsset ?? 'SOL',
    timeframe: overrides.timeframe ?? '1h',
    lastPrice: overrides.lastPrice ?? 150,
    markPrice: overrides.markPrice ?? 150,
    priceChangePct: overrides.priceChangePct ?? 4.5,
    quoteVolume24h: overrides.quoteVolume24h ?? 50_000_000,
    openInterestUsd: overrides.openInterestUsd ?? 20_000_000,
    oiDeltaPct: overrides.oiDeltaPct ?? 3.1,
    fundingRate: overrides.fundingRate ?? 0.0001,
    direction: overrides.direction ?? 'LONG',
    phase: overrides.phase ?? 'PRE_PUMP',
    confidence: overrides.confidence ?? 78,
    pumpProbability: overrides.pumpProbability ?? 80,
    dumpProbability: overrides.dumpProbability ?? 20,
    suspiciousVolumeScore: overrides.suspiciousVolumeScore ?? 55,
    volumeZScore: overrides.volumeZScore ?? 2.1,
    volumeRatio20: overrides.volumeRatio20 ?? 1.9,
    takerBuyRatio: overrides.takerBuyRatio ?? 0.58,
    rsi14: overrides.rsi14 ?? 57,
    bbWidthPercentile: overrides.bbWidthPercentile ?? 22,
    isSqueeze: overrides.isSqueeze ?? true,
    imbalanceRatio: overrides.imbalanceRatio ?? 1.4,
    alignedTimeframes: overrides.alignedTimeframes ?? 2,
    optimalEntry: overrides.optimalEntry ?? 150,
    stopLoss: overrides.stopLoss ?? 144,
    tp1: overrides.tp1 ?? 159,
    tp2: overrides.tp2 ?? 168,
    tp3: overrides.tp3 ?? 177,
    riskReward2: overrides.riskReward2 ?? 3.0,
    suggestedMaxLeverage: overrides.suggestedMaxLeverage ?? 5,
    summaryEn: 'Bullish setup',
    summaryFa: 'الگوی صعودی',
    analyzedAt: overrides.analyzedAt ?? 1_760_000_000_000,
  };
}

function makeJournalEntry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    id: overrides.id ?? 'j-1',
    createdAt: overrides.createdAt ?? 1_760_000_000_000,
    updatedAt: overrides.updatedAt ?? 1_760_000_000_000,
    symbol: overrides.symbol ?? 'BTC-SWAP-USDT',
    baseAsset: overrides.baseAsset ?? 'BTC',
    timeframe: overrides.timeframe ?? '1h',
    direction: overrides.direction ?? 'LONG',
    phase: overrides.phase ?? 'PRE_PUMP',
    confidence: overrides.confidence ?? 82,
    entryPrice: overrides.entryPrice ?? 90000,
    stopLoss: overrides.stopLoss ?? 88000,
    tp1: overrides.tp1 ?? 93000,
    tp2: overrides.tp2 ?? 96000,
    tp3: overrides.tp3 ?? 99000,
    leverage: overrides.leverage ?? 5,
    capitalUsd: overrides.capitalUsd ?? 1000,
    riskPct: overrides.riskPct ?? 2,
    status: overrides.status ?? 'OPEN',
    exitPrice: overrides.exitPrice,
    closedAt: overrides.closedAt,
    closeReason: overrides.closeReason,
    notes: overrides.notes ?? '',
  };
}

test('computeMarketOverviewSummary aggregates volume, OI, breadth, gainers/losers, and scanner counts', () => {
  const tickers = [
    makeTicker({ symbol: 'BTC-SWAP-USDT', baseAsset: 'BTC', priceChangePct: 3.1, quoteVolume24h: 800_000_000, openInterestUsd: 300_000_000, fundingRate: 0.0001 }),
    makeTicker({ symbol: 'ETH-SWAP-USDT', baseAsset: 'ETH', priceChangePct: 5.8, quoteVolume24h: 400_000_000, openInterestUsd: 150_000_000, fundingRate: 0.0002 }),
    makeTicker({ symbol: 'SOL-SWAP-USDT', baseAsset: 'SOL', priceChangePct: -4.2, quoteVolume24h: 200_000_000, openInterestUsd: 80_000_000, fundingRate: -0.0001 }),
    makeTicker({ symbol: 'USDC-SWAP-USDT', baseAsset: 'USDC', priceChangePct: 0.01, quoteVolume24h: 50_000_000, openInterestUsd: 10_000_000 }),
  ];

  const opps = [
    makeOpp({ symbol: 'ETH-SWAP-USDT', baseAsset: 'ETH', phase: 'PRE_PUMP', pumpProbability: 82, suspiciousVolumeScore: 60, isSqueeze: true }),
    makeOpp({ symbol: 'SOL-SWAP-USDT', baseAsset: 'SOL', direction: 'SHORT', phase: 'PRE_DUMP', pumpProbability: 20, dumpProbability: 78, suspiciousVolumeScore: 45, isSqueeze: false }),
  ];

  const summary = computeMarketOverviewSummary(tickers, opps);

  assert.equal(summary.totalContracts, 4);
  assert.equal(summary.totalVolume24hUsd, 1_450_000_000);
  assert.equal(summary.totalOpenInterestUsd, 540_000_000);
  assert.equal(summary.advancersCount, 3);
  assert.equal(summary.declinersCount, 1);
  assert.equal(summary.breadthBullPct, 75);
  assert.equal(summary.prePumpCount, 1);
  assert.equal(summary.preDumpCount, 1);
  assert.equal(summary.suspiciousCount, 2);
  assert.equal(summary.squeezeCount, 1);
  assert.equal(summary.topGainer?.symbol, 'ETH-SWAP-USDT');
  assert.equal(summary.topLoser?.symbol, 'SOL-SWAP-USDT');
  assert.equal(summary.marketBenchmarks.some((b) => b.baseAsset === 'USDC'), false);
  assert.equal(summary.marketBenchmarks[0].symbol, 'BTC-SWAP-USDT');
});

test('selectTopHighConfidenceSignals picks top 3 non-neutral, non-stablecoin setups ordered by conviction', () => {
  const opps = [
    makeOpp({ symbol: 'USDC-SWAP-USDT', baseAsset: 'USDC', confidence: 99, pumpProbability: 99 }),
    makeOpp({ symbol: 'DOGE-SWAP-USDT', baseAsset: 'DOGE', direction: 'NEUTRAL', confidence: 92 }),
    makeOpp({ symbol: 'THIN-SWAP-USDT', baseAsset: 'THIN', confidence: 94, pumpProbability: 94, volumeRatio20: 0.02, quoteVolume24h: 150_000 }),
    makeOpp({ symbol: 'ADA-SWAP-USDT', baseAsset: 'ADA', confidence: 66, pumpProbability: 64, alignedTimeframes: 1 }),
    makeOpp({ symbol: 'SOL-SWAP-USDT', baseAsset: 'SOL', confidence: 88, pumpProbability: 86, alignedTimeframes: 3 }),
    makeOpp({ symbol: 'AVAX-SWAP-USDT', baseAsset: 'AVAX', direction: 'SHORT', phase: 'PRE_DUMP', confidence: 84, pumpProbability: 15, dumpProbability: 83, alignedTimeframes: 3, takerBuyRatio: 0.41, optimalEntry: 150, stopLoss: 156, tp1: 141, tp2: 132, tp3: 123 }),
    makeOpp({ symbol: 'LINK-SWAP-USDT', baseAsset: 'LINK', confidence: 79, pumpProbability: 76, alignedTimeframes: 2 }),
    makeOpp({ symbol: 'TINY-SWAP-USDT', baseAsset: 'TINY', confidence: 91, pumpProbability: 90, quoteVolume24h: 10_000 }),
  ];

  const top3 = selectTopHighConfidenceSignals(opps, 100_000, 3);
  assert.equal(top3.length, 3);
  assert.deepEqual(
    top3.map((s) => s.baseAsset),
    ['SOL', 'AVAX', 'LINK'],
  );
});

test('buildMiniJournalSnapshot prioritizes open positions and computes live leveraged PnL', () => {
  const entries: JournalEntry[] = [
    makeJournalEntry({ id: 'closed-1', symbol: 'ETH-SWAP-USDT', baseAsset: 'ETH', status: 'TP1_HIT', entryPrice: 2000, stopLoss: 1900, exitPrice: 2100, updatedAt: 500 }),
    makeJournalEntry({ id: 'open-1', symbol: 'BTC-SWAP-USDT', baseAsset: 'BTC', status: 'OPEN', entryPrice: 90000, stopLoss: 88000, updatedAt: 200 }),
    makeJournalEntry({ id: 'open-2', symbol: 'SOL-SWAP-USDT', baseAsset: 'SOL', direction: 'SHORT', status: 'OPEN', entryPrice: 150, stopLoss: 155, updatedAt: 300 }),
  ];

  const snap = buildMiniJournalSnapshot(
    entries,
    {
      'BTC-SWAP-USDT': 91800, // +2% raw -> +10% at 5x, +$900 / +1R
      'SOL-SWAP-USDT': 147, // +2% raw short
    },
    2,
  );

  assert.equal(snap.stats.total, 3);
  assert.equal(snap.stats.openCount, 2);
  assert.equal(snap.stats.closedCount, 1);
  assert.equal(snap.recentRows.length, 2);
  assert.deepEqual(
    snap.recentRows.map((r) => r.entry.id),
    ['open-2', 'open-1'],
  );
  assert.equal(snap.recentRows[1].metrics.leveragedPnlPct, 10);
});
