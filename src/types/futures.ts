export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';
export type Language = 'fa' | 'en';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradesCount: number;
  takerBuyBaseVol: number;
  takerBuyQuoteVol: number;
}

export interface MarketTicker {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: number;
  markPrice: number;
  indexBasisPct: number;
  open24h: number;
  high24h: number;
  low24h: number;
  priceChange: number;
  priceChangePct: number;
  volume24h: number;
  quoteVolume24h: number;
  openInterest: number;
  openInterestUsd: number;
  oiDeltaPct: number;
  fundingRate: number;
  nextFundingTime: number;
  volumeAccelPct: number;
  updatedAt: number;
}

export interface OrderBookLevel {
  price: number;
  qty: number;
  totalUsd: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bidDepthUsd: number;
  askDepthUsd: number;
  imbalanceRatio: number;
  spreadPct: number;
  largestBidWall: OrderBookLevel | null;
  largestAskWall: OrderBookLevel | null;
  updatedAt: number;
}

export interface RecentTrade {
  time: number;
  price: number;
  qty: number;
  quoteUsd: number;
  isBuyerMaker: boolean;
}

export type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export type MarketPhase =
  | 'PRE_PUMP'
  | 'PRE_DUMP'
  | 'PUMP_ACTIVE'
  | 'DUMP_ACTIVE'
  | 'SQUEEZE_WATCH'
  | 'CONSOLIDATION';

export interface SignalFactor {
  id: string;
  labelEn: string;
  labelFa: string;
  score: number; // -100 (strong bearish) to +100 (strong bullish)
  weight: number;
  valueText: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  detailEn: string;
  detailFa: string;
}

export interface IndicatorSnapshot {
  rsi14: number;
  stochK: number;
  stochD: number;
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidthPct: number;
  bbWidthPercentile: number;
  ttmSqueeze: boolean;
  squeezeBars: number;
  ttmMomentum: number;
  atr14: number;
  atrPct: number;
  atrExpansionRatio: number;
  vwap: number;
  adx14: number;
  plusDi: number;
  minusDi: number;
  obvSlope: number;
  cvdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  obvBreakout: 'BULLISH' | 'BEARISH' | 'NONE';
  donchianPos: number;
  superTrendDir: 'BULLISH' | 'BEARISH';
  superTrendValue: number;
  ichimokuState: 'ABOVE_KUMO' | 'INSIDE_KUMO' | 'BELOW_KUMO';
  cmf20: number;
  mfi14: number;
  smcZone: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  support1: number;
  support2: number;
  resistance1: number;
  resistance2: number;
  wickSignal: 'BULLISH_ABSORPTION' | 'BEARISH_REJECTION' | 'NONE';
}

export interface DetectedPattern {
  id: string;
  category: 'CANDLESTICK' | 'CHART' | 'SMC' | 'DIVERGENCE';
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number; // 1..100
  nameEn: string;
  nameFa: string;
  detailEn: string;
  detailFa: string;
}

export interface MtfTimeframeSnapshot {
  timeframe: '1h' | '4h' | '1d';
  direction: SignalDirection;
  score: number; // -100..+100
  superTrend: 'BULLISH' | 'BEARISH';
  ichimoku: 'ABOVE_KUMO' | 'INSIDE_KUMO' | 'BELOW_KUMO';
  adx14: number;
  rsi14: number;
  structure: 'BULLISH' | 'BEARISH' | 'RANGING';
}

export interface MtfSummary {
  tf1h: MtfTimeframeSnapshot | null;
  tf4h: MtfTimeframeSnapshot | null;
  tf1d: MtfTimeframeSnapshot | null;
  alignmentScore: number; // -100..+100
  alignmentLabel: 'STRONG_BULL' | 'BULL_CONFLUENCE' | 'CONFLICT' | 'BEAR_CONFLUENCE' | 'STRONG_BEAR';
  alignedTimeframes: number; // 0..3
}

export interface TradePlan {
  action: 'LONG' | 'SHORT' | 'WAIT';
  entryZoneLow: number;
  entryZoneHigh: number;
  optimalEntry: number;
  stopLoss: number;
  slDistancePct: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskReward1: number;
  riskReward2: number;
  riskReward3: number;
  suggestedMaxLeverage: number;
  invalidationEn: string;
  invalidationFa: string;
}

export interface ChartSeries {
  ema9: (number | null)[];
  ema21: (number | null)[];
  ema50: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
  vwap: (number | null)[];
  rsi: (number | null)[];
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  macdHist: (number | null)[];
  cvd: number[];
}

export interface BacktestTrade {
  id: string;
  direction: 'LONG' | 'SHORT';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  outcome: 'WIN' | 'LOSS';
  rMultiple: number;
  pnlPct: number;
}

export interface BacktestSummary {
  tradesCount: number;
  winRatePct: number;
  avgRr: number;
  netReturnPct: number;
  trades?: BacktestTrade[];
}

