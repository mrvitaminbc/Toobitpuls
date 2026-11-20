import type {
  AlertEvent,
  AnalysisResult,
  JournalCloseReason,
  JournalEntry,
  JournalStatus,
  ScannerOpportunity,
} from '../types/futures';
import { classifyAlertSide } from '../utils/alerts';

export interface EvaluatedJournalMetrics {
  currentPrice: number;
  rawMovePct: number;
  leveragedPnlPct: number;
  pnlUsd: number;
  positionUsd: number;
  rMultiple: number;
  isWin: boolean;
  suggestedStatus: JournalStatus;
}

export function resolveCloseReasonFromStatus(status: JournalStatus): JournalCloseReason | undefined {
  switch (status) {
    case 'SL_HIT':
      return 'STOP_LOSS';
    case 'TP1_HIT':
      return 'TP1';
    case 'TP2_HIT':
      return 'TP2';
    case 'TP3_HIT':
      return 'TP3';
    case 'CLOSED':
      return 'MANUAL';
    default:
      return undefined;
  }
}

export function evaluateJournalEntry(
  entry: JournalEntry,
  livePrice: number | undefined,
): EvaluatedJournalMetrics {
  const refPrice =
    entry.status !== 'OPEN' && entry.exitPrice
      ? entry.exitPrice
      : livePrice && livePrice > 0
        ? livePrice
        : entry.entryPrice;

  const isLong = entry.direction === 'LONG';
  const signedMoveRatio =
    entry.entryPrice > 0
      ? isLong
        ? (refPrice - entry.entryPrice) / entry.entryPrice
        : (entry.entryPrice - refPrice) / entry.entryPrice
      : 0;
  const rawMovePct = signedMoveRatio * 100;

  const leveragedPnlPct = rawMovePct * Math.max(1, entry.leverage);

  const riskDist = Math.abs(entry.entryPrice - entry.stopLoss);
  const slPct = entry.entryPrice > 0 && riskDist > 0 ? riskDist / entry.entryPrice : 0;
  const capital = Number.isFinite(entry.capitalUsd) && entry.capitalUsd > 0 ? entry.capitalUsd : 1000;
  const riskPct = Number.isFinite(entry.riskPct) && entry.riskPct > 0 ? entry.riskPct : 2;
  const positionUsd =
    slPct > 0 ? (capital * (riskPct / 100)) / slPct : capital * Math.max(1, entry.leverage);
  const pnlUsd = positionUsd * signedMoveRatio;

  const priceDelta = isLong ? refPrice - entry.entryPrice : entry.entryPrice - refPrice;
  const rMultiple = riskDist > 0 ? priceDelta / riskDist : 0;

  let suggestedStatus: JournalStatus = entry.status;
  if (entry.status === 'OPEN' && livePrice && livePrice > 0) {
    if (isLong) {
      if (livePrice <= entry.stopLoss) suggestedStatus = 'SL_HIT';
      else if (livePrice >= entry.tp3) suggestedStatus = 'TP3_HIT';
      else if (livePrice >= entry.tp2) suggestedStatus = 'TP2_HIT';
      else if (livePrice >= entry.tp1) suggestedStatus = 'TP1_HIT';
    } else {
      if (livePrice >= entry.stopLoss) suggestedStatus = 'SL_HIT';
      else if (livePrice <= entry.tp3) suggestedStatus = 'TP3_HIT';
      else if (livePrice <= entry.tp2) suggestedStatus = 'TP2_HIT';
      else if (livePrice <= entry.tp1) suggestedStatus = 'TP1_HIT';
    }
  }

  return {
    currentPrice: refPrice,
    rawMovePct: Number(rawMovePct.toFixed(2)),
    leveragedPnlPct: Number(leveragedPnlPct.toFixed(2)),
    pnlUsd: Number(pnlUsd.toFixed(2)),
    positionUsd: Number(positionUsd.toFixed(2)),
    rMultiple: Number(rMultiple.toFixed(2)),
    isWin: entry.status === 'SL_HIT' ? false : rawMovePct > 0,
    suggestedStatus,
  };
}

