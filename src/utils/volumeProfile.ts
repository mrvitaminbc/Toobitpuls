import type { Candle } from '../types/futures';

export type VolumeNodeRole = 'POC' | 'RESISTANCE_HVN' | 'SUPPORT_HVN' | 'LVN' | 'NORMAL';

export interface VolumeProfileBin {
  index: number;
  priceLow: number;
  priceHigh: number;
  midPrice: number;
  totalVolumeUsd: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  volumePctOfMax: number;
  volumeSharePct: number;
  buyPct: number;
  inValueArea: boolean;
  isPoc: boolean;
  isCurrentPriceBin: boolean;
  role: VolumeNodeRole;
}

export interface VolumeProfileLevel {
  price: number;
  volumeUsd: number;
  volumePctOfMax: number;
  kind: 'POC' | 'VAH' | 'VAL' | 'HVN_SUPPORT' | 'HVN_RESISTANCE';
}

export interface VolumeProfileResult {
  bins: VolumeProfileBin[]; // Ordered from highest price (top) to lowest price (bottom)
  minPrice: number;
  maxPrice: number;
  currentPrice: number;
  pocPrice: number;
  vahPrice: number;
  valPrice: number;
  totalVolumeUsd: number;
  maxBinVolumeUsd: number;
  valueAreaVolumePct: number;
  candleCount: number;
  supportLevels: VolumeProfileLevel[];
  resistanceLevels: VolumeProfileLevel[];
}

export interface VolumeProfileOptions {
  binsCount?: number;
  valueAreaRatio?: number;
  lookbackBars?: number;
}

