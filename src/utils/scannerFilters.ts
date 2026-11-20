import type { ScannerOpportunity } from '../types/futures';

export type RsiFilterMode =
  | 'ANY'
  | 'OVERBOUGHT_70'
  | 'OVERSOLD_30'
  | 'BULL_ZONE'
  | 'BEAR_ZONE'
  | 'CUSTOM';

export type ProximityFilterMode =
  | 'ANY'
  | 'NEAR_SUPPORT'
  | 'NEAR_RESISTANCE'
  | 'DISCOUNT_ZONE';

export type FundingBiasMode = 'ANY' | 'NEGATIVE' | 'POSITIVE';

export interface AdvancedScannerFilters {
  rsiCondition: RsiFilterMode;
  rsiMin: number;
  rsiMax: number;
  minVolumeRatio: number; // e.g., 2.0 => Volume > 200% average
  proximityFilter: ProximityFilterMode;
  proximityThresholdPct: number;
  minConfidence: number;
  minAlignedTimeframes: number;
  onlyTtmSqueeze: boolean;
  fundingBias: FundingBiasMode;
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedScannerFilters = {
  rsiCondition: 'ANY',
  rsiMin: 30,
  rsiMax: 70,
  minVolumeRatio: 0,
  proximityFilter: 'ANY',
  proximityThresholdPct: 2.5,
  minConfidence: 0,
  minAlignedTimeframes: 0,
  onlyTtmSqueeze: false,
  fundingBias: 'ANY',
};

export function countActiveAdvancedFilters(filters: AdvancedScannerFilters): number {
  let count = 0;
  if (filters.rsiCondition !== 'ANY') count++;
  if (filters.minVolumeRatio > 0) count++;
  if (filters.proximityFilter !== 'ANY') count++;
  if (filters.minConfidence > 0) count++;
  if (filters.minAlignedTimeframes > 0) count++;
  if (filters.onlyTtmSqueeze) count++;
  if (filters.fundingBias !== 'ANY') count++;
  return count;
}

export function isNearPriceLevel(
  lastPrice: number,
  targetLevel: number | undefined,
  maxDistancePct: number,
): boolean {
  if (!lastPrice || lastPrice <= 0 || !targetLevel || targetLevel <= 0) {
    return false;
  }
  const distPct = (Math.abs(lastPrice - targetLevel) / lastPrice) * 100;
  return distPct <= Math.max(0.2, maxDistancePct);
}

export function matchesAdvancedFilters(
  opp: ScannerOpportunity,
  filters: AdvancedScannerFilters,
): boolean {
  // 1. RSI (14) Regime Filter
  switch (filters.rsiCondition) {
    case 'OVERBOUGHT_70':
      if (!(opp.rsi14 > 70)) return false;
      break;
    case 'OVERSOLD_30':
      if (!(opp.rsi14 < 30)) return false;
      break;
    case 'BULL_ZONE':
      if (opp.rsi14 < 52 || opp.rsi14 > 68) return false;
      break;
    case 'BEAR_ZONE':
      if (opp.rsi14 < 32 || opp.rsi14 > 48) return false;
      break;
    case 'CUSTOM':
      if (opp.rsi14 < filters.rsiMin || opp.rsi14 > filters.rsiMax) return false;
      break;
    case 'ANY':
    default:
      break;
  }

  // 2. Volume vs 20-bar Average Filter (e.g., 2.0 => > 200% average)
  if (filters.minVolumeRatio > 0 && opp.volumeRatio20 < filters.minVolumeRatio) {
    return false;
  }

  // 3. Structural Price Proximity Filter (Support / Resistance / Discount SMC)
  if (filters.proximityFilter === 'NEAR_SUPPORT') {
    const supportLevel =
      opp.support1 && opp.support1 > 0
        ? opp.support1
        : opp.direction === 'LONG' && opp.optimalEntry > 0
          ? opp.optimalEntry
          : opp.direction === 'LONG' && opp.stopLoss > 0
            ? opp.stopLoss * 1.01
            : undefined;
    const nearSupport = isNearPriceLevel(opp.lastPrice, supportLevel, filters.proximityThresholdPct);
    const inDiscountSupport =
      opp.smcZone === 'DISCOUNT' &&
      isNearPriceLevel(opp.lastPrice, opp.optimalEntry, filters.proximityThresholdPct * 1.25);
    if (!nearSupport && !inDiscountSupport) {
      return false;
    }
  } else if (filters.proximityFilter === 'NEAR_RESISTANCE') {
    const resistanceLevel =
      opp.resistance1 && opp.resistance1 > 0
        ? opp.resistance1
        : opp.direction === 'SHORT' && opp.optimalEntry > 0
          ? opp.optimalEntry
          : opp.direction === 'LONG' && opp.tp1 > 0
            ? opp.tp1
            : undefined;
    const nearResistance = isNearPriceLevel(
      opp.lastPrice,
      resistanceLevel,
      filters.proximityThresholdPct,
    );
    const inPremiumResistance =
      opp.smcZone === 'PREMIUM' &&
      isNearPriceLevel(opp.lastPrice, opp.optimalEntry, filters.proximityThresholdPct * 1.25);
    if (!nearResistance && !inPremiumResistance) {
      return false;
    }
  } else if (filters.proximityFilter === 'DISCOUNT_ZONE') {
    const isDiscount = opp.smcZone === 'DISCOUNT' || (opp.rsi14 <= 42 && opp.priceChangePct < 2);
    if (!isDiscount) return false;
  }

  // 4. Confidence Floor
  if (filters.minConfidence > 0 && opp.confidence < filters.minConfidence) {
    return false;
  }

  // 5. Multi-Timeframe Alignment Floor
  if (
    filters.minAlignedTimeframes > 0 &&
    (opp.alignedTimeframes ?? 0) < filters.minAlignedTimeframes
  ) {
    return false;
  }

  // 6. TTM Squeeze Active
  if (filters.onlyTtmSqueeze && !opp.ttmSqueeze && !opp.isSqueeze) {
    return false;
  }

  // 7. Funding Bias
  if (filters.fundingBias === 'NEGATIVE' && !(opp.fundingRate < 0)) {
    return false;
  }
  if (filters.fundingBias === 'POSITIVE' && !(opp.fundingRate > 0)) {
    return false;
  }

  return true;
}
