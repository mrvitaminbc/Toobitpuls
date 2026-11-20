import type { Candle } from '../types/futures';

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function calcSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

export function calcEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;

  const k = 2 / (period + 1);
  let seedSum = 0;
  for (let i = 0; i < period; i++) {
    seedSum += values[i];
  }
  let prev = seedSum / period;
  result[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i] = avgGain === 0 ? 50 : 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

export function calcStochRSI(
  rsiSeries: (number | null)[],
  rsiPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: number; d: number } {
  const validRsi: number[] = [];
  for (const v of rsiSeries) {
    if (v !== null) validRsi.push(v);
  }
  if (validRsi.length < rsiPeriod + kSmooth) {
    return { k: 50, d: 50 };
  }

  const rawK: number[] = [];
  for (let i = rsiPeriod - 1; i < validRsi.length; i++) {
    const slice = validRsi.slice(i - rsiPeriod + 1, i + 1);
    const minRsi = Math.min(...slice);
    const maxRsi = Math.max(...slice);
    const span = maxRsi - minRsi;
    rawK.push(span === 0 ? 50 : ((validRsi[i] - minRsi) / span) * 100);
  }

  const kValues = calcSMA(rawK, kSmooth).filter((v): v is number => v !== null);
  const dValues = calcSMA(kValues, dSmooth).filter((v): v is number => v !== null);

  return {
    k: kValues.length ? kValues[kValues.length - 1] : 50,
    d: dValues.length ? dValues[dValues.length - 1] : 50,
  };
}

export function calcMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macdLine: number; signalLine: number; histogram: number; prevHistogram: number } {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  const macdSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdSeries.push((emaFast[i] as number) - (emaSlow[i] as number));
    }
  }

  if (macdSeries.length < signalPeriod + 2) {
    const last = macdSeries.length ? macdSeries[macdSeries.length - 1] : 0;
    return { macdLine: last, signalLine: last, histogram: 0, prevHistogram: 0 };
  }

  const signalSeries = calcEMA(macdSeries, signalPeriod);
  const lastIdx = macdSeries.length - 1;
  const prevIdx = macdSeries.length - 2;

  const macdLine = macdSeries[lastIdx];
  const signalLine = signalSeries[lastIdx] ?? macdLine;
  const prevSignal = signalSeries[prevIdx] ?? macdSeries[prevIdx];
  const histogram = macdLine - signalLine;
  const prevHistogram = macdSeries[prevIdx] - prevSignal;

  return { macdLine, signalLine, histogram, prevHistogram };
}

export function calcBollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2,
): {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  widthPct: (number | null)[];
  widthPercentile: number;
} {
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const middle = calcSMA(closes, period);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  const widthPct: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (mean === null || mean === 0) continue;
    let sqDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - mean;
      sqDiff += d * d;
    }
    const sd = Math.sqrt(sqDiff / period);
    const u = mean + stdDevMult * sd;
    const l = mean - stdDevMult * sd;
    upper[i] = u;
    lower[i] = l;
    widthPct[i] = ((u - l) / mean) * 100;
  }

  const validWidths = widthPct.filter((v): v is number => v !== null);
  let widthPercentile = 50;
  if (validWidths.length >= 10) {
    const recentWidths = validWidths.slice(-80);
    const current = recentWidths[recentWidths.length - 1];
    const belowOrEqual = recentWidths.filter((w) => w <= current).length;
    widthPercentile = (belowOrEqual / recentWidths.length) * 100;
  }

  return { upper, middle, lower, widthPct, widthPercentile };
}

