import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPairAssets,
  isValidActiveFuturesContract,
  isValidMarketTickerRow,
} from './futuresContracts';

test('isValidActiveFuturesContract accepts active USDT/USDC SWAP contracts and rejects delisted/testnet/closing ones', () => {
  const now = 1_700_000_000_000;

  assert.equal(
    isValidActiveFuturesContract(
      { symbol: 'BTC-SWAP-USDT', status: 'TRADING', quoteAsset: 'USDT', closingStartTime: '0' },
      now,
    ),
    true,
  );
  assert.equal(
    isValidActiveFuturesContract(
      { symbol: 'SOL-SWAP-USDC', status: 'TRADING', quoteAsset: 'USDC', closingStartTime: '0' },
      now,
    ),
    true,
  );
  // Testnet / TBV contract
  assert.equal(
    isValidActiveFuturesContract(
      { symbol: 'TBV_BTC-SWAP-TBV_USDT', status: 'TRADING', quoteAsset: 'USDT' },
      now,
    ),
    false,
  );
  // Non-TRADING status (delisted / halted)
  assert.equal(
    isValidActiveFuturesContract(
      { symbol: 'VELODROME-SWAP-USDT', status: 'BREAK', quoteAsset: 'USDT' },
      now,
    ),
    false,
  );
  assert.equal(
    isValidActiveFuturesContract(
      { symbol: 'REN-SWAP-USDT', status: 'SETTLING', quoteAsset: 'USDT' },
      now,
    ),
    false,
  );
  // Spot / non-SWAP format
  assert.equal(
    isValidActiveFuturesContract(
      { symbol: 'BTCUSDT', status: 'TRADING', quoteAsset: 'USDT' },
      now,
    ),
    false,
  );
  // Scheduled closing passed
  assert.equal(
    isValidActiveFuturesContract(
      {
        symbol: 'OLD-SWAP-USDT',
        status: 'TRADING',
        quoteAsset: 'USDT',
        closingStartTime: String(now - 1000),
      },
      now,
    ),
    false,
  );
});

test('isValidMarketTickerRow blocks delisted symbols absent from activeContracts registry', () => {
  const activeSet = new Set(['BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'SOL-SWAP-USDC']);

  assert.equal(isValidMarketTickerRow('BTC-SWAP-USDT', activeSet, 90000), true);
  assert.equal(isValidMarketTickerRow('SOL-SWAP-USDC', activeSet, 180), true);

  // Delisted coins that Toobit still emits in 24hr ticker feed
  assert.equal(isValidMarketTickerRow('VELODROME-SWAP-USDT', activeSet, 0.029), false);
  assert.equal(isValidMarketTickerRow('REN-SWAP-USDT', activeSet, 0.046), false);
  assert.equal(isValidMarketTickerRow('WAVES-SWAP-USDT', activeSet, 1.33), false);
  assert.equal(isValidMarketTickerRow('TBV_RARE-SWAP-TBV_USDT', activeSet, 0.12), false);
  assert.equal(isValidMarketTickerRow('BCH-USDT-SWAPUSDT', activeSet, 500), false);

  // Zero or NaN prices
  assert.equal(isValidMarketTickerRow('BTC-SWAP-USDT', activeSet, 0), false);
  assert.equal(isValidMarketTickerRow('BTC-SWAP-USDT', activeSet, Number.NaN), false);
});

test('getPairAssets parses both USDT and USDC perpetual symbols accurately', () => {
  assert.deepEqual(getPairAssets('BTC-SWAP-USDT'), { baseAsset: 'BTC', quoteAsset: 'USDT' });
  assert.deepEqual(getPairAssets('ETH-SWAP-USDC'), { baseAsset: 'ETH', quoteAsset: 'USDC' });
});