export function applyLivePriceToJournalEntry(
  entry: JournalEntry,
  livePrice: number | undefined,
  options?: { autoCloseOnTakeProfit?: boolean; moveStopToBreakevenOnTp1?: boolean; now?: number },
): JournalEntry {
  if (entry.status !== 'OPEN' || !livePrice || livePrice <= 0) {
    return entry;
  }

  const ev = evaluateJournalEntry(entry, livePrice);
  const hitSl = ev.suggestedStatus === 'SL_HIT';
  const hitTp =
    ev.suggestedStatus === 'TP1_HIT' ||
    ev.suggestedStatus === 'TP2_HIT' ||
    ev.suggestedStatus === 'TP3_HIT';

  const now = options?.now ?? Date.now();

  if (hitSl) {
    return {
      ...entry,
      status: 'SL_HIT',
      closeReason: 'STOP_LOSS',
      exitPrice: livePrice,
      closedAt: now,
      updatedAt: now,
    };
  }

  if (hitTp) {
    if (options?.autoCloseOnTakeProfit ?? true) {
      return {
        ...entry,
        status: ev.suggestedStatus,
        closeReason: resolveCloseReasonFromStatus(ev.suggestedStatus),
        exitPrice: livePrice,
        closedAt: now,
        updatedAt: now,
      };
    }

    if (options?.moveStopToBreakevenOnTp1 && !entry.movedToBreakeven) {
      return {
        ...entry,
        stopLoss: entry.entryPrice,
        movedToBreakeven: true,
        updatedAt: now,
      };
    }
  }

  return entry;
}

export function createJournalFromOpportunity(
  opp: ScannerOpportunity,
  options?: { capitalUsd?: number; riskPct?: number; autoLogged?: boolean },
): JournalEntry | null {
  if (opp.direction === 'NEUTRAL') return null;
  const now = Date.now();
  return {
    id: `${opp.symbol}-${opp.timeframe}-${now}`,
    createdAt: now,
    updatedAt: now,
    symbol: opp.symbol,
    baseAsset: opp.baseAsset,
    timeframe: opp.timeframe,
    direction: opp.direction,
    phase: opp.phase,
    confidence: opp.confidence,
    entryPrice: opp.optimalEntry || opp.lastPrice,
    stopLoss: opp.stopLoss,
    tp1: opp.tp1,
    tp2: opp.tp2,
    tp3: opp.tp3,
    leverage: opp.suggestedMaxLeverage,
    capitalUsd: options?.capitalUsd ?? 1000,
    riskPct: options?.riskPct ?? 2,
    status: 'OPEN',
    notes: opp.summaryEn,
    autoLogged: options?.autoLogged ?? false,
  };
}

export function createJournalFromAnalysis(
  analysis: AnalysisResult,
  options?: { capitalUsd?: number; riskPct?: number; notes?: string },
): JournalEntry | null {
  if (analysis.direction === 'NEUTRAL') return null;
  const now = Date.now();
  return {
    id: `${analysis.symbol}-${analysis.timeframe}-${now}`,
    createdAt: now,
    updatedAt: now,
    symbol: analysis.symbol,
    baseAsset: analysis.baseAsset,
    timeframe: analysis.timeframe,
    direction: analysis.direction,
    phase: analysis.phase,
    confidence: analysis.confidence,
    entryPrice: analysis.tradePlan.optimalEntry || analysis.lastPrice,
    stopLoss: analysis.tradePlan.stopLoss,
    tp1: analysis.tradePlan.tp1,
    tp2: analysis.tradePlan.tp2,
    tp3: analysis.tradePlan.tp3,
    leverage: analysis.tradePlan.suggestedMaxLeverage,
    capitalUsd: options?.capitalUsd ?? 1000,
    riskPct: options?.riskPct ?? 2,
    status: 'OPEN',
    notes: options?.notes ?? analysis.summaryEn,
    autoLogged: false,
  };
}

