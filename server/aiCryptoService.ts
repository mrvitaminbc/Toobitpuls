import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AiCryptoAnalysisReport,
  AiVerdict,
  AnalysisResult,
  SocialSentimentData,
  Timeframe,
} from '../src/types/futures';
import {
  buildOpportunityFromAnalysisResult,
  evaluateSignalQualification,
} from '../src/utils/signalQualification';
import { socialSentimentService } from './socialSentimentService';
import { toobitService } from './toobitService';

const GEMINI_FREE_MODEL = 'gemini-4-hydrogen';
const AI_CACHE_TTL_MS = 3 * 60 * 1000;

export class AiServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 502, code = 'AI_UPSTREAM_ERROR') {
    super(message);
    this.name = 'AiServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AiAnalysisDeps {
  getApiKey?: () => string | undefined;
  analyzeSymbol?: (symbol: string, timeframe: Timeframe) => Promise<AnalysisResult>;
  getSentiment?: (symbol: string) => Promise<SocialSentimentData>;
  generateJson?: (prompt: string) => Promise<string>;
}

const VALID_VERDICTS = new Set<AiVerdict>([
  'STRONG_LONG',
  'LONG',
  'NEUTRAL_WAIT',
  'SHORT',
  'STRONG_SHORT',
]);

const AI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      description: 'One of: STRONG_LONG, LONG, NEUTRAL_WAIT, SHORT, STRONG_SHORT',
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Calibrated confidence integer from 1 to 99',
    },
    agreesWithTechnical: {
      type: Type.BOOLEAN,
      description: 'True if AI verdict aligns with the technical engine direction',
    },
    headlineFa: { type: Type.STRING },
    headlineEn: { type: Type.STRING },
    summaryFa: { type: Type.STRING },
    summaryEn: { type: Type.STRING },
    bullCaseFa: { type: Type.STRING },
    bullCaseEn: { type: Type.STRING },
    bearCaseFa: { type: Type.STRING },
    bearCaseEn: { type: Type.STRING },
    riskWarningsFa: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    riskWarningsEn: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    executionAdviceFa: { type: Type.STRING },
    executionAdviceEn: { type: Type.STRING },
  },
  required: [
    'verdict',
    'confidence',
    'agreesWithTechnical',
    'headlineFa',
    'headlineEn',
    'summaryFa',
    'summaryEn',
    'bullCaseFa',
    'bullCaseEn',
    'bearCaseFa',
    'bearCaseEn',
    'riskWarningsFa',
    'riskWarningsEn',
    'executionAdviceFa',
    'executionAdviceEn',
  ],
};

