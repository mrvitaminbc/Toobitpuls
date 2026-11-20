import { evaluateJournalEntry, computeJournalStats, type JournalStatsSummary, type EvaluatedJournalMetrics } from '../engine/journal';
import type { JournalEntry, MarketTicker, ScannerOpportunity } from '../types/futures';
import { isPeggedStablecoin } from './alerts';
import { evaluateSignalQualification } from './signalQualification';

export interface MarketOverviewSummary {
  totalContracts: number;
  totalVolume24hUsd: number;
  totalOpenInterestUsd: number;
  avgFundingRate: number;
  advancersCount: number;
  declinersCount: number;
  breadthBullPct: number;
  prePumpCount: number;
  preDumpCount: number;
  suspiciousCount: number;
  squeezeCount: number;
  topGainer: MarketTicker | null;
  topLoser: MarketTicker | null;
  marketBenchmarks: MarketTicker[];
}

export interface MiniJournalRow {
  entry: JournalEntry;
  metrics: EvaluatedJournalMetrics;
}

export interface MiniJournalSnapshot {
  stats: JournalStatsSummary;
  recentRows: MiniJournalRow[];
}

export function computeMarketOverviewSummary(
  tickers: MarketTicker[],
  opportunities: ScannerOpportunity[],
): MarketOverviewSummary {
  let totalVolume24hUsd = 0;
  let totalOpenInterestUsd = 0;
  let fundingWeightedSum = 0;
  let fundingWeightTotal = 0;
  let advancersCount = 0;
  let declinersCount = 0;

  let topGainer: MarketTicker | null = null;
  let topLoser: MarketTicker | null = null;

  for (const tk of tickers) {
    if (tk.quoteVolume24h > 0) totalVolume24hUsd += tk.quoteVolume24h;
    if (tk.openInterestUsd > 0) totalOpenInterestUsd += tk.openInterestUsd;

    if (Number.isFinite(tk.fundingRate)) {
      const weight = tk.quoteVolume24h > 0 ? tk.quoteVolume24h : 1;
      fundingWeightedSum += tk.fundingRate * weight;
      fundingWeightTotal += weight;
    }

    if (tk.priceChangePct > 0) advancersCount++;
    else if (tk.priceChangePct < 0) declinersCount++;

    if (!isPeggedStablecoin(tk.baseAsset) && tk.quoteVolume24h >= 100_000) {
      if (!topGainer || tk.priceChangePct > topGainer.priceChangePct) {
        topGainer = tk;
      }
      if (!topLoser || tk.priceChangePct < topLoser.priceChangePct) {
        topLoser = tk;
      }
    }
  }

  const breadthDenominator = advancersCount + declinersCount;
  const breadthBullPct =
    breadthDenominator > 0 ? Math.round((advancersCount / breadthDenominator) * 100) : 50;
  const avgFundingRate = fundingWeightTotal > 0 ? fundingWeightedSum / fundingWeightTotal : 0;

  let prePumpCount = 0;
  let preDumpCount = 0;
  let suspiciousCount = 0;
  let squeezeCount = 0;

  for (const opp of opportunities) {
    if (opp.phase === 'PRE_PUMP' || (opp.pumpProbability >= 65 && opp.phase !== 'PUMP_ACTIVE')) {
      prePumpCount++;
    }
    if (opp.phase === 'PRE_DUMP' || (opp.dumpProbability >= 65 && opp.phase !== 'DUMP_ACTIVE')) {
      preDumpCount++;
    }
    if (opp.suspiciousVolumeScore >= 40) suspiciousCount++;
    if (opp.isSqueeze || opp.ttmSqueeze) squeezeCount++;
  }

  // Benchmarks: prioritize BTC, ETH, SOL, then top volume contracts (non-stablecoin)
  const preferredSymbols = ['BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'SOL-SWAP-USDT'];
  const benchmarkMap = new Map<string, MarketTicker>();
  for (const sym of preferredSymbols) {
    const found = tickers.find((tk) => tk.symbol === sym);
    if (found) benchmarkMap.set(found.symbol, found);
  }
  const byVol = [...tickers]
    .filter((tk) => !isPeggedStablecoin(tk.baseAsset))
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  for (const tk of byVol) {
    if (benchmarkMap.size >= 6) break;
    if (!benchmarkMap.has(tk.symbol)) {
      benchmarkMap.set(tk.symbol, tk);
    }
  }

  return {
    totalContracts: tickers.length,
    totalVolume24hUsd,
    totalOpenInterestUsd,
    avgFundingRate,
    advancersCount,
    declinersCount,
    breadthBullPct,
    prePumpCount,
    preDumpCount,
    suspiciousCount,
    squeezeCount,
    topGainer,
    topLoser,
    marketBenchmarks: Array.from(benchmarkMap.values()),
  };
}

function scoreOpportunityConviction(opp: ScannerOpportunity): number {
  const qual = evaluateSignalQualification(opp, { minCriteriaRequired: 5, minConfidence: 55 });
  const dominantProb = opp.direction === 'LONG' ? opp.pumpProbability : opp.dumpProbability;
  const mtfBonus = (opp.alignedTimeframes ?? 0) * 4;
  const rrBonus = Math.min(8, Math.max(0, opp.riskReward2 - 1) * 2.5);
  const squeezeBonus = opp.ttmSqueeze || opp.isSqueeze ? 3 : 0;
  const criteriaBonus = qual.passedCount * 3.5;
  const volumeRatioBonus =
    opp.volumeRatio20 >= 1.5
      ? 5
      : opp.volumeRatio20 >= 0.8
        ? 2.5
        : opp.volumeRatio20 < 0.25
          ? -8
          : 0;
  const liquidityBonus = opp.quoteVolume24h >= 1_000_000 ? 3 : opp.quoteVolume24h < 250_000 ? -6 : 0;
  return (
    opp.confidence * 0.5 +
    dominantProb * 0.28 +
    criteriaBonus +
    mtfBonus +
    rrBonus +
    squeezeBonus +
    volumeRatioBonus +
    liquidityBonus
  );
}

export function selectTopHighConfidenceSignals(
  opportunities: ScannerOpportunity[],
  minVolume24h = 0,
  limit = 3,
): ScannerOpportunity[] {
  const strictQualified = opportunities.filter((opp) => {
    if (opp.quoteVolume24h < minVolume24h) return false;
    return evaluateSignalQualification(opp, { minCriteriaRequired: 5, minConfidence: 55 }).qualified;
  });

  const nonBlockedCandidates = opportunities.filter((opp) => {
    if (opp.quoteVolume24h < minVolume24h) return false;
    const qual = evaluateSignalQualification(opp, { minCriteriaRequired: 4, minConfidence: 55 });
    return !qual.hardBlocked && opp.confidence >= 55;
  });

  const pool =
    strictQualified.length >= limit
      ? strictQualified
      : nonBlockedCandidates.length >= limit
        ? nonBlockedCandidates
        : opportunities.filter(
            (opp) =>
              opp.direction !== 'NEUTRAL' &&
              !isPeggedStablecoin(opp.baseAsset) &&
              opp.quoteVolume24h >= minVolume24h,
          );

  return [...pool]
    .sort((a, b) => {
      const scoreDiff = scoreOpportunityConviction(b) - scoreOpportunityConviction(a);
      if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
      const confDiff = b.confidence - a.confidence;
      if (confDiff !== 0) return confDiff;
      return b.quoteVolume24h - a.quoteVolume24h;
    })
    .slice(0, Math.max(0, limit));
}

export function buildMiniJournalSnapshot(
  entries: JournalEntry[],
  livePriceMap: Record<string, number>,
  limit = 4,
): MiniJournalSnapshot {
  const stats = computeJournalStats(entries, livePriceMap);

  const prioritized = [...entries].sort((a, b) => {
    const aOpen = a.status === 'OPEN' ? 1 : 0;
    const bOpen = b.status === 'OPEN' ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return b.updatedAt - a.updatedAt;
  });

  const recentRows: MiniJournalRow[] = prioritized.slice(0, Math.max(0, limit)).map((entry) => ({
    entry,
    metrics: evaluateJournalEntry(entry, livePriceMap[entry.symbol]),
  }));

  return { stats, recentRows };
}