export function createJournalFromAlert(
  alert: AlertEvent,
  matchingOpp?: ScannerOpportunity,
  options?: { capitalUsd?: number; riskPct?: number },
): JournalEntry {
  const side = classifyAlertSide(alert);
  const direction: 'LONG' | 'SHORT' =
    alert.direction === 'LONG' || alert.direction === 'SHORT'
      ? alert.direction
      : side === 'PUMP'
        ? 'LONG'
        : 'SHORT';
  const isLong = direction === 'LONG';
  const entryPrice =
    alert.optimalEntry && alert.optimalEntry > 0
      ? alert.optimalEntry
      : matchingOpp?.optimalEntry && matchingOpp.optimalEntry > 0
        ? matchingOpp.optimalEntry
        : alert.price;

  const stopLoss =
    alert.stopLoss && alert.stopLoss > 0
      ? alert.stopLoss
      : matchingOpp?.stopLoss && matchingOpp.stopLoss > 0
        ? matchingOpp.stopLoss
        : isLong
          ? Number((entryPrice * 0.98).toFixed(6))
          : Number((entryPrice * 1.02).toFixed(6));

  const tp1 =
    alert.tp1 && alert.tp1 > 0
      ? alert.tp1
      : matchingOpp?.tp1 && matchingOpp.tp1 > 0
        ? matchingOpp.tp1
        : isLong
          ? Number((entryPrice * 1.035).toFixed(6))
          : Number((entryPrice * 0.965).toFixed(6));

  const tp2 =
    alert.tp2 && alert.tp2 > 0
      ? alert.tp2
      : matchingOpp?.tp2 && matchingOpp.tp2 > 0
        ? matchingOpp.tp2
        : isLong
          ? Number((entryPrice * 1.06).toFixed(6))
          : Number((entryPrice * 0.94).toFixed(6));

  const tp3 =
    alert.tp3 && alert.tp3 > 0
      ? alert.tp3
      : matchingOpp?.tp3 && matchingOpp.tp3 > 0
        ? matchingOpp.tp3
        : isLong
          ? Number((entryPrice * 1.09).toFixed(6))
          : Number((entryPrice * 0.91).toFixed(6));

  const leverage =
    alert.suggestedMaxLeverage ?? matchingOpp?.suggestedMaxLeverage ?? 5;
  const now = Date.now();

  return {
    id: `${alert.symbol}-alert-${now}`,
    createdAt: now,
    updatedAt: now,
    symbol: alert.symbol,
    baseAsset: alert.baseAsset,
    timeframe: alert.timeframe,
    direction,
    phase: alert.phase,
    confidence: alert.confidence,
    entryPrice,
    stopLoss,
    tp1,
    tp2,
    tp3,
    leverage,
    capitalUsd: options?.capitalUsd ?? 1000,
    riskPct: options?.riskPct ?? 2,
    status: 'OPEN',
    notes: alert.reasonEn,
    autoLogged: false,
  };
}

export interface JournalStatsSummary {
  total: number;
  openCount: number;
  closedCount: number;
  winRatePct: number;
  avgRMultiple: number;
  netLeveragedPnlPct: number;
  netPnlUsd: number;
}

export function computeJournalStats(
  entries: JournalEntry[],
  livePriceMap: Record<string, number>,
): JournalStatsSummary {
  if (entries.length === 0) {
    return {
      total: 0,
      openCount: 0,
      closedCount: 0,
      winRatePct: 0,
      avgRMultiple: 0,
      netLeveragedPnlPct: 0,
      netPnlUsd: 0,
    };
  }

  let openCount = 0;
  let wins = 0;
  let rSum = 0;
  let pnlSum = 0;
  let usdSum = 0;

  for (const entry of entries) {
    if (entry.status === 'OPEN') openCount++;
    const ev = evaluateJournalEntry(entry, livePriceMap[entry.symbol]);
    if (ev.isWin) wins++;
    rSum += ev.rMultiple;
    pnlSum += ev.leveragedPnlPct;
    usdSum += ev.pnlUsd;
  }

  return {
    total: entries.length,
    openCount,
    closedCount: entries.length - openCount,
    winRatePct: Math.round((wins / entries.length) * 100),
    avgRMultiple: Number((rSum / entries.length).toFixed(2)),
    netLeveragedPnlPct: Number(pnlSum.toFixed(2)),
    netPnlUsd: Number(usdSum.toFixed(2)),
  };
}

export interface PortfolioHeatSummary {
  openCount: number;
  totalOpenRiskPct: number;
  longRiskPct: number;
  shortRiskPct: number;
  longCount: number;
  shortCount: number;
  thresholdPct: number;
  isOverheated: boolean;
  isDirectionSkewed: boolean;
  dominantDirection: 'LONG' | 'SHORT' | 'BALANCED';
}