export function buildAiPromptPayload(
  analysis: AnalysisResult,
  sentiment: SocialSentimentData,
): string {
  const opp = buildOpportunityFromAnalysisResult(analysis);
  const qual = evaluateSignalQualification(opp, { minCriteriaRequired: 5, minConfidence: 55 });

  const compactContext = {
    contract: analysis.symbol,
    baseAsset: analysis.baseAsset,
    timeframe: analysis.timeframe,
    price: {
      last: analysis.lastPrice,
      mark: analysis.markPrice,
      change24hPct: Number(analysis.priceChangePct.toFixed(2)),
      quoteVolume24hUsd: Math.round(analysis.quoteVolume24h),
    },
    derivatives: {
      openInterestUsd: Math.round(analysis.openInterestUsd),
      oiDeltaPct: analysis.oiDeltaPct,
      fundingRatePct: Number((analysis.fundingRate * 100).toFixed(4)),
      orderBookImbalance: analysis.orderBook?.imbalanceRatio ?? null,
      spreadPct: analysis.orderBook?.spreadPct ?? null,
    },
    engineOutput: {
      direction: analysis.direction,
      phase: analysis.phase,
      confidence: analysis.confidence,
      pumpProbability: analysis.pumpProbability,
      dumpProbability: analysis.dumpProbability,
      sharpMoveScore: analysis.sharpMoveScore,
      tradePlan: {
        action: analysis.tradePlan.action,
        entry: analysis.tradePlan.optimalEntry,
        stopLoss: analysis.tradePlan.stopLoss,
        slPct: analysis.tradePlan.slDistancePct,
        tp1: analysis.tradePlan.tp1,
        tp2: analysis.tradePlan.tp2,
        tp3: analysis.tradePlan.tp3,
        rr2: analysis.tradePlan.riskReward2,
        maxLeverage: analysis.tradePlan.suggestedMaxLeverage,
      },
    },
    institutionalGate: {
      qualified: qual.qualified,
      passedCount: `${qual.passedCount}/${qual.totalCount}`,
      grade: qual.grade,
      hardBlocked: qual.hardBlocked,
      hardBlockReason: qual.hardBlockReason ?? null,
      failedCriteria: qual.criteria.filter((c) => !c.passed).map((c) => c.id),
      passedCriteria: qual.criteria.filter((c) => c.passed).map((c) => c.id),
    },
    indicators: {
      rsi14: analysis.indicators.rsi14,
      adx14: analysis.indicators.adx14,
      vwap: analysis.indicators.vwap,
      superTrend: analysis.indicators.superTrendDir,
      ichimoku: analysis.indicators.ichimokuState,
      ttmSqueeze: analysis.indicators.ttmSqueeze,
      squeezeBars: analysis.indicators.squeezeBars,
      cmf20: analysis.indicators.cmf20,
      takerBuyRatio: analysis.takerBuyRatio,
      volumeRatio20: analysis.volumeRatio20,
      cvdDivergence: analysis.indicators.cvdDivergence,
      smcZone: analysis.indicators.smcZone,
      support1: analysis.indicators.support1,
      resistance1: analysis.indicators.resistance1,
    },
    mtf: analysis.mtf
      ? {
          alignmentLabel: analysis.mtf.alignmentLabel,
          alignedTimeframes: analysis.mtf.alignedTimeframes,
          score: analysis.mtf.alignmentScore,
        }
      : null,
    backtestOnRecentCandles: {
      trades: analysis.backtest.tradesCount,
      winRatePct: analysis.backtest.winRatePct,
      avgRr: analysis.backtest.avgRr,
    },
    crowdAndNewsSentiment: {
      moodScore: sentiment.moodScore,
      mood: sentiment.mood,
      bullishPct: sentiment.bullishPct,
      bearishPct: sentiment.bearishPct,
      fearGreedValue: sentiment.fearGreedValue,
      fearGreedLabel: sentiment.fearGreedLabel,
      coinMentionsCount: sentiment.coinMentionsCount,
      topHeadlines: sentiment.headlines.slice(0, 4).map((h) => ({
        title: h.title,
        source: h.source,
        sentiment: h.sentiment,
        matchedCoin: h.matchedCoin,
      })),
    },
  };

  return [
    'You are an institutional crypto perpetual futures risk & signal validation analyst.',
    'Critically audit the provided live Toobit perpetual futures telemetry, 7-criteria qualification audit, and external crowd/news sentiment.',
    'Do NOT invent numbers or prices outside the JSON context. Be skeptical of low-criteria, counter-HTF, high-funding-crowded, or low-ADX chop setups.',
    'Provide concise, high-signal bilingual output in natural Persian (fa) and English (en).',
    'Context JSON:',
    JSON.stringify(compactContext),
  ].join('\n');
}

export class AiCryptoService {
  private readonly deps: AiAnalysisDeps;
  private cache = new Map<string, { report: AiCryptoAnalysisReport; expiresAt: number }>();

  constructor(deps: AiAnalysisDeps = {}) {
    this.deps = deps;
  }

  private getApiKey(): string | undefined {
    if (this.deps.getApiKey) return this.deps.getApiKey();
    return process.env.GEMINI_API_KEY?.trim() || undefined;
  }

