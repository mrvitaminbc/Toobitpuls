import type {
  AlertAccuracySummary,
  AlertEvent,
  AlertOutcomeRecord,
  AlertOutcomeStatus,
  AlertQualityGrade,
  GradeAccuracyStat,
} from '../types/futures';
import { classifyAlertSide, estimateAlertFallbackMove } from './alerts';

export function initializeOutcomeFromAlert(alert: AlertEvent): AlertOutcomeRecord {
  const side = classifyAlertSide(alert);
  const entryPrice =
    alert.optimalEntry && alert.optimalEntry > 0 ? alert.optimalEntry : alert.price;
  const fallbackMove = estimateAlertFallbackMove(alert);
  const horizonMax = alert.expectedHorizonHoursMax ?? fallbackMove.expectedHorizonHoursMax;
  const defaultSl =
    side === 'PUMP' ? Number((entryPrice * 0.975).toFixed(6)) : Number((entryPrice * 1.025).toFixed(6));

  return {
    alertId: alert.id,
    symbol: alert.symbol,
    baseAsset: alert.baseAsset,
    side,
    qualityGrade: alert.qualityGrade ?? 'B',
    timeframe: alert.timeframe,
    entryPrice,
    stopLoss: alert.stopLoss && alert.stopLoss > 0 ? alert.stopLoss : defaultSl,
    expectedMoveMinPct: Math.abs(fallbackMove.expectedMoveMinPct),
    expectedMoveMaxPct: Math.abs(fallbackMove.expectedMoveMaxPct),
    startedAt: alert.timestamp,
    expiresAt: alert.timestamp + Math.max(4, horizonMax) * 3_600_000,
    lastPrice: alert.price,
    mfePct: 0,
    maePct: 0,
    status: 'TRACKING',
    lastEvaluatedAt: alert.timestamp,
  };
}

export function evaluateAlertOutcomeWithPrice(
  record: AlertOutcomeRecord,
  livePrice: number | undefined,
  now = Date.now(),
): AlertOutcomeRecord {
  if (record.status !== 'TRACKING') {
    return record;
  }
  if (!livePrice || !Number.isFinite(livePrice) || livePrice <= 0 || record.entryPrice <= 0) {
    return record;
  }

  const isPump = record.side === 'PUMP';
  const signedMovePct = isPump
    ? ((livePrice - record.entryPrice) / record.entryPrice) * 100
    : ((record.entryPrice - livePrice) / record.entryPrice) * 100;

  const nextMfe = Number(Math.max(record.mfePct, Math.max(0, signedMovePct)).toFixed(2));
  const nextMae = Number(Math.max(record.maePct, Math.max(0, -signedMovePct)).toFixed(2));

  const hitSl = isPump ? livePrice <= record.stopLoss : livePrice >= record.stopLoss;
  const hitTarget = nextMfe >= record.expectedMoveMinPct;

  let status: AlertOutcomeStatus = record.status;
  let closedAt: number | undefined = record.closedAt;

  if (hitTarget) {
    status = 'HIT_TARGET';
    closedAt = now;
  } else if (hitSl) {
    status = 'INVALIDATED';
    closedAt = now;
  } else if (now >= record.expiresAt) {
    status = nextMfe >= Math.max(1.2, record.expectedMoveMinPct * 0.45) && signedMovePct > 0
      ? 'EXPIRED_PROFIT'
      : 'INVALIDATED';
    closedAt = now;
  }

  return {
    ...record,
    lastPrice: livePrice,
    mfePct: nextMfe,
    maePct: nextMae,
    status,
    closedAt,
    lastEvaluatedAt: now,
  };
}

export function computeAlertAccuracySummary(records: AlertOutcomeRecord[]): AlertAccuracySummary {
  const grades: AlertQualityGrade[] = ['A+', 'A', 'B'];
  const resolved = records.filter((r) => r.status !== 'TRACKING');
  const wins = resolved.filter((r) => r.status === 'HIT_TARGET' || r.status === 'EXPIRED_PROFIT');

  const avgMfePct =
    records.length > 0
      ? Number((records.reduce((acc, r) => acc + r.mfePct, 0) / records.length).toFixed(2))
      : 0;
  const avgMaePct =
    records.length > 0
      ? Number((records.reduce((acc, r) => acc + r.maePct, 0) / records.length).toFixed(2))
      : 0;

  const byGrade: GradeAccuracyStat[] = grades.map((grade) => {
    const group = records.filter((r) => r.qualityGrade === grade);
    const gResolved = group.filter((r) => r.status !== 'TRACKING');
    const gWins = gResolved.filter((r) => r.status === 'HIT_TARGET' || r.status === 'EXPIRED_PROFIT');
    return {
      grade,
      total: group.length,
      resolved: gResolved.length,
      wins: gWins.length,
      winRatePct: gResolved.length > 0 ? Math.round((gWins.length / gResolved.length) * 100) : 0,
      avgMfePct:
        group.length > 0
          ? Number((group.reduce((acc, r) => acc + r.mfePct, 0) / group.length).toFixed(2))
          : 0,
      avgMaePct:
        group.length > 0
          ? Number((group.reduce((acc, r) => acc + r.maePct, 0) / group.length).toFixed(2))
          : 0,
    };
  });

  return {
    totalTracked: records.length,
    resolvedCount: resolved.length,
    trackingCount: records.length - resolved.length,
    winsCount: wins.length,
    overallWinRatePct: resolved.length > 0 ? Math.round((wins.length / resolved.length) * 100) : 0,
    avgMfePct,
    avgMaePct,
    byGrade,
  };
}
