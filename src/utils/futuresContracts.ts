export interface RawExchangeContract {
  symbol?: string;
  symbolName?: string;
  status?: string;
  quoteAsset?: string;
  marginToken?: string;
  contractMultiplier?: string;
  closingStartTime?: string;
  closingEndTime?: string;
  inverse?: boolean;
  isRwa?: boolean;
  categories?: string[];
}

export function getPairAssets(symbol: string): { baseAsset: string; quoteAsset: string } {
  if (symbol.includes('-SWAP-')) {
    const [base, quote] = symbol.split('-SWAP-');
    return { baseAsset: base, quoteAsset: quote || 'USDT' };
  }
  if (symbol.endsWith('USDC')) {
    return { baseAsset: symbol.replace(/USDC$/, ''), quoteAsset: 'USDC' };
  }
  return { baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT' };
}

/**
 * Validates that a Toobit exchangeInfo contract is an active, non-delisted,
 * non-closing perpetual Futures contract (USDT or USDC settled).
 */
export function isValidActiveFuturesContract(
  contract: RawExchangeContract,
  now = Date.now(),
): boolean {
  const symbol = typeof contract.symbol === 'string' ? contract.symbol.trim() : '';
  if (!symbol) return false;
  if (symbol.startsWith('TBV_')) return false;
  if (!symbol.includes('-SWAP-')) return false;
  if (contract.status !== 'TRADING') return false;

  const { quoteAsset: parsedQuote } = getPairAssets(symbol);
  const quote = (contract.quoteAsset || parsedQuote || '').toUpperCase();
  if (quote !== 'USDT' && quote !== 'USDC') return false;

  if (contract.closingStartTime && Number(contract.closingStartTime) > 0) {
    if (now >= Number(contract.closingStartTime)) {
      return false;
    }
  }

  return true;
}

/**
 * Validates a 24hr ticker feed row against the authoritative active Futures
 * contract registry so delisted/stale/invalid symbols never leak into Market or Scanner.
 */
export function isValidMarketTickerRow(
  symbol: string,
  activeContracts: ReadonlyMap<string, unknown> | ReadonlySet<string> | null,
  lastPrice: number,
): boolean {
  if (!symbol || symbol.startsWith('TBV_')) return false;
  if (!symbol.includes('-SWAP-')) return false;
  if (!symbol.endsWith('-SWAP-USDT') && !symbol.endsWith('-SWAP-USDC')) return false;
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return false;

  if (activeContracts && activeContracts.size > 0) {
    return activeContracts.has(symbol);
  }

  return true;
}
