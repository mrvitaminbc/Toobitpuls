import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeToobitEngine, type HttpTransport } from './nativeToobitEngine';

function createSyntheticKlines(count = 120, basePrice = 95000): unknown[] {
  const now = Date.now();
  const rows: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const t = now - (count - i) * 3600 * 1000;
    const open = basePrice + Math.sin(i / 6) * 400 + i * 12;
    const close = open + (i % 3 === 0 ? -90 : 140);
    const high = Math.max(open, close) + 120;
    const low = Math.min(open, close) - 100;
    const vol = 1500 + (i > count - 4 ? 3200 : i * 10);
    const qv = vol * close;
    rows.push([
      t,
      open.toFixed(2),
      high.toFixed(2),
      low.toFixed(2),
      close.toFixed(2),
      vol.toFixed(2),
      t + 3599999,
      qv.toFixed(2),
      350,
      (vol * 0.62).toFixed(2),
      (qv * 0.62).toFixed(2),
    ]);
  }
  return rows;
}

function createMockTransport(postedCalls: Array<{ url: string; body: unknown }>): HttpTransport {
  return {
    async getJson<T>(url: string): Promise<T> {
      if (url.includes('/api/v1/exchangeInfo')) {
        return {
          contracts: [
            {
              symbol: 'BTC-SWAP-USDT',
              status: 'TRADING',
              quoteAsset: 'USDT',
              baseAsset: 'BTC',
              contractMultiplier: '0.001',
            },
            {
              symbol: 'ETH-SWAP-USDT',
              status: 'TRADING',
              quoteAsset: 'USDT',
              baseAsset: 'ETH',
              contractMultiplier: '0.01',
            },
            {
              symbol: 'OLD-SWAP-USDT',
              status: 'SETTLING',
              quoteAsset: 'USDT',
              baseAsset: 'OLD',
            },
          ],
        } as T;
      }
      if (url.includes('/quote/v1/contract/ticker/24hr')) {
        return [
          {
            t: Date.now(),
            s: 'BTC-SWAP-USDT',
            c: '96200',
            h: '97000',
            l: '94000',
            o: '94500',
            v: '500000',
            qv: '480000000',
            op: '1200000',
            pc: '1700',
            pcp: '0.018',
          },
          {
            t: Date.now(),
            s: 'ETH-SWAP-USDT',
            c: '3400',
            h: '3450',
            l: '3320',
            o: '3350',
            v: '250000',
            qv: '120000000',
            op: '800000',
            pc: '50',
            pcp: '0.015',
          },
          {
            t: Date.now(),
            s: 'OLD-SWAP-USDT',
            c: '1.2',
            h: '1.3',
            l: '1.1',
            o: '1.2',
            v: '100',
            qv: '120',
            op: '10',
            pc: '0',
            pcp: '0',
          },
        ] as T;
      }
      if (url.includes('/api/v1/futures/fundingRate')) {
        return [
          { symbol: 'BTC-SWAP-USDT', rate: '0.00012' },
          { symbol: 'ETH-SWAP-USDT', rate: '-0.00018' },
        ] as T;
      }
      if (url.includes('/quote/v1/markPrice')) {
        return [
          { symbolId: 'BTC-SWAP-USDT', price: '96180', time: Date.now() },
          { symbolId: 'ETH-SWAP-USDT', price: '3398', time: Date.now() },
        ] as T;
      }
      if (url.includes('/quote/v1/klines')) {
        const isEth = url.includes('ETH-SWAP-USDT');
        return createSyntheticKlines(120, isEth ? 3350 : 95000) as T;
      }
      if (url.includes('/quote/v1/depth')) {
        return {
          t: Date.now(),
          b: [
            ['96190', '2000'],
            ['96150', '4500'],
          ],
          a: [
            ['96210', '1200'],
            ['96250', '2500'],
          ],
        } as T;
      }
      if (url.includes('/quote/v1/trades')) {
        return [
          { t: Date.now(), p: '96200', q: '400', ibm: false },
          { t: Date.now() - 500, p: '96195', q: '150', ibm: true },
        ] as T;
      }
      if (url.includes('alternative.me/fng')) {
        return {
          data: [{ value: '64', value_classification: 'Greed' }],
        } as T;
      }
      if (url.includes('coingecko.com/api/v3/coins/bitcoin')) {
        return {
          name: 'Bitcoin',
          sentiment_votes_up_percentage: 74,
          sentiment_votes_down_percentage: 26,
          watchlist_portfolio_users: 2100000,
        } as T;
      }
      throw new Error(`Unexpected GET URL: ${url}`);
    },

    async getText(): Promise<string | null> {
      return `
        <rss><channel>
          <item>
            <title>Bitcoin surges past key resistance as institutional ETF inflows climb</title>
            <link>https://example.com/btc-news</link>
            <pubDate>${new Date().toUTCString()}</pubDate>
          </item>
        </channel></rss>
      `;
    },

    async postJson(url: string, body: unknown) {
      postedCalls.push({ url, body });
      return { ok: true, status: 204, text: '' };
    },
  };
}

test('NativeToobitEngine refreshes active contracts, scales multipliers, and analyzes pairs cleanly', async () => {
  const posted: Array<{ url: string; body: unknown }> = [];
  const engine = new NativeToobitEngine({ transport: createMockTransport(posted) });

  const market = await engine.refreshMarketBatch();
  assert.equal(market.error, null);
  assert.equal(market.tickers.length, 2, 'delisted SETTLING contract should be excluded');
  assert.equal(market.tickers[0].symbol, 'BTC-SWAP-USDT');
  assert.equal(market.tickers[0].volume24h, 500, 'contractMultiplier 0.001 should scale volume');
  assert.equal(market.tickers[0].fundingRate, 0.00012);

  const analysis = await engine.analyzeSymbol('BTC-SWAP-USDT', '1h');
  assert.equal(analysis.symbol, 'BTC-SWAP-USDT');
  assert.ok(analysis.candles.length >= 100);
  assert.ok(analysis.tradePlan.stopLoss > 0);
  assert.ok(analysis.tradePlan.tp1 > 0);

  const opps = await engine.runScannerCycle('1h', ['BTC-SWAP-USDT']);
  assert.equal(opps.length, 2);
  assert.ok(opps.some((o) => o.symbol === 'BTC-SWAP-USDT'));
});

test('NativeToobitEngine validates & dispatches webhooks and aggregates social sentiment', async () => {
  const posted: Array<{ url: string; body: unknown }> = [];
  const engine = new NativeToobitEngine({ transport: createMockTransport(posted) });

  const saved = engine.saveWebhookConfig({
    enabled: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/123456789/abc_defToken',
    telegramWebhookUrl: '',
    minConfidence: 75,
  });
  assert.equal(saved.ok, true);

  const testRes = await engine.sendTestWebhook();
  assert.equal(testRes.ok, true);
  assert.equal(posted.length, 1);
  assert.ok(posted[0].url.includes('discord.com/api/webhooks/123456789/abc_defToken'));

  const sentiment = await engine.getSentiment('BTC-SWAP-USDT');
  assert.equal(sentiment.baseAsset, 'BTC');
  assert.equal(sentiment.fearGreedValue, 64);
  assert.ok(sentiment.moodScore > 50);
  assert.ok(sentiment.headlines.length >= 1);
});