export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prevClose),
      Math.abs(curr.low - prevClose),
    );
    trs.push(tr);
  }
  if (trs.length < period) {
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

export function calcADX(
  candles: Candle[],
  period = 14,
): { adx: number; plusDi: number; minusDi: number } {
  if (candles.length < period * 2 + 1) {
    return { adx: 18, plusDi: 20, minusDi: 20 };
  }

  const trList: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trList.push(
      Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close),
      ),
    );
  }

  let smoothTr = trList.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDm.slice(0, period).reduce((a, b) => a + b, 0);

  const dxList: number[] = [];
  let lastPlusDi = 0;
  let lastMinusDi = 0;

  for (let i = period; i < trList.length; i++) {
    smoothTr = smoothTr - smoothTr / period + trList[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];

    const pDi = smoothTr > 0 ? (100 * smoothPlus) / smoothTr : 0;
    const mDi = smoothTr > 0 ? (100 * smoothMinus) / smoothTr : 0;
    lastPlusDi = pDi;
    lastMinusDi = mDi;

    const diSum = pDi + mDi;
    dxList.push(diSum > 0 ? (100 * Math.abs(pDi - mDi)) / diSum : 0);
  }

  if (dxList.length < period) {
    const avg = dxList.length ? dxList.reduce((a, b) => a + b, 0) / dxList.length : 18;
    return { adx: avg, plusDi: lastPlusDi, minusDi: lastMinusDi };
  }

  let adx = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxList.length; i++) {
    adx = (adx * (period - 1) + dxList[i]) / period;
  }

  return { adx, plusDi: lastPlusDi, minusDi: lastMinusDi };
}

export function calcVWAPSeries(candles: Candle[], windowSize = 48): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return result;

  const startIdx = Math.max(0, candles.length - windowSize);
  let cumPv = 0;
  let cumVol = 0;

  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.quoteVolume > 0 ? c.quoteVolume : c.volume * typical;
    cumPv += typical * vol;
    cumVol += vol;
    result[i] = cumVol > 0 ? cumPv / cumVol : c.close;
  }
  return result;
}

export function calcOBVSlope(candles: Candle[], lookback = 12): number {
  if (candles.length < lookback + 2) return 0;
  let obv = 0;
  const obvSeries: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].quoteVolume > 0 ? candles[i].quoteVolume : candles[i].volume;
    if (candles[i].close > candles[i - 1].close) obv += vol;
    else if (candles[i].close < candles[i - 1].close) obv -= vol;
    obvSeries.push(obv);
  }

  const recent = obvSeries.slice(-lookback);
  const baseVol = candles
    .slice(-lookback)
    .reduce((acc, c) => acc + (c.quoteVolume > 0 ? c.quoteVolume : c.volume), 0);
  if (baseVol <= 0) return 0;

  return ((recent[recent.length - 1] - recent[0]) / baseVol) * 100;
}

export function calcVolumeMetrics(candles: Candle[]): {
  zScore: number;
  ratio20: number;
  recent3Ratio: number;
  suspiciousScore: number;
} {
  if (candles.length < 22) {
    return { zScore: 0, ratio20: 1, recent3Ratio: 1, suspiciousScore: 0 };
  }

  const vols = candles.map((c) => (c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close));
  // Compare latest completed + live candle against preceding 20 bars
  const baseline = vols.slice(-22, -2);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance);

  const latest = vols[vols.length - 1];
  const prev = vols[vols.length - 2];
  const peakRecent = Math.max(latest, prev);
  const recent3Mean = (vols[vols.length - 1] + vols[vols.length - 2] + vols[vols.length - 3]) / 3;

  const ratio20 = mean > 0 ? peakRecent / mean : 1;
  const recent3Ratio = mean > 0 ? recent3Mean / mean : 1;
  const zScore = std > 0 ? (peakRecent - mean) / std : ratio20 > 2 ? 2.5 : 0;

  // Price compression during volume spike amplifies suspicious accumulation/distribution score
  const lastPrice = candles[candles.length - 1].close;
  const price3Ago = candles[candles.length - 4].close;
  const move3Pct = price3Ago > 0 ? Math.abs(((lastPrice - price3Ago) / price3Ago) * 100) : 0;

  let score = 0;
  if (zScore > 0.8) score += clamp((zScore - 0.8) * 18, 0, 48);
  if (ratio20 > 1.3) score += clamp((ratio20 - 1.3) * 15, 0, 32);
  if (recent3Ratio > 1.4 && move3Pct < 3.0) {
    // High volume surge while price hasn't broken out yet = stealth accumulation/distribution
    score += 20;
  }

  return {
    zScore: Number(zScore.toFixed(2)),
    ratio20: Number(ratio20.toFixed(2)),
    recent3Ratio: Number(recent3Ratio.toFixed(2)),
    suspiciousScore: Math.round(clamp(score, 0, 100)),
  };
}