export function computeVolumeProfile(
  candles: Candle[],
  currentPrice?: number,
  options: VolumeProfileOptions = {},
): VolumeProfileResult {
  const lookback = options.lookbackBars && options.lookbackBars > 0 ? options.lookbackBars : candles.length;
  const slice = candles.slice(-lookback);
  const effectivePrice =
    currentPrice && Number.isFinite(currentPrice) && currentPrice > 0
      ? currentPrice
      : slice[slice.length - 1]?.close ?? 0;

  if (slice.length < 2) {
    return {
      bins: [],
      minPrice: effectivePrice,
      maxPrice: effectivePrice,
      currentPrice: effectivePrice,
      pocPrice: effectivePrice,
      vahPrice: effectivePrice,
      valPrice: effectivePrice,
      totalVolumeUsd: 0,
      maxBinVolumeUsd: 0,
      valueAreaVolumePct: 0,
      candleCount: slice.length,
      supportLevels: [],
      resistanceLevels: [],
    };
  }

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const c of slice) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }

  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0) {
    return {
      bins: [],
      minPrice: 0,
      maxPrice: 0,
      currentPrice: effectivePrice,
      pocPrice: effectivePrice,
      vahPrice: effectivePrice,
      valPrice: effectivePrice,
      totalVolumeUsd: 0,
      maxBinVolumeUsd: 0,
      valueAreaVolumePct: 0,
      candleCount: slice.length,
      supportLevels: [],
      resistanceLevels: [],
    };
  }

  // Handle completely flat price series safely
  if (maxPrice <= minPrice) {
    const pad = Math.max(minPrice * 0.002, 1e-8);
    minPrice = Math.max(0, minPrice - pad);
    maxPrice = maxPrice + pad;
  }

  const binsCount = Math.max(8, Math.min(48, Math.round(options.binsCount ?? 24)));
  const valueAreaRatio = Math.max(0.5, Math.min(0.9, options.valueAreaRatio ?? 0.7));
  const step = (maxPrice - minPrice) / binsCount;

  // Low-to-high internal accumulator arrays
  const totalVols = new Array<number>(binsCount).fill(0);
  const buyVols = new Array<number>(binsCount).fill(0);
  const sellVols = new Array<number>(binsCount).fill(0);

  let grandTotalVol = 0;

  for (const c of slice) {
    const qVol = c.quoteVolume > 0 ? c.quoteVolume : Math.max(0, c.volume * c.close);
    if (!Number.isFinite(qVol) || qVol <= 0) continue;

    let buyShare = 0.5;
    if (c.takerBuyQuoteVol > 0 && qVol > 0) {
      buyShare = Math.max(0, Math.min(1, c.takerBuyQuoteVol / qVol));
    } else if (c.high > c.low) {
      buyShare = c.close >= c.open ? 0.62 : 0.38;
    }

    const lowIdx = Math.max(0, Math.min(binsCount - 1, Math.floor((c.low - minPrice) / step)));
    const highIdx = Math.max(0, Math.min(binsCount - 1, Math.floor((c.high - minPrice) / step)));
    const spanBins = highIdx - lowIdx + 1;
    const perBinVol = qVol / spanBins;
    const perBinBuy = perBinVol * buyShare;
    const perBinSell = perBinVol * (1 - buyShare);

    for (let b = lowIdx; b <= highIdx; b++) {
      totalVols[b] += perBinVol;
      buyVols[b] += perBinBuy;
      sellVols[b] += perBinSell;
    }
    grandTotalVol += qVol;
  }

  if (grandTotalVol <= 0) {
    return {
      bins: [],
      minPrice,
      maxPrice,
      currentPrice: effectivePrice,
      pocPrice: effectivePrice,
      vahPrice: effectivePrice,
      valPrice: effectivePrice,
      totalVolumeUsd: 0,
      maxBinVolumeUsd: 0,
      valueAreaVolumePct: 0,
      candleCount: slice.length,
      supportLevels: [],
      resistanceLevels: [],
    };
  }

  // Locate Point of Control (POC)
  let pocLowIdx = 0;
  let maxBinVol = -1;
  for (let b = 0; b < binsCount; b++) {
    if (totalVols[b] > maxBinVol) {
      maxBinVol = totalVols[b];
      pocLowIdx = b;
    }
  }

  // Classic TradingView / Market Profile 70% Value Area expansion around POC
  const vaFlags = new Array<boolean>(binsCount).fill(false);
  vaFlags[pocLowIdx] = true;
  let vaVolume = totalVols[pocLowIdx];
  const targetVaVol = grandTotalVol * valueAreaRatio;

  let upperIdx = pocLowIdx;
  let lowerIdx = pocLowIdx;
  while (vaVolume < targetVaVol && (upperIdx < binsCount - 1 || lowerIdx > 0)) {
    const upCand = upperIdx + 1 < binsCount ? totalVols[upperIdx + 1] : -1;
    const downCand = lowerIdx - 1 >= 0 ? totalVols[lowerIdx - 1] : -1;

    if (upCand >= downCand && upCand >= 0) {
      upperIdx++;
      vaFlags[upperIdx] = true;
      vaVolume += totalVols[upperIdx];
    } else if (downCand >= 0) {
      lowerIdx--;
      vaFlags[lowerIdx] = true;
      vaVolume += totalVols[lowerIdx];
    } else {
      break;
    }
  }

  const pocPrice = minPrice + (pocLowIdx + 0.5) * step;
  const vahPrice = minPrice + (upperIdx + 1) * step;
  const valPrice = minPrice + lowerIdx * step;
  const currentPriceBinIdx = Math.max(
    0,
    Math.min(binsCount - 1, Math.floor((effectivePrice - minPrice) / step)),
  );

  // Build ordered Top -> Bottom bins (highest price first)
  const bins: VolumeProfileBin[] = [];
  for (let b = binsCount - 1; b >= 0; b--) {
    const priceLow = minPrice + b * step;
    const priceHigh = priceLow + step;
    const midPrice = (priceLow + priceHigh) / 2;
    const totalVol = totalVols[b];
    const pctOfMax = maxBinVol > 0 ? (totalVol / maxBinVol) * 100 : 0;
    const sharePct = grandTotalVol > 0 ? (totalVol / grandTotalVol) * 100 : 0;
    const buyPct = totalVol > 0 ? (buyVols[b] / totalVol) * 100 : 50;
    const isPoc = b === pocLowIdx;

    let role: VolumeNodeRole = 'NORMAL';
    if (isPoc) {
      role = 'POC';
    } else if (pctOfMax >= 62) {
      role = midPrice >= effectivePrice ? 'RESISTANCE_HVN' : 'SUPPORT_HVN';
    } else if (pctOfMax <= 22) {
      role = 'LVN';
    }

    bins.push({
      index: b,
      priceLow,
      priceHigh,
      midPrice,
      totalVolumeUsd: totalVol,
      buyVolumeUsd: buyVols[b],
      sellVolumeUsd: sellVols[b],
      volumePctOfMax: Number(pctOfMax.toFixed(1)),
      volumeSharePct: Number(sharePct.toFixed(1)),
      buyPct: Number(buyPct.toFixed(1)),
      inValueArea: vaFlags[b],
      isPoc,
      isCurrentPriceBin: b === currentPriceBinIdx,
      role,
    });
  }

  // Extract strongest HVN support & resistance shelves distinct from immediate current price
  const hvnSupports: VolumeProfileLevel[] = bins
    .filter((b) => !b.isPoc && b.midPrice < effectivePrice && b.volumePctOfMax >= 55)
    .sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd)
    .slice(0, 2)
    .map((b) => ({
      price: b.midPrice,
      volumeUsd: b.totalVolumeUsd,
      volumePctOfMax: b.volumePctOfMax,
      kind: 'HVN_SUPPORT',
    }));

  const hvnResistances: VolumeProfileLevel[] = bins
    .filter((b) => !b.isPoc && b.midPrice > effectivePrice && b.volumePctOfMax >= 55)
    .sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd)
    .slice(0, 2)
    .map((b) => ({
      price: b.midPrice,
      volumeUsd: b.totalVolumeUsd,
      volumePctOfMax: b.volumePctOfMax,
      kind: 'HVN_RESISTANCE',
    }));

  const supportLevels: VolumeProfileLevel[] = [
    {
      price: valPrice,
      volumeUsd: totalVols[lowerIdx],
      volumePctOfMax: maxBinVol > 0 ? Number(((totalVols[lowerIdx] / maxBinVol) * 100).toFixed(1)) : 0,
      kind: 'VAL',
    },
    ...hvnSupports,
  ];

  const resistanceLevels: VolumeProfileLevel[] = [
    {
      price: vahPrice,
      volumeUsd: totalVols[upperIdx],
      volumePctOfMax: maxBinVol > 0 ? Number(((totalVols[upperIdx] / maxBinVol) * 100).toFixed(1)) : 0,
      kind: 'VAH',
    },
    ...hvnResistances,
  ];

  return {
    bins,
    minPrice,
    maxPrice,
    currentPrice: effectivePrice,
    pocPrice,
    vahPrice,
    valPrice,
    totalVolumeUsd: grandTotalVol,
    maxBinVolumeUsd: maxBinVol,
    valueAreaVolumePct: Number(((vaVolume / grandTotalVol) * 100).toFixed(1)),
    candleCount: slice.length,
    supportLevels,
    resistanceLevels,
  };
}