export interface AnalysisResult {
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  lastPrice: number;
  markPrice: number;
  priceChangePct: number;
  quoteVolume24h: number;
  openInterestUsd: number;
  oiDeltaPct: number;
  fundingRate: number;
  direction: SignalDirection;
  phase: MarketPhase;
  confidence: number; // 0..100
  pumpProbability: number; // 0..100
  dumpProbability: number; // 0..100
  sharpMoveScore: number; // 0..100 readiness for >=20% daily expansion
  sharpMoveBias: 'PUMP_20_PLUS' | 'DUMP_20_PLUS' | 'BALANCED';
  suspiciousVolumeScore: number; // 0..100
  volumeZScore: number;
  volumeRatio20: number;
  takerBuyRatio: number; // 0..1
  cvdTrend: 'ACCUMULATION' | 'DISTRIBUTION' | 'BALANCED';
  isSqueeze: boolean;
  indicators: IndicatorSnapshot;
  patterns: DetectedPattern[];
  mtf: MtfSummary | null;
  tradePlan: TradePlan;
  factors: SignalFactor[];
  summaryEn: string;
  summaryFa: string;
  conclusionEn: string;
  conclusionFa: string;
  candles: Candle[];
  series: ChartSeries;
  orderBook: OrderBookSnapshot | null;
  recentTrades: RecentTrade[];
  backtest: BacktestSummary;
  analyzedAt: number;
}

export interface ScannerOpportunity {
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  lastPrice: number;
  markPrice: number;
  priceChangePct: number;
  quoteVolume24h: number;
  openInterestUsd: number;
  oiDeltaPct: number;
  fundingRate: number;
  direction: SignalDirection;
  phase: MarketPhase;
  confidence: number;
  pumpProbability: number;
  dumpProbability: number;
  sharpMoveScore?: number;
  sharpMoveBias?: 'PUMP_20_PLUS' | 'DUMP_20_PLUS' | 'BALANCED';
  ttmSqueeze?: boolean;
  squeezeBars?: number;
  cvdDivergence?: 'BULLISH' | 'BEARISH' | 'NONE';
  suspiciousVolumeScore: number;
  volumeZScore: number;
  volumeRatio20: number;
  takerBuyRatio: number;
  rsi14: number;
  adx14?: number;
  vwapDistPct?: number;
  cmf20?: number;
  atrPct?: number;
  bbWidthPercentile: number;
  isSqueeze: boolean;
  imbalanceRatio: number | null;
  spreadPct?: number | null;
  mtfAlignment?: MtfSummary['alignmentLabel'] | null;
  alignedTimeframes?: number;
  topPatternEn?: string | null;
  topPatternFa?: string | null;
  optimalEntry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  support1?: number;
  resistance1?: number;
  smcZone?: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  riskReward2: number;
  suggestedMaxLeverage: number;
  summaryEn: string;
  summaryFa: string;
  analyzedAt: number;
}

export type SignalCriterionId =
  | 'liquidity'
  | 'mtf'
  | 'riskReward'
  | 'trendOrSqueeze'
  | 'orderflow'
  | 'vwapMomentum'
  | 'derivatives';

export interface SignalCriterionCheck {
  id: SignalCriterionId;
  labelEn: string;
  labelFa: string;
  passed: boolean;
  valueText: string;
  detailEn: string;
  detailFa: string;
}

export interface SignalQualificationSummary {
  qualified: boolean;
  hardBlocked: boolean;
  hardBlockReason?: string;
  passedCount: number;
  totalCount: number;
  grade: AlertQualityGrade;
  compositeScore: number;
  criteria: SignalCriterionCheck[];
}

export type AlertQualityGrade = 'A+' | 'A' | 'B';

export interface AlertEvent {
  id: string;
  timestamp: number;
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  phase: MarketPhase;
  direction: SignalDirection;
  confidence: number;
  pumpProbability?: number;
  dumpProbability?: number;
  price: number;
  optimalEntry?: number;
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  suggestedMaxLeverage?: number;
  volumeZScore: number;
  qualityGrade?: AlertQualityGrade;
  qualityScore?: number;
  alignedTimeframes?: number;
  expectedMoveMinPct?: number;
  expectedMoveMaxPct?: number;
  expectedHorizonHoursMin?: number;
  expectedHorizonHoursMax?: number;
  expectedWindowEn?: string;
  expectedWindowFa?: string;
  riskReward1?: number;
  takerBuyPct?: number;
  reasonEn: string;
  reasonFa: string;
}

export interface ScannerSettings {
  timeframe: Timeframe;
  minVolume24h: number;
  minConfidence: number;
  onlySuspiciousVolume: boolean;
  soundAlerts: boolean;
  browserAlerts: boolean;
  refreshSeconds: number;
  autoLogSignals: boolean;
  autoTrackJournal: boolean;
  autoMoveBreakeven?: boolean;
}

export type JournalStatus = 'OPEN' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'CLOSED';
export type JournalCloseReason = 'STOP_LOSS' | 'TP1' | 'TP2' | 'TP3' | 'MANUAL';

export interface JournalEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  direction: 'LONG' | 'SHORT';
  phase: MarketPhase;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  leverage: number;
  capitalUsd: number;
  riskPct: number;
  status: JournalStatus;
  closeReason?: JournalCloseReason;
  exitPrice?: number;
  notes: string;
  autoLogged?: boolean;
  movedToBreakeven?: boolean;
}