export function calcCVDSeries(candles: Candle[]): {
  series: number[];
  takerBuyRatio: number;
  cvdSlopePct: number;
} {
  let cumulative = 0;
  const series: number[] = [];

  for (const c of candles) {
    const totalVol = c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close;
    const buyVol = c.takerBuyQuoteVol > 0 ? c.takerBuyQuoteVol : totalVol * 0.5;
    const sellVol = Math.max(0, totalVol - buyVol);
    const delta = buyVol - sellVol;
    cumulative += delta;
    series.push(cumulative);
  }

  const recentCandles = candles.slice(-6);
  let recentTotal = 0;
  let recentBuy = 0;
  for (const c of recentCandles) {
    const totalVol = c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close;
    const buyVol = c.takerBuyQuoteVol > 0 ? c.takerBuyQuoteVol : totalVol * 0.5;
    recentTotal += totalVol;
    recentBuy += buyVol;
  }

  const takerBuyRatio = recentTotal > 0 ? recentBuy / recentTotal : 0.5;
  const prevIdx = Math.max(0, series.length - 7);
  const deltaShift = series.length ? series[series.length - 1] - series[prevIdx] : 0;
  const cvdSlopePct = recentTotal > 0 ? (deltaShift / recentTotal) * 100 : 0;

  return { series, takerBuyRatio, cvdSlopePct };
}

export function detectLiquidityWick(candles: Candle[]): 'BULLISH_ABSORPTION' | 'BEARISH_REJECTION' | 'NONE' {
  if (candles.length < 3) return 'NONE';
  const recent = candles.slice(-2);
  for (const c of recent) {
    const range = c.high - c.low;
    if (range <= 0) continue;
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);

    if (lowerWick / range > 0.55 && lowerWick > body * 1.6) {
      return 'BULLISH_ABSORPTION';
    }
    if (upperWick / range > 0.55 && upperWick > body * 1.6) {
      return 'BEARISH_REJECTION';
    }
  }
  return 'NONE';
}

export function detectPivotLevels(
  candles: Candle[],
  lastPrice: number,
): { support1: number; support2: number; resistance1: number; resistance2: number } {
  const slice = candles.slice(-48);
  if (slice.length === 0) {
    return {
      support1: lastPrice * 0.985,
      support2: lastPrice * 0.96,
      resistance1: lastPrice * 1.015,
      resistance2: lastPrice * 1.04,
    };
  }

  const lows = slice.map((c) => c.low).filter((l) => l < lastPrice).sort((a, b) => b - a);
  const highs = slice.map((c) => c.high).filter((h) => h > lastPrice).sort((a, b) => a - b);

  const support1 = lows.length > 0 ? lows[Math.min(2, lows.length - 1)] : lastPrice * 0.985;
  const support2 = lows.length > 5 ? lows[Math.min(Math.floor(lows.length * 0.65), lows.length - 1)] : support1 * 0.98;

  const resistance1 = highs.length > 0 ? highs[Math.min(2, highs.length - 1)] : lastPrice * 1.015;
  const resistance2 = highs.length > 5 ? highs[Math.min(Math.floor(highs.length * 0.65), highs.length - 1)] : resistance1 * 1.02;

  return { support1, support2, resistance1, resistance2 };
}

