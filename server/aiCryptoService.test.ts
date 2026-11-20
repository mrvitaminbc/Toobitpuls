import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeFuturesSymbol } from '../src/engine/analyzer';
import type { Candle, SocialSentimentData } from '../src/types/futures';
import { AiCryptoService, AiServiceError, buildAiPromptPayload } from './aiCryptoService';

function sampleCandles(count = 60): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < count; i++) {
    const close = p + (i % 3 === 0 ? -0.2 : 0.45);
    out.push({
      time: 1700000000000 + i * 3_600_000,
      open: p,
      high: Math.max(p, close) + 0.3,
      low: Math.min(p, close) - 0.3,
      close,
      volume: 1000,
      quoteVolume: 100000,
      tradesCount: 300,
      takerBuyBaseVol: 580,
      takerBuyQuoteVol: 58000,
    });
    p = close;
  }
  return out;
}

function sampleSentiment(): SocialSentimentData {
  return {
    symbol: 'SOL-SWAP-USDT',
    baseAsset: 'SOL',
    coinName: 'Solana',
    moodScore: 68,
    mood: 'BULLISH',
    bullishPct: 68,
    bearishPct: 32,
    fearGreedValue: 61,
    fearGreedLabel: 'Greed',
    watchlistUsers: 520000,
    coinMentionsCount: 2,
    platforms: [],
    headlines: [
      {
        title: 'Solana futures open interest expands cleanly',
        source: 'CoinDesk',
        publishedAt: Date.now(),
        url: 'https://example.com',
        sentiment: 'BULLISH',
        matchedCoin: true,
      },
    ],
    fetchedAt: Date.now(),
  };
}

test('buildAiPromptPayload embeds institutional gate, indicators, and sentiment telemetry', () => {
  const analysis = analyzeFuturesSymbol({
    symbol: 'SOL-SWAP-USDT',
    baseAsset: 'SOL',
    timeframe: '1h',
    candles: sampleCandles(70),
    quoteVolume24h: 45_000_000,
    oiDeltaPct: 2.3,
    fundingRate: 0.0001,
  });
  const prompt = buildAiPromptPayload(analysis, sampleSentiment());
  assert.ok(prompt.includes('SOL-SWAP-USDT'));
  assert.ok(prompt.includes('institutionalGate'));
  assert.ok(prompt.includes('crowdAndNewsSentiment'));
  assert.ok(prompt.includes('Greed'));
});

test('AiCryptoService parses valid Gemini JSON, caches repeated calls, and propagates missing key cleanly', async () => {
  const analysis = analyzeFuturesSymbol({
    symbol: 'SOL-SWAP-USDT',
    baseAsset: 'SOL',
    timeframe: '1h',
    candles: sampleCandles(70),
    quoteVolume24h: 45_000_000,
  });

  let callCount = 0;
  const service = new AiCryptoService({
    analyzeSymbol: async () => analysis,
    getSentiment: async () => sampleSentiment(),
    generateJson: async () => {
      callCount++;
      return JSON.stringify({
        verdict: 'LONG',
        confidence: 78,
        agreesWithTechnical: true,
        headlineFa: 'تایید روند صعودی سولانا با حمایت جریان نقدینگی',
        headlineEn: 'Solana bullish trend supported by healthy orderflow',
        summaryFa: 'ساختار و احساسات بازار همسو است.',
        summaryEn: 'Technical structure and market mood align.',
        bullCaseFa: 'حفظ قیمت بالای VWAP',
        bullCaseEn: 'Holding above VWAP',
        bearCaseFa: 'از دست رفتن حمایت اول',
        bearCaseEn: 'Loss of support 1',
        riskWarningsFa: ['نوسان بیت‌کوین را زیر نظر بگیرید'],
        riskWarningsEn: ['Monitor BTC volatility'],
        executionAdviceFa: 'ورود پله‌ای با رعایت حد ضرر',
        executionAdviceEn: 'Scale in near optimal entry with strict SL',
      });
    },
  });

  const first = await service.analyzeCrypto('SOL-SWAP-USDT', '1h');
  assert.equal(first.verdict, 'LONG');
  assert.equal(first.cached, false);
  assert.equal(first.sentimentContext.fearGreedValue, 61);
  assert.equal(callCount, 1);

  const second = await service.analyzeCrypto('SOL-SWAP-USDT', '1h');
  assert.equal(second.cached, true);
  assert.equal(callCount, 1);

  const noKeyService = new AiCryptoService({
    getApiKey: () => undefined,
    analyzeSymbol: async () => analysis,
    getSentiment: async () => sampleSentiment(),
  });
  await assert.rejects(
    () => noKeyService.analyzeCrypto('SOL-SWAP-USDT', '1h'),
    (err: unknown) =>
      err instanceof AiServiceError &&
      err.statusCode === 503 &&
      err.code === 'MISSING_GEMINI_API_KEY',
  );
});