  private async callGemini(prompt: string): Promise<string> {
    if (this.deps.generateJson) {
      return this.deps.generateJson(prompt);
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new AiServiceError(
        'GEMINI_API_KEY is not configured on the server environment.',
        503,
        'MISSING_GEMINI_API_KEY',
      );
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const response = await ai.models.generateContent({
      model: GEMINI_FREE_MODEL,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: AI_RESPONSE_SCHEMA,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      throw new AiServiceError('Empty response returned by Gemini AI.', 502, 'EMPTY_AI_RESPONSE');
    }
    return text;
  }

  public async analyzeCrypto(
    symbol: string,
    timeframe: Timeframe = '1h',
    forceRefresh = false,
  ): Promise<AiCryptoAnalysisReport> {
    const cacheKey = `${symbol}:${timeframe}`;
    const now = Date.now();

    if (!forceRefresh) {
      const hit = this.cache.get(cacheKey);
      if (hit && hit.expiresAt > now) {
        return { ...hit.report, cached: true };
      }
    }

    const runAnalysis = this.deps.analyzeSymbol ?? ((s, tf) => toobitService.analyzeSymbol(s, tf));
    const runSentiment = this.deps.getSentiment ?? ((s) => socialSentimentService.getSentiment(s));

    const [analysis, sentiment] = await Promise.all([
      runAnalysis(symbol, timeframe),
      runSentiment(symbol).catch(
        (): SocialSentimentData => ({
          symbol,
          baseAsset: symbol.split('-')[0] || symbol,
          coinName: null,
          moodScore: 50,
          mood: 'NEUTRAL',
          bullishPct: 50,
          bearishPct: 50,
          fearGreedValue: null,
          fearGreedLabel: null,
          watchlistUsers: null,
          coinMentionsCount: 0,
          platforms: [],
          headlines: [],
          fetchedAt: now,
        }),
      ),
    ]);

    const prompt = buildAiPromptPayload(analysis, sentiment);
    let rawJsonText: string;
    try {
      rawJsonText = await this.callGemini(prompt);
    } catch (err) {
      if (err instanceof AiServiceError) throw err;
      const msg = err instanceof Error ? err.message : 'Gemini AI request failed';
      const status = msg.includes('429') || msg.toLowerCase().includes('quota') ? 429 : 502;
      throw new AiServiceError(msg, status, status === 429 ? 'RATE_LIMITED' : 'AI_UPSTREAM_ERROR');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJsonText) as Record<string, unknown>;
    } catch {
      throw new AiServiceError('Gemini returned malformed JSON analysis.', 502, 'INVALID_AI_JSON');
    }

    const rawVerdict = String(parsed.verdict || 'NEUTRAL_WAIT') as AiVerdict;
    const verdict: AiVerdict = VALID_VERDICTS.has(rawVerdict) ? rawVerdict : 'NEUTRAL_WAIT';
    const rawConf = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConf)
      ? Math.max(1, Math.min(99, Math.round(rawConf)))
      : analysis.confidence;

    const toStringArray = (val: unknown): string[] =>
      Array.isArray(val) ? val.map((item) => String(item)).filter(Boolean).slice(0, 5) : [];

    const report: AiCryptoAnalysisReport = {
      symbol: analysis.symbol,
      baseAsset: analysis.baseAsset,
      timeframe: analysis.timeframe,
      model: GEMINI_FREE_MODEL,
      verdict,
      confidence,
      agreesWithTechnical: Boolean(parsed.agreesWithTechnical),
      headlineFa: String(parsed.headlineFa || ''),
      headlineEn: String(parsed.headlineEn || ''),
      summaryFa: String(parsed.summaryFa || ''),
      summaryEn: String(parsed.summaryEn || ''),
      bullCaseFa: String(parsed.bullCaseFa || ''),
      bullCaseEn: String(parsed.bullCaseEn || ''),
      bearCaseFa: String(parsed.bearCaseFa || ''),
      bearCaseEn: String(parsed.bearCaseEn || ''),
      riskWarningsFa: toStringArray(parsed.riskWarningsFa),
      riskWarningsEn: toStringArray(parsed.riskWarningsEn),
      executionAdviceFa: String(parsed.executionAdviceFa || ''),
      executionAdviceEn: String(parsed.executionAdviceEn || ''),
      sentimentContext: {
        moodScore: sentiment.moodScore,
        mood: sentiment.mood,
        fearGreedValue: sentiment.fearGreedValue,
        fearGreedLabel: sentiment.fearGreedLabel,
        coinMentionsCount: sentiment.coinMentionsCount,
      },
      generatedAt: Date.now(),
      cached: false,
    };

    if (this.cache.size > 150) {
      this.cache.clear();
    }
    this.cache.set(cacheKey, { report, expiresAt: Date.now() + AI_CACHE_TTL_MS });
    return report;
  }
}

export const aiCryptoService = new AiCryptoService();