export function calcMACDSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macdLine: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] } {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine: (number | null)[] = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const validIndices: number[] = [];
  const validMacd: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      validIndices.push(i);
      validMacd.push(macdLine[i] as number);
    }
  }
  const signalCompact = calcEMA(validMacd, signalPeriod);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);
  for (let k = 0; k < validIndices.length; k++) {
    const idx = validIndices[k];
    const sig = signalCompact[k];
    signalLine[idx] = sig;
    if (sig !== null && macdLine[idx] !== null) {
      histogram[idx] = (macdLine[idx] as number) - sig;
    }
  }
  return { macdLine, signalLine, histogram };
}

export function calcSuperTrend(
  candles: Candle[],
  atrPeriod = 10,
  multiplier = 3,
): { direction: 'BULLISH' | 'BEARISH'; value: number; flippedRecently: boolean } {
  if (candles.length < atrPeriod + 2) {
    const last = candles[candles.length - 1]?.close ?? 0;
    return { direction: 'BULLISH', value: last, flippedRecently: false };
  }

  const trList: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trList.push(candles[0].high - candles[0].low);
    } else {
      const prevClose = candles[i - 1].close;
      trList.push(
        Math.max(
          candles[i].high - candles[i].low,
          Math.abs(candles[i].high - prevClose),
          Math.abs(candles[i].low - prevClose),
        ),
      );
    }
  }

  const atrArr: number[] = new Array(candles.length).fill(0);
  let atr = trList.slice(0, atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod;
  atrArr[atrPeriod - 1] = atr;
  for (let i = atrPeriod; i < candles.length; i++) {
    atr = (atr * (atrPeriod - 1) + trList[i]) / atrPeriod;
    atrArr[i] = atr;
  }

  let finalUpper = 0;
  let finalLower = 0;
  let dir: 'BULLISH' | 'BEARISH' = 'BULLISH';
  const dirs: ('BULLISH' | 'BEARISH')[] = [];

  for (let i = atrPeriod - 1; i < candles.length; i++) {
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + multiplier * atrArr[i];
    const basicLower = hl2 - multiplier * atrArr[i];

    if (i === atrPeriod - 1) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      dir = c.close >= hl2 ? 'BULLISH' : 'BEARISH';
    } else {
      const prevClose = candles[i - 1].close;
      finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

      if (dir === 'BULLISH' && c.close < finalLower) {
        dir = 'BEARISH';
      } else if (dir === 'BEARISH' && c.close > finalUpper) {
        dir = 'BULLISH';
      }
    }
    dirs.push(dir);
  }

  const latestDir = dirs[dirs.length - 1] ?? 'BULLISH';
  const recentDirs = dirs.slice(-4);
  const flippedRecently = recentDirs.some((d) => d !== latestDir);

  return {
    direction: latestDir,
    value: latestDir === 'BULLISH' ? finalLower : finalUpper,
    flippedRecently,
  };
}

