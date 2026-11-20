import type {
  AlertEvent,
  ScannerOpportunity,
  WatchlistAlertRule,
  WatchlistConditionMetric,
  WatchlistRuleCondition,
} from '../types/futures';

export function evaluateRuleCondition(
  opp: ScannerOpportunity,
  cond: WatchlistRuleCondition,
): boolean {
  switch (cond.metric) {
    case 'MTF_ALIGNED':
      return (opp.alignedTimeframes ?? 0) >= cond.threshold;
    case 'TTM_SQUEEZE_BARS':
      return Boolean(opp.ttmSqueeze) && (opp.squeezeBars ?? 0) >= cond.threshold;
    case 'FUNDING_LTE':
      // Threshold expressed in basis points or percentage? Keep raw % e.g. -0.02 means -0.0002 rate
      return opp.fundingRate * 100 <= cond.threshold;
    case 'FUNDING_GTE':
      return opp.fundingRate * 100 >= cond.threshold;
    case 'CONFIDENCE_GTE':
      return opp.confidence >= cond.threshold;
    case 'PUMP_PROB_GTE':
      return opp.pumpProbability >= cond.threshold;
    case 'DUMP_PROB_GTE':
      return opp.dumpProbability >= cond.threshold;
    case 'VOL_RATIO_GTE':
      return opp.volumeRatio20 >= cond.threshold;
    default:
      return false;
  }
}

export function doesRuleMatchOpportunity(
  opp: ScannerOpportunity,
  rule: WatchlistAlertRule,
): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  if (rule.symbol !== '*' && opp.symbol !== rule.symbol) return false;

  return rule.matchMode === 'ANY'
    ? rule.conditions.some((c) => evaluateRuleCondition(opp, c))
    : rule.conditions.every((c) => evaluateRuleCondition(opp, c));
}

export function formatRuleConditionLabel(
  cond: WatchlistRuleCondition,
  lang: 'en' | 'fa',
): string {
  const labels: Record<WatchlistConditionMetric, { en: string; fa: string; unit: string }> = {
    MTF_ALIGNED: { en: 'MTF Aligned ≥', fa: 'هم‌گرایی MTF ≥', unit: '/3' },
    TTM_SQUEEZE_BARS: { en: 'TTM Squeeze ≥', fa: 'فشردگی TTM ≥', unit: 'b' },
    FUNDING_LTE: { en: 'Funding ≤', fa: 'فاندینگ ≤', unit: '%' },
    FUNDING_GTE: { en: 'Funding ≥', fa: 'فاندینگ ≥', unit: '%' },
    CONFIDENCE_GTE: { en: 'Confidence ≥', fa: 'اطمینان ≥', unit: '%' },
    PUMP_PROB_GTE: { en: 'Pump Prob ≥', fa: 'احتمال پامپ ≥', unit: '%' },
    DUMP_PROB_GTE: { en: 'Dump Prob ≥', fa: 'احتمال دامپ ≥', unit: '%' },
    VOL_RATIO_GTE: { en: 'Vol Ratio ≥', fa: 'نسبت حجم ≥', unit: 'x' },
  };
  const item = labels[cond.metric];
  return `${item[lang]} ${cond.threshold}${item.unit}`;
}

export interface WatchlistRuleTriggerResult {
  triggeredAlerts: AlertEvent[];
  updatedRules: WatchlistAlertRule[];
}

export function evaluateWatchlistRules(
  opportunities: ScannerOpportunity[],
  rules: WatchlistAlertRule[],
  now = Date.now(),
): WatchlistRuleTriggerResult {
  if (opportunities.length === 0 || rules.length === 0) {
    return { triggeredAlerts: [], updatedRules: rules };
  }

  const triggeredAlerts: AlertEvent[] = [];
  let anyChanged = false;

  const updatedRules = rules.map((rule) => {
    if (!rule.enabled || rule.conditions.length === 0) return rule;
    const cooldownMs = Math.max(1, rule.cooldownMinutes) * 60_000;
    if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < cooldownMs) {
      return rule;
    }

    const match = opportunities.find((opp) => doesRuleMatchOpportunity(opp, rule));
    if (!match) return rule;

    anyChanged = true;
    const isBear =
      match.direction === 'SHORT' ||
      (match.direction === 'NEUTRAL' && match.dumpProbability > match.pumpProbability);
    const condTextEn = rule.conditions.map((c) => formatRuleConditionLabel(c, 'en')).join(' · ');
    const condTextFa = rule.conditions.map((c) => formatRuleConditionLabel(c, 'fa')).join(' · ');

    triggeredAlerts.push({
      id: `rule-${rule.id}-${match.symbol}-${now}`,
      timestamp: now,
      symbol: match.symbol,
      baseAsset: match.baseAsset,
      timeframe: match.timeframe,
      phase: match.phase,
      direction: match.direction === 'NEUTRAL' ? (isBear ? 'SHORT' : 'LONG') : match.direction,
      confidence: Math.max(match.confidence, 55),
      pumpProbability: Math.max(52, match.pumpProbability),
      dumpProbability: Math.max(52, match.dumpProbability),
      price: match.lastPrice,
      optimalEntry: match.optimalEntry,
      stopLoss: match.stopLoss,
      tp1: match.tp1,
      tp2: match.tp2,
      tp3: match.tp3,
      suggestedMaxLeverage: match.suggestedMaxLeverage,
      volumeZScore: match.volumeZScore,
      qualityGrade: match.confidence >= 75 ? 'A' : 'B',
      alignedTimeframes: match.alignedTimeframes,
      takerBuyPct: Math.round(match.takerBuyRatio * 100),
      reasonEn: `[Custom Rule: ${rule.name}] ${condTextEn}`,
      reasonFa: `[قانون سفارشی: ${rule.name}] ${condTextFa}`,
    });

    return {
      ...rule,
      lastTriggeredAt: now,
    };
  });

  return {
    triggeredAlerts,
    updatedRules: anyChanged ? updatedRules : rules,
  };
}
