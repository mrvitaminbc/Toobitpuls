import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketTicker } from '../types/futures';
import { filterAndSortPairs } from './pairSort';

function makeTicker(symbol: string, base: string, price: number, change: number, vol: number): MarketTicker {
  return {
    symbol,
    baseAsset: base,
    quoteAsset: 'USDT',
    lastPrice: price,
    markPrice: price,
    indexBasisPct: 0,
    open24h: price,
    high24h: price,
    low24h: price,
    priceChange: 0,
    priceChangePct: change,
    volume24h: vol / Math.max(1, price),
    quoteVolume24h: vol,
    openInterest: 0,
    openInterestUsd: 0,
    oiDeltaPct: 0,
    fundingRate: 0,
    nextFundingTime: 0,
    volumeAccelPct: 0,
    updatedAt: 0,
  };
}

const sample: MarketTicker[] = [
  makeTicker('BTC-SWAP-USDT', 'BTC', 64000, -2.1, 6_500_000_000),
  makeTicker('ETH-SWAP-USDT', 'ETH', 1800, 3.4, 4_200_000_000),
  makeTicker('SOL-SWAP-USDT', 'SOL', 72, 8.5, 1_100_000_000),
  makeTicker('AAVE-SWAP-USDT', 'AAVE', 95, -5.2, 85_000_000),
];

test('filterAndSortPairs sorts by price desc and asc', () => {
  const desc = filterAndSortPairs(sample, { query: '', sortBy: 'price', sortDir: 'desc' });
  assert.deepEqual(desc.map((x) => x.baseAsset), ['BTC', 'ETH', 'AAVE', 'SOL']);

  const asc = filterAndSortPairs(sample, { query: '', sortBy: 'price', sortDir: 'asc' });
  assert.deepEqual(asc.map((x) => x.baseAsset), ['SOL', 'AAVE', 'ETH', 'BTC']);
});

test('filterAndSortPairs sorts by 24h change pct and alphabetical order', () => {
  const byChange = filterAndSortPairs(sample, { query: '', sortBy: 'change', sortDir: 'desc' });
  assert.deepEqual(byChange.map((x) => x.baseAsset), ['SOL', 'ETH', 'BTC', 'AAVE']);

  const byAlpha = filterAndSortPairs(sample, { query: '', sortBy: 'alpha', sortDir: 'asc' });
  assert.deepEqual(byAlpha.map((x) => x.baseAsset), ['AAVE', 'BTC', 'ETH', 'SOL']);
});

test('filterAndSortPairs filters by search query and watchlist', () => {
  const searched = filterAndSortPairs(sample, { query: 'sol', sortBy: 'volume', sortDir: 'desc' });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].symbol, 'SOL-SWAP-USDT');

  const watched = filterAndSortPairs(sample, {
    query: '',
    sortBy: 'volume',
    sortDir: 'desc',
    onlyWatchlist: true,
    watchlist: ['ETH-SWAP-USDT', 'AAVE-SWAP-USDT'],
  });
  assert.deepEqual(watched.map((x) => x.baseAsset), ['ETH', 'AAVE']);
});