export function calcIchimoku(candles: Candle[]): {
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudState: 'ABOVE_KUMO' | 'INSIDE_KUMO' | 'BELOW_KUMO';
  tkCross: 'BULLISH' | 'BEARISH';
  cloudBias: 'BULLISH' | 'BEARISH';
} {
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const midRange = (slice: Candle[]) => {
    if (slice.length === 0) return lastPrice;
    let hi = -Infinity;
    let lo = Infinity;
    for (const c of slice) {
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    return (hi + lo) / 2;
  };

  const tenkan = midRange(candles.slice(-9));
  const kijun = midRange(candles.slice(-26));
  // Leading spans plotted 26 bars ahead reflect cloud computed 26 bars ago over current price
  const refIdx = Math.max(26, candles.length - 26);
  const pastSlice = candles.slice(0, refIdx);
  const spanA =
    pastSlice.length >= 26
      ? (midRange(pastSlice.slice(-9)) + midRange(pastSlice.slice(-26))) / 2
      : (tenkan + kijun) / 2;
  const spanB = pastSlice.length >= 52 ? midRange(pastSlice.slice(-52)) : midRange(candles.slice(-52));

  const cloudTop = Math.max(spanA, spanB);
  const cloudBottom = Math.min(spanA, spanB);
  const cloudState: 'ABOVE_KUMO' | 'INSIDE_KUMO' | 'BELOW_KUMO' =
    lastPrice > cloudTop ? 'ABOVE_KUMO' : lastPrice < cloudBottom ? 'BELOW_KUMO' : 'INSIDE_KUMO';

  return {
    tenkan,
    kijun,
    spanA,
    spanB,
    cloudState,
    tkCross: tenkan >= kijun ? 'BULLISH' : 'BEARISH',
    cloudBias: spanA >= spanB ? 'BULLISH' : 'BEARISH',
  };
}

export function calcCMF(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period);
  if (slice.length < 5) return 0;

  let mfvSum = 0;
  let volSum = 0;
  for (const c of slice) {
    const range = c.high - c.low;
    const vol = c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close;
    const mfm = range > 0 ? ((c.close - c.low) - (c.high - c.close)) / range : 0;
    mfvSum += mfm * vol;
    volSum += vol;
  }
  return volSum > 0 ? clamp(mfvSum / volSum, -1, 1) : 0;
}

export function calcMFI(candles: Candle[], period = 14): number {
  if (candles.length < period + 2) return 50;
  const slice = candles.slice(-(period + 1));
  let posFlow = 0;
  let negFlow = 0;

  for (let i = 1; i < slice.length; i++) {
    const currTp = (slice[i].high + slice[i].low + slice[i].close) / 3;
    const prevTp = (slice[i - 1].high + slice[i - 1].low + slice[i - 1].close) / 3;
    const vol = slice[i].quoteVolume > 0 ? slice[i].quoteVolume : slice[i].volume * currTp;
    if (currTp > prevTp) posFlow += currTp * vol;
    else if (currTp < prevTp) negFlow += currTp * vol;
  }

  if (negFlow === 0) return posFlow === 0 ? 50 : 100;
  const ratio = posFlow / negFlow;
  return clamp(100 - 100 / (1 + ratio), 0, 100);
}

export function calcTTMSqueeze(
  candles: Candle[],
  period = 20,
  bbMult = 2.0,
  kcMult = 1.5,
): {
  isSqueeze: boolean;
  squeezeBars: number;
  squeezeFired: boolean;
  momentum: number;
  prevMomentum: number;
} {
  if (candles.length < period + 5) {
    return { isSqueeze: false, squeezeBars: 0, squeezeFired: false, momentum: 0, prevMomentum: 0 };
  }

  const closes = candles.map((c) => c.close);
  const sma = calcSMA(closes, period);
  const ema = calcEMA(closes, period);

  // Rolling TR for Keltner ATR
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  const atrSma = calcSMA(tr, period);

  const squeezeFlags: boolean[] = new Array(candles.length).fill(false);
  const rawMom: number[] = new Array(candles.length).fill(0);

  for (let i = period - 1; i < candles.length; i++) {
    const m = sma[i];
    const e = ema[i];
    const a = atrSma[i];
    if (m === null || e === null || a === null || m <= 0) continue;

    let sq = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - m;
      sq += d * d;
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low < lo) lo = candles[j].low;
    }
    const sd = Math.sqrt(sq / period);
    const bbUpper = m + bbMult * sd;
    const bbLower = m - bbMult * sd;
    const kcUpper = e + kcMult * a;
    const kcLower = e - kcMult * a;

    squeezeFlags[i] = bbUpper < kcUpper && bbLower > kcLower;

    // TTM Squeeze momentum: close minus average of Donchian midpoint & SMA20, normalized by ATR
    const donchianMid = (hi + lo) / 2;
    const baseline = (donchianMid + m) / 2;
    const safeAtr = a > 0 ? a : closes[i] * 0.01;
    rawMom[i] = (closes[i] - baseline) / safeAtr;
  }

  const lastIdx = candles.length - 1;
  const isSqueeze = squeezeFlags[lastIdx];

  // Count consecutive squeeze bars ending at current or previous bar
  let squeezeBars = 0;
  let scanIdx = isSqueeze ? lastIdx : lastIdx - 1;
  while (scanIdx >= 0 && squeezeFlags[scanIdx]) {
    squeezeBars++;
    scanIdx--;
  }

  const squeezeFired =
    !isSqueeze &&
    (squeezeFlags[lastIdx - 1] || squeezeFlags[lastIdx - 2]) &&
    squeezeBars >= 2;

  const momentum = Number((rawMom[lastIdx] ?? 0).toFixed(3));
  const prevMomentum = Number((rawMom[lastIdx - 1] ?? 0).toFixed(3));

  return { isSqueeze, squeezeBars, squeezeFired, momentum, prevMomentum };
}

