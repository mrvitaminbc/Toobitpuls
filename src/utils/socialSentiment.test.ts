import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateSocialSentiment,
  compareSentimentWithTechnical,
  extractBaseAssetFromSymbol,
  matchesCoinMention,
  normalizeBaseTicker,
  parseRssHeadlines,
  scoreHeadlineSentiment,
} from './socialSentiment';
import { SocialSentimentService, type FetchLike } from '../../server/socialSentimentService';

test('extractBaseAssetFromSymbol and normalizeBaseTicker handle standard and 1000x futures pairs', () => {
  assert.equal(extractBaseAssetFromSymbol('SOL-SWAP-USDT'), 'SOL');
  assert.equal(extractBaseAssetFromSymbol('1000PEPE-SWAP-USDT'), '1000PEPE');
  assert.equal(normalizeBaseTicker('1000PEPE'), 'PEPE');
  assert.equal(normalizeBaseTicker('1000000MOG'), 'MOG');
  assert.equal(normalizeBaseTicker('BTC'), 'BTC');
});

test('scoreHeadlineSentiment differentiates bullish, bearish, and neutral crypto headlines', () => {
  const bull = scoreHeadlineSentiment('Solana surges 18% on massive ETF inflows and institutional breakout');
  assert.equal(bull.mood, 'BULLISH');
  assert.ok(bull.score >= 70);

  const bear = scoreHeadlineSentiment('Major exchange exploit triggers crash and $400M liquidation sell-off');
  assert.equal(bear.mood, 'BEARISH');
  assert.ok(bear.score <= 30);

  const neutral = scoreHeadlineSentiment('Developers schedule routine weekly community call');
  assert.equal(neutral.mood, 'NEUTRAL');
  assert.equal(neutral.score, 50);
});

test('parseRssHeadlines extracts CDATA titles, links, and timestamps cleanly', () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <item>
        <title><![CDATA[Bitcoin &amp; Solana rally on fresh ETF inflows]]></title>
        <link>https://www.coindesk.com/markets/btc-sol-rally</link>
        <pubDate>Wed, 18 Nov 2026 15:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Broken link ignored</title>
        <link>not-a-url</link>
      </item>
    </channel></rss>`;

  const parsed = parseRssHeadlines(sampleXml, 'CoinDesk');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Bitcoin & Solana rally on fresh ETF inflows');
  assert.equal(parsed[0].source, 'CoinDesk');
  assert.equal(parsed[0].link, 'https://www.coindesk.com/markets/btc-sol-rally');
});

test('matchesCoinMention checks exact ticker/coin name and avoids substring false positives', () => {
  assert.equal(matchesCoinMention('Solana institutional adoption rises', 'SOL', 'Solana'), true);
  assert.equal(matchesCoinMention('$SOL breakout confirmed', 'SOL', null), true);
  assert.equal(matchesCoinMention('Solar energy mining grows', 'SOL', 'Solana'), false);
});

test('aggregateSocialSentiment computes weighted Bullish/Bearish percentages and handles partial sources', () => {
  const result = aggregateSocialSentiment({
    symbol: 'SOL-SWAP-USDT',
    baseAsset: 'SOL',
    coinName: 'Solana',
    coingeckoUpPct: 78,
    coingeckoDownPct: 22,
    watchlistUsers: 1350000,
    fearGreedValue: 64,
    fearGreedLabel: 'Greed',
    rssItems: [
      {
        title: 'Solana breakout rally attracts record inflows',
        link: 'https://example.com/1',
        publishedAt: 1760000000000,
        source: 'CoinDesk',
      },
      {
        title: 'Altcoins rise after positive macro data',
        link: 'https://example.com/2',
        publishedAt: 1759999000000,
        source: 'Decrypt',
      },
    ],
  });

  assert.equal(result.mood, 'BULLISH');
  assert.ok(result.moodScore >= 68);
  assert.equal(result.bullishPct + result.bearishPct, 100);
  assert.equal(result.coinMentionsCount, 1);
  assert.equal(result.platforms.filter((p) => p.available).length, 3);
  assert.equal(result.headlines[0].matchedCoin, true);

  // Partial sources fallback safely without NaN
  const sparse = aggregateSocialSentiment({
    symbol: 'XYZ-SWAP-USDT',
    baseAsset: 'XYZ',
    coinName: null,
    coingeckoUpPct: null,
    coingeckoDownPct: null,
    watchlistUsers: null,
    fearGreedValue: 20,
    fearGreedLabel: 'Extreme Fear',
    rssItems: [],
  });
  assert.equal(sparse.mood, 'BEARISH');
  assert.equal(sparse.moodScore, 20);
  assert.equal(sparse.bullishPct, 20);
  assert.equal(sparse.bearishPct, 80);
});

test('compareSentimentWithTechnical identifies confirmation and contrarian divergence', () => {
  assert.equal(compareSentimentWithTechnical('BULLISH', 'LONG'), 'CONFIRMING');
  assert.equal(compareSentimentWithTechnical('BEARISH', 'SHORT'), 'CONFIRMING');
  assert.equal(compareSentimentWithTechnical('BEARISH', 'LONG'), 'DIVERGING');
  assert.equal(compareSentimentWithTechnical('NEUTRAL', 'LONG'), 'NEUTRAL');
});

test('SocialSentimentService aggregates mocked multi-platform endpoints and caches per ticker', async () => {
  let cgCalls = 0;
  const mockFetch: FetchLike = async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('alternative.me')) {
      return new Response(
        JSON.stringify({ data: [{ value: '72', value_classification: 'Greed' }] }),
        { status: 200 },
      );
    }
    if (url.includes('coingecko.com/api/v3/coins/solana')) {
      cgCalls += 1;
      return new Response(
        JSON.stringify({
          name: 'Solana',
          sentiment_votes_up_percentage: 81.4,
          sentiment_votes_down_percentage: 18.6,
          watchlist_portfolio_users: 1400000,
        }),
        { status: 200 },
      );
    }
    if (url.includes('coindesk.com')) {
      return new Response(
        `<rss><channel><item><title>Solana surges to multi-month high on strong inflows</title><link>https://www.coindesk.com/sol</link><pubDate>Wed, 18 Nov 2026 16:00:00 GMT</pubDate></item></channel></rss>`,
        { status: 200 },
      );
    }
    return new Response('<rss><channel></channel></rss>', { status: 200 });
  };

  const svc = new SocialSentimentService({ fetchImpl: mockFetch });
  const first = await svc.getSentiment('SOL-SWAP-USDT');
  assert.equal(first.mood, 'BULLISH');
  assert.ok(first.moodScore >= 75);
  assert.equal(first.fearGreedValue, 72);
  assert.equal(first.watchlistUsers, 1400000);
  assert.equal(first.coinMentionsCount, 1);

  // Second call hits 5-minute cache
  const second = await svc.getSentiment('SOL-SWAP-USDT');
  assert.equal(second.moodScore, first.moodScore);
  assert.equal(cgCalls, 1);
});