export function computePortfolioHeat(
  entries: JournalEntry[],
  thresholdPct = 6,
): PortfolioHeatSummary {
  let openCount = 0;
  let longRiskPct = 0;
  let shortRiskPct = 0;
  let longCount = 0;
  let shortCount = 0;

  for (const entry of entries) {
    if (entry.status !== 'OPEN') continue;
    openCount++;
    // If SL was moved to breakeven at entryPrice, effective risk at stop is 0
    const isRiskFreeBreakeven =
      Boolean(entry.movedToBreakeven) || Math.abs(entry.stopLoss - entry.entryPrice) <= 1e-9;
    const effectiveRisk = isRiskFreeBreakeven
      ? 0
      : Math.max(0, Number.isFinite(entry.riskPct) ? entry.riskPct : 2);
    if (entry.direction === 'LONG') {
      longRiskPct += effectiveRisk;
      longCount++;
    } else {
      shortRiskPct += effectiveRisk;
      shortCount++;
    }
  }

  const totalOpenRiskPct = Number((longRiskPct + shortRiskPct).toFixed(2));
  const dominantDirection: 'LONG' | 'SHORT' | 'BALANCED' =
    longRiskPct > shortRiskPct + 0.5
      ? 'LONG'
      : shortRiskPct > longRiskPct + 0.5
        ? 'SHORT'
        : 'BALANCED';
  const isDirectionSkewed =
    Math.max(longCount, shortCount) >= 3 && (longCount === 0 || shortCount === 0);

  return {
    openCount,
    totalOpenRiskPct,
    longRiskPct: Number(longRiskPct.toFixed(2)),
    shortRiskPct: Number(shortRiskPct.toFixed(2)),
    longCount,
    shortCount,
    thresholdPct,
    isOverheated: totalOpenRiskPct > thresholdPct,
    isDirectionSkewed,
    dominantDirection,
  };
}

export interface EquityCurvePoint {
  index: number;
  timestamp: number;
  symbol: string;
  pnlUsd: number;
  cumulativePnlUsd: number;
  rMultiple: number;
  isClosed: boolean;
}

export interface RDistributionBucket {
  label: string;
  count: number;
  positive: boolean;
}

export interface JournalEquityAnalytics {
  points: EquityCurvePoint[];
  buckets: RDistributionBucket[];
  maxDrawdownUsd: number;
  profitFactor: number;
}

export function buildJournalEquityCurve(
  entries: JournalEntry[],
  livePriceMap: Record<string, number>,
): JournalEquityAnalytics {
  const chronological = [...entries].sort(
    (a, b) => (a.closedAt ?? a.createdAt) - (b.closedAt ?? b.createdAt),
  );

  let cumulative = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  const bucketCounts = [0, 0, 0, 0, 0];
  const points: EquityCurvePoint[] = chronological.map((entry, idx) => {
    const ev = evaluateJournalEntry(entry, livePriceMap[entry.symbol]);
    cumulative += ev.pnlUsd;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDrawdownUsd) maxDrawdownUsd = dd;

    if (ev.pnlUsd > 0) grossProfit += ev.pnlUsd;
    else if (ev.pnlUsd < 0) grossLoss += Math.abs(ev.pnlUsd);

    if (ev.rMultiple < -1) bucketCounts[0]++;
    else if (ev.rMultiple < 0) bucketCounts[1]++;
    else if (ev.rMultiple < 1) bucketCounts[2]++;
    else if (ev.rMultiple < 2) bucketCounts[3]++;
    else bucketCounts[4]++;

    return {
      index: idx + 1,
      timestamp: entry.closedAt ?? entry.createdAt,
      symbol: entry.baseAsset,
      pnlUsd: ev.pnlUsd,
      cumulativePnlUsd: Number(cumulative.toFixed(2)),
      rMultiple: ev.rMultiple,
      isClosed: entry.status !== 'OPEN',
    };
  });

  const buckets: RDistributionBucket[] = [
    { label: '<-1R', count: bucketCounts[0], positive: false },
    { label: '-1..0R', count: bucketCounts[1], positive: false },
    { label: '0..1R', count: bucketCounts[2], positive: true },
    { label: '1..2R', count: bucketCounts[3], positive: true },
    { label: '2R+', count: bucketCounts[4], positive: true },
  ];

  const profitFactor =
    grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 9.99 : 0;

  return {
    points,
    buckets,
    maxDrawdownUsd: Number(maxDrawdownUsd.toFixed(2)),
    profitFactor,
  };
}