export function calcRangeCompressionRatio(candles: Candle[]): {
  atrExpansionRatio: number;
  isVcpTightening: boolean;
  isAbsorption: boolean;
} {
  if (candles.length < 28) {
    return { atrExpansionRatio: 1, isVcpTightening: false, isAbsorption: false };
  }

  const trPct: number[] = candles.map((c, i) => {
    const pc = i > 0 ? candles[i - 1].close : c.open;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    return c.close > 0 ? (tr / c.close) * 100 : 0;
  });

  // 8-bar ATR% series over the last 36 bars
  const rolling8: number[] = [];
  const start = Math.max(8, trPct.length - 36);
  for (let i = start; i <= trPct.length; i++) {
    const win = trPct.slice(i - 8, i);
    rolling8.push(win.reduce((a, b) => a + b, 0) / win.length);
  }
  const currentAtr = rolling8[rolling8.length - 1] || 1;
  const peakAtr = Math.max(...rolling8, currentAtr, 0.01);
  const atrExpansionRatio = Number((currentAtr / peakAtr).toFixed(2));

  // VCP tightening: last 6 bars average high-low range <= 0.72 * preceding 14 bars average range
  const recent6 = candles.slice(-6);
  const prior14 = candles.slice(-20, -6);
  const avgRange = (arr: Candle[]) =>
    arr.reduce((acc, c) => acc + (c.close > 0 ? ((c.high - c.low) / c.close) * 100 : 0), 0) /
    Math.max(arr.length, 1);

  const r6 = avgRange(recent6);
  const r14 = avgRange(prior14);
  const isVcpTightening = r14 > 0 && r6 / r14 <= 0.74;

  // Wyckoff Effort vs Result (Absorption): last 3 bars volume >= 1.5x prior 14-bar avg while net displacement < 2.2%
  const vols = candles.map((c) => (c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close));
  const avgPriorVol = vols.slice(-18, -3).reduce((a, b) => a + b, 0) / 15;
  const recentVol = vols.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const pStart = candles[candles.length - 4].close;
  const pEnd = candles[candles.length - 1].close;
  const movePct = pStart > 0 ? Math.abs(((pEnd - pStart) / pStart) * 100) : 0;
  const isAbsorption = avgPriorVol > 0 && recentVol / avgPriorVol >= 1.55 && movePct < 2.6;

  return { atrExpansionRatio, isVcpTightening, isAbsorption };
}