export type WebhookPlatform = 'discord' | 'telegram';

export interface WebhookConfig {
  enabled: boolean;
  discordWebhookUrl: string;
  telegramWebhookUrl: string;
  minConfidence: number;
}

export interface WebhookDeliveryLog {
  id: string;
  timestamp: number;
  platform: WebhookPlatform;
  symbol: string;
  confidence: number;
  ok: boolean;
  statusCode: number | null;
  error?: string;
}

export type SentimentMood = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface SocialPlatformScore {
  id: 'coingecko' | 'fear_greed' | 'media_pulse';
  nameEn: string;
  nameFa: string;
  score: number; // 0..100
  mood: SentimentMood;
  detailEn: string;
  detailFa: string;
  available: boolean;
}

export interface SocialHeadlineItem {
  title: string;
  source: string;
  publishedAt: number;
  url: string;
  sentiment: SentimentMood;
  matchedCoin: boolean;
}

export interface SocialSentimentData {
  symbol: string;
  baseAsset: string;
  coinName: string | null;
  moodScore: number; // 0..100
  mood: SentimentMood;
  bullishPct: number;
  bearishPct: number;
  fearGreedValue: number | null;
  fearGreedLabel: string | null;
  watchlistUsers: number | null;
  coinMentionsCount: number;
  platforms: SocialPlatformScore[];
  headlines: SocialHeadlineItem[];
  fetchedAt: number;
}


export type AlertOutcomeStatus = 'TRACKING' | 'HIT_TARGET' | 'EXPIRED_PROFIT' | 'INVALIDATED';

export interface AlertOutcomeRecord {
  alertId: string;
  symbol: string;
  baseAsset: string;
  side: 'PUMP' | 'DUMP';
  qualityGrade: AlertQualityGrade;
  timeframe: Timeframe;
  entryPrice: number;
  stopLoss: number;
  expectedMoveMinPct: number;
  expectedMoveMaxPct: number;
  startedAt: number;
  expiresAt: number;
  lastPrice: number;
  mfePct: number;
  maePct: number;
  status: AlertOutcomeStatus;
  closedAt?: number;
  lastEvaluatedAt: number;
}

export interface GradeAccuracyStat {
  grade: AlertQualityGrade;
  total: number;
  resolved: number;
  wins: number;
  winRatePct: number;
  avgMfePct: number;
  avgMaePct: number;
}

export interface AlertAccuracySummary {
  totalTracked: number;
  resolvedCount: number;
  trackingCount: number;
  winsCount: number;
  overallWinRatePct: number;
  avgMfePct: number;
  avgMaePct: number;
  byGrade: GradeAccuracyStat[];
}

export interface LiquidationCluster {
  id: string;
  price: number;
  side: 'LONG_LIQ' | 'SHORT_LIQ';
  leverageTier: '25x' | '50x' | '100x';
  distancePct: number;
  intensity: number; // 0..100
  anchorSwingPrice: number;
}

export interface CrowdedSqueezeInfo {
  isCrowded: boolean;
  squeezeType: 'SHORT_SQUEEZE' | 'LONG_SQUEEZE' | 'NONE';
  squeezeScore: number; // 0..100
  labelEn: string;
  labelFa: string;
}

export type WatchlistConditionMetric =
  | 'MTF_ALIGNED'
  | 'TTM_SQUEEZE_BARS'
  | 'FUNDING_LTE'
  | 'FUNDING_GTE'
  | 'CONFIDENCE_GTE'
  | 'PUMP_PROB_GTE'
  | 'DUMP_PROB_GTE'
  | 'VOL_RATIO_GTE';

export interface WatchlistRuleCondition {
  metric: WatchlistConditionMetric;
  threshold: number;
}

export interface WatchlistAlertRule {
  id: string;
  symbol: string;
  name: string;
  enabled: boolean;
  matchMode: 'ALL' | 'ANY';
  conditions: WatchlistRuleCondition[];
  cooldownMinutes: number;
  lastTriggeredAt?: number;
  createdAt: number;
}

export type AiVerdict = 'STRONG_LONG' | 'LONG' | 'NEUTRAL_WAIT' | 'SHORT' | 'STRONG_SHORT';

export interface AiCryptoAnalysisReport {
  symbol: string;
  baseAsset: string;
  timeframe: Timeframe;
  model: string;
  verdict: AiVerdict;
  confidence: number;
  agreesWithTechnical: boolean;
  headlineFa: string;
  headlineEn: string;
  summaryFa: string;
  summaryEn: string;
  bullCaseFa: string;
  bullCaseEn: string;
  bearCaseFa: string;
  bearCaseEn: string;
  riskWarningsFa: string[];
  riskWarningsEn: string[];
  executionAdviceFa: string;
  executionAdviceEn: string;
  sentimentContext: {
    moodScore: number;
    mood: SentimentMood;
    fearGreedValue: number | null;
    fearGreedLabel: string | null;
    coinMentionsCount: number;
  };
  generatedAt: number;
  cached: boolean;
}