export function calcCVDDivergence(
  candles: Candle[],
  cvdSeries: number[],
  lookback = 20,
): 'BULLISH' | 'BEARISH' | 'NONE' {
  if (candles.length < lookback + 2 || cvdSeries.length !== candles.length) return 'NONE';

  const sliceC = candles.slice(-lookback);
  const sliceCvd = cvdSeries.slice(-lookback);
  const mid = Math.floor(lookback / 2);

  const firstAvgPrice = sliceC.slice(0, mid).reduce((a, c) => a + c.close, 0) / mid;
  const secondAvgPrice = sliceC.slice(mid).reduce((a, c) => a + c.close, 0) / (lookback - mid);
  const priceSlopePct = firstAvgPrice > 0 ? ((secondAvgPrice - firstAvgPrice) / firstAvgPrice) * 100 : 0;

  const avgVol =
    sliceC.reduce((a, c) => a + (c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close), 0) / lookback;
  if (avgVol <= 0) return 'NONE';

  const firstCvd = sliceCvd[mid - 1] - sliceCvd[0];
  const secondCvd = sliceCvd[sliceCvd.length - 1] - sliceCvd[mid - 1];
  const cvdShiftNorm = (secondCvd - firstCvd) / avgVol;
  const netRecentCvdNorm = secondCvd / avgVol;

  // Price flat or drifting down while CVD accelerates positively -> Stealth Accumulation
  if (priceSlopePct <= 0.9 && netRecentCvdNorm > 0.65 && cvdShiftNorm > 0.45) {
    return 'BULLISH';
  }
  // Price flat or creeping up while CVD turns negative -> Stealth Distribution
  if (priceSlopePct >= -0.9 && netRecentCvdNorm < -0.65 && cvdShiftNorm < -0.45) {
    return 'BEARISH';
  }
  return 'NONE';
}

export function calcOBVBreakout(candles: Candle[], period = 20): 'BULLISH' | 'BEARISH' | 'NONE' {
  if (candles.length < period + 5) return 'NONE';
  let obv = 0;
  const obvSeries: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].quoteVolume > 0 ? candles[i].quoteVolume : candles[i].volume * candles[i].close;
    if (candles[i].close > candles[i - 1].close) obv += vol;
    else if (candles[i].close < candles[i - 1].close) obv -= vol;
    obvSeries.push(obv);
  }

  const lastObv = obvSeries[obvSeries.length - 1];
  const priorObv = obvSeries.slice(-(period + 1), -1);
  const maxPriorObv = Math.max(...priorObv);
  const minPriorObv = Math.min(...priorObv);

  const lastClose = candles[candles.length - 1].close;
  const priorCloses = candles.slice(-(period + 1), -1);
  const maxPriorClose = Math.max(...priorCloses.map((c) => c.high));
  const minPriorClose = Math.min(...priorCloses.map((c) => c.low));

  // OBV breaks out ahead of or right with price breakout
  if (lastObv > maxPriorObv && lastClose >= minPriorClose * 1.005 && lastClose <= maxPriorClose * 1.015) {
    return 'BULLISH';
  }
  if (lastObv < minPriorObv && lastClose <= maxPriorClose * 0.995 && lastClose >= minPriorClose * 0.985) {
    return 'BEARISH';
  }
  return 'NONE';
}

export function calcDonchianBreakout(
  candles: Candle[],
  period = 20,
  atr14 = 0,
): {
  upper: number;
  lower: number;
  posPct: number;
  nearHighBreakout: boolean;
  nearLowBreakdown: boolean;
} {
  if (candles.length < period + 1) {
    const p = candles[candles.length - 1]?.close ?? 0;
    return { upper: p, lower: p, posPct: 50, nearHighBreakout: false, nearLowBreakdown: false };
  }

  const prior = candles.slice(-(period + 1), -1);
  const upper = Math.max(...prior.map((c) => c.high));
  const lower = Math.min(...prior.map((c) => c.low));
  const lastClose = candles[candles.length - 1].close;
  const span = Math.max(upper - lower, lastClose * 0.002);
  const posPct = Number(clamp(((lastClose - lower) / span) * 100, 0, 100).toFixed(1));
  const buffer = atr14 > 0 ? atr14 * 1.1 : lastClose * 0.015;

  const nearHighBreakout = lastClose >= upper - buffer && lastClose <= upper + buffer * 1.2;
  const nearLowBreakdown = lastClose <= lower + buffer && lastClose >= lower - buffer * 1.2;

  return { upper, lower, posPct, nearHighBreakout, nearLowBreakdown };
}


