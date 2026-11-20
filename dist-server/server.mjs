// server.ts
import express from "express";
import fs2 from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

// src/engine/indicators.ts
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
function calcSMA(values, period) {
  const result = new Array(values.length).fill(null);
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
function calcEMA(values, period) {
  const result = new Array(values.length).fill(null);
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
function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
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
function calcStochRSI(rsiSeries, rsiPeriod = 14, kSmooth = 3, dSmooth = 3) {
  const validRsi = [];
  for (const v of rsiSeries) {
    if (v !== null) validRsi.push(v);
  }
  if (validRsi.length < rsiPeriod + kSmooth) {
    return { k: 50, d: 50 };
  }
  const rawK = [];
  for (let i = rsiPeriod - 1; i < validRsi.length; i++) {
    const slice = validRsi.slice(i - rsiPeriod + 1, i + 1);
    const minRsi = Math.min(...slice);
    const maxRsi = Math.max(...slice);
    const span = maxRsi - minRsi;
    rawK.push(span === 0 ? 50 : (validRsi[i] - minRsi) / span * 100);
  }
  const kValues = calcSMA(rawK, kSmooth).filter((v) => v !== null);
  const dValues = calcSMA(kValues, dSmooth).filter((v) => v !== null);
  return {
    k: kValues.length ? kValues[kValues.length - 1] : 50,
    d: dValues.length ? dValues[dValues.length - 1] : 50
  };
}
function calcMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdSeries = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdSeries.push(emaFast[i] - emaSlow[i]);
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
function calcBollingerBands(closes, period = 20, stdDevMult = 2) {
  const upper = new Array(closes.length).fill(null);
  const middle = calcSMA(closes, period);
  const lower = new Array(closes.length).fill(null);
  const widthPct = new Array(closes.length).fill(null);
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
    widthPct[i] = (u - l) / mean * 100;
  }
  const validWidths = widthPct.filter((v) => v !== null);
  let widthPercentile = 50;
  if (validWidths.length >= 10) {
    const recentWidths = validWidths.slice(-80);
    const current = recentWidths[recentWidths.length - 1];
    const belowOrEqual = recentWidths.filter((w) => w <= current).length;
    widthPercentile = belowOrEqual / recentWidths.length * 100;
  }
  return { upper, middle, lower, widthPct, widthPercentile };
}
function calcATR(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prevClose),
      Math.abs(curr.low - prevClose)
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
function calcADX(candles, period = 14) {
  if (candles.length < period * 2 + 1) {
    return { adx: 18, plusDi: 20, minusDi: 20 };
  }
  const trList = [];
  const plusDm = [];
  const minusDm = [];
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
        Math.abs(curr.low - prev.close)
      )
    );
  }
  let smoothTr = trList.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDm.slice(0, period).reduce((a, b) => a + b, 0);
  const dxList = [];
  let lastPlusDi = 0;
  let lastMinusDi = 0;
  for (let i = period; i < trList.length; i++) {
    smoothTr = smoothTr - smoothTr / period + trList[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDm[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDm[i];
    const pDi = smoothTr > 0 ? 100 * smoothPlus / smoothTr : 0;
    const mDi = smoothTr > 0 ? 100 * smoothMinus / smoothTr : 0;
    lastPlusDi = pDi;
    lastMinusDi = mDi;
    const diSum = pDi + mDi;
    dxList.push(diSum > 0 ? 100 * Math.abs(pDi - mDi) / diSum : 0);
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
function calcVWAPSeries(candles, windowSize = 48) {
  const result = new Array(candles.length).fill(null);
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
function calcOBVSlope(candles, lookback = 12) {
  if (candles.length < lookback + 2) return 0;
  let obv = 0;
  const obvSeries = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].quoteVolume > 0 ? candles[i].quoteVolume : candles[i].volume;
    if (candles[i].close > candles[i - 1].close) obv += vol;
    else if (candles[i].close < candles[i - 1].close) obv -= vol;
    obvSeries.push(obv);
  }
  const recent = obvSeries.slice(-lookback);
  const baseVol = candles.slice(-lookback).reduce((acc, c) => acc + (c.quoteVolume > 0 ? c.quoteVolume : c.volume), 0);
  if (baseVol <= 0) return 0;
  return (recent[recent.length - 1] - recent[0]) / baseVol * 100;
}
function calcVolumeMetrics(candles) {
  if (candles.length < 22) {
    return { zScore: 0, ratio20: 1, recent3Ratio: 1, suspiciousScore: 0 };
  }
  const vols = candles.map((c) => c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close);
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
  const lastPrice = candles[candles.length - 1].close;
  const price3Ago = candles[candles.length - 4].close;
  const move3Pct = price3Ago > 0 ? Math.abs((lastPrice - price3Ago) / price3Ago * 100) : 0;
  let score = 0;
  if (zScore > 0.8) score += clamp((zScore - 0.8) * 18, 0, 48);
  if (ratio20 > 1.3) score += clamp((ratio20 - 1.3) * 15, 0, 32);
  if (recent3Ratio > 1.4 && move3Pct < 3) {
    score += 20;
  }
  return {
    zScore: Number(zScore.toFixed(2)),
    ratio20: Number(ratio20.toFixed(2)),
    recent3Ratio: Number(recent3Ratio.toFixed(2)),
    suspiciousScore: Math.round(clamp(score, 0, 100))
  };
}
function calcCVDSeries(candles) {
  let cumulative = 0;
  const series = [];
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
  const cvdSlopePct = recentTotal > 0 ? deltaShift / recentTotal * 100 : 0;
  return { series, takerBuyRatio, cvdSlopePct };
}
function detectLiquidityWick(candles) {
  if (candles.length < 3) return "NONE";
  const recent = candles.slice(-2);
  for (const c of recent) {
    const range = c.high - c.low;
    if (range <= 0) continue;
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    if (lowerWick / range > 0.55 && lowerWick > body * 1.6) {
      return "BULLISH_ABSORPTION";
    }
    if (upperWick / range > 0.55 && upperWick > body * 1.6) {
      return "BEARISH_REJECTION";
    }
  }
  return "NONE";
}
function detectPivotLevels(candles, lastPrice) {
  const slice = candles.slice(-48);
  if (slice.length === 0) {
    return {
      support1: lastPrice * 0.985,
      support2: lastPrice * 0.96,
      resistance1: lastPrice * 1.015,
      resistance2: lastPrice * 1.04
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
function calcMACDSeries(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map(
    (_, i) => emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null
  );
  const validIndices = [];
  const validMacd = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      validIndices.push(i);
      validMacd.push(macdLine[i]);
    }
  }
  const signalCompact = calcEMA(validMacd, signalPeriod);
  const signalLine = new Array(closes.length).fill(null);
  const histogram = new Array(closes.length).fill(null);
  for (let k = 0; k < validIndices.length; k++) {
    const idx = validIndices[k];
    const sig = signalCompact[k];
    signalLine[idx] = sig;
    if (sig !== null && macdLine[idx] !== null) {
      histogram[idx] = macdLine[idx] - sig;
    }
  }
  return { macdLine, signalLine, histogram };
}
function calcSuperTrend(candles, atrPeriod = 10, multiplier = 3) {
  if (candles.length < atrPeriod + 2) {
    const last = candles[candles.length - 1]?.close ?? 0;
    return { direction: "BULLISH", value: last, flippedRecently: false };
  }
  const trList = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trList.push(candles[0].high - candles[0].low);
    } else {
      const prevClose = candles[i - 1].close;
      trList.push(
        Math.max(
          candles[i].high - candles[i].low,
          Math.abs(candles[i].high - prevClose),
          Math.abs(candles[i].low - prevClose)
        )
      );
    }
  }
  const atrArr = new Array(candles.length).fill(0);
  let atr = trList.slice(0, atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod;
  atrArr[atrPeriod - 1] = atr;
  for (let i = atrPeriod; i < candles.length; i++) {
    atr = (atr * (atrPeriod - 1) + trList[i]) / atrPeriod;
    atrArr[i] = atr;
  }
  let finalUpper = 0;
  let finalLower = 0;
  let dir = "BULLISH";
  const dirs = [];
  for (let i = atrPeriod - 1; i < candles.length; i++) {
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + multiplier * atrArr[i];
    const basicLower = hl2 - multiplier * atrArr[i];
    if (i === atrPeriod - 1) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      dir = c.close >= hl2 ? "BULLISH" : "BEARISH";
    } else {
      const prevClose = candles[i - 1].close;
      finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
      if (dir === "BULLISH" && c.close < finalLower) {
        dir = "BEARISH";
      } else if (dir === "BEARISH" && c.close > finalUpper) {
        dir = "BULLISH";
      }
    }
    dirs.push(dir);
  }
  const latestDir = dirs[dirs.length - 1] ?? "BULLISH";
  const recentDirs = dirs.slice(-4);
  const flippedRecently = recentDirs.some((d) => d !== latestDir);
  return {
    direction: latestDir,
    value: latestDir === "BULLISH" ? finalLower : finalUpper,
    flippedRecently
  };
}
function calcIchimoku(candles) {
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  const midRange = (slice) => {
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
  const refIdx = Math.max(26, candles.length - 26);
  const pastSlice = candles.slice(0, refIdx);
  const spanA = pastSlice.length >= 26 ? (midRange(pastSlice.slice(-9)) + midRange(pastSlice.slice(-26))) / 2 : (tenkan + kijun) / 2;
  const spanB = pastSlice.length >= 52 ? midRange(pastSlice.slice(-52)) : midRange(candles.slice(-52));
  const cloudTop = Math.max(spanA, spanB);
  const cloudBottom = Math.min(spanA, spanB);
  const cloudState = lastPrice > cloudTop ? "ABOVE_KUMO" : lastPrice < cloudBottom ? "BELOW_KUMO" : "INSIDE_KUMO";
  return {
    tenkan,
    kijun,
    spanA,
    spanB,
    cloudState,
    tkCross: tenkan >= kijun ? "BULLISH" : "BEARISH",
    cloudBias: spanA >= spanB ? "BULLISH" : "BEARISH"
  };
}
function calcCMF(candles, period = 20) {
  const slice = candles.slice(-period);
  if (slice.length < 5) return 0;
  let mfvSum = 0;
  let volSum = 0;
  for (const c of slice) {
    const range = c.high - c.low;
    const vol = c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close;
    const mfm = range > 0 ? (c.close - c.low - (c.high - c.close)) / range : 0;
    mfvSum += mfm * vol;
    volSum += vol;
  }
  return volSum > 0 ? clamp(mfvSum / volSum, -1, 1) : 0;
}
function calcMFI(candles, period = 14) {
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
function calcTTMSqueeze(candles, period = 20, bbMult = 2, kcMult = 1.5) {
  if (candles.length < period + 5) {
    return { isSqueeze: false, squeezeBars: 0, squeezeFired: false, momentum: 0, prevMomentum: 0 };
  }
  const closes = candles.map((c) => c.close);
  const sma = calcSMA(closes, period);
  const ema = calcEMA(closes, period);
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  const atrSma = calcSMA(tr, period);
  const squeezeFlags = new Array(candles.length).fill(false);
  const rawMom = new Array(candles.length).fill(0);
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
    const donchianMid = (hi + lo) / 2;
    const baseline = (donchianMid + m) / 2;
    const safeAtr = a > 0 ? a : closes[i] * 0.01;
    rawMom[i] = (closes[i] - baseline) / safeAtr;
  }
  const lastIdx = candles.length - 1;
  const isSqueeze = squeezeFlags[lastIdx];
  let squeezeBars = 0;
  let scanIdx = isSqueeze ? lastIdx : lastIdx - 1;
  while (scanIdx >= 0 && squeezeFlags[scanIdx]) {
    squeezeBars++;
    scanIdx--;
  }
  const squeezeFired = !isSqueeze && (squeezeFlags[lastIdx - 1] || squeezeFlags[lastIdx - 2]) && squeezeBars >= 2;
  const momentum = Number((rawMom[lastIdx] ?? 0).toFixed(3));
  const prevMomentum = Number((rawMom[lastIdx - 1] ?? 0).toFixed(3));
  return { isSqueeze, squeezeBars, squeezeFired, momentum, prevMomentum };
}
function calcRangeCompressionRatio(candles) {
  if (candles.length < 28) {
    return { atrExpansionRatio: 1, isVcpTightening: false, isAbsorption: false };
  }
  const trPct = candles.map((c, i) => {
    const pc = i > 0 ? candles[i - 1].close : c.open;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    return c.close > 0 ? tr / c.close * 100 : 0;
  });
  const rolling8 = [];
  const start = Math.max(8, trPct.length - 36);
  for (let i = start; i <= trPct.length; i++) {
    const win = trPct.slice(i - 8, i);
    rolling8.push(win.reduce((a, b) => a + b, 0) / win.length);
  }
  const currentAtr = rolling8[rolling8.length - 1] || 1;
  const peakAtr = Math.max(...rolling8, currentAtr, 0.01);
  const atrExpansionRatio = Number((currentAtr / peakAtr).toFixed(2));
  const recent6 = candles.slice(-6);
  const prior14 = candles.slice(-20, -6);
  const avgRange = (arr) => arr.reduce((acc, c) => acc + (c.close > 0 ? (c.high - c.low) / c.close * 100 : 0), 0) / Math.max(arr.length, 1);
  const r6 = avgRange(recent6);
  const r14 = avgRange(prior14);
  const isVcpTightening = r14 > 0 && r6 / r14 <= 0.74;
  const vols = candles.map((c) => c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close);
  const avgPriorVol = vols.slice(-18, -3).reduce((a, b) => a + b, 0) / 15;
  const recentVol = vols.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const pStart = candles[candles.length - 4].close;
  const pEnd = candles[candles.length - 1].close;
  const movePct = pStart > 0 ? Math.abs((pEnd - pStart) / pStart * 100) : 0;
  const isAbsorption = avgPriorVol > 0 && recentVol / avgPriorVol >= 1.55 && movePct < 2.6;
  return { atrExpansionRatio, isVcpTightening, isAbsorption };
}
function calcCVDDivergence(candles, cvdSeries, lookback = 20) {
  if (candles.length < lookback + 2 || cvdSeries.length !== candles.length) return "NONE";
  const sliceC = candles.slice(-lookback);
  const sliceCvd = cvdSeries.slice(-lookback);
  const mid = Math.floor(lookback / 2);
  const firstAvgPrice = sliceC.slice(0, mid).reduce((a, c) => a + c.close, 0) / mid;
  const secondAvgPrice = sliceC.slice(mid).reduce((a, c) => a + c.close, 0) / (lookback - mid);
  const priceSlopePct = firstAvgPrice > 0 ? (secondAvgPrice - firstAvgPrice) / firstAvgPrice * 100 : 0;
  const avgVol = sliceC.reduce((a, c) => a + (c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close), 0) / lookback;
  if (avgVol <= 0) return "NONE";
  const firstCvd = sliceCvd[mid - 1] - sliceCvd[0];
  const secondCvd = sliceCvd[sliceCvd.length - 1] - sliceCvd[mid - 1];
  const cvdShiftNorm = (secondCvd - firstCvd) / avgVol;
  const netRecentCvdNorm = secondCvd / avgVol;
  if (priceSlopePct <= 0.9 && netRecentCvdNorm > 0.65 && cvdShiftNorm > 0.45) {
    return "BULLISH";
  }
  if (priceSlopePct >= -0.9 && netRecentCvdNorm < -0.65 && cvdShiftNorm < -0.45) {
    return "BEARISH";
  }
  return "NONE";
}
function calcOBVBreakout(candles, period = 20) {
  if (candles.length < period + 5) return "NONE";
  let obv = 0;
  const obvSeries = [0];
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
  if (lastObv > maxPriorObv && lastClose >= minPriorClose * 1.005 && lastClose <= maxPriorClose * 1.015) {
    return "BULLISH";
  }
  if (lastObv < minPriorObv && lastClose <= maxPriorClose * 0.995 && lastClose >= minPriorClose * 0.985) {
    return "BEARISH";
  }
  return "NONE";
}
function calcDonchianBreakout(candles, period = 20, atr14 = 0) {
  if (candles.length < period + 1) {
    const p = candles[candles.length - 1]?.close ?? 0;
    return { upper: p, lower: p, posPct: 50, nearHighBreakout: false, nearLowBreakdown: false };
  }
  const prior = candles.slice(-(period + 1), -1);
  const upper = Math.max(...prior.map((c) => c.high));
  const lower = Math.min(...prior.map((c) => c.low));
  const lastClose = candles[candles.length - 1].close;
  const span = Math.max(upper - lower, lastClose * 2e-3);
  const posPct = Number(clamp((lastClose - lower) / span * 100, 0, 100).toFixed(1));
  const buffer = atr14 > 0 ? atr14 * 1.1 : lastClose * 0.015;
  const nearHighBreakout = lastClose >= upper - buffer && lastClose <= upper + buffer * 1.2;
  const nearLowBreakdown = lastClose <= lower + buffer && lastClose >= lower - buffer * 1.2;
  return { upper, lower, posPct, nearHighBreakout, nearLowBreakdown };
}

// src/engine/patterns.ts
function bodySize(c) {
  return Math.abs(c.close - c.open);
}
function candleRange(c) {
  return Math.max(0, c.high - c.low);
}
function isBull(c) {
  return c.close > c.open;
}
function isBear(c) {
  return c.close < c.open;
}
function linearSlopePct(values) {
  if (values.length < 3) return 0;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  if (meanY === 0) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * (values[i] - meanY);
    den += dx * dx;
  }
  if (den === 0) return 0;
  const slopePerBar = num / den;
  return slopePerBar / meanY * 100;
}
function detectCandlestickPatterns(candles) {
  if (candles.length < 5) return [];
  const patterns = [];
  const c0 = candles[candles.length - 3];
  const c1 = candles[candles.length - 2];
  const c2 = candles[candles.length - 1];
  const r0 = candleRange(c0);
  const r1 = candleRange(c1);
  const r2 = candleRange(c2);
  const b0 = bodySize(c0);
  const b1 = bodySize(c1);
  const b2 = bodySize(c2);
  const recent14 = candles.slice(-14);
  const avgRange = recent14.reduce((a, c) => a + candleRange(c), 0) / recent14.length || r2 || 1;
  if (isBear(c1) && isBull(c2) && b2 >= avgRange * 0.45 && c2.open <= c1.close * 1.0015 && c2.close >= c1.open) {
    patterns.push({
      id: "bullish_engulfing",
      category: "CANDLESTICK",
      bias: "BULLISH",
      strength: 78,
      nameEn: "Bullish Engulfing",
      nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u067E\u0648\u0634\u0627\u06CC \u0635\u0639\u0648\u062F\u06CC (Bullish Engulfing)",
      detailEn: "Current bullish candle completely engulfs the prior bearish body, signaling strong buyer takeover.",
      detailFa: "\u06A9\u0646\u062F\u0644 \u0635\u0639\u0648\u062F\u06CC \u0627\u062E\u06CC\u0631 \u0628\u062F\u0646\u0647 \u06A9\u0646\u062F\u0644 \u0646\u0632\u0648\u0644\u06CC \u0642\u0628\u0644\u06CC \u0631\u0627 \u06A9\u0627\u0645\u0644\u0627\u064B \u067E\u0648\u0634\u0627\u0646\u062F\u0647 \u0648 \u0646\u0634\u0627\u0646\u200C\u062F\u0647\u0646\u062F\u0647 \u0686\u0631\u062E\u0634 \u0642\u062F\u0631\u062A \u0628\u0647 \u0633\u0645\u062A \u062E\u0631\u06CC\u062F\u0627\u0631\u0627\u0646 \u0627\u0633\u062A."
    });
  }
  if (isBull(c1) && isBear(c2) && b2 >= avgRange * 0.45 && c2.open >= c1.close * 0.9985 && c2.close <= c1.open) {
    patterns.push({
      id: "bearish_engulfing",
      category: "CANDLESTICK",
      bias: "BEARISH",
      strength: 78,
      nameEn: "Bearish Engulfing",
      nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u067E\u0648\u0634\u0627\u06CC \u0646\u0632\u0648\u0644\u06CC (Bearish Engulfing)",
      detailEn: "Current bearish candle engulfs the prior bullish body, indicating aggressive supply.",
      detailFa: "\u06A9\u0646\u062F\u0644 \u0646\u0632\u0648\u0644\u06CC \u0627\u062E\u06CC\u0631 \u0628\u062F\u0646\u0647 \u06A9\u0646\u062F\u0644 \u0635\u0639\u0648\u062F\u06CC \u0642\u0628\u0644\u06CC \u0631\u0627 \u0628\u0644\u0639\u06CC\u062F\u0647 \u0648 \u0646\u0634\u0627\u0646\u0647 \u0628\u0631\u062A\u0631\u06CC \u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646 \u0627\u0633\u062A."
    });
  }
  if (isBear(c0) && b0 >= avgRange * 0.4 && b1 <= Math.max(r1 * 0.35, b0 * 0.4) && isBull(c2) && c2.close > (c0.open + c0.close) / 2) {
    patterns.push({
      id: "morning_star",
      category: "CANDLESTICK",
      bias: "BULLISH",
      strength: 84,
      nameEn: "Morning Star",
      nameFa: "\u0633\u062A\u0627\u0631\u0647 \u0635\u0628\u062D\u06AF\u0627\u0647\u06CC (Morning Star)",
      detailEn: "3-bar reversal transition from selling pressure through indecision into strong bullish follow-through.",
      detailFa: "\u0627\u0644\u06AF\u0648\u06CC \u0633\u0647\u200C\u06A9\u0646\u062F\u0644\u06CC \u0628\u0627\u0632\u06AF\u0634\u062A \u0635\u0639\u0648\u062F\u06CC \u0627\u0632 \u0641\u0634\u0627\u0631 \u0641\u0631\u0648\u0634 \u0628\u0647 \u062A\u0631\u062F\u06CC\u062F \u0648 \u0633\u067E\u0633 \u062D\u0645\u0644\u0647 \u0642\u062F\u0631\u062A\u0645\u0646\u062F \u062E\u0631\u06CC\u062F\u0627\u0631\u0627\u0646."
    });
  }
  if (isBull(c0) && b0 >= avgRange * 0.4 && b1 <= Math.max(r1 * 0.35, b0 * 0.4) && isBear(c2) && c2.close < (c0.open + c0.close) / 2) {
    patterns.push({
      id: "evening_star",
      category: "CANDLESTICK",
      bias: "BEARISH",
      strength: 84,
      nameEn: "Evening Star",
      nameFa: "\u0633\u062A\u0627\u0631\u0647 \u0634\u0627\u0645\u06AF\u0627\u0647\u06CC (Evening Star)",
      detailEn: "3-bar bearish reversal showing buying exhaustion and strong supply takeover.",
      detailFa: "\u0627\u0644\u06AF\u0648\u06CC \u0633\u0647\u200C\u06A9\u0646\u062F\u0644\u06CC \u0628\u0627\u0632\u06AF\u0634\u062A \u0646\u0632\u0648\u0644\u06CC \u06A9\u0647 \u062A\u062E\u0644\u06CC\u0647 \u0645\u0648\u0645\u0646\u062A\u0648\u0645 \u062E\u0631\u06CC\u062F \u0648 \u0648\u0631\u0648\u062F \u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646 \u0631\u0627 \u062A\u0627\u06CC\u06CC\u062F \u0645\u06CC\u200C\u06A9\u0646\u062F."
    });
  }
  for (const bar of [c1, c2]) {
    const r = candleRange(bar);
    const b = bodySize(bar);
    if (r < avgRange * 0.5 || r <= 0) continue;
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    if (lowerWick >= r * 0.58 && upperWick <= r * 0.18 && b <= r * 0.35) {
      patterns.push({
        id: "bullish_pinbar",
        category: "CANDLESTICK",
        bias: "BULLISH",
        strength: 72,
        nameEn: "Hammer / Bullish Pin Bar",
        nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u0686\u06A9\u0634 / \u067E\u06CC\u0646\u200C\u0628\u0627\u0631 \u0635\u0639\u0648\u062F\u06CC",
        detailEn: "Long lower rejection wick confirms aggressive dip-buying and stop-sweep absorption.",
        detailFa: "\u0634\u062F\u0648\u06CC \u0628\u0644\u0646\u062F \u067E\u0627\u06CC\u06CC\u0646\u06CC \u0646\u0634\u0627\u0646\u200C\u062F\u0647\u0646\u062F\u0647 \u062C\u0645\u0639\u200C\u0622\u0648\u0631\u06CC \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC \u06A9\u0641 \u0648 \u062F\u0641\u0627\u0639 \u0633\u0646\u06AF\u06CC\u0646 \u062E\u0631\u06CC\u062F\u0627\u0631\u0627\u0646 \u0627\u0633\u062A."
      });
      break;
    }
    if (upperWick >= r * 0.58 && lowerWick <= r * 0.18 && b <= r * 0.35) {
      patterns.push({
        id: "bearish_pinbar",
        category: "CANDLESTICK",
        bias: "BEARISH",
        strength: 72,
        nameEn: "Shooting Star / Bearish Pin Bar",
        nameFa: "\u0633\u062A\u0627\u0631\u0647 \u062B\u0627\u0642\u0628 / \u067E\u06CC\u0646\u200C\u0628\u0627\u0631 \u0646\u0632\u0648\u0644\u06CC",
        detailEn: "Long upper rejection wick reveals supply rejection at highs.",
        detailFa: "\u0634\u062F\u0648\u06CC \u0628\u0644\u0646\u062F \u0628\u0627\u0644\u0627\u06CC\u06CC \u0646\u0634\u0627\u0646\u200C\u062F\u0647\u0646\u062F\u0647 \u0631\u062F \u0634\u062F\u0646 \u0642\u06CC\u0645\u062A \u0627\u0632 \u0645\u0642\u0627\u0648\u0645\u062A \u0648 \u0641\u0634\u0627\u0631 \u0641\u0631\u0648\u0634 \u062F\u0631 \u0633\u0642\u0641 \u0627\u0633\u062A."
      });
      break;
    }
  }
  if (isBull(c0) && isBull(c1) && isBull(c2) && c1.close > c0.close && c2.close > c1.close && b0 >= r0 * 0.45 && b1 >= r1 * 0.45 && b2 >= r2 * 0.45) {
    patterns.push({
      id: "three_white_soldiers",
      category: "CANDLESTICK",
      bias: "BULLISH",
      strength: 80,
      nameEn: "Three White Soldiers",
      nameFa: "\u0633\u0647 \u0633\u0631\u0628\u0627\u0632 \u0633\u0641\u06CC\u062F (\u0631\u0648\u0646\u062F \u0635\u0639\u0648\u062F\u06CC \u067E\u0631\u0642\u062F\u0631\u062A)",
      detailEn: "Three consecutive strong-bodied bullish candles closing near highs.",
      detailFa: "\u0633\u0647 \u06A9\u0646\u062F\u0644 \u0635\u0639\u0648\u062F\u06CC \u0645\u062A\u0648\u0627\u0644\u06CC \u0628\u0627 \u0628\u062F\u0646\u0647 \u067E\u0631\u0642\u062F\u0631\u062A \u0648 \u0628\u0633\u062A\u0647 \u0634\u062F\u0646 \u0646\u0632\u062F\u06CC\u06A9 \u0633\u0642\u0641."
    });
  } else if (isBear(c0) && isBear(c1) && isBear(c2) && c1.close < c0.close && c2.close < c1.close && b0 >= r0 * 0.45 && b1 >= r1 * 0.45 && b2 >= r2 * 0.45) {
    patterns.push({
      id: "three_black_crows",
      category: "CANDLESTICK",
      bias: "BEARISH",
      strength: 80,
      nameEn: "Three Black Crows",
      nameFa: "\u0633\u0647 \u06A9\u0644\u0627\u063A \u0633\u06CC\u0627\u0647 (\u0641\u0634\u0627\u0631 \u0646\u0632\u0648\u0644\u06CC \u0645\u062A\u0648\u0627\u0644\u06CC)",
      detailEn: "Three consecutive strong bearish candles expanding downward momentum.",
      detailFa: "\u0633\u0647 \u06A9\u0646\u062F\u0644 \u0646\u0632\u0648\u0644\u06CC \u0645\u062A\u0648\u0627\u0644\u06CC \u0628\u0627 \u0628\u062F\u0646\u0647 \u067E\u0631 \u0648 \u062A\u0633\u0644\u0637 \u06A9\u0627\u0645\u0644 \u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646."
    });
  }
  return patterns;
}
function detectDivergences(candles, rsiSeries, macdHistSeries) {
  if (candles.length < 30) return [];
  const patterns = [];
  const start = Math.max(5, candles.length - 48);
  const end = candles.length - 3;
  const swingLows = [];
  const swingHighs = [];
  for (let i = start; i <= end; i++) {
    const low = candles[i].low;
    const high = candles[i].high;
    if (low <= candles[i - 1].low && low <= candles[i - 2].low && low <= candles[i + 1].low && low <= candles[i + 2].low) {
      swingLows.push(i);
    }
    if (high >= candles[i - 1].high && high >= candles[i - 2].high && high >= candles[i + 1].high && high >= candles[i + 2].high) {
      swingHighs.push(i);
    }
  }
  if (swingLows.length >= 2) {
    const prevIdx = swingLows[swingLows.length - 2];
    const lastIdx = swingLows[swingLows.length - 1];
    if (lastIdx - prevIdx >= 4) {
      const pPrev = candles[prevIdx].low;
      const pLast = candles[lastIdx].low;
      const rPrev = rsiSeries[prevIdx];
      const rLast = rsiSeries[lastIdx];
      const mPrev = macdHistSeries[prevIdx];
      const mLast = macdHistSeries[lastIdx];
      if (rPrev !== null && rLast !== null) {
        if (pLast < pPrev * 0.999 && rLast > rPrev + 2.5 && rLast < 50) {
          patterns.push({
            id: "rsi_bullish_div",
            category: "DIVERGENCE",
            bias: "BULLISH",
            strength: 82,
            nameEn: "Regular Bullish RSI Divergence",
            nameFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u0645\u062B\u0628\u062A (\u0635\u0639\u0648\u062F\u06CC) \u06A9\u0644\u0627\u0633\u06CC\u06A9 RSI",
            detailEn: `Price printed a lower low while RSI climbed from ${rPrev.toFixed(1)} to ${rLast.toFixed(1)}.`,
            detailFa: `\u0642\u06CC\u0645\u062A \u06A9\u0641 \u067E\u0627\u06CC\u06CC\u0646\u200C\u062A\u0631 \u062B\u0628\u062A \u06A9\u0631\u062F\u0647 \u0627\u0645\u0627 RSI \u0627\u0632 ${rPrev.toFixed(1)} \u0628\u0647 ${rLast.toFixed(1)} \u0635\u0639\u0648\u062F \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A.`
          });
        } else if (pLast > pPrev * 1.002 && rLast < rPrev - 2.5 && rPrev > 40) {
          patterns.push({
            id: "rsi_hidden_bull_div",
            category: "DIVERGENCE",
            bias: "BULLISH",
            strength: 70,
            nameEn: "Hidden Bullish RSI Divergence",
            nameFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u0645\u062E\u0641\u06CC \u0635\u0639\u0648\u062F\u06CC RSI (\u0627\u062F\u0627\u0645\u0647\u200C\u062F\u0647\u0646\u062F\u0647)",
            detailEn: "Higher low in price with lower RSI reset signals bullish trend continuation.",
            detailFa: "\u06A9\u0641 \u0628\u0627\u0644\u0627\u062A\u0631 \u0642\u06CC\u0645\u062A \u0647\u0645\u0632\u0645\u0627\u0646 \u0628\u0627 \u062A\u062E\u0644\u06CC\u0647 \u0627\u0646\u062F\u06CC\u06A9\u0627\u062A\u0648\u0631 RSI \u0646\u0634\u0627\u0646\u0647 \u0627\u062F\u0627\u0645\u0647 \u0631\u0648\u0646\u062F \u0635\u0639\u0648\u062F\u06CC \u0627\u0633\u062A."
          });
        }
      }
      if (mPrev !== null && mLast !== null && pLast < pPrev * 0.999 && mLast > mPrev && mPrev < 0) {
        patterns.push({
          id: "macd_bullish_div",
          category: "DIVERGENCE",
          bias: "BULLISH",
          strength: 74,
          nameEn: "MACD Bullish Divergence",
          nameFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u0645\u062B\u0628\u062A \u0647\u06CC\u0633\u062A\u0648\u06AF\u0631\u0627\u0645 \u0645\u06A9\u062F\u06CC (MACD)",
          detailEn: "Downward selling momentum weakened noticeably on the recent retest low.",
          detailFa: "\u0641\u0634\u0627\u0631 \u0641\u0631\u0648\u0634 \u062F\u0631 \u0647\u06CC\u0633\u062A\u0648\u06AF\u0631\u0627\u0645 \u0645\u06A9\u062F\u06CC \u0647\u0646\u06AF\u0627\u0645 \u0644\u0645\u0633 \u06A9\u0641 \u062C\u062F\u06CC\u062F \u0628\u0647\u200C\u0634\u062F\u062A \u062A\u0636\u0639\u06CC\u0641 \u0634\u062F\u0647 \u0627\u0633\u062A."
        });
      }
    }
  }
  if (swingHighs.length >= 2) {
    const prevIdx = swingHighs[swingHighs.length - 2];
    const lastIdx = swingHighs[swingHighs.length - 1];
    if (lastIdx - prevIdx >= 4) {
      const pPrev = candles[prevIdx].high;
      const pLast = candles[lastIdx].high;
      const rPrev = rsiSeries[prevIdx];
      const rLast = rsiSeries[lastIdx];
      const mPrev = macdHistSeries[prevIdx];
      const mLast = macdHistSeries[lastIdx];
      if (rPrev !== null && rLast !== null) {
        if (pLast > pPrev * 1.001 && rLast < rPrev - 2.5 && rPrev > 52) {
          patterns.push({
            id: "rsi_bearish_div",
            category: "DIVERGENCE",
            bias: "BEARISH",
            strength: 82,
            nameEn: "Regular Bearish RSI Divergence",
            nameFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u0645\u0646\u0641\u06CC (\u0646\u0632\u0648\u0644\u06CC) \u06A9\u0644\u0627\u0633\u06CC\u06A9 RSI",
            detailEn: `Price made a higher high while RSI fell from ${rPrev.toFixed(1)} to ${rLast.toFixed(1)}.`,
            detailFa: `\u0642\u06CC\u0645\u062A \u0633\u0642\u0641 \u0628\u0627\u0644\u0627\u062A\u0631 \u0632\u062F\u0647 \u0627\u0645\u0627 RSI \u0627\u0632 ${rPrev.toFixed(1)} \u0628\u0647 ${rLast.toFixed(1)} \u0627\u0641\u062A \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A.`
          });
        } else if (pLast < pPrev * 0.998 && rLast > rPrev + 2.5 && rLast < 65) {
          patterns.push({
            id: "rsi_hidden_bear_div",
            category: "DIVERGENCE",
            bias: "BEARISH",
            strength: 70,
            nameEn: "Hidden Bearish RSI Divergence",
            nameFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u0645\u062E\u0641\u06CC \u0646\u0632\u0648\u0644\u06CC RSI (\u0627\u062F\u0627\u0645\u0647\u200C\u062F\u0647\u0646\u062F\u0647)",
            detailEn: "Lower high in price paired with higher RSI bounce warns of bearish continuation.",
            detailFa: "\u0633\u0642\u0641 \u067E\u0627\u06CC\u06CC\u0646\u200C\u062A\u0631 \u0642\u06CC\u0645\u062A \u0647\u0645\u0632\u0645\u0627\u0646 \u0628\u0627 \u0631\u0634\u062F \u06A9\u0627\u0630\u0628 RSI \u0627\u062D\u062A\u0645\u0627\u0644 \u0627\u062F\u0627\u0645\u0647 \u0631\u06CC\u0632\u0634 \u0631\u0627 \u0646\u0634\u0627\u0646 \u0645\u06CC\u200C\u062F\u0647\u062F."
          });
        }
      }
      if (mPrev !== null && mLast !== null && pLast > pPrev * 1.001 && mLast < mPrev && mPrev > 0) {
        patterns.push({
          id: "macd_bearish_div",
          category: "DIVERGENCE",
          bias: "BEARISH",
          strength: 74,
          nameEn: "MACD Bearish Divergence",
          nameFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u0645\u0646\u0641\u06CC \u0647\u06CC\u0633\u062A\u0648\u06AF\u0631\u0627\u0645 \u0645\u06A9\u062F\u06CC (MACD)",
          detailEn: "Bullish MACD histogram faded on a higher price peak.",
          detailFa: "\u0645\u0648\u0645\u0646\u062A\u0648\u0645 \u062E\u0631\u06CC\u062F \u062F\u0631 \u0647\u06CC\u0633\u062A\u0648\u06AF\u0631\u0627\u0645 \u0645\u06A9\u062F\u06CC \u0647\u0646\u06AF\u0627\u0645 \u062B\u0628\u062A \u0633\u0642\u0641 \u062C\u062F\u06CC\u062F \u062A\u0636\u0639\u06CC\u0641 \u0634\u062F\u0647 \u0627\u0633\u062A."
        });
      }
    }
  }
  return patterns;
}
function analyzeSmcAndChartPatterns(candles, rsiSeries, macdHistSeries) {
  if (candles.length < 30) {
    return {
      patterns: [],
      smcZone: "EQUILIBRIUM",
      smcStructure: "RANGING",
      candlestickAndChartScore: 0,
      smcScore: 0
    };
  }
  const patterns = [
    ...detectCandlestickPatterns(candles),
    ...detectDivergences(candles, rsiSeries, macdHistSeries)
  ];
  const lastPrice = candles[candles.length - 1].close;
  const dealingSlice = candles.slice(-48);
  const rangeHigh = Math.max(...dealingSlice.map((c) => c.high));
  const rangeLow = Math.min(...dealingSlice.map((c) => c.low));
  const span = Math.max(rangeHigh - rangeLow, lastPrice * 1e-3);
  const posRatio = (lastPrice - rangeLow) / span;
  const smcZone = posRatio <= 0.38 ? "DISCOUNT" : posRatio >= 0.62 ? "PREMIUM" : "EQUILIBRIUM";
  const recent = candles.slice(-45);
  const swingHighs = [];
  const swingLows = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const h = recent[i].high;
    const l = recent[i].low;
    if (h >= recent[i - 1].high && h >= recent[i - 2].high && h >= recent[i + 1].high && h >= recent[i + 2].high) {
      swingHighs.push({ idx: i, price: h });
    }
    if (l <= recent[i - 1].low && l <= recent[i - 2].low && l <= recent[i + 1].low && l <= recent[i + 2].low) {
      swingLows.push({ idx: i, price: l });
    }
  }
  let smcStructure = "RANGING";
  let smcScore = 0;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const hPrev = swingHighs[swingHighs.length - 2].price;
    const hLast = swingHighs[swingHighs.length - 1].price;
    const lPrev = swingLows[swingLows.length - 2].price;
    const lLast = swingLows[swingLows.length - 1].price;
    if (lastPrice > hLast && lLast >= lPrev * 0.997) {
      smcStructure = "BULLISH";
      smcScore += 45;
      patterns.push({
        id: "smc_bull_bos",
        category: "SMC",
        bias: "BULLISH",
        strength: 82,
        nameEn: "Bullish Break of Structure (BOS)",
        nameFa: "\u0634\u06A9\u0633\u062A \u0633\u0627\u062E\u062A\u0627\u0631 \u0635\u0639\u0648\u062F\u06CC \u0627\u0633\u0645\u0627\u0631\u062A\u200C\u0645\u0627\u0646\u06CC (BOS)",
        detailEn: "Price closed above the latest swing high while defending higher swing lows.",
        detailFa: "\u0642\u06CC\u0645\u062A \u0628\u0627\u0644\u0627\u06CC \u0622\u062E\u0631\u06CC\u0646 \u0633\u0642\u0641 \u0633\u0627\u062E\u062A\u0627\u0631\u06CC \u0628\u0633\u062A\u0647 \u0634\u062F\u0647 \u0648 \u0633\u0627\u062E\u062A\u0627\u0631 \u06A9\u0641\u200C\u0647\u0627\u06CC \u0628\u0627\u0644\u0627\u062A\u0631 \u062D\u0641\u0638 \u0634\u062F\u0647 \u0627\u0633\u062A."
      });
    } else if (lastPrice < lLast && hLast <= hPrev * 1.003) {
      smcStructure = "BEARISH";
      smcScore -= 45;
      patterns.push({
        id: "smc_bear_bos",
        category: "SMC",
        bias: "BEARISH",
        strength: 82,
        nameEn: "Bearish Break of Structure (BOS)",
        nameFa: "\u0634\u06A9\u0633\u062A \u0633\u0627\u062E\u062A\u0627\u0631 \u0646\u0632\u0648\u0644\u06CC \u0627\u0633\u0645\u0627\u0631\u062A\u200C\u0645\u0627\u0646\u06CC (BOS)",
        detailEn: "Price broke below structural swing support while printing lower highs.",
        detailFa: "\u0642\u06CC\u0645\u062A \u062D\u0645\u0627\u06CC\u062A \u0633\u0627\u062E\u062A\u0627\u0631\u06CC \u0627\u062E\u06CC\u0631 \u0631\u0627 \u0628\u0647 \u067E\u0627\u06CC\u06CC\u0646 \u0634\u06A9\u0633\u062A\u0647 \u0648 \u0633\u0642\u0641\u200C\u0647\u0627\u06CC \u067E\u0627\u06CC\u06CC\u0646\u200C\u062A\u0631 \u062A\u0627\u06CC\u06CC\u062F \u0634\u062F\u0647 \u0627\u0633\u062A."
      });
    } else if (hLast < hPrev && lastPrice > hLast) {
      smcStructure = "BULLISH";
      smcScore += 35;
      patterns.push({
        id: "smc_bull_choch",
        category: "SMC",
        bias: "BULLISH",
        strength: 78,
        nameEn: "Bullish Change of Character (CHoCH)",
        nameFa: "\u062A\u063A\u06CC\u06CC\u0631 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0635\u0639\u0648\u062F\u06CC \u0631\u0648\u0646\u062F (CHoCH)",
        detailEn: "First bullish structural break after a sequence of lower highs.",
        detailFa: "\u0627\u0648\u0644\u06CC\u0646 \u0634\u06A9\u0633\u062A \u0631\u0648 \u0628\u0647 \u0628\u0627\u0644\u0627\u06CC \u0633\u0627\u062E\u062A\u0627\u0631 \u067E\u0633 \u0627\u0632 \u06CC\u06A9 \u062F\u0648\u0631\u0647 \u0633\u0642\u0641\u200C\u0647\u0627\u06CC \u0646\u0632\u0648\u0644\u06CC (\u0647\u0634\u062F\u0627\u0631 \u062A\u063A\u06CC\u06CC\u0631 \u0631\u0648\u0646\u062F)."
      });
    } else if (lLast > lPrev && lastPrice < lLast) {
      smcStructure = "BEARISH";
      smcScore -= 35;
      patterns.push({
        id: "smc_bear_choch",
        category: "SMC",
        bias: "BEARISH",
        strength: 78,
        nameEn: "Bearish Change of Character (CHoCH)",
        nameFa: "\u062A\u063A\u06CC\u06CC\u0631 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0646\u0632\u0648\u0644\u06CC \u0631\u0648\u0646\u062F (CHoCH)",
        detailEn: "First bearish breakdown below a higher swing low.",
        detailFa: "\u0627\u0648\u0644\u06CC\u0646 \u0634\u06A9\u0633\u062A \u0628\u0647 \u0632\u06CC\u0631 \u06A9\u0641 \u0635\u0639\u0648\u062F\u06CC \u0642\u0628\u0644\u06CC \u0648 \u0646\u0634\u0627\u0646\u0647 \u062A\u063A\u06CC\u06CC\u0631 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0632\u0627\u0631 \u0628\u0647 \u0646\u0632\u0648\u0644\u06CC."
      });
    } else if (hLast > hPrev && lLast > lPrev) {
      smcStructure = "BULLISH";
      smcScore += 22;
    } else if (hLast < hPrev && lLast < lPrev) {
      smcStructure = "BEARISH";
      smcScore -= 22;
    }
    const tol = 8e-3;
    if (swingLows.length >= 2 && swingLows[swingLows.length - 1].idx - swingLows[swingLows.length - 2].idx >= 5 && Math.abs(lLast - lPrev) / lPrev <= tol && lastPrice > lLast * 1.008) {
      patterns.push({
        id: "double_bottom",
        category: "CHART",
        bias: "BULLISH",
        strength: 76,
        nameEn: "Double Bottom (W Reversal)",
        nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u06A9\u0641 \u062F\u0648\u0642\u0644\u0648 (Double Bottom)",
        detailEn: "Two aligned demand lows held firm with upward rebound toward neckline.",
        detailFa: "\u062F\u0648 \u06A9\u0641 \u0647\u0645\u200C\u062A\u0631\u0627\u0632 \u062A\u0642\u0627\u0636\u0627 \u0628\u0627 \u0648\u0627\u06A9\u0646\u0634 \u0635\u0639\u0648\u062F\u06CC \u0642\u062F\u0631\u062A\u0645\u0646\u062F \u0634\u06A9\u0644 \u06AF\u0631\u0641\u062A\u0647 \u0627\u0633\u062A."
      });
    }
    if (swingHighs.length >= 2 && swingHighs[swingHighs.length - 1].idx - swingHighs[swingHighs.length - 2].idx >= 5 && Math.abs(hLast - hPrev) / hPrev <= tol && lastPrice < hLast * 0.992) {
      patterns.push({
        id: "double_top",
        category: "CHART",
        bias: "BEARISH",
        strength: 76,
        nameEn: "Double Top (M Reversal)",
        nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u0633\u0642\u0641 \u062F\u0648\u0642\u0644\u0648 (Double Top)",
        detailEn: "Two aligned supply rejections at resistance point to downside rotation.",
        detailFa: "\u062F\u0648 \u0633\u0642\u0641 \u0647\u0645\u200C\u062A\u0631\u0627\u0632 \u0639\u0631\u0636\u0647 \u0648 \u0646\u0627\u062A\u0648\u0627\u0646\u06CC \u0642\u06CC\u0645\u062A \u062F\u0631 \u0639\u0628\u0648\u0631 \u0627\u0632 \u0645\u0642\u0627\u0648\u0645\u062A \u0645\u0634\u0627\u0647\u062F\u0647 \u0634\u062F."
      });
    }
  }
  for (let i = candles.length - 2; i >= Math.max(2, candles.length - 15); i--) {
    const cLeft = candles[i - 2];
    const cRight = candles[i];
    if (cRight.low > cLeft.high) {
      const gapLow = cLeft.high;
      const gapHigh = cRight.low;
      const gapWidthPct = (gapHigh - gapLow) / lastPrice * 100;
      if (gapWidthPct >= 0.15 && lastPrice >= gapLow * 0.995 && lastPrice <= gapHigh * 1.018) {
        smcScore += 25;
        patterns.push({
          id: "smc_bull_fvg",
          category: "SMC",
          bias: "BULLISH",
          strength: 72,
          nameEn: "Bullish Fair Value Gap (FVG)",
          nameFa: "\u06AF\u067E \u0627\u0631\u0632\u0634 \u0645\u0646\u0635\u0641\u0627\u0646\u0647 \u0635\u0639\u0648\u062F\u06CC (Bullish FVG)",
          detailEn: "Price is tapping/holding an active institutional bullish imbalance zone.",
          detailFa: "\u0642\u06CC\u0645\u062A \u062F\u0631 \u062D\u0627\u0644 \u0648\u0627\u06A9\u0646\u0634 \u0628\u0647 \u0646\u0627\u062D\u06CC\u0647 \u0639\u062F\u0645 \u062A\u0639\u0627\u062F\u0644 \u062A\u0642\u0627\u0636\u0627 (FVG \u0635\u0639\u0648\u062F\u06CC) \u0627\u0633\u062A."
        });
        break;
      }
    }
    if (cRight.high < cLeft.low) {
      const gapLow = cRight.high;
      const gapHigh = cLeft.low;
      const gapWidthPct = (gapHigh - gapLow) / lastPrice * 100;
      if (gapWidthPct >= 0.15 && lastPrice <= gapHigh * 1.005 && lastPrice >= gapLow * 0.982) {
        smcScore -= 25;
        patterns.push({
          id: "smc_bear_fvg",
          category: "SMC",
          bias: "BEARISH",
          strength: 72,
          nameEn: "Bearish Fair Value Gap (FVG)",
          nameFa: "\u06AF\u067E \u0627\u0631\u0632\u0634 \u0645\u0646\u0635\u0641\u0627\u0646\u0647 \u0646\u0632\u0648\u0644\u06CC (Bearish FVG)",
          detailEn: "Price is reacting into an unmitigated institutional supply FVG zone.",
          detailFa: "\u0642\u06CC\u0645\u062A \u0628\u0647 \u0646\u0627\u062D\u06CC\u0647 \u0639\u062F\u0645 \u062A\u0639\u0627\u062F\u0644 \u0639\u0631\u0636\u0647 (FVG \u0646\u0632\u0648\u0644\u06CC) \u0628\u0631\u062E\u0648\u0631\u062F \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A."
        });
        break;
      }
    }
  }
  if (smcZone === "DISCOUNT") smcScore += 18;
  else if (smcZone === "PREMIUM") smcScore -= 18;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const highSlope = linearSlopePct(swingHighs.map((s) => s.price));
    const lowSlope = linearSlopePct(swingLows.map((s) => s.price));
    if (Math.abs(highSlope) < 0.08 && lowSlope > 0.12) {
      patterns.push({
        id: "ascending_triangle",
        category: "CHART",
        bias: "BULLISH",
        strength: 75,
        nameEn: "Ascending Triangle",
        nameFa: "\u0645\u062B\u0644\u062B \u0635\u0639\u0648\u062F\u06CC (\u0641\u0634\u0627\u0631 \u062E\u0631\u06CC\u062F \u0632\u06CC\u0631 \u0645\u0642\u0627\u0648\u0645\u062A)",
        detailEn: "Flat ceiling resistance paired with steadily rising higher lows.",
        detailFa: "\u0633\u0642\u0641 \u0645\u0642\u0627\u0648\u0645\u062A\u06CC \u0627\u0641\u0642\u06CC \u0647\u0645\u0631\u0627\u0647 \u0628\u0627 \u06A9\u0641\u200C\u0647\u0627\u06CC \u0635\u0639\u0648\u062F\u06CC \u06A9\u0647 \u0627\u062D\u062A\u0645\u0627\u0644 \u0634\u06A9\u0633\u062A \u0631\u0648 \u0628\u0647 \u0628\u0627\u0644\u0627 \u0631\u0627 \u0627\u0641\u0632\u0627\u06CC\u0634 \u0645\u06CC\u200C\u062F\u0647\u062F."
      });
    } else if (Math.abs(lowSlope) < 0.08 && highSlope < -0.12) {
      patterns.push({
        id: "descending_triangle",
        category: "CHART",
        bias: "BEARISH",
        strength: 75,
        nameEn: "Descending Triangle",
        nameFa: "\u0645\u062B\u0644\u062B \u0646\u0632\u0648\u0644\u06CC (\u0641\u0634\u0627\u0631 \u0641\u0631\u0648\u0634 \u0631\u0648\u06CC \u062D\u0645\u0627\u06CC\u062A)",
        detailEn: "Horizontal support tested repeatedly against lower highs.",
        detailFa: "\u062D\u0645\u0627\u06CC\u062A \u0627\u0641\u0642\u06CC \u0647\u0645\u0631\u0627\u0647 \u0628\u0627 \u0633\u0642\u0641\u200C\u0647\u0627\u06CC \u067E\u0627\u06CC\u06CC\u0646\u200C\u062A\u0631 \u06A9\u0647 \u0631\u06CC\u0633\u06A9 \u0634\u06A9\u0633\u062A \u0646\u0632\u0648\u0644\u06CC \u0631\u0627 \u0628\u0627\u0644\u0627 \u0645\u06CC\u200C\u0628\u0631\u062F."
      });
    } else if (highSlope < -0.1 && lowSlope < -0.02 && highSlope < lowSlope - 0.04) {
      patterns.push({
        id: "falling_wedge",
        category: "CHART",
        bias: "BULLISH",
        strength: 74,
        nameEn: "Falling Wedge (Bullish Breakout Bias)",
        nameFa: "\u06AF\u0648\u0647 \u0646\u0632\u0648\u0644\u06CC (\u06A9\u0646\u062C \u0635\u0639\u0648\u062F\u06CC)",
        detailEn: "Converging downward channel losing bearish expansion speed.",
        detailFa: "\u06A9\u0627\u0646\u0627\u0644 \u0647\u0645\u06AF\u0631\u0627\u06CC \u0631\u0648 \u0628\u0647 \u067E\u0627\u06CC\u06CC\u0646 \u0628\u0627 \u06A9\u0627\u0647\u0634 \u0641\u0634\u0627\u0631 \u0641\u0631\u0648\u0634 (\u0645\u0633\u062A\u0639\u062F \u0634\u06A9\u0633\u062A \u0635\u0639\u0648\u062F\u06CC)."
      });
    } else if (highSlope > 0.02 && lowSlope > 0.1 && lowSlope > highSlope + 0.04) {
      patterns.push({
        id: "rising_wedge",
        category: "CHART",
        bias: "BEARISH",
        strength: 74,
        nameEn: "Rising Wedge (Bearish Breakdown Bias)",
        nameFa: "\u06AF\u0648\u0647 \u0635\u0639\u0648\u062F\u06CC (\u06A9\u0646\u062C \u0646\u0632\u0648\u0644\u06CC)",
        detailEn: "Narrowing upward wedge often precedes sharp downside breakdown.",
        detailFa: "\u06A9\u0627\u0646\u0627\u0644 \u0647\u0645\u06AF\u0631\u0627\u06CC \u0631\u0648 \u0628\u0647 \u0628\u0627\u0644\u0627 \u06A9\u0647 \u0645\u0639\u0645\u0648\u0644\u0627\u064B \u0628\u0627 \u0634\u06A9\u0633\u062A \u0646\u0632\u0648\u0644\u06CC \u0647\u0645\u0631\u0627\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F."
      });
    } else if (highSlope < -0.06 && lowSlope > 0.06) {
      patterns.push({
        id: "symmetrical_triangle",
        category: "CHART",
        bias: "NEUTRAL",
        strength: 76,
        nameEn: "Symmetrical Coil / Pennant Apex",
        nameFa: "\u0645\u062B\u0644\u062B \u0645\u062A\u0642\u0627\u0631\u0646 / \u0641\u0634\u0631\u062F\u06AF\u06CC \u0641\u0646\u0631 \u0627\u0646\u0641\u062C\u0627\u0631\u06CC",
        detailEn: "Converging lower highs and higher lows signaling imminent high-volatility breakout.",
        detailFa: "\u0647\u0645\u06AF\u0631\u0627\u06CC\u06CC \u0633\u0642\u0641\u200C\u0647\u0627\u06CC \u067E\u0627\u06CC\u06CC\u0646\u200C\u062A\u0631 \u0648 \u06A9\u0641\u200C\u0647\u0627\u06CC \u0628\u0627\u0644\u0627\u062A\u0631 (\u0641\u0634\u0631\u062F\u06AF\u06CC \u0634\u062F\u06CC\u062F \u067E\u06CC\u0634 \u0627\u0632 \u062D\u0631\u06A9\u062A \u0634\u0627\u0631\u067E)."
      });
    }
  }
  if (swingHighs.length >= 3) {
    const ls = swingHighs[swingHighs.length - 3].price;
    const head = swingHighs[swingHighs.length - 2].price;
    const rs = swingHighs[swingHighs.length - 1].price;
    const shoulderSymmetry = Math.abs(ls - rs) / Math.max(ls, 1e-8);
    if (head > ls * 1.008 && head > rs * 1.008 && shoulderSymmetry <= 0.025 && lastPrice < rs) {
      patterns.push({
        id: "head_and_shoulders",
        category: "CHART",
        bias: "BEARISH",
        strength: 82,
        nameEn: "Head & Shoulders Top",
        nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u0633\u0631 \u0648 \u0634\u0627\u0646\u0647 \u0633\u0642\u0641 (\u0631\u06CC\u0632\u0634 \u0633\u0646\u06AF\u06CC\u0646)",
        detailEn: "Classic 3-peak bearish reversal structure warning of steep downside breakdown.",
        detailFa: "\u0633\u0627\u062E\u062A\u0627\u0631 \u06A9\u0644\u0627\u0633\u06CC\u06A9 \u0633\u0647 \u0642\u0644\u0647 \u0646\u0632\u0648\u0644\u06CC \u0628\u0627 \u067E\u062A\u0627\u0646\u0633\u06CC\u0644 \u0634\u06A9\u0633\u062A \u0646\u06A9\u200C\u0644\u0627\u06CC\u0646 \u0648 \u0631\u06CC\u0632\u0634 \u0634\u0627\u0631\u067E."
      });
    }
  }
  if (swingLows.length >= 3) {
    const ls = swingLows[swingLows.length - 3].price;
    const head = swingLows[swingLows.length - 2].price;
    const rs = swingLows[swingLows.length - 1].price;
    const shoulderSymmetry = Math.abs(ls - rs) / Math.max(ls, 1e-8);
    if (head < ls * 0.992 && head < rs * 0.992 && shoulderSymmetry <= 0.025 && lastPrice > rs) {
      patterns.push({
        id: "inverse_head_and_shoulders",
        category: "CHART",
        bias: "BULLISH",
        strength: 82,
        nameEn: "Inverse Head & Shoulders Bottom",
        nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u0633\u0631 \u0648 \u0634\u0627\u0646\u0647 \u0645\u0639\u06A9\u0648\u0633 (\u067E\u0627\u0645\u067E \u0628\u0627\u0632\u06AF\u0634\u062A\u06CC)",
        detailEn: "3-trough bottoming reversal signaling strong upside breakout potential.",
        detailFa: "\u0633\u0627\u062E\u062A\u0627\u0631 \u06A9\u0644\u0627\u0633\u06CC\u06A9 \u0633\u0647 \u062F\u0631\u0647 \u0628\u0627\u0632\u06AF\u0634\u062A\u06CC \u0628\u0627 \u067E\u062A\u0627\u0646\u0633\u06CC\u0644 \u0634\u06A9\u0633\u062A \u0645\u0642\u0627\u0648\u0645\u062A \u06AF\u0631\u062F\u0646 \u0648 \u062C\u0647\u0634 \u067E\u0631\u0642\u062F\u0631\u062A."
      });
    }
  }
  if (candles.length >= 22) {
    const priorRange = candles.slice(-20, -2);
    const rangeLow2 = Math.min(...priorRange.map((c) => c.low));
    const rangeHigh2 = Math.max(...priorRange.map((c) => c.high));
    const avgVol = priorRange.reduce((acc, c) => acc + (c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close), 0) / priorRange.length;
    const latestBars = candles.slice(-2);
    for (const bar of latestBars) {
      const barVol = bar.quoteVolume > 0 ? bar.quoteVolume : bar.volume * bar.close;
      const volOk = avgVol <= 0 || barVol >= avgVol * 1.25;
      if (bar.low < rangeLow2 * 0.999 && bar.close > rangeLow2 && volOk) {
        patterns.push({
          id: "wyckoff_spring",
          category: "SMC",
          bias: "BULLISH",
          strength: 85,
          nameEn: "Wyckoff Spring (Liquidity Sweep & Reclaim)",
          nameFa: "\u0627\u0633\u067E\u0631\u06CC\u0646\u06AF \u0648\u0627\u06CC\u06A9\u0648\u0641 (\u0634\u06A9\u0627\u0631 \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC \u06A9\u0641 \u0648 \u0628\u0627\u0632\u06AF\u0634\u062A)",
          detailEn: "Swept below prior 18-bar range support and closed sharply back inside with heavy volume.",
          detailFa: "\u062C\u0645\u0639\u200C\u0622\u0648\u0631\u06CC \u0627\u0633\u062A\u0627\u067E\u200C\u0647\u0627\u06CC \u0632\u06CC\u0631 \u06A9\u0641 \u06F1\u06F8 \u06A9\u0646\u062F\u0644 \u0627\u062E\u06CC\u0631 \u0648 \u0628\u0627\u0632\u06AF\u0634\u062A \u0641\u0648\u0631\u06CC \u0628\u0627\u0644\u0627\u06CC \u062D\u0645\u0627\u06CC\u062A \u0628\u0627 \u062D\u062C\u0645 \u0628\u0627\u0644\u0627 (\u062A\u0631\u06CC\u06AF\u0631 \u067E\u0627\u0645\u067E)."
        });
        smcScore += 32;
        break;
      }
      if (bar.high > rangeHigh2 * 1.001 && bar.close < rangeHigh2 && volOk) {
        patterns.push({
          id: "wyckoff_utad",
          category: "SMC",
          bias: "BEARISH",
          strength: 85,
          nameEn: "Wyckoff UTAD (Upthrust Distribution Sweep)",
          nameFa: "\u0627\u0644\u06AF\u0648\u06CC UTAD \u0648\u0627\u06CC\u06A9\u0648\u0641 (\u062A\u0644\u0647 \u0634\u06A9\u0633\u062A \u0633\u0642\u0641 \u0648 \u0631\u06CC\u0632\u0634)",
          detailEn: "Swept above 18-bar range highs to trap longs before rejecting back below resistance.",
          detailFa: "\u0634\u06A9\u0627\u0631 \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC \u0628\u0627\u0644\u0627\u06CC \u0633\u0642\u0641 \u0648 \u0628\u0627\u0632\u06AF\u0634\u062A \u0633\u0631\u06CC\u0639 \u0632\u06CC\u0631 \u0645\u0642\u0627\u0648\u0645\u062A \u0647\u0645\u0631\u0627\u0647 \u0628\u0627 \u062D\u062C\u0645 \u0633\u0646\u06AF\u06CC\u0646 (\u0647\u0634\u062F\u0627\u0631 \u062F\u0627\u0645\u067E \u0634\u0627\u0631\u067E)."
        });
        smcScore -= 32;
        break;
      }
    }
  }
  for (let i = candles.length - 4; i >= Math.max(2, candles.length - 24); i--) {
    const ob = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];
    const obRange = Math.max(ob.high - ob.low, lastPrice * 1e-3);
    if (isBear(ob) && isBull(next1) && next2.close - ob.open > obRange * 2.1) {
      if (lastPrice >= ob.low * 0.996 && lastPrice <= ob.high * 1.012) {
        smcScore += 22;
        patterns.push({
          id: "smc_bull_ob",
          category: "SMC",
          bias: "BULLISH",
          strength: 77,
          nameEn: "Institutional Bullish Order Block",
          nameFa: "\u0627\u0648\u0631\u062F\u0631 \u0628\u0644\u0627\u06A9 \u062A\u0642\u0627\u0636\u0627\u06CC \u0646\u0647\u0627\u062F\u06CC (Bullish OB)",
          detailEn: "Price is retesting an unmitigated institutional accumulation origin candle.",
          detailFa: "\u0642\u06CC\u0645\u062A \u062F\u0631 \u062D\u0627\u0644 \u067E\u0648\u0644\u0628\u06A9 \u0628\u0647 \u0645\u0646\u0634\u0623 \u062D\u0631\u06A9\u062A \u0627\u0646\u0641\u062C\u0627\u0631\u06CC \u062E\u0631\u06CC\u062F\u0627\u0631\u0627\u0646 (Order Block \u0635\u0639\u0648\u062F\u06CC) \u0627\u0633\u062A."
        });
        break;
      }
    }
    if (isBull(ob) && isBear(next1) && ob.open - next2.close > obRange * 2.1) {
      if (lastPrice <= ob.high * 1.004 && lastPrice >= ob.low * 0.988) {
        smcScore -= 22;
        patterns.push({
          id: "smc_bear_ob",
          category: "SMC",
          bias: "BEARISH",
          strength: 77,
          nameEn: "Institutional Bearish Order Block",
          nameFa: "\u0627\u0648\u0631\u062F\u0631 \u0628\u0644\u0627\u06A9 \u0639\u0631\u0636\u0647 \u0646\u0647\u0627\u062F\u06CC (Bearish OB)",
          detailEn: "Price bounced into an unmitigated institutional distribution supply block.",
          detailFa: "\u0642\u06CC\u0645\u062A \u0628\u0647 \u0646\u0627\u062D\u06CC\u0647 \u0639\u0631\u0636\u0647 \u0648 \u0645\u0646\u0634\u0623 \u0631\u06CC\u0632\u0634 \u0642\u0628\u0644\u06CC (Order Block \u0646\u0632\u0648\u0644\u06CC) \u0631\u0633\u06CC\u062F\u0647 \u0627\u0633\u062A."
        });
        break;
      }
    }
  }
  if (candles.length >= 32) {
    const poleStart = candles[candles.length - 30].close;
    const poleEnd = candles[candles.length - 12].close;
    const poleReturnPct = poleStart > 0 ? (poleEnd - poleStart) / poleStart * 100 : 0;
    const flagSlice = candles.slice(-12);
    const flagHigh = Math.max(...flagSlice.map((c) => c.high));
    const flagLow = Math.min(...flagSlice.map((c) => c.low));
    const flagRangePct = lastPrice > 0 ? (flagHigh - flagLow) / lastPrice * 100 : 100;
    if (poleReturnPct >= 6 && flagRangePct <= poleReturnPct * 0.65 && lastPrice >= poleEnd * 0.96) {
      patterns.push({
        id: "bull_flag",
        category: "CHART",
        bias: "BULLISH",
        strength: 79,
        nameEn: "Bullish Continuation Flag",
        nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u067E\u0631\u0686\u0645 \u0635\u0639\u0648\u062F\u06CC (Bull Flag)",
        detailEn: `Strong +${poleReturnPct.toFixed(1)}% impulse pole followed by tight ${flagRangePct.toFixed(1)}% consolidation.`,
        detailFa: `\u0645\u0648\u062C \u0635\u0639\u0648\u062F\u06CC \u0642\u062F\u0631\u062A\u0645\u0646\u062F (+${poleReturnPct.toFixed(1)}\u066A) \u0648 \u0627\u0633\u062A\u0631\u0627\u062D\u062A \u0641\u0634\u0631\u062F\u0647 \u062F\u0631 \u06A9\u0627\u0646\u0627\u0644 \u067E\u0631\u0686\u0645.`
      });
    } else if (poleReturnPct <= -6 && flagRangePct <= Math.abs(poleReturnPct) * 0.65 && lastPrice <= poleEnd * 1.04) {
      patterns.push({
        id: "bear_flag",
        category: "CHART",
        bias: "BEARISH",
        strength: 79,
        nameEn: "Bearish Continuation Flag",
        nameFa: "\u0627\u0644\u06AF\u0648\u06CC \u067E\u0631\u0686\u0645 \u0646\u0632\u0648\u0644\u06CC (Bear Flag)",
        detailEn: `Sharp ${poleReturnPct.toFixed(1)}% drop followed by narrow bearish flag consolidation.`,
        detailFa: `\u0631\u06CC\u0632\u0634 \u062A\u0646\u062F (${poleReturnPct.toFixed(1)}\u066A) \u0647\u0645\u0631\u0627\u0647 \u0628\u0627 \u0627\u0635\u0644\u0627\u062D \u06A9\u0645\u200C\u0639\u0645\u0642 \u0645\u0633\u062A\u0639\u062F \u0627\u062F\u0627\u0645\u0647 \u0631\u06CC\u0632\u0634.`
      });
    }
  }
  const uniqueMap = /* @__PURE__ */ new Map();
  for (const p of patterns) {
    const existing = uniqueMap.get(p.id);
    if (!existing || p.strength > existing.strength) {
      uniqueMap.set(p.id, p);
    }
  }
  const uniquePatterns = Array.from(uniqueMap.values()).sort((a, b) => b.strength - a.strength);
  let rawPatternScore = 0;
  for (const p of uniquePatterns) {
    if (p.category === "SMC") continue;
    const sign = p.bias === "BULLISH" ? 1 : p.bias === "BEARISH" ? -1 : 0;
    rawPatternScore += sign * (p.strength * 0.45);
  }
  return {
    patterns: uniquePatterns.slice(0, 8),
    smcZone,
    smcStructure,
    candlestickAndChartScore: clamp(rawPatternScore, -100, 100),
    smcScore: clamp(smcScore, -100, 100)
  };
}

// src/engine/analyzer.ts
function roundPrice(value, refPrice) {
  if (!Number.isFinite(value)) return 0;
  if (refPrice >= 1e3) return Number(value.toFixed(2));
  if (refPrice >= 10) return Number(value.toFixed(3));
  if (refPrice >= 0.1) return Number(value.toFixed(4));
  if (refPrice >= 1e-3) return Number(value.toFixed(6));
  return Number(value.toFixed(8));
}
function evaluateTimeframeRegime(candles, timeframe) {
  if (!candles || candles.length < 20) return null;
  const closes = candles.map((c) => c.close);
  const lastIdx = candles.length - 1;
  const lastPrice = closes[lastIdx];
  const ema9 = calcEMA(closes, 9)[lastIdx] ?? lastPrice;
  const ema21 = calcEMA(closes, 21)[lastIdx] ?? lastPrice;
  const ema50 = calcEMA(closes, Math.min(50, Math.max(21, Math.floor(candles.length * 0.7))))[lastIdx] ?? ema21;
  const ema200 = calcEMA(closes, Math.min(200, Math.max(50, candles.length - 2)))[lastIdx] ?? ema50;
  const superTrend = calcSuperTrend(candles, 10, 3);
  const ichimoku = calcIchimoku(candles);
  const adxInfo = calcADX(candles, 14);
  const rsiArr = calcRSI(closes, 14);
  const rsi14 = rsiArr[lastIdx] ?? 50;
  const macd = calcMACD(closes, 12, 26, 9);
  const macdHistSeries = calcMACDSeries(closes, 12, 26, 9).histogram;
  const smc = analyzeSmcAndChartPatterns(candles, rsiArr, macdHistSeries);
  let score = 0;
  score += ema9 > ema21 ? 10 : -10;
  score += ema21 > ema50 ? 10 : -10;
  score += lastPrice > ema50 ? 5 : -5;
  score += lastPrice > ema200 ? 5 : -5;
  score += superTrend.direction === "BULLISH" ? 24 : -24;
  if (ichimoku.cloudState === "ABOVE_KUMO") score += 16;
  else if (ichimoku.cloudState === "BELOW_KUMO") score -= 16;
  score += ichimoku.tkCross === "BULLISH" ? 6 : -6;
  if (adxInfo.adx >= 19) {
    score += adxInfo.plusDi >= adxInfo.minusDi ? 12 : -12;
  }
  score += macd.histogram >= 0 ? 6 : -6;
  if (rsi14 >= 54) score += 6;
  else if (rsi14 <= 46) score -= 6;
  if (smc.smcStructure === "BULLISH") score += 6;
  else if (smc.smcStructure === "BEARISH") score -= 6;
  score = Math.round(clamp(score, -100, 100));
  const direction = score >= 18 ? "LONG" : score <= -18 ? "SHORT" : "NEUTRAL";
  let structure = smc.smcStructure;
  if (structure === "RANGING") {
    if (score >= 30 && adxInfo.adx >= 18) structure = "BULLISH";
    else if (score <= -30 && adxInfo.adx >= 18) structure = "BEARISH";
  }
  return {
    timeframe,
    direction,
    score,
    superTrend: superTrend.direction,
    ichimoku: ichimoku.cloudState,
    adx14: Number(adxInfo.adx.toFixed(1)),
    rsi14: Number(rsi14.toFixed(1)),
    structure
  };
}
function buildMtfSummary(params) {
  const { timeframe, candles, mtfCandles } = params;
  const candles1h = mtfCandles?.tf1h ?? (timeframe === "1h" ? candles : void 0);
  const candles4h = mtfCandles?.tf4h ?? (timeframe === "4h" ? candles : void 0);
  const candles1d = mtfCandles?.tf1d ?? (timeframe === "1d" ? candles : void 0);
  const tf1h = evaluateTimeframeRegime(candles1h, "1h");
  const tf4h = evaluateTimeframeRegime(candles4h, "4h");
  const tf1d = evaluateTimeframeRegime(candles1d, "1d");
  const snapshots = [
    { snap: tf1d, weight: 0.4 },
    { snap: tf4h, weight: 0.35 },
    { snap: tf1h, weight: 0.25 }
  ].filter((item) => item.snap !== null);
  if (snapshots.length === 0) return null;
  const weightSum = snapshots.reduce((acc, s) => acc + s.weight, 0);
  const alignmentScore = Math.round(
    clamp(
      snapshots.reduce((acc, s) => acc + s.snap.score * (s.weight / weightSum), 0),
      -100,
      100
    )
  );
  const bullCount = snapshots.filter((s) => s.snap.direction === "LONG").length;
  const bearCount = snapshots.filter((s) => s.snap.direction === "SHORT").length;
  const alignedTimeframes = alignmentScore >= 0 ? bullCount : bearCount;
  let alignmentLabel = "CONFLICT";
  if (bullCount === 3 || bullCount >= 2 && bearCount === 0 && alignmentScore >= 46) {
    alignmentLabel = "STRONG_BULL";
  } else if (bearCount === 3 || bearCount >= 2 && bullCount === 0 && alignmentScore <= -46) {
    alignmentLabel = "STRONG_BEAR";
  } else if (alignmentScore >= 18 && bullCount >= bearCount) {
    alignmentLabel = "BULL_CONFLUENCE";
  } else if (alignmentScore <= -18 && bearCount >= bullCount) {
    alignmentLabel = "BEAR_CONFLUENCE";
  }
  return {
    tf1h,
    tf4h,
    tf1d,
    alignmentScore,
    alignmentLabel,
    alignedTimeframes
  };
}
function buildTradePlan(params) {
  const {
    direction,
    lastPrice,
    atr,
    support1,
    resistance1,
    smcZone,
    isExplosivePreMove = false,
    gateReasonEn,
    gateReasonFa
  } = params;
  const safeAtr = atr > 0 ? atr : lastPrice * 0.014;
  if (direction === "LONG") {
    const pullbackAdj = smcZone === "PREMIUM" ? 0.28 : 0.14;
    const entryLow = roundPrice(lastPrice - safeAtr * (pullbackAdj + 0.25), lastPrice);
    const entryHigh = roundPrice(lastPrice + safeAtr * 0.1, lastPrice);
    const optimalEntry = roundPrice(lastPrice - safeAtr * pullbackAdj, lastPrice);
    const structStop = Math.min(
      lastPrice - safeAtr * 1.4,
      Math.max(support1 * 0.994, lastPrice - safeAtr * 2.45)
    );
    const stopLoss = roundPrice(Math.min(structStop, optimalEntry - safeAtr * 1.25), lastPrice);
    const risk = Math.max(optimalEntry - stopLoss, lastPrice * 4e-3);
    const tp3Mult = isExplosivePreMove ? 4.8 : 3.8;
    const tp1 = roundPrice(optimalEntry + risk * 1.5, lastPrice);
    const tp2 = roundPrice(optimalEntry + risk * (isExplosivePreMove ? 2.8 : 2.5), lastPrice);
    const tp3 = roundPrice(
      Math.max(optimalEntry + risk * tp3Mult, resistance1 * (isExplosivePreMove ? 1.035 : 1.015)),
      lastPrice
    );
    const slDistancePct = Number(((optimalEntry - stopLoss) / optimalEntry * 100).toFixed(2));
    const suggestedMaxLeverage = clamp(Math.floor(36 / Math.max(slDistancePct, 1)), 2, 15);
    return {
      action: "LONG",
      entryZoneLow: entryLow,
      entryZoneHigh: entryHigh,
      optimalEntry,
      stopLoss,
      slDistancePct,
      tp1,
      tp2,
      tp3,
      riskReward1: 1.5,
      riskReward2: isExplosivePreMove ? 2.8 : 2.5,
      riskReward3: Number(((tp3 - optimalEntry) / risk).toFixed(2)),
      suggestedMaxLeverage,
      invalidationEn: `HTF/Primary candle close below $${stopLoss} invalidates the bullish setup.`,
      invalidationFa: `\u062A\u062B\u0628\u06CC\u062A \u06A9\u0646\u062F\u0644 \u0632\u06CC\u0631 $${stopLoss} \u0633\u0646\u0627\u0631\u06CC\u0648\u06CC \u0635\u0639\u0648\u062F\u06CC \u0648 \u0633\u0627\u062E\u062A\u0627\u0631 \u062A\u0642\u0627\u0636\u0627 \u0631\u0627 \u0628\u0627\u0637\u0644 \u0645\u06CC\u200C\u06A9\u0646\u062F.`
    };
  }
  if (direction === "SHORT") {
    const pullbackAdj = smcZone === "DISCOUNT" ? 0.28 : 0.14;
    const entryLow = roundPrice(lastPrice - safeAtr * 0.1, lastPrice);
    const entryHigh = roundPrice(lastPrice + safeAtr * (pullbackAdj + 0.25), lastPrice);
    const optimalEntry = roundPrice(lastPrice + safeAtr * pullbackAdj, lastPrice);
    const structStop = Math.max(
      lastPrice + safeAtr * 1.4,
      Math.min(resistance1 * 1.006, lastPrice + safeAtr * 2.45)
    );
    const stopLoss = roundPrice(Math.max(structStop, optimalEntry + safeAtr * 1.25), lastPrice);
    const risk = Math.max(stopLoss - optimalEntry, lastPrice * 4e-3);
    const tp3Mult = isExplosivePreMove ? 4.8 : 3.8;
    const tp1 = roundPrice(optimalEntry - risk * 1.5, lastPrice);
    const tp2 = roundPrice(optimalEntry - risk * (isExplosivePreMove ? 2.8 : 2.5), lastPrice);
    const tp3 = roundPrice(
      Math.max(
        optimalEntry * 0.2,
        Math.min(optimalEntry - risk * tp3Mult, support1 * (isExplosivePreMove ? 0.965 : 0.985))
      ),
      lastPrice
    );
    const slDistancePct = Number(((stopLoss - optimalEntry) / optimalEntry * 100).toFixed(2));
    const suggestedMaxLeverage = clamp(Math.floor(36 / Math.max(slDistancePct, 1)), 2, 15);
    return {
      action: "SHORT",
      entryZoneLow: entryLow,
      entryZoneHigh: entryHigh,
      optimalEntry,
      stopLoss,
      slDistancePct,
      tp1,
      tp2,
      tp3,
      riskReward1: 1.5,
      riskReward2: isExplosivePreMove ? 2.8 : 2.5,
      riskReward3: Number(((optimalEntry - tp3) / risk).toFixed(2)),
      suggestedMaxLeverage,
      invalidationEn: `Candle close above $${stopLoss} invalidates the bearish distribution breakdown.`,
      invalidationFa: `\u062A\u062B\u0628\u06CC\u062A \u06A9\u0646\u062F\u0644 \u0628\u0627\u0644\u0627\u06CC $${stopLoss} \u0633\u0646\u0627\u0631\u06CC\u0648\u06CC \u0646\u0632\u0648\u0644\u06CC \u0648 \u0634\u06A9\u0633\u062A \u0639\u0631\u0636\u0647 \u0631\u0627 \u0628\u0627\u0637\u0644 \u0645\u06CC\u200C\u06A9\u0646\u062F.`
    };
  }
  return {
    action: "WAIT",
    entryZoneLow: roundPrice(support1, lastPrice),
    entryZoneHigh: roundPrice(resistance1, lastPrice),
    optimalEntry: roundPrice(lastPrice, lastPrice),
    stopLoss: roundPrice(lastPrice - safeAtr * 1.5, lastPrice),
    slDistancePct: Number((safeAtr * 1.5 / Math.max(lastPrice, 1e-8) * 100).toFixed(2)),
    tp1: roundPrice(resistance1, lastPrice),
    tp2: roundPrice(resistance1 + safeAtr * 1.5, lastPrice),
    tp3: roundPrice(resistance1 + safeAtr * 3, lastPrice),
    riskReward1: 1,
    riskReward2: 2.2,
    riskReward3: 3.2,
    suggestedMaxLeverage: 3,
    invalidationEn: gateReasonEn || "Waiting for 1H/4H/1D timeframe alignment and volume breakout confirmation.",
    invalidationFa: gateReasonFa || "\u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631 \u0647\u0645\u200C\u06AF\u0631\u0627\u06CC\u06CC \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645\u200C\u0647\u0627\u06CC 1H/4H/1D \u0648 \u062A\u0627\u06CC\u06CC\u062F \u062D\u062C\u0645 \u0634\u06A9\u0633\u062A."
  };
}
function runQuickBacktest(candles) {
  if (candles.length < 70) {
    return { tradesCount: 0, winRatePct: 0, avgRr: 0, netReturnPct: 0, trades: [] };
  }
  const closes = candles.map((c) => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes, 14);
  let wins = 0;
  let losses = 0;
  let netReturnPct = 0;
  let totalRr = 0;
  const trades = [];
  let i = 52;
  while (i < candles.length - 12) {
    const e9 = ema9[i];
    const e21 = ema21[i];
    const e50 = ema50[i];
    const prevE9 = ema9[i - 1];
    const prevE21 = ema21[i - 1];
    const r = rsi[i];
    const curr = candles[i];
    if (e9 === null || e21 === null || e50 === null || prevE9 === null || prevE21 === null || r === null) {
      i++;
      continue;
    }
    const totalVol = curr.quoteVolume > 0 ? curr.quoteVolume : curr.volume * curr.close;
    const buyRatio = totalVol > 0 && curr.takerBuyQuoteVol > 0 ? curr.takerBuyQuoteVol / totalVol : 0.5;
    const cmfLocal = calcCMF(candles.slice(Math.max(0, i - 19), i + 1), 20);
    let side = null;
    if (prevE9 <= prevE21 && e9 > e21 && curr.close > e50 && r < 68 && cmfLocal >= -0.05 || r < 34 && buyRatio > 0.55 && cmfLocal > 0) {
      side = "LONG";
    } else if (prevE9 >= prevE21 && e9 < e21 && curr.close < e50 && r > 32 && cmfLocal <= 0.05 || r > 68 && buyRatio < 0.45 && cmfLocal < 0) {
      side = "SHORT";
    }
    if (!side) {
      i++;
      continue;
    }
    const localSlice = candles.slice(i - 15, i + 1);
    const atr = calcATR(localSlice, 14) || curr.close * 0.012;
    const entry = curr.close;
    const slDist = atr * 1.4;
    const tpDist = slDist * 2.2;
    const sl = side === "LONG" ? entry - slDist : entry + slDist;
    const tp = side === "LONG" ? entry + tpDist : entry - tpDist;
    let outcome = "SCRATCH";
    let exitBar = Math.min(i + 12, candles.length - 1);
    let exitPrice = candles[exitBar].close;
    for (let j = i + 1; j <= Math.min(i + 16, candles.length - 1); j++) {
      const bar = candles[j];
      if (side === "LONG") {
        if (bar.low <= sl) {
          outcome = "LOSS";
          exitBar = j;
          exitPrice = sl;
          break;
        }
        if (bar.high >= tp) {
          outcome = "WIN";
          exitBar = j;
          exitPrice = tp;
          break;
        }
      } else {
        if (bar.high >= sl) {
          outcome = "LOSS";
          exitBar = j;
          exitPrice = sl;
          break;
        }
        if (bar.low <= tp) {
          outcome = "WIN";
          exitBar = j;
          exitPrice = tp;
          break;
        }
      }
    }
    let tradePnlPct = 0;
    let tradeRr = 0;
    if (outcome === "WIN") {
      wins++;
      tradePnlPct = tpDist / entry * 100;
      tradeRr = 2.2;
    } else if (outcome === "LOSS") {
      losses++;
      tradePnlPct = -(slDist / entry) * 100;
      tradeRr = -1;
    } else {
      const pct = side === "LONG" ? (exitPrice - entry) / entry * 100 : (entry - exitPrice) / entry * 100;
      if (pct > 0) wins++;
      else losses++;
      tradePnlPct = pct;
      tradeRr = pct > 0 ? 0.6 : -0.5;
    }
    netReturnPct += tradePnlPct;
    totalRr += tradeRr;
    trades.push({
      id: `bt-${i}-${side}`,
      direction: side,
      entryTime: curr.time,
      exitTime: candles[exitBar].time,
      entryPrice: roundPrice(entry, entry),
      exitPrice: roundPrice(exitPrice, entry),
      stopLoss: roundPrice(sl, entry),
      takeProfit: roundPrice(tp, entry),
      outcome: tradePnlPct > 0 ? "WIN" : "LOSS",
      rMultiple: Number(tradeRr.toFixed(2)),
      pnlPct: Number(tradePnlPct.toFixed(2))
    });
    i = exitBar + 1;
  }
  const tradesCount = wins + losses;
  return {
    tradesCount,
    winRatePct: tradesCount > 0 ? Math.round(wins / tradesCount * 100) : 0,
    avgRr: tradesCount > 0 ? Number((totalRr / tradesCount).toFixed(2)) : 0,
    netReturnPct: Number(netReturnPct.toFixed(2)),
    trades: trades.slice(-24)
  };
}
function formatMtfSnapshotLabel(snap, lang) {
  if (!snap) return "N/A";
  const dir = snap.direction === "LONG" ? lang === "fa" ? "\u0635\u0639\u0648\u062F\u06CC" : "BULL" : snap.direction === "SHORT" ? lang === "fa" ? "\u0646\u0632\u0648\u0644\u06CC" : "BEAR" : lang === "fa" ? "\u062E\u0646\u062B\u06CC" : "FLAT";
  return `${snap.timeframe.toUpperCase()}: ${dir} (${snap.score > 0 ? `+${snap.score}` : snap.score}, ST=${snap.superTrend === "BULLISH" ? "Bull" : "Bear"})`;
}
function buildComprehensiveConclusion(params) {
  const {
    timeframe,
    lastPrice,
    direction,
    phase,
    confidence,
    pumpProbability,
    dumpProbability,
    sharpMoveScore,
    sharpMoveBias,
    suspiciousScore,
    volumeRatio20,
    volumeZScore,
    takerBuyRatio,
    cvdTrend,
    cvdDivergence,
    obvBreakout,
    isSqueeze,
    ttmSqueeze,
    squeezeBars,
    atrExpansionRatio,
    isVcpTightening,
    isAbsorption,
    donchianPos,
    bbWidthPercentile,
    rsi14,
    stochK,
    stochD,
    macdHist,
    ema9,
    ema21,
    ema50,
    ema200,
    vwap,
    adx14,
    plusDi,
    minusDi,
    superTrendDir,
    ichimokuState,
    cmf20,
    mfi14,
    smcZone,
    smcStructure,
    patterns,
    mtf,
    gateReasonEn,
    gateReasonFa,
    fundingRate,
    oiDeltaPct,
    orderBook,
    wickSignal,
    support1,
    resistance1,
    tradePlan
  } = params;
  const mtfLineEn = mtf ? `1. MTF Regime (1H/4H/1D): Overall ${mtf.alignmentLabel.replace("_", " ")} (Score ${mtf.alignmentScore > 0 ? `+${mtf.alignmentScore}` : mtf.alignmentScore}, ${mtf.alignedTimeframes}/3 aligned) \u2014 [${formatMtfSnapshotLabel(mtf.tf1h, "en")} | ${formatMtfSnapshotLabel(mtf.tf4h, "en")} | ${formatMtfSnapshotLabel(mtf.tf1d, "en")}].` : `1. Structural Regime (${timeframe.toUpperCase()}): Single-timeframe evaluation (EMA200 $${roundPrice(ema200, lastPrice)}, SMC ${smcStructure}).`;
  const mtfLineFa = mtf ? `\u06F1. \u0647\u0645\u200C\u06AF\u0631\u0627\u06CC\u06CC \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645\u200C\u0647\u0627 (1H / 4H / 1D): \u0648\u0636\u0639\u06CC\u062A \u06A9\u0644\u06CC ${mtf.alignmentLabel === "STRONG_BULL" ? "\u0631\u0648\u0646\u062F \u0635\u0639\u0648\u062F\u06CC \u0642\u062F\u0631\u062A\u0645\u0646\u062F" : mtf.alignmentLabel === "BULL_CONFLUENCE" ? "\u0647\u0645\u200C\u0633\u0648\u06CC\u06CC \u0635\u0639\u0648\u062F\u06CC" : mtf.alignmentLabel === "STRONG_BEAR" ? "\u0631\u0648\u0646\u062F \u0646\u0632\u0648\u0644\u06CC \u0642\u062F\u0631\u062A\u0645\u0646\u062F" : mtf.alignmentLabel === "BEAR_CONFLUENCE" ? "\u0647\u0645\u200C\u0633\u0648\u06CC\u06CC \u0646\u0632\u0648\u0644\u06CC" : "\u062A\u0636\u0627\u062F \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645\u200C\u0647\u0627"} (\u0627\u0645\u062A\u06CC\u0627\u0632 ${mtf.alignmentScore > 0 ? `+${mtf.alignmentScore}` : mtf.alignmentScore}\u060C \u0647\u0645\u200C\u06AF\u0631\u0627\u06CC\u06CC ${mtf.alignedTimeframes}/3) \u2014 [${formatMtfSnapshotLabel(mtf.tf1h, "fa")} | ${formatMtfSnapshotLabel(mtf.tf4h, "fa")} | ${formatMtfSnapshotLabel(mtf.tf1d, "fa")}].` : `\u06F1. \u0633\u0627\u062E\u062A\u0627\u0631 \u06A9\u0644\u0627\u0646 (${timeframe.toUpperCase()}): \u062A\u062D\u0644\u06CC\u0644 \u062A\u06A9\u200C\u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645 \u0628\u0627 \u0645\u0631\u062C\u0639 EMA200 ($${roundPrice(ema200, lastPrice)}) \u0648 \u0633\u0627\u062E\u062A\u0627\u0631 ${smcStructure}.`;
  const patEn = patterns.length > 0 ? patterns.slice(0, 4).map((p) => `${p.nameEn} (${p.bias})`).join(", ") : "No extreme reversal/continuation chart pattern active yet";
  const patFa = patterns.length > 0 ? patterns.slice(0, 4).map((p) => p.nameFa).join("\u060C ") : "\u0627\u0644\u06AF\u0648\u06CC \u06A9\u0644\u0627\u0633\u06CC\u06A9 \u06CC\u0627 \u06A9\u0646\u062F\u0644\u06CC \u0628\u0627\u0632\u06AF\u0634\u062A\u06CC \u0642\u0637\u0639\u06CC \u062F\u0631 \u0627\u06CC\u0646 \u06A9\u0646\u062F\u0644 \u062B\u0628\u062A \u0646\u0634\u062F\u0647";
  const smcZoneEn = smcZone === "DISCOUNT" ? "Discount (institutional demand zone)" : smcZone === "PREMIUM" ? "Premium (institutional supply zone)" : "Equilibrium mid-range";
  const smcZoneFa = smcZone === "DISCOUNT" ? "\u0646\u0627\u062D\u06CC\u0647 \u0627\u0631\u0632\u0627\u0646\u200C\u0641\u0631\u0648\u0634\u06CC/\u062A\u0642\u0627\u0636\u0627 (Discount)" : smcZone === "PREMIUM" ? "\u0646\u0627\u062D\u06CC\u0647 \u06AF\u0631\u0627\u0646\u200C\u0641\u0631\u0648\u0634\u06CC/\u0639\u0631\u0636\u0647 (Premium)" : "\u0645\u062D\u062F\u0648\u062F\u0647 \u062A\u0639\u0627\u062F\u0644 (Equilibrium)";
  const sharpBiasEn = sharpMoveBias === "PUMP_20_PLUS" ? "+20% Pre-Pump Bias" : sharpMoveBias === "DUMP_20_PLUS" ? "-20% Pre-Dump Bias" : "Neutral Expansion";
  const sharpBiasFa = sharpMoveBias === "PUMP_20_PLUS" ? "\u0645\u0633\u062A\u0639\u062F \u067E\u0627\u0645\u067E \u0634\u0627\u0631\u067E (+\u06F2\u06F0\u066A)" : sharpMoveBias === "DUMP_20_PLUS" ? "\u0645\u0633\u062A\u0639\u062F \u062F\u0627\u0645\u067E \u0634\u0627\u0631\u067E (-\u06F2\u06F0\u066A)" : "\u0628\u062F\u0648\u0646 \u0633\u0648\u06AF\u06CC\u0631\u06CC \u0627\u0646\u0641\u062C\u0627\u0631\u06CC \u0642\u0637\u0639\u06CC";
  const ttmStatusEn = ttmSqueeze ? `TTM Squeeze ACTIVE (${squeezeBars} bars inside Keltner)` : isSqueeze ? `BB Squeeze P${bbWidthPercentile}` : `BB P${bbWidthPercentile}`;
  const ttmStatusFa = ttmSqueeze ? `\u0641\u0634\u0631\u062F\u06AF\u06CC TTM \u0641\u0639\u0627\u0644 (${squeezeBars} \u06A9\u0646\u062F\u0644 \u062F\u0627\u062E\u0644 \u06A9\u0627\u0646\u0627\u0644 \u06A9\u0644\u062A\u0646\u0631)` : isSqueeze ? `\u0641\u0634\u0631\u062F\u06AF\u06CC \u0628\u0648\u0644\u06CC\u0646\u06AF\u0631 (\u0635\u062F\u06A9 ${bbWidthPercentile})` : `\u067E\u0647\u0646\u0627\u06CC \u0628\u0627\u0646\u062F \u062F\u0631 \u0635\u062F\u06A9 ${bbWidthPercentile}`;
  const patternsLineEn = `2. Sharp-Move Coil (\u226520% Readiness: ${sharpMoveScore}/100 \xB7 ${sharpBiasEn}) & SMC: ${ttmStatusEn}, ATR compression ${atrExpansionRatio}x${isVcpTightening ? " (VCP tightening)" : ""}, Donchian pos ${donchianPos}%. Price sits in ${smcZoneEn} (${smcStructure}). Patterns: ${patEn}.`;
  const patternsLineFa = `\u06F2. \u0622\u0645\u0627\u062F\u06AF\u06CC \u062D\u0631\u06A9\u062A \u0634\u0627\u0631\u067E (+\u06F2\u06F0\u066A: \u0627\u0645\u062A\u06CC\u0627\u0632 ${sharpMoveScore}/100 \xB7 ${sharpBiasFa}) \u0648 \u0627\u0644\u06AF\u0648\u0647\u0627: ${ttmStatusFa}\u060C \u0646\u0633\u0628\u062A \u0641\u0634\u0631\u062F\u06AF\u06CC \u0646\u0648\u0633\u0627\u0646 ${atrExpansionRatio}x${isVcpTightening ? " (\u062A\u0631\u0627\u06A9\u0645 VCP \u0641\u0639\u0627\u0644)" : ""}\u060C \u0645\u0648\u0642\u0639\u06CC\u062A \u062F\u0627\u0646\u0686\u06CC\u0646 ${donchianPos}\u066A. \u0642\u06CC\u0645\u062A \u062F\u0631 ${smcZoneFa} \u0628\u0627 \u0633\u0627\u062E\u062A\u0627\u0631 ${smcStructure === "BULLISH" ? "\u0635\u0639\u0648\u062F\u06CC" : smcStructure === "BEARISH" ? "\u0646\u0632\u0648\u0644\u06CC" : "\u0631\u0646\u062C"} \u0627\u0633\u062A. \u0627\u0644\u06AF\u0648\u0647\u0627: ${patFa}.`;
  const ichiEn = ichimokuState === "ABOVE_KUMO" ? "above Ichimoku Kumo" : ichimokuState === "BELOW_KUMO" ? "below Ichimoku Kumo" : "inside Ichimoku Kumo";
  const ichiFa = ichimokuState === "ABOVE_KUMO" ? "\u0628\u0627\u0644\u0627\u06CC \u0627\u0628\u0631 \u06A9\u0648\u0645\u0648 \u0627\u06CC\u0686\u06CC\u0645\u0648\u06A9\u0648" : ichimokuState === "BELOW_KUMO" ? "\u0632\u06CC\u0631 \u0627\u0628\u0631 \u06A9\u0648\u0645\u0648 \u0627\u06CC\u0686\u06CC\u0645\u0648\u06A9\u0648" : "\u062F\u0631\u0648\u0646 \u0627\u0628\u0631 \u06A9\u0648\u0645\u0648 (\u0646\u0627\u062D\u06CC\u0647 \u062A\u0631\u062F\u06CC\u062F)";
  const emaStateEn = ema9 > ema21 && ema21 > ema50 ? "bullish EMA 9/21/50 stack" : ema9 < ema21 && ema21 < ema50 ? "bearish EMA 9/21/50 stack" : "mixed EMA transition";
  const emaStateFa = ema9 > ema21 && ema21 > ema50 ? "\u0622\u0631\u0627\u06CC\u0634 \u0635\u0639\u0648\u062F\u06CC EMA 9/21/50" : ema9 < ema21 && ema21 < ema50 ? "\u0622\u0631\u0627\u06CC\u0634 \u0646\u0632\u0648\u0644\u06CC EMA 9/21/50" : "\u0641\u0627\u0632 \u0627\u0646\u062A\u0642\u0627\u0644\u06CC \u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646\u200C\u0647\u0627\u06CC EMA";
  const adxStateEn = adx14 >= 22 ? `trending ADX ${adx14.toFixed(1)} (${plusDi >= minusDi ? "DI+" : "DI-"} leading)` : `coiling/low-ADX (${adx14.toFixed(1)})`;
  const adxStateFa = adx14 >= 22 ? `\u0631\u0648\u0646\u062F \u0641\u0639\u0627\u0644 ADX=${adx14.toFixed(1)} (\u0628\u0631\u062A\u0631\u06CC ${plusDi >= minusDi ? "DI+" : "DI-"})` : `\u0641\u0627\u0632 \u062A\u0631\u0627\u06A9\u0645/\u06A9\u0645\u200C\u0631\u0645\u0642 (ADX=${adx14.toFixed(1)})`;
  const indicatorsLineEn = `3. Core Indicators: SuperTrend(10,3) is ${superTrendDir}, price sits ${ichiEn} & ${lastPrice >= vwap ? "above" : "below"} VWAP inside a ${emaStateEn} (${adxStateEn}). RSI(14)=${rsi14.toFixed(1)}, Stoch=${stochK.toFixed(0)}/${stochD.toFixed(0)}, MACD hist ${macdHist >= 0 ? "positive" : "negative"}, CMF(20)=${cmf20.toFixed(2)}, MFI(14)=${mfi14.toFixed(0)}.`;
  const indicatorsLineFa = `\u06F3. \u0627\u0646\u062F\u06CC\u06A9\u0627\u062A\u0648\u0631\u0647\u0627\u06CC \u062A\u062E\u0635\u0635\u06CC: \u0633\u0648\u067E\u0631\u062A\u0631\u0646\u062F (SuperTrend 10,3) \u062F\u0631 \u0648\u0636\u0639\u06CC\u062A ${superTrendDir === "BULLISH" ? "\u0635\u0639\u0648\u062F\u06CC" : "\u0646\u0632\u0648\u0644\u06CC"}\u060C \u0642\u06CC\u0645\u062A ${ichiFa} \u0648 ${lastPrice >= vwap ? "\u0628\u0627\u0644\u0627\u06CC" : "\u0632\u06CC\u0631"} VWAP \u062F\u0631 ${emaStateFa} \u0628\u0627 ${adxStateFa} \u0642\u0631\u0627\u0631 \u062F\u0627\u0631\u062F. \u0634\u0627\u062E\u0635\u200C\u0647\u0627\u06CC RSI=${rsi14.toFixed(1)}\u060C \u0627\u0633\u062A\u0648\u06A9\u0633\u062A\u06CC\u06A9 ${stochK.toFixed(0)}/${stochD.toFixed(0)}\u060C \u0645\u06A9\u062F\u06CC ${macdHist >= 0 ? "\u0645\u062B\u0628\u062A" : "\u0645\u0646\u0641\u06CC"}\u060C \u062C\u0631\u06CC\u0627\u0646 \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC CMF=${cmf20.toFixed(2)} \u0648 MFI=${mfi14.toFixed(0)} \u0627\u0633\u062A.`;
  const takerBuyPct = Math.round(takerBuyRatio * 100);
  const cvdEn = cvdTrend === "ACCUMULATION" ? `buyer accumulation (${takerBuyPct}% taker buys)` : cvdTrend === "DISTRIBUTION" ? `seller distribution (${100 - takerBuyPct}% taker sells)` : `balanced orderflow (${takerBuyPct}% buys)`;
  const cvdFa = cvdTrend === "ACCUMULATION" ? `\u0627\u0646\u0628\u0627\u0634\u062A \u062A\u0647\u0627\u062C\u0645\u06CC \u062E\u0631\u06CC\u062F\u0627\u0631\u0627\u0646 (${takerBuyPct}\u066A \u062E\u0631\u06CC\u062F \u0645\u0627\u0631\u06A9\u062A)` : cvdTrend === "DISTRIBUTION" ? `\u062A\u0648\u0632\u06CC\u0639 \u0648 \u0641\u0634\u0627\u0631 \u0641\u0631\u0648\u0634 \u062A\u0647\u0627\u062C\u0645\u06CC (${100 - takerBuyPct}\u066A \u0641\u0631\u0648\u0634 \u0645\u0627\u0631\u06A9\u062A)` : `\u062A\u0639\u0627\u062F\u0644 \u062C\u0631\u06CC\u0627\u0646 \u0633\u0641\u0627\u0631\u0634\u0627\u062A (${takerBuyPct}\u066A \u062E\u0631\u06CC\u062F \u0645\u0627\u0631\u06A9\u062A)`;
  const divTagsEn = [
    cvdDivergence !== "NONE" ? `CVD ${cvdDivergence} Divergence` : null,
    obvBreakout !== "NONE" ? `Leading OBV ${obvBreakout} Breakout` : null,
    isAbsorption ? "Wyckoff Volume Absorption" : null
  ].filter(Boolean).join(", ");
  const divTagsFa = [
    cvdDivergence === "BULLISH" ? "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u067E\u0646\u0647\u0627\u0646 \u0627\u0646\u0628\u0627\u0634\u062A CVD" : cvdDivergence === "BEARISH" ? "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u067E\u0646\u0647\u0627\u0646 \u062A\u0648\u0632\u06CC\u0639 CVD" : null,
    obvBreakout === "BULLISH" ? "\u0634\u06A9\u0633\u062A \u067E\u06CC\u0634\u200C\u062F\u0633\u062A\u0627\u0646\u0647 OBV \u0635\u0639\u0648\u062F\u06CC" : obvBreakout === "BEARISH" ? "\u0634\u06A9\u0633\u062A \u067E\u06CC\u0634\u200C\u062F\u0633\u062A\u0627\u0646\u0647 OBV \u0646\u0632\u0648\u0644\u06CC" : null,
    isAbsorption ? "\u062C\u0630\u0628 \u067E\u0646\u0647\u0627\u0646 \u062D\u062C\u0645 (Wyckoff Absorption)" : null
  ].filter(Boolean).join(" \xB7 ");
  const obEn = orderBook ? `Orderbook bid/ask ratio ${orderBook.imbalanceRatio.toFixed(2)}x.` : "Live depth snapshot pending.";
  const obFa = orderBook ? `\u0646\u0633\u0628\u062A \u062E\u0631\u06CC\u062F \u0628\u0647 \u0641\u0631\u0648\u0634 \u062F\u0641\u062A\u0631 \u0633\u0641\u0627\u0631\u0634\u0627\u062A ${orderBook.imbalanceRatio.toFixed(2)}x.` : "\u062F\u0627\u062F\u0647 \u0639\u0645\u0642 \u0644\u062D\u0638\u0647\u200C\u0627\u06CC \u0628\u062F\u0648\u0646 \u062F\u06CC\u0648\u0627\u0631 \u062E\u0627\u0635.";
  const fundingPct = (fundingRate * 100).toFixed(4);
  const flowLineEn = `4. Orderflow, Absorption & Squeeze Fuel: Suspicious Volume=${suspiciousScore}/100 (${volumeRatio20}x avg, Z=${volumeZScore}) with ${cvdEn}${divTagsEn ? ` [${divTagsEn}]` : ""}. Funding=${fundingPct}%, OI delta=${oiDeltaPct >= 0 ? "+" : ""}${oiDeltaPct.toFixed(2)}%. ${obEn} Wick=${wickSignal}. S1=$${support1} / R1=$${resistance1}.`;
  const flowLineFa = `\u06F4. \u062C\u0631\u06CC\u0627\u0646 \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC\u060C \u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC CVD \u0648 \u0645\u0634\u062A\u0642\u0627\u062A: \u0627\u0645\u062A\u06CC\u0627\u0632 \u062D\u062C\u0645 \u0645\u0634\u06A9\u0648\u06A9 ${suspiciousScore}/100 (${volumeRatio20} \u0628\u0631\u0627\u0628\u0631 \u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646\u060C Z=${volumeZScore}) \u0647\u0645\u0631\u0627\u0647 \u0628\u0627 ${cvdFa}${divTagsFa ? ` [${divTagsFa}]` : ""}. \u0641\u0627\u0646\u062F\u06CC\u0646\u06AF \u0631\u06CC\u062A ${fundingPct}\u066A \u0648 \u062A\u063A\u06CC\u06CC\u0631 \u0633\u0648\u062F \u0628\u0627\u0632 (OI) \u0628\u0631\u0627\u0628\u0631 ${oiDeltaPct >= 0 ? "+" : ""}${oiDeltaPct.toFixed(2)}\u066A \u0627\u0633\u062A. ${obFa} \u062D\u0645\u0627\u06CC\u062A \u06A9\u0644\u06CC\u062F\u06CC $${support1} \u0648 \u0645\u0642\u0627\u0648\u0645\u062A $${resistance1} \u0627\u0633\u062A.`;
  const verdictEn = direction === "LONG" ? `5. Final Verdict: Confirmed LONG (${confidence}% confidence \xB7 Phase: ${phase} \xB7 Pre-Pump \u226520% ${pumpProbability}% vs Dump ${dumpProbability}%). Optimal Entry ~$${tradePlan.optimalEntry}, Stop Loss $${tradePlan.stopLoss} (-${tradePlan.slDistancePct}%), Targets $${tradePlan.tp1} / $${tradePlan.tp2} / $${tradePlan.tp3} (max ${tradePlan.suggestedMaxLeverage}x).` : direction === "SHORT" ? `5. Final Verdict: Confirmed SHORT (${confidence}% confidence \xB7 Phase: ${phase} \xB7 Pre-Dump \u226520% ${dumpProbability}% vs Pump ${pumpProbability}%). Optimal Entry ~$${tradePlan.optimalEntry}, Stop Loss $${tradePlan.stopLoss} (-${tradePlan.slDistancePct}%), Targets $${tradePlan.tp1} / $${tradePlan.tp2} / $${tradePlan.tp3} (max ${tradePlan.suggestedMaxLeverage}x).` : `5. Final Verdict: NEUTRAL / WAIT (${confidence}% score \xB7 Sharp-Move Readiness ${sharpMoveScore}/100 \xB7 Pump ${pumpProbability}% vs Dump ${dumpProbability}%). ${gateReasonEn ? `Filter Gate: ${gateReasonEn}. ` : ""}Wait for confirmed 1H/4H alignment and RVOL breakout past resistance $${resistance1} or support $${support1}.`;
  const verdictFa = direction === "LONG" ? `\u06F5. \u062C\u0645\u0639\u200C\u0628\u0646\u062F\u06CC \u0646\u0647\u0627\u06CC\u06CC \u0648 \u067E\u0644\u0646 \u0645\u0639\u0627\u0645\u0644\u0647: \u062A\u0627\u06CC\u06CC\u062F \u0633\u06CC\u06AF\u0646\u0627\u0644 \u0644\u0627\u0646\u06AF (\u062E\u0631\u06CC\u062F) \u0628\u0627 \u0627\u0637\u0645\u06CC\u0646\u0627\u0646 ${confidence}\u066A \u062F\u0631 \u0641\u0627\u0632 ${phase} (\u0627\u062D\u062A\u0645\u0627\u0644 \u067E\u0627\u0645\u067E \u0634\u0627\u0631\u067E ${pumpProbability}\u066A \u062F\u0631 \u0628\u0631\u0627\u0628\u0631 \u062F\u0627\u0645\u067E ${dumpProbability}\u066A). \u0648\u0631\u0648\u062F \u0628\u0647\u06CC\u0646\u0647 $${tradePlan.optimalEntry}\u060C \u062D\u062F \u0636\u0631\u0631 $${tradePlan.stopLoss} (-${tradePlan.slDistancePct}\u066A) \u0648 \u062A\u0627\u0631\u06AF\u062A\u200C\u0647\u0627\u06CC $${tradePlan.tp1}\u060C $${tradePlan.tp2} \u0648 $${tradePlan.tp3} \u0628\u0627 \u062D\u062F\u0627\u06A9\u062B\u0631 \u0627\u0647\u0631\u0645 ${tradePlan.suggestedMaxLeverage}x.` : direction === "SHORT" ? `\u06F5. \u062C\u0645\u0639\u200C\u0628\u0646\u062F\u06CC \u0646\u0647\u0627\u06CC\u06CC \u0648 \u067E\u0644\u0646 \u0645\u0639\u0627\u0645\u0644\u0647: \u062A\u0627\u06CC\u06CC\u062F \u0633\u06CC\u06AF\u0646\u0627\u0644 \u0634\u0648\u0631\u062A (\u0641\u0631\u0648\u0634) \u0628\u0627 \u0627\u0637\u0645\u06CC\u0646\u0627\u0646 ${confidence}\u066A \u062F\u0631 \u0641\u0627\u0632 ${phase} (\u0627\u062D\u062A\u0645\u0627\u0644 \u062F\u0627\u0645\u067E \u0634\u0627\u0631\u067E ${dumpProbability}\u066A \u062F\u0631 \u0628\u0631\u0627\u0628\u0631 \u067E\u0627\u0645\u067E ${pumpProbability}\u066A). \u0648\u0631\u0648\u062F \u0628\u0647\u06CC\u0646\u0647 $${tradePlan.optimalEntry}\u060C \u062D\u062F \u0636\u0631\u0631 $${tradePlan.stopLoss} (-${tradePlan.slDistancePct}\u066A) \u0648 \u062A\u0627\u0631\u06AF\u062A\u200C\u0647\u0627\u06CC $${tradePlan.tp1}\u060C $${tradePlan.tp2} \u0648 $${tradePlan.tp3} \u0628\u0627 \u062D\u062F\u0627\u06A9\u062B\u0631 \u0627\u0647\u0631\u0645 ${tradePlan.suggestedMaxLeverage}x.` : `\u06F5. \u062C\u0645\u0639\u200C\u0628\u0646\u062F\u06CC \u0646\u0647\u0627\u06CC\u06CC \u0648 \u067E\u0644\u0646 \u0645\u0639\u0627\u0645\u0644\u0647: \u0648\u0636\u0639\u06CC\u062A \u062E\u0646\u062B\u06CC / \u0627\u0646\u062A\u0638\u0627\u0631 (\u0627\u0645\u062A\u06CC\u0627\u0632 \u062D\u0631\u06A9\u062A \u0634\u0627\u0631\u067E ${sharpMoveScore}/100 \xB7 \u0627\u062D\u062A\u0645\u0627\u0644 \u067E\u0627\u0645\u067E ${pumpProbability}\u066A \u062F\u0631 \u0628\u0631\u0627\u0628\u0631 \u062F\u0627\u0645\u067E ${dumpProbability}\u066A). ${gateReasonFa ? `\u0641\u06CC\u0644\u062A\u0631 \u0636\u062F\u062E\u0637\u0627: ${gateReasonFa}. ` : ""}\u062A\u0627 \u0632\u0645\u0627\u0646 \u0647\u0645\u200C\u06AF\u0631\u0627\u06CC\u06CC \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645\u200C\u0647\u0627\u06CC \u06F1 \u0648 \u06F4 \u0633\u0627\u0639\u062A\u0647 \u06CC\u0627 \u0634\u06A9\u0633\u062A \u0645\u0639\u062A\u0628\u0631 \u0645\u0642\u0627\u0648\u0645\u062A $${resistance1} / \u062D\u0645\u0627\u06CC\u062A $${support1} \u0628\u0627 \u062C\u0647\u0634 \u062D\u062C\u0645 \u0648\u0627\u0631\u062F \u0646\u0634\u0648\u06CC\u062F.`;
  return {
    conclusionEn: [mtfLineEn, patternsLineEn, indicatorsLineEn, flowLineEn, verdictEn].join("\n"),
    conclusionFa: [mtfLineFa, patternsLineFa, indicatorsLineFa, flowLineFa, verdictFa].join("\n")
  };
}
function analyzeFuturesSymbol(input) {
  const {
    symbol,
    baseAsset,
    timeframe,
    candles,
    mtfCandles,
    markPrice: providedMarkPrice,
    indexBasisPct = 0,
    priceChangePct = 0,
    quoteVolume24h = 0,
    openInterestUsd = 0,
    oiDeltaPct = 0,
    fundingRate = 0,
    orderBook = null,
    recentTrades = []
  } = input;
  const closes = candles.map((c) => c.close);
  const lastIdx = candles.length - 1;
  const lastPrice = lastIdx >= 0 ? closes[lastIdx] : 0;
  const markPrice = providedMarkPrice ?? lastPrice;
  const ema9Arr = calcEMA(closes, 9);
  const ema21Arr = calcEMA(closes, 21);
  const ema50Arr = calcEMA(closes, 50);
  const ema200Arr = calcEMA(closes, 200);
  const rsiArr = calcRSI(closes, 14);
  const stoch = calcStochRSI(rsiArr, 14, 3, 3);
  const macd = calcMACD(closes, 12, 26, 9);
  const macdSeries = calcMACDSeries(closes, 12, 26, 9);
  const bb = calcBollingerBands(closes, 20, 2);
  const atr14 = calcATR(candles, 14);
  const adxInfo = calcADX(candles, 14);
  const vwapArr = calcVWAPSeries(candles, 48);
  const obvSlope = calcOBVSlope(candles, 12);
  const volMetrics = calcVolumeMetrics(candles);
  const cvdInfo = calcCVDSeries(candles);
  const wickSignal = detectLiquidityWick(candles);
  const pivots = detectPivotLevels(candles, lastPrice);
  const superTrend = calcSuperTrend(candles, 10, 3);
  const ichimoku = calcIchimoku(candles);
  const cmf20 = calcCMF(candles, 20);
  const mfi14 = calcMFI(candles, 14);
  const ttm = calcTTMSqueeze(candles);
  const compression = calcRangeCompressionRatio(candles);
  const cvdDivergence = calcCVDDivergence(candles, cvdInfo.series, 20);
  const obvBreakout = calcOBVBreakout(candles, 20);
  const donchian = calcDonchianBreakout(candles, 20, atr14);
  const patternSuite = analyzeSmcAndChartPatterns(candles, rsiArr, macdSeries.histogram);
  const mtf = buildMtfSummary({ timeframe, candles, mtfCandles });
  const extraPatterns = [];
  if (ttm.isSqueeze && ttm.squeezeBars >= 4) {
    extraPatterns.push({
      id: "ttm_squeeze_coil",
      category: "CHART",
      bias: ttm.momentum > 0.08 ? "BULLISH" : ttm.momentum < -0.08 ? "BEARISH" : "NEUTRAL",
      strength: Math.min(90, 72 + ttm.squeezeBars * 2),
      nameEn: `TTM Volatility Squeeze (${ttm.squeezeBars} bars)`,
      nameFa: `\u0641\u0634\u0631\u062F\u06AF\u06CC \u0627\u0646\u0641\u062C\u0627\u0631\u06CC TTM Squeeze (${ttm.squeezeBars} \u06A9\u0646\u062F\u0644)`,
      detailEn: `Bollinger Bands compressed inside Keltner Channels for ${ttm.squeezeBars} bars \u2014 coiled for a sharp expansion move.`,
      detailFa: `\u0628\u0627\u0646\u062F \u0628\u0648\u0644\u06CC\u0646\u06AF\u0631 \u0628\u0647 \u0645\u062F\u062A ${ttm.squeezeBars} \u06A9\u0646\u062F\u0644 \u062F\u0627\u062E\u0644 \u06A9\u0627\u0646\u0627\u0644 \u06A9\u0644\u062A\u0646\u0631 \u0641\u0634\u0631\u062F\u0647 \u0634\u062F\u0647\u061B \u0627\u0646\u0631\u0698\u06CC \u0622\u0645\u0627\u062F\u0647 \u067E\u0631\u062A\u0627\u0628 \u0642\u06CC\u0645\u062A \u0627\u0633\u062A.`
    });
  }
  if (cvdDivergence === "BULLISH") {
    extraPatterns.push({
      id: "cvd_bull_accumulation",
      category: "DIVERGENCE",
      bias: "BULLISH",
      strength: 83,
      nameEn: "Stealth CVD Accumulation Divergence",
      nameFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u067E\u0646\u0647\u0627\u0646 \u0627\u0646\u0628\u0627\u0634\u062A \u0646\u0647\u0646\u06AF\u200C\u0647\u0627 (CVD Accumulation)",
      detailEn: "Cumulative Volume Delta surged positively while price remained flat/compressed \u2014 hidden buyer absorption.",
      detailFa: "\u062F\u0644\u062A\u0627\u06CC \u062A\u062C\u0645\u0639\u06CC \u062E\u0631\u06CC\u062F\u0627\u0631\u0627\u0646 \u062F\u0631 \u0633\u06A9\u0648\u062A \u0642\u06CC\u0645\u062A\u06CC \u0628\u0647\u200C\u0634\u062F\u062A \u0635\u0639\u0648\u062F \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A (\u0646\u0634\u0627\u0646\u06AF\u0631 \u067E\u06CC\u0634\u200C\u062A\u0648\u0644\u06CC\u062F \u067E\u0627\u0645\u067E)."
    });
  } else if (cvdDivergence === "BEARISH") {
    extraPatterns.push({
      id: "cvd_bear_distribution",
      category: "DIVERGENCE",
      bias: "BEARISH",
      strength: 83,
      nameEn: "Stealth CVD Distribution Divergence",
      nameFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u067E\u0646\u0647\u0627\u0646 \u062A\u0648\u0632\u06CC\u0639 \u0639\u0631\u0636\u0647 (CVD Distribution)",
      detailEn: "Aggressive seller delta accelerated downward despite price holding range highs \u2014 institutional distribution.",
      detailFa: "\u062C\u0631\u06CC\u0627\u0646 \u0633\u0641\u0627\u0631\u0634 \u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646 \u0628\u0647\u200C\u0635\u0648\u0631\u062A \u067E\u0646\u0647\u0627\u0646\u06CC \u062F\u0631 \u062D\u0627\u0644 \u062A\u062E\u0644\u06CC\u0647 \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC \u0627\u0633\u062A (\u0647\u0634\u062F\u0627\u0631 \u062F\u0627\u0645\u067E \u0634\u0627\u0631\u067E)."
    });
  }
  if (obvBreakout === "BULLISH") {
    extraPatterns.push({
      id: "obv_bull_breakout",
      category: "CHART",
      bias: "BULLISH",
      strength: 78,
      nameEn: "Leading OBV Volume Breakout",
      nameFa: "\u0634\u06A9\u0633\u062A \u067E\u06CC\u0634\u200C\u062F\u0633\u062A\u0627\u0646\u0647 \u062D\u062C\u0645 \u062A\u062C\u0645\u0639\u06CC (OBV Breakout)",
      detailEn: "On-Balance Volume cleared its 20-bar peak ahead of price breakout.",
      detailFa: "\u062D\u062C\u0645 \u062A\u062C\u0645\u0639\u06CC OBV \u067E\u06CC\u0634 \u0627\u0632 \u0634\u06A9\u0633\u062A \u0642\u06CC\u0645\u062A\u06CC \u0627\u0632 \u0633\u0642\u0641 \u06F2\u06F0 \u06A9\u0646\u062F\u0644 \u0627\u062E\u06CC\u0631 \u0639\u0628\u0648\u0631 \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A."
    });
  } else if (obvBreakout === "BEARISH") {
    extraPatterns.push({
      id: "obv_bear_breakdown",
      category: "CHART",
      bias: "BEARISH",
      strength: 78,
      nameEn: "Leading OBV Volume Breakdown",
      nameFa: "\u0634\u06A9\u0633\u062A \u0646\u0632\u0648\u0644\u06CC \u067E\u06CC\u0634\u200C\u062F\u0633\u062A\u0627\u0646\u0647 \u062D\u062C\u0645 (OBV Breakdown)",
      detailEn: "On-Balance Volume dropped below 20-bar lows ahead of structural support failure.",
      detailFa: "\u062D\u062C\u0645 \u062A\u062C\u0645\u0639\u06CC OBV \u067E\u06CC\u0634 \u0627\u0632 \u0634\u06A9\u0633\u062A \u062D\u0645\u0627\u06CC\u062A \u0642\u06CC\u0645\u062A\u06CC \u0628\u0647 \u06A9\u0641 \u06F2\u06F0 \u06A9\u0646\u062F\u0644 \u0646\u0641\u0648\u0630 \u06A9\u0631\u062F\u0647 \u0627\u0633\u062A."
    });
  }
  const allPatterns = [...patternSuite.patterns, ...extraPatterns].sort((a, b) => b.strength - a.strength).slice(0, 8);
  const ema9 = ema9Arr[lastIdx] ?? lastPrice;
  const ema21 = ema21Arr[lastIdx] ?? lastPrice;
  const ema50 = ema50Arr[lastIdx] ?? lastPrice;
  const ema200 = ema200Arr[lastIdx] ?? ema50;
  const rsi14 = rsiArr[lastIdx] ?? 50;
  const bbUpper = bb.upper[lastIdx] ?? lastPrice * 1.02;
  const bbMiddle = bb.middle[lastIdx] ?? lastPrice;
  const bbLower = bb.lower[lastIdx] ?? lastPrice * 0.98;
  const bbWidthPct = bb.widthPct[lastIdx] ?? 2.5;
  const vwap = vwapArr[lastIdx] ?? lastPrice;
  const atrPct = lastPrice > 0 ? atr14 / lastPrice * 100 : 1;
  const isSqueeze = ttm.isSqueeze || bb.widthPercentile <= 30;
  const price3Ago = candles.length >= 4 ? candles[candles.length - 4].close : lastPrice;
  const priceMove3Pct = price3Ago > 0 ? (lastPrice - price3Ago) / price3Ago * 100 : 0;
  let mtfFactorScore = 0;
  if (mtf) {
    mtfFactorScore = mtf.alignmentScore;
  } else {
    mtfFactorScore += superTrend.direction === "BULLISH" ? 35 : -35;
    mtfFactorScore += ichimoku.cloudState === "ABOVE_KUMO" ? 35 : ichimoku.cloudState === "BELOW_KUMO" ? -35 : 0;
    mtfFactorScore += lastPrice > ema50 ? 20 : -20;
    mtfFactorScore = clamp(mtfFactorScore, -100, 100);
  }
  let trendStackScore = 0;
  trendStackScore += superTrend.direction === "BULLISH" ? 32 : -32;
  if (superTrend.flippedRecently) {
    trendStackScore += superTrend.direction === "BULLISH" ? 12 : -12;
  }
  if (ichimoku.cloudState === "ABOVE_KUMO") trendStackScore += 24;
  else if (ichimoku.cloudState === "BELOW_KUMO") trendStackScore -= 24;
  trendStackScore += ichimoku.tkCross === "BULLISH" ? 10 : -10;
  trendStackScore += ema9 > ema21 ? 10 : -10;
  trendStackScore += ema21 > ema50 ? 12 : -12;
  trendStackScore = clamp(trendStackScore, -100, 100);
  let ttmCompressionScore = 0;
  const compressionIntensity = (ttm.isSqueeze ? 36 + Math.min(24, ttm.squeezeBars * 3) : ttm.squeezeFired ? 44 : 0) + (compression.isVcpTightening ? 20 : 0) + (compression.atrExpansionRatio <= 0.65 ? 20 : bb.widthPercentile <= 28 ? 14 : 0);
  if (compressionIntensity > 0) {
    let dirBias = 0;
    if (ttm.momentum > 0.08) dirBias += 0.45;
    else if (ttm.momentum < -0.08) dirBias -= 0.45;
    if (ttm.momentum > ttm.prevMomentum) dirBias += 0.2;
    else if (ttm.momentum < ttm.prevMomentum) dirBias -= 0.2;
    if (cvdInfo.takerBuyRatio >= 0.53) dirBias += 0.35;
    else if (cvdInfo.takerBuyRatio <= 0.47) dirBias -= 0.35;
    if (cvdDivergence === "BULLISH") dirBias += 0.35;
    else if (cvdDivergence === "BEARISH") dirBias -= 0.35;
    ttmCompressionScore = clamp(compressionIntensity * clamp(dirBias, -1, 1), -100, 100);
  }
  const smcFactorScore = patternSuite.smcScore;
  const patternFactorScore = patternSuite.candlestickAndChartScore;
  let volumeAnomalyScore = 0;
  const effectiveSuspicious = Math.min(100, volMetrics.suspiciousScore + (compression.isAbsorption ? 15 : 0));
  if (effectiveSuspicious > 16) {
    const dirSign = cvdInfo.takerBuyRatio >= 0.52 || cmf20 >= 0.08 || cvdDivergence === "BULLISH" ? 1 : cvdInfo.takerBuyRatio <= 0.48 || cmf20 <= -0.08 || cvdDivergence === "BEARISH" ? -1 : priceMove3Pct >= 0 ? 0.45 : -0.45;
    volumeAnomalyScore = clamp(effectiveSuspicious * dirSign, -100, 100);
  }
  const takerBias = (cvdInfo.takerBuyRatio - 0.5) * 180;
  const cvdBias = clamp(cvdInfo.cvdSlopePct * 1.15, -35, 35);
  const cmfBias = clamp(cmf20 * 110, -35, 35);
  const mfiBias = mfi14 >= 65 ? 12 : mfi14 <= 35 ? -12 : 0;
  const divBoost = cvdDivergence === "BULLISH" ? 32 : cvdDivergence === "BEARISH" ? -32 : 0;
  const obvBoost = obvBreakout === "BULLISH" ? 18 : obvBreakout === "BEARISH" ? -18 : 0;
  const volBoost = effectiveSuspicious >= 40 ? 1.2 : 1;
  const orderflowScore = clamp(
    (takerBias * 0.45 + cvdBias * 0.3 + cmfBias * 0.4 + mfiBias * 0.3 + divBoost + obvBoost) * volBoost,
    -100,
    100
  );
  const strongBearTrend = adxInfo.adx >= 26 && adxInfo.minusDi > adxInfo.plusDi + 6;
  const strongBullTrend = adxInfo.adx >= 26 && adxInfo.plusDi > adxInfo.minusDi + 6;
  let momentumScore = 0;
  if (rsi14 <= 32) momentumScore += strongBearTrend && cvdInfo.takerBuyRatio < 0.52 ? 18 : 55;
  else if (rsi14 <= 44 && stoch.k > stoch.d) momentumScore += 32;
  else if (rsi14 >= 72) momentumScore -= strongBullTrend && cvdInfo.takerBuyRatio > 0.48 ? 18 : 55;
  else if (rsi14 >= 58 && stoch.k < stoch.d) momentumScore -= 32;
  else if (rsi14 > 52) momentumScore += 14;
  else if (rsi14 < 48) momentumScore -= 14;
  if (macd.prevHistogram <= 0 && macd.histogram > 0) momentumScore += 42;
  else if (macd.prevHistogram >= 0 && macd.histogram < 0) momentumScore -= 42;
  else if (macd.histogram > 0 && macd.histogram > macd.prevHistogram) momentumScore += 28;
  else if (macd.histogram < 0 && macd.histogram < macd.prevHistogram) momentumScore -= 28;
  momentumScore = clamp(momentumScore, -100, 100);
  let breakoutProxScore = 0;
  const vwapDistPct = vwap > 0 ? (lastPrice - vwap) / vwap * 100 : 0;
  if (vwapDistPct > 0.15) breakoutProxScore += 26;
  else if (vwapDistPct < -0.15) breakoutProxScore -= 26;
  if (donchian.nearHighBreakout && (cvdInfo.takerBuyRatio >= 0.51 || obvBreakout === "BULLISH")) {
    breakoutProxScore += 52;
  } else if (donchian.nearLowBreakdown && (cvdInfo.takerBuyRatio <= 0.49 || obvBreakout === "BEARISH")) {
    breakoutProxScore -= 52;
  } else if (lastPrice < bbLower && !strongBearTrend) {
    breakoutProxScore += 30;
  } else if (lastPrice > bbUpper && !strongBullTrend) {
    breakoutProxScore -= 30;
  }
  breakoutProxScore = clamp(breakoutProxScore, -100, 100);
  let derivativesScore = 0;
  if (fundingRate <= -3e-4) derivativesScore += 52;
  else if (fundingRate <= -1e-4) derivativesScore += 24;
  else if (fundingRate >= 5e-4) derivativesScore -= 52;
  else if (fundingRate >= 2e-4) derivativesScore -= 24;
  if (indexBasisPct <= -0.06) derivativesScore += 22;
  else if (indexBasisPct >= 0.06) derivativesScore -= 22;
  if (oiDeltaPct > 1) {
    derivativesScore += cvdInfo.takerBuyRatio >= 0.51 || priceMove3Pct >= 0 ? 32 : -32;
  }
  derivativesScore = clamp(derivativesScore, -100, 100);
  let microstructureScore = 0;
  if (orderBook) {
    if (orderBook.imbalanceRatio >= 1.35) microstructureScore += 60;
    else if (orderBook.imbalanceRatio >= 1.12) microstructureScore += 30;
    else if (orderBook.imbalanceRatio <= 0.74) microstructureScore -= 60;
    else if (orderBook.imbalanceRatio <= 0.89) microstructureScore -= 30;
  }
  if (wickSignal === "BULLISH_ABSORPTION") microstructureScore += 40;
  if (wickSignal === "BEARISH_REJECTION") microstructureScore -= 40;
  microstructureScore = clamp(microstructureScore, -100, 100);
  let volExpansionScore = 0;
  if (priceChangePct >= 22 && rsi14 >= 72) {
    volExpansionScore = -60;
  } else if (priceChangePct <= -22 && rsi14 <= 28) {
    volExpansionScore = 60;
  } else if (compression.atrExpansionRatio <= 0.65) {
    volExpansionScore = cvdInfo.takerBuyRatio >= 0.52 ? 45 : cvdInfo.takerBuyRatio <= 0.48 ? -45 : 0;
  }
  volExpansionScore = clamp(volExpansionScore, -100, 100);
  const factors = [
    {
      id: "mtf_confluence",
      labelEn: "MTF Confluence (1H/4H/1D)",
      labelFa: "\u0647\u0645\u200C\u06AF\u0631\u0627\u06CC\u06CC \u0645\u0648\u0644\u062A\u06CC\u200C\u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645 (1H/4H/1D)",
      score: Math.round(mtfFactorScore),
      weight: 0.14,
      valueText: mtf ? `${mtf.alignedTimeframes}/3 \xB7 ${mtf.alignmentScore > 0 ? `+${mtf.alignmentScore}` : mtf.alignmentScore}` : `${timeframe.toUpperCase()} Regime`,
      bias: mtfFactorScore > 15 ? "BULLISH" : mtfFactorScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: mtf ? `1H(${mtf.tf1h?.score ?? "-"}) / 4H(${mtf.tf4h?.score ?? "-"}) / 1D(${mtf.tf1d?.score ?? "-"}) alignment.` : `Single-timeframe structural alignment (${timeframe}).`,
      detailFa: mtf ? `\u0647\u0645\u200C\u0633\u0648\u06CC\u06CC \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645\u200C\u0647\u0627\u06CC 1H (${mtf.tf1h?.score ?? "-"})\u060C 4H (${mtf.tf4h?.score ?? "-"}) \u0648 1D (${mtf.tf1d?.score ?? "-"}).` : `\u0647\u0645\u200C\u0633\u0648\u06CC\u06CC \u0633\u0627\u062E\u062A\u0627\u0631\u06CC \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645 ${timeframe}.`
    },
    {
      id: "trend_ichimoku_supertrend",
      labelEn: "SuperTrend & Ichimoku Kumo",
      labelFa: "\u0633\u0648\u067E\u0631\u062A\u0631\u0646\u062F\u060C \u0627\u0628\u0631 \u0627\u06CC\u0686\u06CC\u0645\u0648\u06A9\u0648 \u0648 EMA",
      score: Math.round(trendStackScore),
      weight: 0.1,
      valueText: `${superTrend.direction === "BULLISH" ? "ST Bull" : "ST Bear"} \xB7 ${ichimoku.cloudState.replace("_KUMO", "")}`,
      bias: trendStackScore > 15 ? "BULLISH" : trendStackScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: `SuperTrend(10,3) ${superTrend.direction}, Ichimoku ${ichimoku.cloudState.replace("_", " ")}, EMA9 ${ema9 > ema21 ? ">" : "<"} EMA21.`,
      detailFa: `\u0633\u0648\u067E\u0631\u062A\u0631\u0646\u062F ${superTrend.direction === "BULLISH" ? "\u0635\u0639\u0648\u062F\u06CC" : "\u0646\u0632\u0648\u0644\u06CC"}\u060C \u0627\u0628\u0631 \u06A9\u0648\u0645\u0648 ${ichimoku.cloudState === "ABOVE_KUMO" ? "\u0632\u06CC\u0631 \u0642\u06CC\u0645\u062A" : ichimoku.cloudState === "BELOW_KUMO" ? "\u0628\u0627\u0644\u0627\u06CC \u0642\u06CC\u0645\u062A" : "\u062E\u0646\u062B\u06CC"}.`
    },
    {
      id: "ttm_squeeze_vcp",
      labelEn: "TTM Squeeze & VCP Coil",
      labelFa: "\u0641\u0634\u0631\u062F\u06AF\u06CC TTM \u0648 \u062A\u0631\u0627\u06A9\u0645 VCP",
      score: Math.round(ttmCompressionScore),
      weight: 0.11,
      valueText: ttm.isSqueeze ? `TTM ${ttm.squeezeBars}b \xB7 ATR ${compression.atrExpansionRatio}x` : `ATR ${compression.atrExpansionRatio}x \xB7 P${Math.round(bb.widthPercentile)}`,
      bias: ttmCompressionScore > 12 ? "BULLISH" : ttmCompressionScore < -12 ? "BEARISH" : "NEUTRAL",
      detailEn: ttm.isSqueeze ? `BB contracted inside Keltner Channels (${ttm.squeezeBars} bars); momentum ${ttm.momentum >= 0 ? "+" : ""}${ttm.momentum}.` : `Volatility ratio ${compression.atrExpansionRatio}x of 36-bar peak${compression.isVcpTightening ? " with VCP tightening" : ""}.`,
      detailFa: ttm.isSqueeze ? `\u0628\u0627\u0646\u062F \u0628\u0648\u0644\u06CC\u0646\u06AF\u0631 \u062F\u0627\u062E\u0644 \u06A9\u0627\u0646\u0627\u0644 \u06A9\u0644\u062A\u0646\u0631 (${ttm.squeezeBars} \u06A9\u0646\u062F\u0644) \u0628\u0627 \u0645\u0648\u0645\u0646\u062A\u0648\u0645 ${ttm.momentum >= 0 ? "+" : ""}${ttm.momentum} \u0641\u0634\u0631\u062F\u0647 \u0634\u062F\u0647 \u0627\u0633\u062A.` : `\u0646\u0633\u0628\u062A \u0646\u0648\u0633\u0627\u0646 \u0628\u0647 \u0627\u0648\u062C \u06F3\u06F6 \u06A9\u0646\u062F\u0644 \u0628\u0631\u0627\u0628\u0631 ${compression.atrExpansionRatio}x${compression.isVcpTightening ? " (\u062A\u0631\u0627\u06A9\u0645 VCP \u0641\u0639\u0627\u0644)" : ""}.`
    },
    {
      id: "smc_structure",
      labelEn: "SMC Structure & Wyckoff",
      labelFa: "\u0633\u0627\u062E\u062A\u0627\u0631 \u0627\u0633\u0645\u0627\u0631\u062A\u200C\u0645\u0627\u0646\u06CC \u0648 \u0648\u0627\u06CC\u06A9\u0648\u0641",
      score: Math.round(smcFactorScore),
      weight: 0.1,
      valueText: `${patternSuite.smcStructure} \xB7 ${patternSuite.smcZone}`,
      bias: smcFactorScore > 15 ? "BULLISH" : smcFactorScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: `Smart Money structure is ${patternSuite.smcStructure} inside ${patternSuite.smcZone} pricing zone.`,
      detailFa: `\u0633\u0627\u062E\u062A\u0627\u0631 \u0628\u0627\u0632\u0627\u0631 ${patternSuite.smcStructure === "BULLISH" ? "\u0635\u0639\u0648\u062F\u06CC" : patternSuite.smcStructure === "BEARISH" ? "\u0646\u0632\u0648\u0644\u06CC" : "\u0631\u0646\u062C"} \u062F\u0631 \u0646\u0627\u062D\u06CC\u0647 ${patternSuite.smcZone}.`
    },
    {
      id: "chart_candle_patterns",
      labelEn: "Chart Patterns & Divergences",
      labelFa: "\u0627\u0644\u06AF\u0648\u0647\u0627\u06CC \u06A9\u0644\u0627\u0633\u06CC\u06A9\u060C \u06A9\u0646\u062F\u0644\u06CC \u0648 \u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC",
      score: Math.round(patternFactorScore),
      weight: 0.09,
      valueText: `${allPatterns.length} Active`,
      bias: patternFactorScore > 12 ? "BULLISH" : patternFactorScore < -12 ? "BEARISH" : "NEUTRAL",
      detailEn: allPatterns.length > 0 ? allPatterns.slice(0, 2).map((p) => p.nameEn).join(" + ") : "No active candlestick/chart breakout or RSI divergence.",
      detailFa: allPatterns.length > 0 ? allPatterns.slice(0, 2).map((p) => p.nameFa).join(" + ") : "\u0627\u0644\u06AF\u0648\u06CC \u06A9\u0646\u062F\u0644\u06CC\u060C \u06A9\u0644\u0627\u0633\u06CC\u06A9 \u06CC\u0627 \u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC \u0641\u0639\u0627\u0644 \u0634\u0646\u0627\u0633\u0627\u06CC\u06CC \u0646\u0634\u062F."
    },
    {
      id: "volume_anomaly",
      labelEn: "RVOL Z-Score & Absorption",
      labelFa: "\u0646\u0627\u0647\u0646\u062C\u0627\u0631\u06CC \u062D\u062C\u0645 \u0648 \u062C\u0630\u0628 \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC",
      score: Math.round(volumeAnomalyScore),
      weight: 0.1,
      valueText: `Z ${volMetrics.zScore} (${volMetrics.ratio20}x)${compression.isAbsorption ? " \xB7 Abs" : ""}`,
      bias: volumeAnomalyScore > 15 ? "BULLISH" : volumeAnomalyScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: `Volume is ${volMetrics.ratio20}x 20-bar average (Z=${volMetrics.zScore})${compression.isAbsorption ? " with Wyckoff stealth absorption" : ""}.`,
      detailFa: `\u062D\u062C\u0645 \u0645\u0639\u0627\u0645\u0644\u0627\u062A ${volMetrics.ratio20} \u0628\u0631\u0627\u0628\u0631 \u0645\u06CC\u0627\u0646\u06AF\u06CC\u0646 \u06F2\u06F0 \u06A9\u0646\u062F\u0644 \u0627\u0633\u062A (Z=${volMetrics.zScore})${compression.isAbsorption ? " \u0647\u0645\u0631\u0627\u0647 \u0628\u0627 \u062C\u0630\u0628 \u067E\u0646\u0647\u0627\u0646 \u0648\u0627\u06CC\u06A9\u0648\u0641" : ""}.`
    },
    {
      id: "cvd_orderflow",
      labelEn: "CVD Div, OBV & CMF/MFI Flow",
      labelFa: "\u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC CVD\u060C OBV \u0648 \u062C\u0631\u06CC\u0627\u0646 \u067E\u0648\u0644",
      score: Math.round(orderflowScore),
      weight: 0.1,
      valueText: `${Math.round(cvdInfo.takerBuyRatio * 100)}% Buy \xB7 CMF ${cmf20.toFixed(2)}`,
      bias: orderflowScore > 15 ? "BULLISH" : orderflowScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: `Taker buy ${(cvdInfo.takerBuyRatio * 100).toFixed(1)}%, CVD Div=${cvdDivergence}, OBV=${obvBreakout}, CMF=${cmf20.toFixed(2)}.`,
      detailFa: `\u062E\u0631\u06CC\u062F \u0645\u0627\u0631\u06A9\u062A ${(cvdInfo.takerBuyRatio * 100).toFixed(1)}\u066A\u060C \u0648\u0627\u06AF\u0631\u0627\u06CC\u06CC CVD=${cvdDivergence}\u060C \u0634\u06A9\u0633\u062A OBV=${obvBreakout}\u060C CMF=${cmf20.toFixed(2)}.`
    },
    {
      id: "momentum_macd_rsi",
      labelEn: "RSI(14), StochRSI & MACD",
      labelFa: "\u0645\u0648\u0645\u0646\u062A\u0648\u0645 RSI\u060C \u0627\u0633\u062A\u0648\u06A9\u0633\u062A\u06CC\u06A9 \u0648 \u0645\u06A9\u062F\u06CC",
      score: Math.round(momentumScore),
      weight: 0.07,
      valueText: `RSI ${rsi14.toFixed(1)} \xB7 ${macd.histogram >= 0 ? "+MACD" : "-MACD"}`,
      bias: momentumScore > 15 ? "BULLISH" : momentumScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: `RSI ${rsi14.toFixed(1)}, Stoch ${stoch.k.toFixed(0)}/${stoch.d.toFixed(0)}, MACD hist ${macd.histogram >= macd.prevHistogram ? "rising" : "falling"}.`,
      detailFa: `RSI \u0631\u0648\u06CC ${rsi14.toFixed(1)}\u060C \u0627\u0633\u062A\u0648\u06A9\u0633\u062A\u06CC\u06A9 ${stoch.k.toFixed(0)}/${stoch.d.toFixed(0)} \u0648 \u0645\u06A9\u062F\u06CC ${macd.histogram >= macd.prevHistogram ? "\u0631\u0648 \u0628\u0647 \u0631\u0634\u062F" : "\u0631\u0648 \u0628\u0647 \u0627\u0641\u062A"}.`
    },
    {
      id: "breakout_proximity",
      labelEn: "Donchian Breakout & VWAP",
      labelFa: "\u0622\u0633\u062A\u0627\u0646\u0647 \u0634\u06A9\u0633\u062A \u062F\u0627\u0646\u0686\u06CC\u0646 \u0648 VWAP",
      score: Math.round(breakoutProxScore),
      weight: 0.06,
      valueText: `DC ${donchian.posPct}% \xB7 ${vwapDistPct >= 0 ? "+" : ""}${vwapDistPct.toFixed(2)}% VWAP`,
      bias: breakoutProxScore > 15 ? "BULLISH" : breakoutProxScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: `Donchian 20-bar position ${donchian.posPct}%; price is ${Math.abs(vwapDistPct).toFixed(2)}% ${vwapDistPct >= 0 ? "above" : "below"} VWAP.`,
      detailFa: `\u0645\u0648\u0642\u0639\u06CC\u062A \u062F\u0631 \u06A9\u0627\u0646\u0627\u0644 \u06F2\u06F0 \u06A9\u0646\u062F\u0644\u06CC \u062F\u0627\u0646\u0686\u06CC\u0646 ${donchian.posPct}\u066A \u0648 \u0641\u0627\u0635\u0644\u0647 \u0627\u0632 VWAP \u0628\u0631\u0627\u0628\u0631 ${Math.abs(vwapDistPct).toFixed(2)}\u066A.`
    },
    {
      id: "derivatives_oi",
      labelEn: "Funding Squeeze, Basis & OI",
      labelFa: "\u0641\u0627\u0646\u062F\u06CC\u0646\u06AF \u0627\u0633\u06A9\u0648\u0626\u06CC\u0632\u060C \u0628\u06CC\u0633 \u0648 \u0633\u0648\u062F \u0628\u0627\u0632",
      score: Math.round(derivativesScore),
      weight: 0.06,
      valueText: `FR ${(fundingRate * 100).toFixed(4)}%`,
      bias: derivativesScore > 15 ? "BULLISH" : derivativesScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: `Funding ${(fundingRate * 100).toFixed(4)}%, basis ${indexBasisPct.toFixed(3)}%, OI delta ${oiDeltaPct >= 0 ? "+" : ""}${oiDeltaPct.toFixed(2)}%.`,
      detailFa: `\u0641\u0627\u0646\u062F\u06CC\u0646\u06AF ${(fundingRate * 100).toFixed(4)}\u066A\u060C \u0627\u062E\u062A\u0644\u0627\u0641 \u0645\u0627\u0631\u06A9 ${indexBasisPct.toFixed(3)}\u066A \u0648 \u062A\u063A\u06CC\u06CC\u0631 OI \u0628\u0631\u0627\u0628\u0631 ${oiDeltaPct.toFixed(2)}\u066A.`
    },
    {
      id: "orderbook_depth",
      labelEn: "Orderbook & Liquidity Wicks",
      labelFa: "\u0639\u0645\u0642 \u0633\u0641\u0627\u0631\u0634\u0627\u062A \u0648 \u0634\u062F\u0648\u06CC \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC",
      score: Math.round(microstructureScore),
      weight: 0.04,
      valueText: orderBook ? `${orderBook.imbalanceRatio.toFixed(2)}x Bid/Ask` : wickSignal,
      bias: microstructureScore > 15 ? "BULLISH" : microstructureScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: orderBook ? `Orderbook bid/ask ratio ${orderBook.imbalanceRatio.toFixed(2)}x, wick: ${wickSignal}.` : `Candle microstructure wick signal: ${wickSignal}.`,
      detailFa: orderBook ? `\u0646\u0633\u0628\u062A \u062E\u0631\u06CC\u062F \u0628\u0647 \u0641\u0631\u0648\u0634 \u062F\u0641\u062A\u0631 \u0633\u0641\u0627\u0631\u0634 ${orderBook.imbalanceRatio.toFixed(2)}x \u0648 \u0634\u062F\u0648: ${wickSignal}.` : `\u0627\u0644\u06AF\u0648\u06CC \u0634\u062F\u0648\u06CC \u0646\u0642\u062F\u06CC\u0646\u06AF\u06CC \u06A9\u0646\u062F\u0644: ${wickSignal}.`
    },
    {
      id: "volatility_expansion",
      labelEn: "\u226520% Move Readiness & Exhaustion",
      labelFa: "\u0638\u0631\u0641\u06CC\u062A \u062D\u0631\u06A9\u062A +\u06F2\u06F0\u066A \u0648 \u0641\u06CC\u0644\u062A\u0631 \u0627\u0634\u0628\u0627\u0639",
      score: Math.round(volExpansionScore),
      weight: 0.03,
      valueText: `ATR ${atrPct.toFixed(2)}% \xB7 ${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(1)}% 24h`,
      bias: volExpansionScore > 15 ? "BULLISH" : volExpansionScore < -15 ? "BEARISH" : "NEUTRAL",
      detailEn: `Hourly ATR=${atrPct.toFixed(2)}% (expansion ratio ${compression.atrExpansionRatio}x), 24h move=${priceChangePct.toFixed(1)}%.`,
      detailFa: `ATR \u0633\u0627\u0639\u062A\u06CC ${atrPct.toFixed(2)}\u066A (\u0646\u0633\u0628\u062A \u0641\u0634\u0631\u062F\u06AF\u06CC ${compression.atrExpansionRatio}x) \u0648 \u062A\u063A\u06CC\u06CC\u0631 \u06F2\u06F4 \u0633\u0627\u0639\u062A\u0647 ${priceChangePct.toFixed(1)}\u066A.`
    }
  ];
  let netScore = 0;
  for (const f of factors) {
    netScore += f.score * f.weight;
  }
  const obvConfirm = clamp(obvSlope * 1.4, -40, 40) + (adxInfo.adx >= 21 ? adxInfo.plusDi > adxInfo.minusDi ? 20 : -20 : 0);
  netScore = clamp(netScore + obvConfirm * 0.05, -100, 100);
  let direction = "NEUTRAL";
  if (netScore >= 21) direction = "LONG";
  else if (netScore <= -21) direction = "SHORT";
  let gateReasonEn;
  let gateReasonFa;
  const hasWyckoffSpring = allPatterns.some((p) => p.id === "wyckoff_spring");
  const hasWyckoffUtad = allPatterns.some((p) => p.id === "wyckoff_utad");
  const hasBullChartReversal = allPatterns.some(
    (p) => p.bias === "BULLISH" && (p.category === "DIVERGENCE" || p.id === "smc_bull_choch" || p.id === "wyckoff_spring" || p.id === "inverse_head_and_shoulders" || p.id === "falling_wedge") && p.strength >= 74
  );
  const hasBearChartReversal = allPatterns.some(
    (p) => p.bias === "BEARISH" && (p.category === "DIVERGENCE" || p.id === "smc_bear_choch" || p.id === "wyckoff_utad" || p.id === "head_and_shoulders" || p.id === "rising_wedge") && p.strength >= 74
  );
  const earlyReversalBull = netScore >= 26 && (hasBullChartReversal && netScore >= 40 || hasWyckoffSpring && cvdInfo.takerBuyRatio >= 0.52 || cvdDivergence === "BULLISH" && (ttm.isSqueeze || compression.isVcpTightening) && effectiveSuspicious >= 34 || ttm.isSqueeze && ttm.momentum > 0 && derivativesScore >= 30 && orderflowScore >= 24);
  const earlyReversalBear = netScore <= -26 && (hasBearChartReversal && netScore <= -40 || hasWyckoffUtad && cvdInfo.takerBuyRatio <= 0.48 || cvdDivergence === "BEARISH" && (ttm.isSqueeze || rsi14 >= 62 || compression.isAbsorption) && effectiveSuspicious >= 30 || fundingRate >= 4e-4 && rsi14 >= 66 && orderflowScore <= -24);
  if (mtf && direction === "LONG") {
    const strongBearHtf = mtf.tf4h && mtf.tf4h.score < -25 && mtf.tf1d && mtf.tf1d.score < -25 || mtf.tf1d && mtf.tf1d.score < -35 && mtf.tf4h && mtf.tf4h.score < -15;
    if (strongBearHtf && !earlyReversalBull) {
      direction = "NEUTRAL";
      gateReasonEn = `Suppressed counter-trend LONG against bearish 4H (${mtf.tf4h?.score}) & 1D (${mtf.tf1d?.score}) structure`;
      gateReasonFa = `\u062C\u0644\u0648\u06AF\u06CC\u0631\u06CC \u0627\u0632 \u0633\u06CC\u06AF\u0646\u0627\u0644 \u0644\u0627\u0646\u06AF \u062E\u0644\u0627\u0641 \u0631\u0648\u0646\u062F \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645\u200C\u0647\u0627\u06CC 4H (${mtf.tf4h?.score}) \u0648 1D (${mtf.tf1d?.score})`;
    }
  } else if (mtf && direction === "SHORT") {
    const strongBullHtf = mtf.tf4h && mtf.tf4h.score > 25 && mtf.tf1d && mtf.tf1d.score > 25 || mtf.tf1d && mtf.tf1d.score > 35 && mtf.tf4h && mtf.tf4h.score > 15;
    if (strongBullHtf && !earlyReversalBear) {
      direction = "NEUTRAL";
      gateReasonEn = `Suppressed counter-trend SHORT against bullish 4H (${mtf.tf4h?.score}) & 1D (${mtf.tf1d?.score}) structure`;
      gateReasonFa = `\u062C\u0644\u0648\u06AF\u06CC\u0631\u06CC \u0627\u0632 \u0633\u06CC\u06AF\u0646\u0627\u0644 \u0634\u0648\u0631\u062A \u062E\u0644\u0627\u0641 \u0631\u0648\u0646\u062F \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645\u200C\u0647\u0627\u06CC 4H (${mtf.tf4h?.score}) \u0648 1D (${mtf.tf1d?.score})`;
    }
  }
  if (direction !== "NEUTRAL" && adxInfo.adx < 17 && !(ttm.isSqueeze && ttm.squeezeBars >= 4) && effectiveSuspicious < 40 && allPatterns.length === 0 && Math.abs(netScore) < 32) {
    direction = "NEUTRAL";
    gateReasonEn = `Suppressed weak signal in sideways low-ADX (${adxInfo.adx.toFixed(1)}) chop without squeeze/volume catalyst`;
    gateReasonFa = `\u062D\u0630\u0641 \u0633\u06CC\u06AF\u0646\u0627\u0644 \u0636\u0639\u06CC\u0641 \u062F\u0631 \u0628\u0627\u0632\u0627\u0631 \u0631\u0646\u062C (ADX=${adxInfo.adx.toFixed(1)}) \u0628\u062F\u0648\u0646 \u0641\u0634\u0631\u062F\u06AF\u06CC TTM \u06CC\u0627 \u062D\u062C\u0645 \u0645\u0634\u06A9\u0648\u06A9`;
  }
  const directionalStrength = Math.abs(netScore);
  const confluenceAlignment = factors.filter(
    (f) => direction === "LONG" && f.score > 10 || direction === "SHORT" && f.score < -10
  ).length;
  const mtfBonus = mtf && direction === "LONG" && mtf.alignmentScore > 25 ? Math.min(10, mtf.alignedTimeframes * 3) : mtf && direction === "SHORT" && mtf.alignmentScore < -25 ? Math.min(10, mtf.alignedTimeframes * 3) : 0;
  const rawConfidence = direction === "NEUTRAL" ? Math.max(12, Math.round(directionalStrength * 1.15)) : Math.round(clamp(42 + directionalStrength * 0.56 + confluenceAlignment * 2.2 + mtfBonus, 30, 98));
  const compressionPts = (ttm.isSqueeze ? 12 + Math.min(8, ttm.squeezeBars * 1.2) : ttm.squeezeFired ? 14 : bb.widthPercentile <= 30 ? 8 : 0) + (compression.atrExpansionRatio <= 0.68 ? 6 : 0) + (compression.isVcpTightening ? 4 : 0);
  const alreadyExplodedUp = priceChangePct >= 20 || priceMove3Pct >= 9;
  const alreadyExplodedDown = priceChangePct <= -20 || priceMove3Pct <= -9;
  const notYetExplodedUp = !alreadyExplodedUp && Math.abs(priceMove3Pct) < 5.5;
  const notYetExplodedDown = !alreadyExplodedDown && Math.abs(priceMove3Pct) < 5.5;
  const isQuietMegaCap = !ttm.isSqueeze && !ttm.squeezeFired && !compression.isVcpTightening && atrPct < 1.15 && volMetrics.suspiciousScore < 35 && cvdDivergence === "NONE" && Math.abs(fundingRate) < 3e-4;
  const mtfBullBoost = mtf && mtf.alignmentScore > 15 ? mtf.alignmentScore * 0.14 : 0;
  const mtfBearBoost = mtf && mtf.alignmentScore < -15 ? Math.abs(mtf.alignmentScore) * 0.14 : 0;
  const bullVolAbsorption = volMetrics.suspiciousScore * 0.28 + (compression.isAbsorption && (cvdInfo.takerBuyRatio >= 0.52 || cvdDivergence === "BULLISH") ? 10 : 0);
  const bearVolAbsorption = volMetrics.suspiciousScore * 0.28 + (compression.isAbsorption && (cvdInfo.takerBuyRatio <= 0.48 || cvdDivergence === "BEARISH") ? 10 : 0);
  const bullFlowFuel = (cvdDivergence === "BULLISH" ? 14 : 0) + (obvBreakout === "BULLISH" ? 8 : 0) + (cvdInfo.takerBuyRatio > 0.525 ? (cvdInfo.takerBuyRatio - 0.5) * 95 : 0) + (cmf20 > 0.07 ? 6 : 0);
  const bearFlowFuel = (cvdDivergence === "BEARISH" ? 14 : 0) + (obvBreakout === "BEARISH" ? 8 : 0) + (cvdInfo.takerBuyRatio < 0.475 ? (0.5 - cvdInfo.takerBuyRatio) * 95 : 0) + (cmf20 < -0.07 ? 6 : 0);
  const bullDerivFuel = (fundingRate <= -2e-4 ? 12 : fundingRate < -5e-5 ? 5 : 0) + (oiDeltaPct > 1 && priceMove3Pct >= -1.5 ? 7 : 0) + (indexBasisPct <= -0.05 ? 4 : 0);
  const bearDerivFuel = (fundingRate >= 3e-4 ? 12 : fundingRate > 15e-5 ? 5 : 0) + (oiDeltaPct > 1 && priceMove3Pct <= 1.5 ? 7 : 0) + (indexBasisPct >= 0.05 ? 4 : 0);
  const bullTrigger = (donchian.nearHighBreakout && cvdInfo.takerBuyRatio >= 0.51 ? 7 : 0) + (ttm.momentum > 0 && ttm.momentum > ttm.prevMomentum ? 6 : 0) + (hasWyckoffSpring || hasBullChartReversal ? 8 : 0) + (alreadyExplodedDown && (rsi14 <= 28 || cvdDivergence === "BULLISH") ? 12 : 0);
  const bearTrigger = (donchian.nearLowBreakdown && cvdInfo.takerBuyRatio <= 0.49 ? 7 : 0) + (ttm.momentum < 0 && ttm.momentum < ttm.prevMomentum ? 6 : 0) + (hasWyckoffUtad || hasBearChartReversal ? 8 : 0) + (alreadyExplodedUp && (rsi14 >= 72 || cvdDivergence === "BEARISH") ? 14 : 0);
  let rawPump = (netScore > 0 ? netScore * 0.42 : 4) + mtfBullBoost + bullVolAbsorption + bullFlowFuel + bullDerivFuel + bullTrigger + (netScore >= 0 || cvdDivergence === "BULLISH" || fundingRate <= -15e-5 ? compressionPts * 0.8 : 0);
  let rawDump = (netScore < 0 ? Math.abs(netScore) * 0.42 : 4) + mtfBearBoost + bearVolAbsorption + bearFlowFuel + bearDerivFuel + bearTrigger + (netScore <= 0 || cvdDivergence === "BEARISH" || fundingRate >= 25e-5 ? compressionPts * 0.8 : 0);
  if (isQuietMegaCap) {
    rawPump *= 0.58;
    rawDump *= 0.58;
  }
  if (alreadyExplodedUp) {
    rawPump = Math.min(rawPump, 54);
  }
  if (alreadyExplodedDown) {
    rawDump = Math.min(rawDump, 54);
  }
  const pumpProbability = Math.round(clamp(rawPump, 2, 98));
  const dumpProbability = Math.round(clamp(rawDump, 2, 98));
  const sharpMoveScore = Math.round(
    clamp(
      Math.max(pumpProbability, dumpProbability) * 0.62 + compressionPts * 0.85 + volMetrics.suspiciousScore * 0.18,
      2,
      98
    )
  );
  const sharpMoveBias = pumpProbability >= dumpProbability + 10 ? "PUMP_20_PLUS" : dumpProbability >= pumpProbability + 10 ? "DUMP_20_PLUS" : "BALANCED";
  let phase = "CONSOLIDATION";
  if (direction === "LONG" && notYetExplodedUp && (volMetrics.suspiciousScore >= 30 || ttm.isSqueeze || isSqueeze || cvdDivergence === "BULLISH" || compression.isVcpTightening)) {
    phase = "PRE_PUMP";
  } else if (direction === "SHORT" && notYetExplodedDown && (volMetrics.suspiciousScore >= 30 || ttm.isSqueeze || isSqueeze || cvdDivergence === "BEARISH" || compression.isVcpTightening)) {
    phase = "PRE_DUMP";
  } else if (direction === "LONG" && (priceMove3Pct >= 2.5 || alreadyExplodedUp)) {
    phase = "PUMP_ACTIVE";
  } else if (direction === "SHORT" && (priceMove3Pct <= -2.5 || alreadyExplodedDown)) {
    phase = "DUMP_ACTIVE";
  } else if (ttm.isSqueeze || isSqueeze) {
    phase = "SQUEEZE_WATCH";
  }
  const cvdTrend = cvdInfo.takerBuyRatio >= 0.54 ? "ACCUMULATION" : cvdInfo.takerBuyRatio <= 0.46 ? "DISTRIBUTION" : "BALANCED";
  const tradePlan = buildTradePlan({
    direction,
    lastPrice,
    atr: atr14,
    support1: pivots.support1,
    resistance1: pivots.resistance1,
    smcZone: patternSuite.smcZone,
    isExplosivePreMove: (phase === "PRE_PUMP" || phase === "PRE_DUMP") && sharpMoveScore >= 62,
    gateReasonEn,
    gateReasonFa
  });
  const topPat = allPatterns[0];
  const mtfSummaryEn = mtf ? `MTF ${mtf.alignedTimeframes}/3 (${mtf.alignmentLabel.replace("_", " ")})` : "";
  const mtfSummaryFa = mtf ? `\u062A\u0627\u06CC\u06CC\u062F ${mtf.alignedTimeframes}/3 \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645` : "";
  const summaryEn = phase === "PRE_PUMP" ? `Pre-Pump \u226520% (${mtfSummaryEn || timeframe}): ${volMetrics.ratio20}x vol + ${Math.round(cvdInfo.takerBuyRatio * 100)}% buy${ttm.isSqueeze ? ` \xB7 TTM ${ttm.squeezeBars}b` : ""}${topPat ? ` \xB7 ${topPat.nameEn}` : ""}.` : phase === "PRE_DUMP" ? `Pre-Dump \u226520% (${mtfSummaryEn || timeframe}): ${Math.round(100 - cvdInfo.takerBuyRatio * 100)}% sell delta + ${volMetrics.ratio20}x vol${ttm.isSqueeze ? ` \xB7 TTM ${ttm.squeezeBars}b` : ""}${topPat ? ` \xB7 ${topPat.nameEn}` : ""}.` : direction === "LONG" ? `Bullish ${mtfSummaryEn || timeframe} confluence (${rawConfidence}%): SuperTrend/Kumo aligned${topPat ? ` with ${topPat.nameEn}` : ""}.` : direction === "SHORT" ? `Bearish ${mtfSummaryEn || timeframe} confluence (${rawConfidence}%): Downside regime${topPat ? ` with ${topPat.nameEn}` : ""}.` : gateReasonEn ? `${gateReasonEn}.` : isSqueeze ? `Volatility squeeze (${ttm.isSqueeze ? `TTM ${ttm.squeezeBars}b` : `P${Math.round(bb.widthPercentile)}`}). Awaiting MTF & volume breakout trigger.` : `Balanced MTF regime; awaiting 1H/4H structure break or suspicious volume.`;
  const summaryFa = phase === "PRE_PUMP" ? `\u0647\u0634\u062F\u0627\u0631 \u067E\u06CC\u0634\u200C\u0627\u0632\u200C\u067E\u0627\u0645\u067E +\u06F2\u06F0\u066A (${mtfSummaryFa || timeframe}): \u062D\u062C\u0645 ${volMetrics.ratio20}x \u0628\u0627 ${Math.round(cvdInfo.takerBuyRatio * 100)}\u066A \u062E\u0631\u06CC\u062F${ttm.isSqueeze ? ` \xB7 \u0641\u0634\u0631\u062F\u06AF\u06CC ${ttm.squeezeBars} \u06A9\u0646\u062F\u0644` : ""}${topPat ? ` \xB7 ${topPat.nameFa}` : ""}.` : phase === "PRE_DUMP" ? `\u0647\u0634\u062F\u0627\u0631 \u067E\u06CC\u0634\u200C\u0627\u0632\u200C\u062F\u0627\u0645\u067E -\u06F2\u06F0\u066A (${mtfSummaryFa || timeframe}): \u0641\u0634\u0627\u0631 \u0641\u0631\u0648\u0634 ${Math.round(100 - cvdInfo.takerBuyRatio * 100)}\u066A \u0648 \u062D\u062C\u0645 ${volMetrics.ratio20}x${ttm.isSqueeze ? ` \xB7 \u0641\u0634\u0631\u062F\u06AF\u06CC ${ttm.squeezeBars} \u06A9\u0646\u062F\u0644` : ""}${topPat ? ` \xB7 ${topPat.nameFa}` : ""}.` : direction === "LONG" ? `\u0647\u0645\u200C\u06AF\u0631\u0627\u06CC\u06CC \u0635\u0639\u0648\u062F\u06CC ${mtfSummaryFa || timeframe} (${rawConfidence}\u066A): \u0633\u0648\u067E\u0631\u062A\u0631\u0646\u062F \u0648 \u0627\u06CC\u0686\u06CC\u0645\u0648\u06A9\u0648 \u0647\u0645\u200C\u062C\u0647\u062A${topPat ? ` \u0628\u0627 ${topPat.nameFa}` : ""}.` : direction === "SHORT" ? `\u0647\u0645\u200C\u06AF\u0631\u0627\u06CC\u06CC \u0646\u0632\u0648\u0644\u06CC ${mtfSummaryFa || timeframe} (${rawConfidence}\u066A): \u0641\u0634\u0627\u0631 \u0633\u0627\u062E\u062A\u0627\u0631 \u0646\u0632\u0648\u0644\u06CC${topPat ? ` \u0628\u0627 ${topPat.nameFa}` : ""}.` : gateReasonFa ? `${gateReasonFa}.` : isSqueeze ? `\u0641\u0634\u0631\u062F\u06AF\u06CC \u0646\u0648\u0633\u0627\u0646 (${ttm.isSqueeze ? `TTM ${ttm.squeezeBars} \u06A9\u0646\u062F\u0644` : `\u0635\u062F\u06A9 ${Math.round(bb.widthPercentile)}`}) \u0641\u0639\u0627\u0644\u061B \u0645\u0646\u062A\u0638\u0631 \u0634\u06A9\u0633\u062A \u0647\u0645\u200C\u0632\u0645\u0627\u0646 \u062D\u062C\u0645 \u0648 \u0633\u0627\u062E\u062A\u0627\u0631.` : `\u062A\u0639\u0627\u062F\u0644 \u062F\u0631 \u062A\u0627\u06CC\u0645\u200C\u0641\u0631\u06CC\u0645\u200C\u0647\u0627\u06CC \u06F1 \u0648 \u06F4 \u0633\u0627\u0639\u062A\u0647\u061B \u062F\u0631 \u0627\u0646\u062A\u0638\u0627\u0631 \u062A\u0631\u06CC\u06AF\u0631 \u0634\u06A9\u0633\u062A \u06CC\u0627 \u062D\u062C\u0645 \u0645\u0634\u06A9\u0648\u06A9.`;
  const { conclusionEn, conclusionFa } = buildComprehensiveConclusion({
    baseAsset,
    timeframe,
    lastPrice,
    direction,
    phase,
    confidence: rawConfidence,
    pumpProbability,
    dumpProbability,
    sharpMoveScore,
    sharpMoveBias,
    suspiciousScore: volMetrics.suspiciousScore,
    volumeRatio20: volMetrics.ratio20,
    volumeZScore: volMetrics.zScore,
    takerBuyRatio: cvdInfo.takerBuyRatio,
    cvdTrend,
    cvdDivergence,
    obvBreakout,
    isSqueeze,
    ttmSqueeze: ttm.isSqueeze,
    squeezeBars: ttm.squeezeBars,
    atrExpansionRatio: compression.atrExpansionRatio,
    isVcpTightening: compression.isVcpTightening,
    isAbsorption: compression.isAbsorption,
    donchianPos: donchian.posPct,
    bbWidthPercentile: Math.round(bb.widthPercentile),
    rsi14,
    stochK: stoch.k,
    stochD: stoch.d,
    macdHist: macd.histogram,
    ema9,
    ema21,
    ema50,
    ema200,
    vwap,
    adx14: adxInfo.adx,
    plusDi: adxInfo.plusDi,
    minusDi: adxInfo.minusDi,
    superTrendDir: superTrend.direction,
    ichimokuState: ichimoku.cloudState,
    cmf20,
    mfi14,
    smcZone: patternSuite.smcZone,
    smcStructure: patternSuite.smcStructure,
    patterns: allPatterns,
    mtf,
    gateReasonEn,
    gateReasonFa,
    fundingRate,
    oiDeltaPct,
    orderBook,
    wickSignal,
    support1: roundPrice(pivots.support1, lastPrice),
    resistance1: roundPrice(pivots.resistance1, lastPrice),
    tradePlan
  });
  const backtest = runQuickBacktest(candles);
  return {
    symbol,
    baseAsset,
    timeframe,
    lastPrice,
    markPrice,
    priceChangePct,
    quoteVolume24h,
    openInterestUsd,
    oiDeltaPct,
    fundingRate,
    direction,
    phase,
    confidence: rawConfidence,
    pumpProbability,
    dumpProbability,
    sharpMoveScore,
    sharpMoveBias,
    suspiciousVolumeScore: volMetrics.suspiciousScore,
    volumeZScore: volMetrics.zScore,
    volumeRatio20: volMetrics.ratio20,
    takerBuyRatio: Number(cvdInfo.takerBuyRatio.toFixed(3)),
    cvdTrend,
    isSqueeze,
    indicators: {
      rsi14: Number(rsi14.toFixed(2)),
      stochK: Number(stoch.k.toFixed(1)),
      stochD: Number(stoch.d.toFixed(1)),
      macdLine: macd.macdLine,
      macdSignal: macd.signalLine,
      macdHist: macd.histogram,
      ema9,
      ema21,
      ema50,
      ema200,
      bbUpper,
      bbMiddle,
      bbLower,
      bbWidthPct: Number(bbWidthPct.toFixed(2)),
      bbWidthPercentile: Math.round(bb.widthPercentile),
      ttmSqueeze: ttm.isSqueeze,
      squeezeBars: ttm.squeezeBars,
      ttmMomentum: ttm.momentum,
      atr14,
      atrPct: Number(atrPct.toFixed(2)),
      atrExpansionRatio: compression.atrExpansionRatio,
      vwap,
      adx14: Number(adxInfo.adx.toFixed(1)),
      plusDi: Number(adxInfo.plusDi.toFixed(1)),
      minusDi: Number(adxInfo.minusDi.toFixed(1)),
      obvSlope: Number(obvSlope.toFixed(2)),
      cvdDivergence,
      obvBreakout,
      donchianPos: donchian.posPct,
      superTrendDir: superTrend.direction,
      superTrendValue: roundPrice(superTrend.value, lastPrice),
      ichimokuState: ichimoku.cloudState,
      cmf20: Number(cmf20.toFixed(3)),
      mfi14: Number(mfi14.toFixed(1)),
      smcZone: patternSuite.smcZone,
      support1: roundPrice(pivots.support1, lastPrice),
      support2: roundPrice(pivots.support2, lastPrice),
      resistance1: roundPrice(pivots.resistance1, lastPrice),
      resistance2: roundPrice(pivots.resistance2, lastPrice),
      wickSignal
    },
    patterns: allPatterns,
    mtf,
    tradePlan,
    factors,
    summaryEn,
    summaryFa,
    conclusionEn,
    conclusionFa,
    candles,
    series: {
      ema9: ema9Arr,
      ema21: ema21Arr,
      ema50: ema50Arr,
      bbUpper: bb.upper,
      bbLower: bb.lower,
      vwap: vwapArr,
      rsi: rsiArr,
      macdLine: macdSeries.macdLine,
      macdSignal: macdSeries.signalLine,
      macdHist: macdSeries.histogram,
      cvd: cvdInfo.series
    },
    orderBook,
    recentTrades,
    backtest,
    analyzedAt: Date.now()
  };
}

// src/utils/futuresContracts.ts
function getPairAssets(symbol) {
  if (symbol.includes("-SWAP-")) {
    const [base, quote] = symbol.split("-SWAP-");
    return { baseAsset: base, quoteAsset: quote || "USDT" };
  }
  if (symbol.endsWith("USDC")) {
    return { baseAsset: symbol.replace(/USDC$/, ""), quoteAsset: "USDC" };
  }
  return { baseAsset: symbol.replace(/USDT$/, ""), quoteAsset: "USDT" };
}
function isValidActiveFuturesContract(contract, now = Date.now()) {
  const symbol = typeof contract.symbol === "string" ? contract.symbol.trim() : "";
  if (!symbol) return false;
  if (symbol.startsWith("TBV_")) return false;
  if (!symbol.includes("-SWAP-")) return false;
  if (contract.status !== "TRADING") return false;
  const { quoteAsset: parsedQuote } = getPairAssets(symbol);
  const quote = (contract.quoteAsset || parsedQuote || "").toUpperCase();
  if (quote !== "USDT" && quote !== "USDC") return false;
  if (contract.closingStartTime && Number(contract.closingStartTime) > 0) {
    if (now >= Number(contract.closingStartTime)) {
      return false;
    }
  }
  return true;
}
function isValidMarketTickerRow(symbol, activeContracts, lastPrice) {
  if (!symbol || symbol.startsWith("TBV_")) return false;
  if (!symbol.includes("-SWAP-")) return false;
  if (!symbol.endsWith("-SWAP-USDT") && !symbol.endsWith("-SWAP-USDC")) return false;
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return false;
  if (activeContracts && activeContracts.size > 0) {
    return activeContracts.has(symbol);
  }
  return true;
}

// src/utils/alerts.ts
var PEGGED_STABLECOINS = /* @__PURE__ */ new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "DAI",
  "BUSD",
  "USDE",
  "PYUSD",
  "USDP",
  "EURC",
  "EURT",
  "USDD",
  "RLUSD",
  "USTC",
  "FRAX",
  "LUSD",
  "GUSD",
  "CRVUSD",
  "PAXG_STABLE"
]);
function isPeggedStablecoin(baseAsset) {
  const clean = baseAsset.trim().toUpperCase().replace(/^1000/, "");
  return PEGGED_STABLECOINS.has(clean);
}
function classifyAlertSide(alert) {
  if (alert.phase === "PRE_PUMP" || alert.phase === "PUMP_ACTIVE") return "PUMP";
  if (alert.phase === "PRE_DUMP" || alert.phase === "DUMP_ACTIVE") return "DUMP";
  if (alert.direction === "LONG") return "PUMP";
  if (alert.direction === "SHORT") return "DUMP";
  const pumpProb = alert.pumpProbability ?? 0;
  const dumpProb = alert.dumpProbability ?? 0;
  return pumpProb >= dumpProb ? "PUMP" : "DUMP";
}
function getAlertProbability(alert) {
  const side = classifyAlertSide(alert);
  if (side === "PUMP") {
    const raw2 = alert.pumpProbability;
    return typeof raw2 === "number" && Number.isFinite(raw2) ? raw2 : alert.confidence;
  }
  const raw = alert.dumpProbability;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : alert.confidence;
}
function getTimeframeHorizon(timeframe) {
  switch (timeframe) {
    case "1m":
      return {
        barsMin: 30,
        barsMax: 90,
        hoursMin: 0.5,
        hoursMax: 1.5,
        windowEn: "30\u201390m",
        windowFa: "\u06F3\u06F0 \u062A\u0627 \u06F9\u06F0 \u062F\u0642\u06CC\u0642\u0647 \u0622\u06CC\u0646\u062F\u0647"
      };
    case "5m":
      return {
        barsMin: 12,
        barsMax: 48,
        hoursMin: 1,
        hoursMax: 4,
        windowEn: "1\u20134h",
        windowFa: "\u06F1 \u062A\u0627 \u06F4 \u0633\u0627\u0639\u062A \u0622\u06CC\u0646\u062F\u0647"
      };
    case "15m":
      return {
        barsMin: 8,
        barsMax: 24,
        hoursMin: 2,
        hoursMax: 6,
        windowEn: "2\u20136h",
        windowFa: "\u06F2 \u062A\u0627 \u06F6 \u0633\u0627\u0639\u062A \u0622\u06CC\u0646\u062F\u0647"
      };
    case "30m":
      return {
        barsMin: 6,
        barsMax: 16,
        hoursMin: 3,
        hoursMax: 8,
        windowEn: "3\u20138h",
        windowFa: "\u06F3 \u062A\u0627 \u06F8 \u0633\u0627\u0639\u062A \u0622\u06CC\u0646\u062F\u0647"
      };
    case "1h":
      return {
        barsMin: 4,
        barsMax: 12,
        hoursMin: 4,
        hoursMax: 12,
        windowEn: "4\u201312h",
        windowFa: "\u06F4 \u062A\u0627 \u06F1\u06F2 \u0633\u0627\u0639\u062A \u0622\u06CC\u0646\u062F\u0647"
      };
    case "4h":
      return {
        barsMin: 3,
        barsMax: 9,
        hoursMin: 12,
        hoursMax: 36,
        windowEn: "12\u201336h",
        windowFa: "\u06F1\u06F2 \u062A\u0627 \u06F3\u06F6 \u0633\u0627\u0639\u062A \u0622\u06CC\u0646\u062F\u0647"
      };
    case "1d":
      return {
        barsMin: 1,
        barsMax: 3,
        hoursMin: 24,
        hoursMax: 72,
        windowEn: "24\u201372h",
        windowFa: "\u06F1 \u062A\u0627 \u06F3 \u0631\u0648\u0632 \u0622\u06CC\u0646\u062F\u0647"
      };
    case "1w":
      return {
        barsMin: 1,
        barsMax: 2,
        hoursMin: 72,
        hoursMax: 168,
        windowEn: "3\u20137d",
        windowFa: "\u06F3 \u062A\u0627 \u06F7 \u0631\u0648\u0632 \u0622\u06CC\u0646\u062F\u0647"
      };
    case "1M":
      return {
        barsMin: 1,
        barsMax: 2,
        hoursMin: 168,
        hoursMax: 360,
        windowEn: "7\u201315d",
        windowFa: "\u06F1 \u062A\u0627 \u06F2 \u0647\u0641\u062A\u0647 \u0622\u06CC\u0646\u062F\u0647"
      };
    default:
      return {
        barsMin: 4,
        barsMax: 12,
        hoursMin: 4,
        hoursMax: 12,
        windowEn: "4\u201312h",
        windowFa: "\u06F4 \u062A\u0627 \u06F1\u06F2 \u0633\u0627\u0639\u062A \u0622\u06CC\u0646\u062F\u0647"
      };
  }
}
function clampVal(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function round1(v) {
  return Math.round(v * 10) / 10;
}
function estimateExpectedPriceMove(analysis) {
  const horizon = getTimeframeHorizon(analysis.timeframe);
  const isDump = analysis.phase === "PRE_DUMP" || analysis.phase === "DUMP_ACTIVE" || analysis.direction === "SHORT" || analysis.direction === "NEUTRAL" && analysis.dumpProbability > analysis.pumpProbability;
  const sign = isDump ? -1 : 1;
  const refPrice = analysis.tradePlan.optimalEntry > 0 ? analysis.tradePlan.optimalEntry : analysis.lastPrice;
  const safePrice = refPrice > 0 ? refPrice : 1;
  const atrPct = clampVal(
    analysis.indicators.atrPct > 0 ? analysis.indicators.atrPct : 1.4,
    0.25,
    14
  );
  const squeezeFactor = analysis.indicators.ttmSqueeze ? 1.32 + Math.min(0.24, analysis.indicators.squeezeBars * 0.025) : analysis.indicators.bbWidthPercentile <= 25 ? 1.24 : 1;
  const volumeFactor = 1 + clampVal((analysis.volumeRatio20 - 1.1) * 0.16, 0, 0.48);
  const mtfAligned = analysis.mtf?.alignedTimeframes ?? 0;
  const mtfFactor = mtfAligned >= 3 ? 1.18 : mtfAligned === 2 ? 1.08 : 0.96;
  const catalystMult = clampVal(squeezeFactor * volumeFactor * mtfFactor, 0.9, 2.15);
  const volLow = atrPct * Math.sqrt(horizon.barsMin) * 0.85 * catalystMult;
  const volHigh = atrPct * Math.sqrt(horizon.barsMax) * 1.05 * catalystMult;
  const tp1Dist = analysis.tradePlan.tp1 > 0 ? Math.abs(analysis.tradePlan.tp1 - safePrice) / safePrice * 100 : volLow;
  const tp2Dist = analysis.tradePlan.tp2 > 0 ? Math.abs(analysis.tradePlan.tp2 - safePrice) / safePrice * 100 : volHigh * 0.85;
  const tp3Dist = analysis.tradePlan.tp3 > 0 ? Math.abs(analysis.tradePlan.tp3 - safePrice) / safePrice * 100 : volHigh * 1.15;
  const structuralHigh = tp2Dist * 0.5 + tp3Dist * 0.5;
  const sharpWeight = clampVal((analysis.sharpMoveScore - 50) / 100, 0, 0.35);
  let absMin = clampVal(volLow * (0.55 - sharpWeight * 0.2) + tp1Dist * (0.45 + sharpWeight * 0.2), 0.8, 35);
  let absMax = clampVal(volHigh * (0.52 + sharpWeight * 0.15) + structuralHigh * (0.48 - sharpWeight * 0.15), absMin + 0.8, 65);
  absMin = round1(absMin);
  absMax = round1(Math.max(absMin + 0.6, absMax));
  return {
    expectedMoveMinPct: Number((sign * absMin).toFixed(1)),
    expectedMoveMaxPct: Number((sign * absMax).toFixed(1)),
    expectedHorizonHoursMin: horizon.hoursMin,
    expectedHorizonHoursMax: horizon.hoursMax,
    expectedWindowEn: horizon.windowEn,
    expectedWindowFa: horizon.windowFa
  };
}
function estimateAlertFallbackMove(alert) {
  if (typeof alert.expectedMoveMinPct === "number" && typeof alert.expectedMoveMaxPct === "number" && alert.expectedWindowEn && alert.expectedWindowFa) {
    return {
      expectedMoveMinPct: alert.expectedMoveMinPct,
      expectedMoveMaxPct: alert.expectedMoveMaxPct,
      expectedHorizonHoursMin: alert.expectedHorizonHoursMin ?? 4,
      expectedHorizonHoursMax: alert.expectedHorizonHoursMax ?? 12,
      expectedWindowEn: alert.expectedWindowEn,
      expectedWindowFa: alert.expectedWindowFa
    };
  }
  const horizon = getTimeframeHorizon(alert.timeframe);
  const side = classifyAlertSide(alert);
  const sign = side === "DUMP" ? -1 : 1;
  const ref = alert.optimalEntry && alert.optimalEntry > 0 ? alert.optimalEntry : alert.price;
  const safeRef = ref > 0 ? ref : 1;
  const prob = getAlertProbability(alert);
  const tp1Pct = alert.tp1 && alert.tp1 > 0 ? Math.abs(alert.tp1 - safeRef) / safeRef * 100 : clampVal(prob * 0.075, 2.5, 14);
  const tp2Pct = alert.tp2 && alert.tp2 > 0 ? Math.abs(alert.tp2 - safeRef) / safeRef * 100 : tp1Pct * 1.75;
  const tp3Pct = alert.tp3 && alert.tp3 > 0 ? Math.abs(alert.tp3 - safeRef) / safeRef * 100 : tp1Pct * 2.5;
  const minPct = round1(clampVal(tp1Pct, 0.8, 35));
  const maxPct = round1(clampVal((tp2Pct + tp3Pct) * 0.5, minPct + 0.8, 65));
  return {
    expectedMoveMinPct: Number((sign * minPct).toFixed(1)),
    expectedMoveMaxPct: Number((sign * maxPct).toFixed(1)),
    expectedHorizonHoursMin: horizon.hoursMin,
    expectedHorizonHoursMax: horizon.hoursMax,
    expectedWindowEn: horizon.windowEn,
    expectedWindowFa: horizon.windowFa
  };
}
function evaluateAlertQualification(analysis) {
  const expectedMove = estimateExpectedPriceMove(analysis);
  const isDumpSide = analysis.phase === "PRE_DUMP" || analysis.phase === "DUMP_ACTIVE" || analysis.direction === "SHORT";
  const side = isDumpSide ? "DUMP" : "PUMP";
  const sideProb = side === "PUMP" ? analysis.pumpProbability : analysis.dumpProbability;
  const oppProb = side === "PUMP" ? analysis.dumpProbability : analysis.pumpProbability;
  const probEdge = sideProb - oppProb;
  const alignedTimeframes = analysis.mtf?.alignedTimeframes ?? 0;
  const fail = (rejectReason) => ({
    qualified: false,
    side,
    probability: sideProb,
    qualityGrade: "B",
    qualityScore: 0,
    alignedTimeframes,
    expectedMove,
    rejectReason
  });
  if (isPeggedStablecoin(analysis.baseAsset)) {
    return fail("pegged_stablecoin");
  }
  if (analysis.direction === "NEUTRAL" || analysis.tradePlan.action === "WAIT") {
    return fail("neutral_direction");
  }
  if (side === "PUMP" && analysis.direction !== "LONG" || side === "DUMP" && analysis.direction !== "SHORT") {
    return fail("side_direction_mismatch");
  }
  if (analysis.quoteVolume24h > 0 && analysis.quoteVolume24h < 4e5) {
    return fail("low_liquidity");
  }
  if (analysis.orderBook && analysis.orderBook.spreadPct > 0.55) {
    return fail("wide_spread");
  }
  if (analysis.confidence < 64) {
    return fail("low_confidence");
  }
  if (sideProb < 60) {
    return fail("low_side_probability");
  }
  if (probEdge < 15) {
    return fail("weak_directional_edge");
  }
  if (analysis.tradePlan.riskReward1 < 1.1 || analysis.tradePlan.riskReward2 < 1.55) {
    return fail("poor_risk_reward");
  }
  if (analysis.mtf) {
    const lbl = analysis.mtf.alignmentLabel;
    if (side === "PUMP" && (lbl === "STRONG_BEAR" || lbl === "BEAR_CONFLUENCE")) {
      return fail("counter_htf_bear");
    }
    if (side === "DUMP" && (lbl === "STRONG_BULL" || lbl === "BULL_CONFLUENCE")) {
      return fail("counter_htf_bull");
    }
    const isExplosiveBreakoutException = alignedTimeframes >= 1 && analysis.sharpMoveScore >= 76 && analysis.suspiciousVolumeScore >= 55 && analysis.volumeRatio20 >= 1.8;
    if (alignedTimeframes < 2 && !isExplosiveBreakoutException) {
      return fail("insufficient_mtf_alignment");
    }
  }
  const takerBuy = analysis.takerBuyRatio;
  const hasVolumeOrSqueezeCatalyst = analysis.volumeRatio20 >= 1.2 || analysis.suspiciousVolumeScore >= 40 || analysis.indicators.ttmSqueeze || analysis.indicators.obvBreakout === (side === "PUMP" ? "BULLISH" : "BEARISH");
  if (!hasVolumeOrSqueezeCatalyst) {
    return fail("missing_volume_or_squeeze_catalyst");
  }
  if (side === "PUMP") {
    const takerConfirmed = takerBuy >= 0.51 || analysis.indicators.cvdDivergence === "BULLISH" && takerBuy >= 0.485;
    if (!takerConfirmed) {
      return fail("negative_taker_flow_for_pump");
    }
    if (analysis.priceChangePct >= 24 || analysis.indicators.rsi14 >= 82 && analysis.indicators.cmf20 < 0.05) {
      return fail("pump_exhausted_top");
    }
  } else {
    const takerConfirmed = takerBuy <= 0.49 || analysis.indicators.cvdDivergence === "BEARISH" && takerBuy <= 0.515;
    if (!takerConfirmed) {
      return fail("positive_taker_flow_for_dump");
    }
    if (analysis.priceChangePct <= -24 || analysis.indicators.rsi14 <= 18 && analysis.indicators.cmf20 > -0.05) {
      return fail("dump_exhausted_bottom");
    }
  }
  const confPillar = clampVal((analysis.confidence - 55) * 0.75, 0, 28);
  const probPillar = clampVal((sideProb - 50) * 0.5 + Math.min(10, probEdge * 0.25), 0, 28);
  const mtfPillar = alignedTimeframes >= 3 ? 18 : alignedTimeframes === 2 ? 13 : 6;
  const flowImbalance = Math.abs(takerBuy - 0.5) * 100;
  const flowPillar = clampVal(
    (analysis.volumeRatio20 >= 2 ? 9 : analysis.volumeRatio20 >= 1.3 ? 6 : 3) + Math.min(7, flowImbalance * 0.6),
    0,
    16
  );
  const rrPillar = clampVal((analysis.tradePlan.riskReward2 - 1.5) * 4, 0, 10);
  const qualityScore = Math.round(clampVal(confPillar + probPillar + mtfPillar + flowPillar + rrPillar, 50, 99));
  const qualityGrade = qualityScore >= 84 ? "A+" : qualityScore >= 72 ? "A" : "B";
  return {
    qualified: true,
    side,
    probability: sideProb,
    qualityGrade,
    qualityScore,
    alignedTimeframes,
    expectedMove
  };
}

// src/utils/alertTracker.ts
function initializeOutcomeFromAlert(alert) {
  const side = classifyAlertSide(alert);
  const entryPrice = alert.optimalEntry && alert.optimalEntry > 0 ? alert.optimalEntry : alert.price;
  const fallbackMove = estimateAlertFallbackMove(alert);
  const horizonMax = alert.expectedHorizonHoursMax ?? fallbackMove.expectedHorizonHoursMax;
  const defaultSl = side === "PUMP" ? Number((entryPrice * 0.975).toFixed(6)) : Number((entryPrice * 1.025).toFixed(6));
  return {
    alertId: alert.id,
    symbol: alert.symbol,
    baseAsset: alert.baseAsset,
    side,
    qualityGrade: alert.qualityGrade ?? "B",
    timeframe: alert.timeframe,
    entryPrice,
    stopLoss: alert.stopLoss && alert.stopLoss > 0 ? alert.stopLoss : defaultSl,
    expectedMoveMinPct: Math.abs(fallbackMove.expectedMoveMinPct),
    expectedMoveMaxPct: Math.abs(fallbackMove.expectedMoveMaxPct),
    startedAt: alert.timestamp,
    expiresAt: alert.timestamp + Math.max(4, horizonMax) * 36e5,
    lastPrice: alert.price,
    mfePct: 0,
    maePct: 0,
    status: "TRACKING",
    lastEvaluatedAt: alert.timestamp
  };
}
function evaluateAlertOutcomeWithPrice(record, livePrice, now = Date.now()) {
  if (record.status !== "TRACKING") {
    return record;
  }
  if (!livePrice || !Number.isFinite(livePrice) || livePrice <= 0 || record.entryPrice <= 0) {
    return record;
  }
  const isPump = record.side === "PUMP";
  const signedMovePct = isPump ? (livePrice - record.entryPrice) / record.entryPrice * 100 : (record.entryPrice - livePrice) / record.entryPrice * 100;
  const nextMfe = Number(Math.max(record.mfePct, Math.max(0, signedMovePct)).toFixed(2));
  const nextMae = Number(Math.max(record.maePct, Math.max(0, -signedMovePct)).toFixed(2));
  const hitSl = isPump ? livePrice <= record.stopLoss : livePrice >= record.stopLoss;
  const hitTarget = nextMfe >= record.expectedMoveMinPct;
  let status = record.status;
  let closedAt = record.closedAt;
  if (hitTarget) {
    status = "HIT_TARGET";
    closedAt = now;
  } else if (hitSl) {
    status = "INVALIDATED";
    closedAt = now;
  } else if (now >= record.expiresAt) {
    status = nextMfe >= Math.max(1.2, record.expectedMoveMinPct * 0.45) && signedMovePct > 0 ? "EXPIRED_PROFIT" : "INVALIDATED";
    closedAt = now;
  }
  return {
    ...record,
    lastPrice: livePrice,
    mfePct: nextMfe,
    maePct: nextMae,
    status,
    closedAt,
    lastEvaluatedAt: now
  };
}
function computeAlertAccuracySummary(records) {
  const grades = ["A+", "A", "B"];
  const resolved = records.filter((r) => r.status !== "TRACKING");
  const wins = resolved.filter((r) => r.status === "HIT_TARGET" || r.status === "EXPIRED_PROFIT");
  const avgMfePct = records.length > 0 ? Number((records.reduce((acc, r) => acc + r.mfePct, 0) / records.length).toFixed(2)) : 0;
  const avgMaePct = records.length > 0 ? Number((records.reduce((acc, r) => acc + r.maePct, 0) / records.length).toFixed(2)) : 0;
  const byGrade = grades.map((grade) => {
    const group = records.filter((r) => r.qualityGrade === grade);
    const gResolved = group.filter((r) => r.status !== "TRACKING");
    const gWins = gResolved.filter((r) => r.status === "HIT_TARGET" || r.status === "EXPIRED_PROFIT");
    return {
      grade,
      total: group.length,
      resolved: gResolved.length,
      wins: gWins.length,
      winRatePct: gResolved.length > 0 ? Math.round(gWins.length / gResolved.length * 100) : 0,
      avgMfePct: group.length > 0 ? Number((group.reduce((acc, r) => acc + r.mfePct, 0) / group.length).toFixed(2)) : 0,
      avgMaePct: group.length > 0 ? Number((group.reduce((acc, r) => acc + r.maePct, 0) / group.length).toFixed(2)) : 0
    };
  });
  return {
    totalTracked: records.length,
    resolvedCount: resolved.length,
    trackingCount: records.length - resolved.length,
    winsCount: wins.length,
    overallWinRatePct: resolved.length > 0 ? Math.round(wins.length / resolved.length * 100) : 0,
    avgMfePct,
    avgMaePct,
    byGrade
  };
}

// server/webhookNotifier.ts
import fs from "fs";

// src/utils/webhook.ts
var DEFAULT_WEBHOOK_CONFIG = {
  enabled: true,
  discordWebhookUrl: "",
  telegramWebhookUrl: "",
  minConfidence: 75
};
function isIpv4PrivateOrLoopback(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) {
    return false;
  }
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => n < 0 || n > 255)) return true;
  const [a, b] = nums;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
function isBlockedWebhookHost(hostname) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    return true;
  }
  if (isIpv4PrivateOrLoopback(host)) {
    return true;
  }
  if (!host.includes(".")) {
    return true;
  }
  return false;
}
function validateDiscordWebhookUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, normalized: "" };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, normalized: trimmed, error: "Invalid Discord webhook URL format." };
  }
  if (parsed.protocol !== "https:") {
    return { valid: false, normalized: trimmed, error: "Discord webhook URL must use HTTPS." };
  }
  if (isBlockedWebhookHost(parsed.hostname)) {
    return { valid: false, normalized: trimmed, error: "Private or local hosts are not allowed." };
  }
  const host = parsed.hostname.toLowerCase();
  const isDiscordHost = host === "discord.com" || host === "discordapp.com" || host === "ptb.discord.com" || host === "canary.discord.com";
  if (!isDiscordHost) {
    return {
      valid: false,
      normalized: trimmed,
      error: "Host must be discord.com or discordapp.com."
    };
  }
  const webhookPathPattern = /^\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9._-]+$/i;
  if (!webhookPathPattern.test(parsed.pathname)) {
    return {
      valid: false,
      normalized: trimmed,
      error: "Expected Discord format: https://discord.com/api/webhooks/<id>/<token>"
    };
  }
  return { valid: true, normalized: parsed.toString() };
}
function validateTelegramWebhookUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, normalized: "" };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, normalized: trimmed, error: "Invalid Telegram webhook URL format." };
  }
  if (parsed.protocol !== "https:") {
    return { valid: false, normalized: trimmed, error: "Telegram webhook URL must use HTTPS." };
  }
  if (isBlockedWebhookHost(parsed.hostname)) {
    return { valid: false, normalized: trimmed, error: "Private or local hosts are not allowed." };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "api.telegram.org") {
    const botSendPattern = /^\/bot[0-9]+:[A-Za-z0-9_-]+\/sendMessage$/i;
    if (!botSendPattern.test(parsed.pathname)) {
      return {
        valid: false,
        normalized: trimmed,
        error: "Expected Telegram Bot API path: /bot<TOKEN>/sendMessage?chat_id=<ID>"
      };
    }
    const chatId = parsed.searchParams.get("chat_id")?.trim();
    if (!chatId) {
      return {
        valid: false,
        normalized: trimmed,
        error: "Telegram Bot API URL requires ?chat_id=<CHAT_ID>."
      };
    }
    return {
      valid: true,
      normalized: parsed.toString(),
      mode: "bot_api",
      targetUrl: `${parsed.origin}${parsed.pathname}`,
      chatId
    };
  }
  if (host === "discord.com" || host === "discordapp.com" || host === "ptb.discord.com" || host === "canary.discord.com") {
    return {
      valid: false,
      normalized: trimmed,
      error: "Discord URLs belong in the Discord Webhook field."
    };
  }
  return {
    valid: true,
    normalized: parsed.toString(),
    mode: "relay",
    targetUrl: parsed.toString()
  };
}
function clampWebhookConfidence(value) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_WEBHOOK_CONFIG.minConfidence;
  return Math.max(50, Math.min(95, Math.round(num)));
}
function validateWebhookConfig(input) {
  const safeInput = input ?? {};
  const discordCheck = validateDiscordWebhookUrl(
    typeof safeInput.discordWebhookUrl === "string" ? safeInput.discordWebhookUrl : ""
  );
  const telegramCheck = validateTelegramWebhookUrl(
    typeof safeInput.telegramWebhookUrl === "string" ? safeInput.telegramWebhookUrl : ""
  );
  const errors = {};
  if (!discordCheck.valid && discordCheck.error) {
    errors.discord = discordCheck.error;
  }
  if (!telegramCheck.valid && telegramCheck.error) {
    errors.telegram = telegramCheck.error;
  }
  return {
    valid: discordCheck.valid && telegramCheck.valid,
    config: {
      enabled: Boolean(safeInput.enabled),
      discordWebhookUrl: discordCheck.normalized,
      telegramWebhookUrl: telegramCheck.normalized,
      minConfidence: clampWebhookConfidence(safeInput.minConfidence)
    },
    errors
  };
}
function shouldPushWebhookSignal(signal, config) {
  if (!config.enabled) return false;
  if (!config.discordWebhookUrl.trim() && !config.telegramWebhookUrl.trim()) {
    return false;
  }
  if (signal.direction === "NEUTRAL") return false;
  return signal.confidence >= config.minConfidence;
}
function formatNum(value) {
  if (!Number.isFinite(value) || value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e3) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(4);
  if (abs >= 0.01) return value.toFixed(5);
  return value.toFixed(6);
}
function escapeHtml(raw) {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function formatPairDisplay(symbol, baseAsset) {
  if (symbol.includes("-SWAP-")) {
    const parts = symbol.split("-SWAP-");
    if (parts.length === 2 && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
  }
  return `${baseAsset}/USDT`;
}
function buildDiscordWebhookPayload(signal) {
  const pair = formatPairDisplay(signal.symbol, signal.baseAsset);
  const isBull2 = signal.direction === "LONG";
  const color = isBull2 ? 1096065 : 16007006;
  const emoji = isBull2 ? "\u{1F7E2}" : "\u{1F534}";
  const estMoveText = typeof signal.expectedMoveMinPct === "number" && typeof signal.expectedMoveMaxPct === "number" ? `${signal.expectedMoveMinPct >= 0 ? "+" : ""}${signal.expectedMoveMinPct}% to ${signal.expectedMoveMaxPct >= 0 ? "+" : ""}${signal.expectedMoveMaxPct}% (${signal.expectedWindowEn ?? "4\u201312h"})` : null;
  return {
    username: "ToobitPulse",
    embeds: [
      {
        title: `${emoji} ${pair} \xB7 ${signal.direction} (${signal.confidence}%${signal.qualityGrade ? ` \xB7 Grade ${signal.qualityGrade}` : ""})`,
        description: signal.summaryEn,
        color,
        fields: [
          { name: "Phase", value: `${signal.phase} (${signal.timeframe})`, inline: true },
          { name: "Last Price", value: `$${formatNum(signal.lastPrice)}`, inline: true },
          { name: "Sharp \u226520%", value: `${signal.sharpMoveScore}%`, inline: true },
          ...estMoveText ? [{ name: "Est. Move", value: estMoveText, inline: true }] : [],
          { name: "Optimal Entry", value: `$${formatNum(signal.tradePlan.optimalEntry)}`, inline: true },
          { name: "Stop Loss", value: `$${formatNum(signal.tradePlan.stopLoss)}`, inline: true },
          { name: "TP1 / TP2", value: `$${formatNum(signal.tradePlan.tp1)} / $${formatNum(signal.tradePlan.tp2)}`, inline: true },
          { name: "Vol Z-Score", value: `${signal.volumeZScore.toFixed(2)}\u03C3`, inline: true },
          { name: "R:R (TP2)", value: `1:${signal.tradePlan.riskReward2.toFixed(2)}`, inline: true }
        ],
        footer: { text: "ToobitPulse Institutional Futures Scanner" },
        timestamp: new Date(signal.analyzedAt || Date.now()).toISOString()
      }
    ]
  };
}
function buildTelegramWebhookPayload(signal, target) {
  const pair = formatPairDisplay(signal.symbol, signal.baseAsset);
  const emoji = signal.direction === "LONG" ? "\u{1F7E2}" : "\u{1F534}";
  const estMoveText = typeof signal.expectedMoveMinPct === "number" && typeof signal.expectedMoveMaxPct === "number" ? `${signal.expectedMoveMinPct >= 0 ? "+" : ""}${signal.expectedMoveMinPct}% to ${signal.expectedMoveMaxPct >= 0 ? "+" : ""}${signal.expectedMoveMaxPct}% (${signal.expectedWindowEn ?? "4\u201312h"})` : null;
  const htmlText = [
    `${emoji} <b>ToobitPulse Alert \u2014 ${escapeHtml(pair)}${signal.qualityGrade ? ` [${escapeHtml(signal.qualityGrade)}]` : ""}</b>`,
    `<b>Direction:</b> ${escapeHtml(signal.direction)} | <b>Phase:</b> ${escapeHtml(signal.phase)} (${escapeHtml(signal.timeframe)})`,
    `<b>Confidence:</b> ${signal.confidence}% | <b>Sharp \u226520%:</b> ${signal.sharpMoveScore}% | <b>Vol Z:</b> ${signal.volumeZScore.toFixed(2)}\u03C3`,
    ...estMoveText ? [`<b>Est. Move:</b> ${escapeHtml(estMoveText)}`] : [],
    `<b>Price:</b> $${formatNum(signal.lastPrice)} | <b>Entry:</b> $${formatNum(signal.tradePlan.optimalEntry)}`,
    `<b>SL:</b> $${formatNum(signal.tradePlan.stopLoss)} | <b>TP1:</b> $${formatNum(signal.tradePlan.tp1)} | <b>TP2:</b> $${formatNum(signal.tradePlan.tp2)}`,
    `<b>R:R:</b> 1:${signal.tradePlan.riskReward2.toFixed(2)}`,
    "",
    escapeHtml(signal.summaryEn)
  ].join("\n");
  if (target.mode === "bot_api") {
    return {
      chat_id: target.chatId,
      text: htmlText,
      parse_mode: "HTML",
      disable_web_page_preview: true
    };
  }
  const plainText = [
    `${emoji} ToobitPulse Alert \u2014 ${pair}`,
    `Direction: ${signal.direction} | Phase: ${signal.phase} (${signal.timeframe})`,
    `Confidence: ${signal.confidence}% | Sharp >=20%: ${signal.sharpMoveScore}% | Vol Z: ${signal.volumeZScore.toFixed(2)}\u03C3`,
    ...estMoveText ? [`Est. Move: ${estMoveText}`] : [],
    `Price: $${formatNum(signal.lastPrice)} | Entry: $${formatNum(signal.tradePlan.optimalEntry)}`,
    `SL: $${formatNum(signal.tradePlan.stopLoss)} | TP1: $${formatNum(signal.tradePlan.tp1)} | TP2: $${formatNum(signal.tradePlan.tp2)}`,
    signal.summaryEn
  ].join("\n");
  return {
    source: "ToobitPulse",
    text: plainText,
    signal: {
      symbol: signal.symbol,
      pair,
      timeframe: signal.timeframe,
      direction: signal.direction,
      phase: signal.phase,
      confidence: signal.confidence,
      sharpMoveScore: signal.sharpMoveScore,
      expectedMoveMinPct: signal.expectedMoveMinPct,
      expectedMoveMaxPct: signal.expectedMoveMaxPct,
      expectedWindow: signal.expectedWindowEn,
      qualityGrade: signal.qualityGrade,
      lastPrice: signal.lastPrice,
      volumeZScore: signal.volumeZScore,
      entry: signal.tradePlan.optimalEntry,
      stopLoss: signal.tradePlan.stopLoss,
      tp1: signal.tradePlan.tp1,
      tp2: signal.tradePlan.tp2,
      tp3: signal.tradePlan.tp3,
      riskReward2: signal.tradePlan.riskReward2,
      summary: signal.summaryEn,
      analyzedAt: signal.analyzedAt
    }
  };
}

// server/webhookNotifier.ts
var PERSIST_PATH = "/tmp/toobitpulse-webhooks.json";
var COOLDOWN_MS = 15 * 60 * 1e3;
var REQUEST_TIMEOUT_MS = 6e3;
var WebhookNotifier = class {
  constructor(options) {
    this.config = { ...DEFAULT_WEBHOOK_CONFIG };
    this.cooldowns = /* @__PURE__ */ new Map();
    this.deliveryLogs = [];
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.persistPath = options?.persistPath === void 0 ? PERSIST_PATH : options.persistPath;
    this.loadFromDisk();
  }
  loadFromDisk() {
    if (!this.persistPath) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(raw);
      const checked = validateWebhookConfig(parsed);
      if (checked.valid) {
        this.config = checked.config;
      }
    } catch {
    }
  }
  saveToDisk() {
    if (!this.persistPath) return;
    try {
      fs.writeFileSync(this.persistPath, JSON.stringify(this.config, null, 2), "utf8");
    } catch {
    }
  }
  getConfig() {
    return { ...this.config };
  }
  getLogs() {
    return [...this.deliveryLogs];
  }
  updateConfig(input) {
    const checked = validateWebhookConfig(input);
    if (!checked.valid) {
      return {
        ok: false,
        config: this.getConfig(),
        errors: checked.errors
      };
    }
    this.config = checked.config;
    this.saveToDisk();
    return {
      ok: true,
      config: this.getConfig(),
      errors: {}
    };
  }
  recordLog(entry) {
    this.deliveryLogs.unshift(entry);
    if (this.deliveryLogs.length > 20) {
      this.deliveryLogs.length = 20;
    }
  }
  async postJson(platform, url, payload, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const now = Date.now();
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      let errorMsg;
      if (!response.ok) {
        try {
          const text = await response.text();
          errorMsg = text ? text.slice(0, 180) : `HTTP ${response.status}`;
        } catch {
          errorMsg = `HTTP ${response.status}`;
        }
      }
      const log = {
        id: `${platform}-${signal.symbol}-${now}`,
        timestamp: now,
        platform,
        symbol: signal.symbol,
        confidence: signal.confidence,
        ok: response.ok,
        statusCode: response.status,
        ...errorMsg ? { error: errorMsg } : {}
      };
      this.recordLog(log);
      return log;
    } catch (err) {
      const msg = err instanceof Error ? err.name === "AbortError" ? "Request timed out (6s)" : err.message : "Network error";
      const log = {
        id: `${platform}-${signal.symbol}-${now}`,
        timestamp: now,
        platform,
        symbol: signal.symbol,
        confidence: signal.confidence,
        ok: false,
        statusCode: null,
        error: msg
      };
      this.recordLog(log);
      return log;
    } finally {
      clearTimeout(timer);
    }
  }
  async dispatchSignal(signal, configOverride) {
    const cfg = configOverride ?? this.config;
    const tasks = [];
    if (cfg.discordWebhookUrl.trim()) {
      const discordTarget = validateDiscordWebhookUrl(cfg.discordWebhookUrl);
      if (discordTarget.valid && discordTarget.normalized) {
        const payload = buildDiscordWebhookPayload(signal);
        tasks.push(this.postJson("discord", discordTarget.normalized, payload, signal));
      }
    }
    if (cfg.telegramWebhookUrl.trim()) {
      const telegramTarget = validateTelegramWebhookUrl(cfg.telegramWebhookUrl);
      if (telegramTarget.valid && telegramTarget.targetUrl) {
        const payload = buildTelegramWebhookPayload(signal, telegramTarget);
        tasks.push(this.postJson("telegram", telegramTarget.targetUrl, payload, signal));
      }
    }
    if (tasks.length === 0) return [];
    return Promise.all(tasks);
  }
  async evaluateAndPushSignal(analysis) {
    if (!shouldPushWebhookSignal(analysis, this.config)) {
      return [];
    }
    const key = `${analysis.symbol}:${analysis.direction}`;
    const now = Date.now();
    const lastSent = this.cooldowns.get(key) ?? 0;
    if (now - lastSent < COOLDOWN_MS) {
      return [];
    }
    this.cooldowns.set(key, now);
    const hasFullIndicators = Boolean(analysis.indicators);
    if (hasFullIndicators) {
      const qual = evaluateAlertQualification(analysis);
      const enriched = {
        ...analysis,
        expectedMoveMinPct: qual.expectedMove.expectedMoveMinPct,
        expectedMoveMaxPct: qual.expectedMove.expectedMoveMaxPct,
        expectedWindowEn: qual.expectedMove.expectedWindowEn,
        qualityGrade: qual.qualified ? qual.qualityGrade : void 0
      };
      return this.dispatchSignal(enriched, this.config);
    }
    return this.dispatchSignal(analysis, this.config);
  }
  async sendTestWebhook(overrideInput) {
    const cfgToTest = overrideInput ? validateWebhookConfig({ ...this.config, ...overrideInput, enabled: true }) : { valid: true, config: { ...this.config, enabled: true }, errors: {} };
    if (!cfgToTest.valid) {
      return { valid: false, errors: cfgToTest.errors, results: [] };
    }
    const hasDiscord = Boolean(cfgToTest.config.discordWebhookUrl.trim());
    const hasTelegram = Boolean(cfgToTest.config.telegramWebhookUrl.trim());
    if (!hasDiscord && !hasTelegram) {
      return {
        valid: false,
        errors: { discord: "Enter a Discord or Telegram webhook URL first." },
        results: []
      };
    }
    const now = Date.now();
    const sampleSignal = {
      symbol: "BTC-SWAP-USDT",
      baseAsset: "BTC",
      timeframe: "1h",
      direction: "LONG",
      phase: "PRE_PUMP",
      confidence: Math.max(84, cfgToTest.config.minConfidence),
      sharpMoveScore: 81,
      expectedMoveMinPct: 4.8,
      expectedMoveMaxPct: 11.4,
      expectedWindowEn: "4\u201312h",
      qualityGrade: "A+",
      lastPrice: 95250,
      volumeZScore: 2.85,
      summaryEn: "Test Alert from ToobitPulse: MTF 1H/4H/1D bullish confluence with TTM squeeze release and rising taker accumulation.",
      tradePlan: {
        optimalEntry: 95100,
        stopLoss: 93800,
        tp1: 96900,
        tp2: 98800,
        tp3: 101500,
        riskReward2: 2.85
      },
      analyzedAt: now
    };
    const results = await this.dispatchSignal(sampleSignal, cfgToTest.config);
    return { valid: true, errors: {}, results };
  }
};
var webhookNotifier = new WebhookNotifier();

// server/toobitService.ts
var BASE_URL = "https://api.toobit.com";
var WS_URL = "wss://stream.toobit.com/quote/ws/v1";
async function fetchJson(path2, timeoutMs = 8e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path2}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ToobitPulse-Scanner/2.0"
      }
    });
    if (!res.ok) {
      throw new Error(`Toobit HTTP ${res.status} on ${path2}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
function parseAssetName(symbol) {
  return getPairAssets(symbol);
}
var ToobitFuturesService = class {
  constructor() {
    this.tickers = [];
    this.tickerMap = /* @__PURE__ */ new Map();
    this.activeContracts = /* @__PURE__ */ new Map();
    this.multiplierMap = /* @__PURE__ */ new Map();
    this.historyMap = /* @__PURE__ */ new Map();
    this.opportunitiesByTf = /* @__PURE__ */ new Map();
    this.activeScanPromises = /* @__PURE__ */ new Map();
    this.analysisCache = /* @__PURE__ */ new Map();
    this.htfCandleCache = /* @__PURE__ */ new Map();
    this.alerts = [];
    this.alertOutcomes = /* @__PURE__ */ new Map();
    this.alertCooldown = /* @__PURE__ */ new Map();
    this.dirtyTickers = /* @__PURE__ */ new Map();
    this.streamListeners = /* @__PURE__ */ new Set();
    this.subscribedSymbols = /* @__PURE__ */ new Set();
    this.ws = null;
    this.wsConnected = false;
    this.wsPingTimer = null;
    this.lastMarketSync = 0;
    this.lastScanSync = 0;
    this.lastContractSync = 0;
    this.isScanning = false;
    this.scanTotal = 0;
    this.scannedCount = 0;
    this.lastError = null;
    this.started = false;
  }
  start() {
    if (this.started) return;
    this.started = true;
    void this.bootstrap();
    setInterval(() => {
      void this.refreshMarketBatch();
    }, 2500);
    setInterval(() => {
      this.flushDirtyTicks();
    }, 450);
  }
  scheduleNextScan() {
    setTimeout(() => {
      void this.runScannerCycle("1h").finally(() => {
        this.scheduleNextScan();
      });
    }, 45e3);
  }
  async bootstrap() {
    await this.refreshMarketBatch();
    this.connectWebSocket();
    await this.runScannerCycle("1h");
    this.scheduleNextScan();
  }
  addStreamListener(listener) {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }
  emitStream(event) {
    for (const listener of this.streamListeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
  flushDirtyTicks() {
    if (this.dirtyTickers.size === 0) return;
    const ticks = Array.from(this.dirtyTickers.values());
    this.dirtyTickers.clear();
    this.emitStream({
      type: "ticks",
      ticks,
      serverTime: Date.now()
    });
  }
  connectWebSocket() {
    if (typeof WebSocket === "undefined") return;
    try {
      if (this.ws) {
        this.ws.close();
      }
    } catch {
    }
    try {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      ws.onopen = () => {
        this.wsConnected = true;
        this.subscribeTopSymbols();
        if (this.wsPingTimer) clearInterval(this.wsPingTimer);
        this.wsPingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ ping: Date.now() }));
          }
        }, 2e4);
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          if (payload.topic === "realtimes" && Array.isArray(payload.data)) {
            for (const item of payload.data) {
              this.applyWsRealtimeTick(item);
            }
          }
        } catch {
        }
      };
      ws.onclose = () => {
        this.wsConnected = false;
        if (this.wsPingTimer) {
          clearInterval(this.wsPingTimer);
          this.wsPingTimer = null;
        }
        setTimeout(() => this.connectWebSocket(), 2500);
      };
      ws.onerror = () => {
        this.wsConnected = false;
      };
    } catch {
      this.wsConnected = false;
      setTimeout(() => this.connectWebSocket(), 4e3);
    }
  }
  subscribeSymbolsBatch(symbols) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || symbols.length === 0) return;
    const chunkSize = 25;
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      for (const s of chunk) this.subscribedSymbols.add(s);
      this.ws.send(
        JSON.stringify({
          symbol: chunk.join(","),
          topic: "realtimes",
          event: "sub",
          params: { binary: false }
        })
      );
    }
  }
  subscribeTopSymbols() {
    const top = this.tickers.slice(0, 65).map((t) => t.symbol);
    if (top.length === 0) {
      top.push("BTC-SWAP-USDT", "ETH-SWAP-USDT", "SOL-SWAP-USDT", "XRP-SWAP-USDT", "DOGE-SWAP-USDT");
    }
    this.subscribeSymbolsBatch(top);
  }
  focusSymbol(symbol) {
    if (!symbol) return;
    if (!this.subscribedSymbols.has(symbol)) {
      this.subscribeSymbolsBatch([symbol]);
    }
  }
  applyWsRealtimeTick(item) {
    const symbol = item.s;
    const existing = this.tickerMap.get(symbol);
    if (!existing) return;
    const lastPrice = Number(item.c);
    if (!Number.isFinite(lastPrice) || lastPrice <= 0) return;
    const open24h = Number(item.o) || existing.open24h;
    const high24h = Number(item.h) || existing.high24h;
    const low24h = Number(item.l) || existing.low24h;
    const mult = this.multiplierMap.get(symbol) ?? 1;
    const volume24h = (Number(item.v) || 0) * mult || existing.volume24h;
    const quoteVolume24h = Number(item.qv) || existing.quoteVolume24h;
    const priceChange = lastPrice - open24h;
    const priceChangePct = item.m !== void 0 ? Number(item.m) * 100 : open24h > 0 ? priceChange / open24h * 100 : existing.priceChangePct;
    const indexBasisPct = existing.markPrice > 0 ? Number(((lastPrice - existing.markPrice) / existing.markPrice * 100).toFixed(4)) : existing.indexBasisPct;
    const updated = {
      ...existing,
      lastPrice,
      open24h,
      high24h,
      low24h,
      volume24h,
      quoteVolume24h,
      priceChange,
      priceChangePct,
      indexBasisPct,
      openInterestUsd: existing.openInterest * lastPrice,
      updatedAt: item.t || Date.now()
    };
    this.tickerMap.set(symbol, updated);
    this.dirtyTickers.set(symbol, updated);
    this.lastMarketSync = Date.now();
    this.evaluateOutcomeForSymbol(symbol, lastPrice);
  }
  evaluateOutcomeForSymbol(symbol, livePrice, now = Date.now()) {
    if (!livePrice || livePrice <= 0 || this.alertOutcomes.size === 0) return;
    for (const [id, rec] of this.alertOutcomes.entries()) {
      if (rec.symbol === symbol && rec.status === "TRACKING") {
        const next = evaluateAlertOutcomeWithPrice(rec, livePrice, now);
        if (next !== rec) {
          this.alertOutcomes.set(id, next);
        }
      }
    }
  }
  evaluateOutcomesWithTickers(now = Date.now()) {
    if (this.alertOutcomes.size === 0) return;
    for (const [id, rec] of this.alertOutcomes.entries()) {
      if (rec.status !== "TRACKING") continue;
      const tk = this.tickerMap.get(rec.symbol);
      if (tk && tk.lastPrice > 0) {
        const next = evaluateAlertOutcomeWithPrice(rec, tk.lastPrice, now);
        if (next !== rec) {
          this.alertOutcomes.set(id, next);
        }
      }
    }
  }
  async ensureContractSpecs(force = false) {
    const now = Date.now();
    const cacheAge = now - this.lastContractSync;
    const ttl = this.activeContracts.size > 0 ? 10 * 60 * 1e3 : 5e3;
    if (!force && cacheAge < ttl && this.activeContracts.size > 0) {
      return;
    }
    try {
      const info = await fetchJson("/api/v1/exchangeInfo");
      const nextActive = /* @__PURE__ */ new Map();
      const nextMult = /* @__PURE__ */ new Map();
      for (const c of info.contracts || []) {
        if (!isValidActiveFuturesContract(c, now) || !c.symbol) continue;
        nextActive.set(c.symbol, c);
        if (c.contractMultiplier) {
          const mult = Number(c.contractMultiplier);
          if (Number.isFinite(mult) && mult > 0) {
            nextMult.set(c.symbol, mult);
          }
        }
      }
      if (nextActive.size > 0) {
        this.activeContracts = nextActive;
        this.multiplierMap = nextMult;
        this.lastContractSync = now;
      }
    } catch {
    }
  }
  isActiveFuturesSymbol(symbol) {
    if (this.activeContracts.size > 0) {
      return this.activeContracts.has(symbol);
    }
    return isValidMarketTickerRow(symbol, null, 1);
  }
  async refreshMarketBatch() {
    try {
      await this.ensureContractSpecs();
      const [rawTickers, rawFunding, rawMark] = await Promise.all([
        fetchJson("/quote/v1/contract/ticker/24hr"),
        fetchJson("/api/v1/futures/fundingRate").catch(() => []),
        fetchJson("/quote/v1/markPrice").catch(() => [])
      ]);
      const fundingMap = /* @__PURE__ */ new Map();
      for (const f of rawFunding) {
        fundingMap.set(f.symbol, f);
      }
      const markMap = /* @__PURE__ */ new Map();
      for (const m of rawMark) {
        markMap.set(m.symbolId, m);
      }
      const now = Date.now();
      const parsed = [];
      const activeRegistry = this.activeContracts.size > 0 ? this.activeContracts : null;
      const validSymbolSet = /* @__PURE__ */ new Set();
      for (const item of rawTickers) {
        const symbol = item.s || item.si || "";
        const lastPrice = Number(item.c) || 0;
        if (!isValidMarketTickerRow(symbol, activeRegistry, lastPrice)) continue;
        const quoteVolume24h = Number(item.qv) || 0;
        const { baseAsset, quoteAsset } = parseAssetName(symbol);
        const markEntry = markMap.get(symbol);
        const markPrice = markEntry ? Number(markEntry.price) || lastPrice : lastPrice;
        const indexBasisPct = markPrice > 0 ? (lastPrice - markPrice) / markPrice * 100 : 0;
        const mult = this.multiplierMap.get(symbol) ?? 1;
        const openInterest = (Number(item.op) || 0) * mult;
        const openInterestUsd = openInterest * lastPrice;
        const fundEntry = fundingMap.get(symbol);
        const fundingRate = fundEntry ? Number(fundEntry.rate) || 0 : 0;
        const nextFundingTime = fundEntry?.nextFundingTime ? Number(fundEntry.nextFundingTime) : 0;
        const hist = this.historyMap.get(symbol) ?? [];
        hist.push({
          openInterest,
          quoteVolume: quoteVolume24h,
          price: lastPrice,
          time: now
        });
        if (hist.length > 40) hist.shift();
        this.historyMap.set(symbol, hist);
        let oiDeltaPct = 0;
        let volumeAccelPct = 0;
        if (hist.length >= 2) {
          const oldest = hist[0];
          if (oldest.openInterest > 0 && openInterest > 0) {
            oiDeltaPct = (openInterest - oldest.openInterest) / oldest.openInterest * 100;
          }
          if (oldest.quoteVolume > 0 && quoteVolume24h > oldest.quoteVolume) {
            volumeAccelPct = (quoteVolume24h - oldest.quoteVolume) / oldest.quoteVolume * 100;
          }
        }
        const prev = this.tickerMap.get(symbol);
        const ticker = {
          symbol,
          baseAsset,
          quoteAsset,
          lastPrice,
          markPrice,
          indexBasisPct: Number(indexBasisPct.toFixed(4)),
          open24h: Number(item.o) || lastPrice,
          high24h: Number(item.h) || lastPrice,
          low24h: Number(item.l) || lastPrice,
          priceChange: Number(item.pc) || 0,
          priceChangePct: (Number(item.pcp) || 0) * 100,
          volume24h: (Number(item.v) || 0) * mult,
          quoteVolume24h,
          openInterest,
          openInterestUsd,
          oiDeltaPct: Number(oiDeltaPct.toFixed(3)),
          fundingRate,
          nextFundingTime,
          volumeAccelPct: Number(volumeAccelPct.toFixed(3)),
          updatedAt: item.t || now
        };
        if (!prev || prev.lastPrice !== ticker.lastPrice || prev.fundingRate !== ticker.fundingRate || prev.markPrice !== ticker.markPrice) {
          this.dirtyTickers.set(symbol, ticker);
        }
        parsed.push(ticker);
        validSymbolSet.add(symbol);
        this.tickerMap.set(symbol, ticker);
      }
      for (const existingSym of this.tickerMap.keys()) {
        if (!validSymbolSet.has(existingSym)) {
          this.tickerMap.delete(existingSym);
          this.historyMap.delete(existingSym);
          this.dirtyTickers.delete(existingSym);
        }
      }
      if (activeRegistry) {
        for (const [tf, opps] of this.opportunitiesByTf.entries()) {
          const pruned = opps.filter((o) => activeRegistry.has(o.symbol));
          if (pruned.length !== opps.length) {
            this.opportunitiesByTf.set(tf, pruned);
          }
        }
      }
      parsed.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
      this.tickers = parsed;
      this.lastMarketSync = now;
      this.lastError = null;
      this.evaluateOutcomesWithTickers(now);
      return parsed;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "Market fetch failed";
      return this.tickers;
    }
  }
  getMarketTickers() {
    const freshTickers = this.tickers.map((t) => this.tickerMap.get(t.symbol) ?? t);
    return {
      tickers: freshTickers,
      updatedAt: this.lastMarketSync,
      wsConnected: this.wsConnected,
      error: this.lastError
    };
  }
  async fetchKlines(symbol, interval, limit = 120) {
    const raw = await fetchJson(
      `/quote/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`
    );
    return raw.map((k) => ({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      quoteVolume: Number(k[7]),
      tradesCount: Number(k[8]) || 0,
      takerBuyBaseVol: Number(k[9]) || 0,
      takerBuyQuoteVol: Number(k[10]) || 0
    }));
  }
  getHtfTtlMs(tf) {
    if (tf === "1d") return 10 * 60 * 1e3;
    if (tf === "4h") return 3 * 60 * 1e3;
    return 75 * 1e3;
  }
  async fetchCachedHtfKlines(symbol, tf, limit = 100) {
    const key = `${symbol}:${tf}`;
    const now = Date.now();
    const cached = this.htfCandleCache.get(key);
    if (cached && cached.expiresAt > now && cached.candles.length >= Math.min(40, limit)) {
      return cached.candles;
    }
    const fresh = await this.fetchKlines(symbol, tf, limit);
    if (fresh.length > 0) {
      if (this.htfCandleCache.size > 2600) {
        this.htfCandleCache.clear();
      }
      this.htfCandleCache.set(key, {
        candles: fresh,
        expiresAt: now + this.getHtfTtlMs(tf)
      });
    }
    return fresh;
  }
  async fetchOrderBook(symbol, limit = 30) {
    try {
      const raw = await fetchJson(
        `/quote/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`
      );
      const mult = this.multiplierMap.get(symbol) ?? 1;
      const bids = (raw.b || []).slice(0, limit).map(([p, q]) => {
        const price = Number(p);
        const qty = Number(q) * mult;
        return { price, qty, totalUsd: price * qty };
      });
      const asks = (raw.a || []).slice(0, limit).map(([p, q]) => {
        const price = Number(p);
        const qty = Number(q) * mult;
        return { price, qty, totalUsd: price * qty };
      });
      const bidDepthUsd = bids.reduce((acc, l) => acc + l.totalUsd, 0);
      const askDepthUsd = asks.reduce((acc, l) => acc + l.totalUsd, 0);
      const imbalanceRatio = askDepthUsd > 0 ? bidDepthUsd / askDepthUsd : 1;
      const bestBid = bids[0]?.price ?? 0;
      const bestAsk = asks[0]?.price ?? 0;
      const spreadPct = bestBid > 0 && bestAsk > 0 ? (bestAsk - bestBid) / bestBid * 100 : 0;
      const largestBidWall = bids.reduce(
        (best, curr) => !best || curr.totalUsd > best.totalUsd ? curr : best,
        null
      );
      const largestAskWall = asks.reduce(
        (best, curr) => !best || curr.totalUsd > best.totalUsd ? curr : best,
        null
      );
      return {
        bids,
        asks,
        bidDepthUsd,
        askDepthUsd,
        imbalanceRatio: Number(imbalanceRatio.toFixed(2)),
        spreadPct: Number(spreadPct.toFixed(4)),
        largestBidWall,
        largestAskWall,
        updatedAt: raw.t || Date.now()
      };
    } catch {
      return null;
    }
  }
  async fetchRecentTrades(symbol, limit = 40) {
    try {
      const raw = await fetchJson(
        `/quote/v1/trades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`
      );
      const mult = this.multiplierMap.get(symbol) ?? 1;
      return raw.map((t) => {
        const price = Number(t.p);
        const qty = Number(t.q) * mult;
        return {
          time: Number(t.t),
          price,
          qty,
          quoteUsd: price * qty,
          isBuyerMaker: Boolean(t.ibm)
        };
      });
    } catch {
      return [];
    }
  }
  async analyzeSymbol(symbol, timeframe = "1h") {
    await this.ensureContractSpecs();
    if (this.activeContracts.size > 0 && !this.activeContracts.has(symbol)) {
      throw new Error(`Contract ${symbol} is delisted or not an active Toobit Futures pair`);
    }
    if (!isValidMarketTickerRow(symbol, this.activeContracts.size > 0 ? this.activeContracts : null, 1)) {
      throw new Error(`Invalid Toobit Futures contract: ${symbol}`);
    }
    this.focusSymbol(symbol);
    const cacheKey = `${symbol}:${timeframe}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    if (this.tickers.length === 0) {
      await this.refreshMarketBatch();
    }
    const ticker = this.tickerMap.get(symbol);
    const { baseAsset } = parseAssetName(symbol);
    const [candles, orderBook, recentTrades, htf1h, htf4h, htf1d] = await Promise.all([
      this.fetchKlines(symbol, timeframe, 260),
      this.fetchOrderBook(symbol, 30),
      this.fetchRecentTrades(symbol, 40),
      timeframe === "1h" ? Promise.resolve(void 0) : this.fetchCachedHtfKlines(symbol, "1h", 110).catch(() => void 0),
      timeframe === "4h" ? Promise.resolve(void 0) : this.fetchCachedHtfKlines(symbol, "4h", 110).catch(() => void 0),
      timeframe === "1d" ? Promise.resolve(void 0) : this.fetchCachedHtfKlines(symbol, "1d", 90).catch(() => void 0)
    ]);
    const analysis = analyzeFuturesSymbol({
      symbol,
      baseAsset: ticker?.baseAsset ?? baseAsset,
      timeframe,
      candles,
      mtfCandles: {
        tf1h: timeframe === "1h" ? candles : htf1h,
        tf4h: timeframe === "4h" ? candles : htf4h,
        tf1d: timeframe === "1d" ? candles : htf1d
      },
      markPrice: ticker?.markPrice,
      indexBasisPct: ticker?.indexBasisPct ?? 0,
      priceChangePct: ticker?.priceChangePct ?? 0,
      quoteVolume24h: ticker?.quoteVolume24h ?? 0,
      openInterestUsd: ticker?.openInterestUsd ?? 0,
      oiDeltaPct: ticker?.oiDeltaPct ?? 0,
      fundingRate: ticker?.fundingRate ?? 0,
      orderBook,
      recentTrades
    });
    this.analysisCache.set(cacheKey, {
      data: analysis,
      expiresAt: Date.now() + 2e3
    });
    return analysis;
  }
  getAllOrderedScanSymbols(extraSymbols = []) {
    const picked = /* @__PURE__ */ new Map();
    for (const sym of extraSymbols) {
      const t = this.tickerMap.get(sym);
      if (t) picked.set(t.symbol, t);
    }
    for (const t of this.tickers.slice(0, 25)) {
      picked.set(t.symbol, t);
    }
    const byMover = [...this.tickers].sort(
      (a, b) => Math.abs(b.priceChangePct) - Math.abs(a.priceChangePct)
    );
    for (const t of byMover.slice(0, 20)) {
      picked.set(t.symbol, t);
    }
    const byFunding = [...this.tickers].sort(
      (a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate)
    );
    for (const t of byFunding.slice(0, 15)) {
      picked.set(t.symbol, t);
    }
    for (const t of this.tickers) {
      if (!picked.has(t.symbol)) {
        picked.set(t.symbol, t);
      }
    }
    return Array.from(picked.values());
  }
  buildOpportunityFromAnalysis(analysis, imbalanceRatio) {
    const topPat = analysis.patterns[0];
    return {
      symbol: analysis.symbol,
      baseAsset: analysis.baseAsset,
      timeframe: analysis.timeframe,
      lastPrice: analysis.lastPrice,
      markPrice: analysis.markPrice,
      priceChangePct: analysis.priceChangePct,
      quoteVolume24h: analysis.quoteVolume24h,
      openInterestUsd: analysis.openInterestUsd,
      oiDeltaPct: analysis.oiDeltaPct,
      fundingRate: analysis.fundingRate,
      direction: analysis.direction,
      phase: analysis.phase,
      confidence: analysis.confidence,
      pumpProbability: analysis.pumpProbability,
      dumpProbability: analysis.dumpProbability,
      sharpMoveScore: analysis.sharpMoveScore,
      sharpMoveBias: analysis.sharpMoveBias,
      ttmSqueeze: analysis.indicators.ttmSqueeze,
      squeezeBars: analysis.indicators.squeezeBars,
      cvdDivergence: analysis.indicators.cvdDivergence,
      suspiciousVolumeScore: analysis.suspiciousVolumeScore,
      volumeZScore: analysis.volumeZScore,
      volumeRatio20: analysis.volumeRatio20,
      takerBuyRatio: analysis.takerBuyRatio,
      rsi14: analysis.indicators.rsi14,
      bbWidthPercentile: analysis.indicators.bbWidthPercentile,
      isSqueeze: analysis.isSqueeze,
      imbalanceRatio,
      mtfAlignment: analysis.mtf?.alignmentLabel ?? null,
      alignedTimeframes: analysis.mtf?.alignedTimeframes ?? 0,
      topPatternEn: topPat?.nameEn ?? null,
      topPatternFa: topPat?.nameFa ?? null,
      optimalEntry: analysis.tradePlan.optimalEntry,
      stopLoss: analysis.tradePlan.stopLoss,
      tp1: analysis.tradePlan.tp1,
      tp2: analysis.tradePlan.tp2,
      tp3: analysis.tradePlan.tp3,
      support1: analysis.indicators.support1,
      resistance1: analysis.indicators.resistance1,
      smcZone: analysis.indicators.smcZone,
      riskReward2: analysis.tradePlan.riskReward2,
      suggestedMaxLeverage: analysis.tradePlan.suggestedMaxLeverage,
      summaryEn: analysis.summaryEn,
      summaryFa: analysis.summaryFa,
      analyzedAt: analysis.analyzedAt
    };
  }
  async runScannerCycle(timeframe = "1h", extraSymbols = []) {
    const inFlight = this.activeScanPromises.get(timeframe);
    if (inFlight) {
      return inFlight;
    }
    const scanPromise = this.executeFullFuturesScan(timeframe, extraSymbols).finally(() => {
      this.activeScanPromises.delete(timeframe);
    });
    this.activeScanPromises.set(timeframe, scanPromise);
    return scanPromise;
  }
  async executeFullFuturesScan(timeframe, extraSymbols) {
    this.isScanning = true;
    try {
      if (this.tickers.length === 0) {
        await this.refreshMarketBatch();
      }
      const allCandidates = this.getAllOrderedScanSymbols(extraSymbols);
      this.scanTotal = allCandidates.length;
      this.scannedCount = 0;
      const candleCache = /* @__PURE__ */ new Map();
      const finalAnalysisBySymbol = /* @__PURE__ */ new Map();
      const resultsBySymbol = /* @__PURE__ */ new Map();
      const queue = [...allCandidates];
      const concurrency = 24;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (queue.length > 0) {
            const ticker = queue.shift();
            if (!ticker) break;
            try {
              const latestTicker = this.tickerMap.get(ticker.symbol) ?? ticker;
              const candles = await this.fetchKlines(latestTicker.symbol, timeframe, 110);
              if (candles.length < 30) continue;
              candleCache.set(latestTicker.symbol, candles);
              if (timeframe === "1h" || timeframe === "4h" || timeframe === "1d") {
                this.htfCandleCache.set(`${latestTicker.symbol}:${timeframe}`, {
                  candles,
                  expiresAt: Date.now() + this.getHtfTtlMs(timeframe)
                });
              }
              const analysis = analyzeFuturesSymbol({
                symbol: latestTicker.symbol,
                baseAsset: latestTicker.baseAsset,
                timeframe,
                candles,
                markPrice: latestTicker.markPrice,
                indexBasisPct: latestTicker.indexBasisPct,
                priceChangePct: latestTicker.priceChangePct,
                quoteVolume24h: latestTicker.quoteVolume24h,
                openInterestUsd: latestTicker.openInterestUsd,
                oiDeltaPct: latestTicker.oiDeltaPct,
                fundingRate: latestTicker.fundingRate,
                orderBook: null
              });
              finalAnalysisBySymbol.set(latestTicker.symbol, analysis);
              resultsBySymbol.set(
                latestTicker.symbol,
                this.buildOpportunityFromAnalysis(analysis, null)
              );
            } catch {
            } finally {
              this.scannedCount += 1;
            }
          }
        })
      );
      const rankedInitial = Array.from(resultsBySymbol.values()).sort((a, b) => {
        const aScore = Math.max(a.pumpProbability, a.dumpProbability) * 0.45 + (a.sharpMoveScore ?? 0) * 0.35 + a.suspiciousVolumeScore * 0.2;
        const bScore = Math.max(b.pumpProbability, b.dumpProbability) * 0.45 + (b.sharpMoveScore ?? 0) * 0.35 + b.suspiciousVolumeScore * 0.2;
        return bScore - aScore;
      });
      const enrichSet = new Set(rankedInitial.slice(0, 80).map((o) => o.symbol));
      for (const sym of extraSymbols) {
        if (resultsBySymbol.has(sym)) enrichSet.add(sym);
      }
      const enrichQueue = Array.from(enrichSet);
      await Promise.all(
        Array.from({ length: 14 }, async () => {
          while (enrichQueue.length > 0) {
            const sym = enrichQueue.shift();
            if (!sym) break;
            try {
              const latestTicker = this.tickerMap.get(sym);
              const candles = candleCache.get(sym);
              if (!latestTicker || !candles) continue;
              const [orderBook, htf1h, htf4h, htf1d] = await Promise.all([
                this.fetchOrderBook(sym, 20),
                timeframe === "1h" ? Promise.resolve(candles) : this.fetchCachedHtfKlines(sym, "1h", 110).catch(() => void 0),
                timeframe === "4h" ? Promise.resolve(candles) : this.fetchCachedHtfKlines(sym, "4h", 110).catch(() => void 0),
                timeframe === "1d" ? Promise.resolve(candles) : this.fetchCachedHtfKlines(sym, "1d", 90).catch(() => void 0)
              ]);
              const analysis = analyzeFuturesSymbol({
                symbol: latestTicker.symbol,
                baseAsset: latestTicker.baseAsset,
                timeframe,
                candles,
                mtfCandles: {
                  tf1h: htf1h,
                  tf4h: htf4h,
                  tf1d: htf1d
                },
                markPrice: latestTicker.markPrice,
                indexBasisPct: latestTicker.indexBasisPct,
                priceChangePct: latestTicker.priceChangePct,
                quoteVolume24h: latestTicker.quoteVolume24h,
                openInterestUsd: latestTicker.openInterestUsd,
                oiDeltaPct: latestTicker.oiDeltaPct,
                fundingRate: latestTicker.fundingRate,
                orderBook
              });
              this.maybeRecordAlert(analysis);
              finalAnalysisBySymbol.set(sym, analysis);
              resultsBySymbol.set(
                sym,
                this.buildOpportunityFromAnalysis(analysis, orderBook?.imbalanceRatio ?? null)
              );
            } catch {
            }
          }
        })
      );
      for (const analysis of finalAnalysisBySymbol.values()) {
        if (isPeggedStablecoin(analysis.baseAsset)) continue;
        if (analysis.quoteVolume24h > 0 && analysis.quoteVolume24h < 4e5) continue;
        const qual = evaluateAlertQualification(analysis);
        if (qual.qualified) {
          void webhookNotifier.evaluateAndPushSignal(analysis);
        }
      }
      const finalResults = Array.from(resultsBySymbol.values()).sort((a, b) => {
        const aMtfBoost = (a.alignedTimeframes ?? 0) >= 2 ? 6 : 0;
        const bMtfBoost = (b.alignedTimeframes ?? 0) >= 2 ? 6 : 0;
        const aPreBoost = a.phase === "PRE_PUMP" || a.phase === "PRE_DUMP" ? 5 : 0;
        const bPreBoost = b.phase === "PRE_PUMP" || b.phase === "PRE_DUMP" ? 5 : 0;
        const aScore = Math.max(a.pumpProbability, a.dumpProbability) * 0.45 + (a.sharpMoveScore ?? 0) * 0.35 + a.suspiciousVolumeScore * 0.2 + aMtfBoost + aPreBoost;
        const bScore = Math.max(b.pumpProbability, b.dumpProbability) * 0.45 + (b.sharpMoveScore ?? 0) * 0.35 + b.suspiciousVolumeScore * 0.2 + bMtfBoost + bPreBoost;
        return bScore - aScore;
      });
      this.opportunitiesByTf.set(timeframe, finalResults);
      this.lastScanSync = Date.now();
      return finalResults;
    } finally {
      this.isScanning = this.activeScanPromises.size > 1;
    }
  }
  maybeRecordAlert(analysis) {
    const qualification = evaluateAlertQualification(analysis);
    if (!qualification.qualified) return;
    const key = `${analysis.symbol}:${qualification.side}`;
    const now = Date.now();
    const prev = this.alertCooldown.get(key);
    const COOLDOWN_MS2 = 12 * 60 * 1e3;
    const isMaterialUpgrade = prev !== void 0 && (qualification.probability >= prev.probability + 10 || qualification.qualityScore >= prev.qualityScore + 12);
    if (prev && now - prev.time < COOLDOWN_MS2 && !isMaterialUpgrade) {
      return;
    }
    this.alertCooldown.set(key, {
      time: now,
      probability: qualification.probability,
      qualityScore: qualification.qualityScore
    });
    const newAlert = {
      id: `${analysis.symbol}-${now}`,
      timestamp: now,
      symbol: analysis.symbol,
      baseAsset: analysis.baseAsset,
      timeframe: analysis.timeframe,
      phase: analysis.phase,
      direction: analysis.direction,
      confidence: analysis.confidence,
      pumpProbability: analysis.pumpProbability,
      dumpProbability: analysis.dumpProbability,
      price: analysis.lastPrice,
      optimalEntry: analysis.tradePlan.optimalEntry,
      stopLoss: analysis.tradePlan.stopLoss,
      tp1: analysis.tradePlan.tp1,
      tp2: analysis.tradePlan.tp2,
      tp3: analysis.tradePlan.tp3,
      suggestedMaxLeverage: analysis.tradePlan.suggestedMaxLeverage,
      volumeZScore: analysis.volumeZScore,
      qualityGrade: qualification.qualityGrade,
      qualityScore: qualification.qualityScore,
      alignedTimeframes: qualification.alignedTimeframes,
      expectedMoveMinPct: qualification.expectedMove.expectedMoveMinPct,
      expectedMoveMaxPct: qualification.expectedMove.expectedMoveMaxPct,
      expectedHorizonHoursMin: qualification.expectedMove.expectedHorizonHoursMin,
      expectedHorizonHoursMax: qualification.expectedMove.expectedHorizonHoursMax,
      expectedWindowEn: qualification.expectedMove.expectedWindowEn,
      expectedWindowFa: qualification.expectedMove.expectedWindowFa,
      riskReward1: analysis.tradePlan.riskReward1,
      takerBuyPct: Math.round(analysis.takerBuyRatio * 100),
      reasonEn: analysis.summaryEn,
      reasonFa: analysis.summaryFa
    };
    this.alerts = [
      newAlert,
      ...this.alerts.filter((existing) => {
        const existingSide = existing.direction === "SHORT" ? "DUMP" : "PUMP";
        return !(existing.symbol === analysis.symbol && existingSide === qualification.side);
      })
    ];
    if (this.alerts.length > 100) {
      this.alerts.length = 100;
    }
    this.alertOutcomes.set(newAlert.id, initializeOutcomeFromAlert(newAlert));
    if (this.alertOutcomes.size > 100) {
      const oldestKey = this.alertOutcomes.keys().next().value;
      if (oldestKey) this.alertOutcomes.delete(oldestKey);
    }
    this.emitStream({ type: "alerts", alerts: this.alerts });
  }
  async getScannerResults(timeframe = "1h", extraSymbols = []) {
    const existing = this.opportunitiesByTf.get(timeframe);
    if (!existing || existing.length === 0) {
      const results = await this.runScannerCycle(timeframe, extraSymbols);
      return {
        opportunities: results,
        updatedAt: this.lastScanSync,
        scanning: this.isScanning,
        scannedCount: this.scannedCount,
        scanTotal: this.scanTotal
      };
    }
    return {
      opportunities: existing,
      updatedAt: this.lastScanSync,
      scanning: this.isScanning,
      scannedCount: this.scannedCount,
      scanTotal: this.scanTotal
    };
  }
  getAlerts() {
    return this.alerts;
  }
  getAlertsWithAccuracy() {
    this.evaluateOutcomesWithTickers();
    const outcomes = Array.from(this.alertOutcomes.values()).sort((a, b) => b.startedAt - a.startedAt);
    return {
      alerts: this.alerts,
      outcomes,
      accuracy: computeAlertAccuracySummary(outcomes)
    };
  }
  getHealth() {
    return {
      ok: true,
      contractsCount: this.tickers.length,
      activeRegistryCount: this.activeContracts.size,
      wsConnected: this.wsConnected,
      subscribedCount: this.subscribedSymbols.size,
      lastMarketSync: this.lastMarketSync,
      lastScanSync: this.lastScanSync,
      isScanning: this.isScanning,
      scannedCount: this.scannedCount,
      scanTotal: this.scanTotal,
      alertsCount: this.alerts.length,
      error: this.lastError
    };
  }
};
var toobitService = new ToobitFuturesService();

// src/utils/socialSentiment.ts
var STRONG_BULL_TERMS = [
  "surge",
  "soar",
  "skyrocket",
  "breakout",
  "all-time high",
  "ath",
  "bullish",
  "etf approval",
  "approved",
  "inflow",
  "inflows",
  "accumulation",
  "rally",
  "moon",
  "institutional",
  "milestone",
  "outperform"
];
var MILD_BULL_TERMS = [
  "gain",
  "gains",
  "rise",
  "rises",
  "rising",
  "up ",
  "adoption",
  "partnership",
  "upgrade",
  "launch",
  "buy",
  "buying",
  "support",
  "rebound",
  "recover",
  "recovery",
  "growth",
  "positive",
  "optimism",
  "whale buy"
];
var STRONG_BEAR_TERMS = [
  "crash",
  "plunge",
  "collapse",
  "hack",
  "hacked",
  "exploit",
  "exploited",
  "bankrupt",
  "bankruptcy",
  "lawsuit",
  "bearish",
  "liquidation",
  "liquidated",
  "sell-off",
  "selloff",
  "dump",
  "scam",
  "fraud",
  "rug pull",
  "ban"
];
var MILD_BEAR_TERMS = [
  "drop",
  "drops",
  "fall",
  "falls",
  "falling",
  "decline",
  "fear",
  "slump",
  "outflow",
  "outflows",
  "resistance",
  "warning",
  "risk",
  "weak",
  "loss",
  "losses",
  "sell",
  "selling",
  "pressure",
  "concern"
];
function extractBaseAssetFromSymbol(symbol) {
  const upper = symbol.trim().toUpperCase();
  if (upper.includes("-SWAP-")) {
    return upper.split("-SWAP-")[0] || upper;
  }
  if (upper.endsWith("USDT") && upper.length > 4) {
    return upper.slice(0, -4);
  }
  if (upper.endsWith("USDC") && upper.length > 4) {
    return upper.slice(0, -4);
  }
  return upper;
}
function normalizeBaseTicker(baseAsset) {
  const cleaned = baseAsset.trim().toUpperCase().replace(/^10+(?=[A-Z]{2,})/, "");
  return cleaned || baseAsset.trim().toUpperCase();
}
function classifyMood(score) {
  if (score >= 55) return "BULLISH";
  if (score <= 45) return "BEARISH";
  return "NEUTRAL";
}
function scoreHeadlineSentiment(text) {
  const normalized = ` ${text.toLowerCase()} `;
  let delta = 0;
  for (const term of STRONG_BULL_TERMS) {
    if (normalized.includes(term)) delta += 16;
  }
  for (const term of MILD_BULL_TERMS) {
    if (normalized.includes(term)) delta += 8;
  }
  for (const term of STRONG_BEAR_TERMS) {
    if (normalized.includes(term)) delta -= 16;
  }
  for (const term of MILD_BEAR_TERMS) {
    if (normalized.includes(term)) delta -= 8;
  }
  const score = Math.max(5, Math.min(95, Math.round(50 + delta)));
  return {
    score,
    mood: classifyMood(score)
  };
}
function decodeXmlEntities(raw) {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function extractTagValue(block, tag) {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const match = block.match(regex);
  return match ? decodeXmlEntities(match[1]) : "";
}
function parseRssHeadlines(xml, source, limit = 18) {
  if (!xml) return [];
  const items = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemMatches) {
    if (items.length >= limit) break;
    const title = extractTagValue(block, "title");
    const link = extractTagValue(block, "link");
    const pubRaw = extractTagValue(block, "pubDate") || extractTagValue(block, "dc:date");
    if (!title || !link.startsWith("http")) continue;
    const parsedDate = pubRaw ? Date.parse(pubRaw) : NaN;
    items.push({
      title,
      link,
      publishedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now(),
      source
    });
  }
  return items;
}
function escapeRegExp(val) {
  return val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function matchesCoinMention(title, baseTicker, coinName) {
  const upperTicker = normalizeBaseTicker(baseTicker);
  if (coinName && coinName.trim().length >= 3) {
    const nameRegex = new RegExp(`\\b${escapeRegExp(coinName.trim())}\\b`, "i");
    if (nameRegex.test(title)) return true;
  }
  if (upperTicker.length >= 2) {
    const cashtagRegex = new RegExp(`\\$${escapeRegExp(upperTicker)}\\b`, "i");
    if (cashtagRegex.test(title)) return true;
  }
  if (upperTicker.length >= 3) {
    const tickerRegex = new RegExp(`\\b${escapeRegExp(upperTicker)}\\b`, "i");
    if (tickerRegex.test(title)) return true;
  }
  return false;
}
function aggregateSocialSentiment(input) {
  const normalizedTicker = normalizeBaseTicker(input.baseAsset);
  const fetchedAt = input.fetchedAt ?? Date.now();
  const hasCg = typeof input.coingeckoUpPct === "number" && Number.isFinite(input.coingeckoUpPct) && input.coingeckoUpPct >= 0 && input.coingeckoUpPct <= 100 && ((input.coingeckoUpPct ?? 0) > 0 || (input.coingeckoDownPct ?? 0) > 0);
  const cgScore = hasCg ? Math.round(input.coingeckoUpPct) : 50;
  const cgPlatform = {
    id: "coingecko",
    nameEn: "CoinGecko Community",
    nameFa: "\u0631\u0623\u06CC \u062C\u0627\u0645\u0639\u0647 \u06A9\u0648\u06CC\u0646\u200C\u06AF\u06A9\u0648",
    score: cgScore,
    mood: classifyMood(cgScore),
    available: hasCg,
    detailEn: hasCg ? `${cgScore}% bullish votes${input.watchlistUsers ? ` \xB7 ${input.watchlistUsers.toLocaleString("en-US")} watchlists` : ""}` : "Community vote breakdown unavailable for this token",
    detailFa: hasCg ? `${cgScore}\u066A \u0631\u0623\u06CC \u0635\u0639\u0648\u062F\u06CC${input.watchlistUsers ? ` \xB7 ${input.watchlistUsers.toLocaleString("en-US")} \u0648\u0627\u0686\u200C\u0644\u06CC\u0633\u062A` : ""}` : "\u0622\u0645\u0627\u0631 \u0631\u0623\u06CC \u062C\u0627\u0645\u0639\u0647 \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u062A\u0648\u06A9\u0646 \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0646\u06CC\u0633\u062A"
  };
  const hasFng = typeof input.fearGreedValue === "number" && Number.isFinite(input.fearGreedValue) && input.fearGreedValue >= 0 && input.fearGreedValue <= 100;
  const fngScore = hasFng ? Math.round(input.fearGreedValue) : 50;
  const fngPlatform = {
    id: "fear_greed",
    nameEn: "Crypto Fear & Greed",
    nameFa: "\u0634\u0627\u062E\u0635 \u062A\u0631\u0633 \u0648 \u0637\u0645\u0639 \u0628\u0627\u0632\u0627\u0631",
    score: fngScore,
    mood: classifyMood(fngScore),
    available: hasFng,
    detailEn: hasFng ? `${fngScore}/100 (${input.fearGreedLabel ?? "Index"})` : "Fear & Greed feed unavailable",
    detailFa: hasFng ? `${fngScore} \u0627\u0632 \u06F1\u06F0\u06F0 (${input.fearGreedLabel ?? "\u0634\u0627\u062E\u0635"})` : "\u0641\u06CC\u062F \u0634\u0627\u062E\u0635 \u062A\u0631\u0633 \u0648 \u0637\u0645\u0639 \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0646\u06CC\u0633\u062A"
  };
  const scoredHeadlines = input.rssItems.map((item) => {
    const scored = scoreHeadlineSentiment(item.title);
    const matchedCoin = matchesCoinMention(item.title, normalizedTicker, input.coinName);
    return {
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.link,
      sentiment: scored.mood,
      matchedCoin
    };
  });
  const coinMatched = scoredHeadlines.filter((h) => h.matchedCoin);
  let mediaScore = 50;
  const hasMedia = scoredHeadlines.length > 0;
  if (hasMedia) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < scoredHeadlines.length; i += 1) {
      const h = scoredHeadlines[i];
      const itemScore = scoreHeadlineSentiment(h.title).score;
      const w = h.matchedCoin ? 2.5 : 1;
      weightedSum += itemScore * w;
      totalWeight += w;
    }
    mediaScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  }
  const mediaPlatform = {
    id: "media_pulse",
    nameEn: "Crypto Media Pulse",
    nameFa: "\u0646\u0628\u0636 \u0631\u0633\u0627\u0646\u0647\u200C\u0647\u0627\u06CC \u06A9\u0631\u06CC\u067E\u062A\u0648",
    score: mediaScore,
    mood: classifyMood(mediaScore),
    available: hasMedia,
    detailEn: hasMedia ? `${coinMatched.length} ${normalizedTicker} mentions across ${scoredHeadlines.length} posts` : "Social/news feeds temporarily unavailable",
    detailFa: hasMedia ? `${coinMatched.length} \u0627\u0634\u0627\u0631\u0647 \u0645\u0633\u062A\u0642\u06CC\u0645 \u0628\u0647 ${normalizedTicker} \u062F\u0631 ${scoredHeadlines.length} \u062E\u0628\u0631` : "\u0641\u06CC\u062F \u062E\u0628\u0631\u06CC \u0645\u0648\u0642\u062A\u0627 \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0646\u06CC\u0633\u062A"
  };
  const platforms = [cgPlatform, mediaPlatform, fngPlatform];
  const weights = {
    coingecko: 0.45,
    media_pulse: 0.3,
    fear_greed: 0.25
  };
  let weightedScore = 0;
  let activeWeight = 0;
  for (const p of platforms) {
    if (!p.available) continue;
    const w = weights[p.id];
    weightedScore += p.score * w;
    activeWeight += w;
  }
  const moodScore = activeWeight > 0 ? Math.round(weightedScore / activeWeight) : 50;
  const mood = classifyMood(moodScore);
  const prioritizedHeadlines = [
    ...coinMatched,
    ...scoredHeadlines.filter((h) => !h.matchedCoin)
  ].sort((a, b) => {
    if (a.matchedCoin !== b.matchedCoin) return a.matchedCoin ? -1 : 1;
    return b.publishedAt - a.publishedAt;
  }).slice(0, 4);
  return {
    symbol: input.symbol,
    baseAsset: input.baseAsset,
    coinName: input.coinName,
    moodScore,
    mood,
    bullishPct: moodScore,
    bearishPct: Math.max(0, 100 - moodScore),
    fearGreedValue: hasFng ? fngScore : null,
    fearGreedLabel: input.fearGreedLabel,
    watchlistUsers: input.watchlistUsers,
    coinMentionsCount: coinMatched.length,
    platforms,
    headlines: prioritizedHeadlines,
    fetchedAt
  };
}

// server/socialSentimentService.ts
var KNOWN_COINGECKO_IDS = {
  BTC: { id: "bitcoin", name: "Bitcoin" },
  ETH: { id: "ethereum", name: "Ethereum" },
  SOL: { id: "solana", name: "Solana" },
  XRP: { id: "ripple", name: "XRP" },
  BNB: { id: "binancecoin", name: "BNB" },
  DOGE: { id: "dogecoin", name: "Dogecoin" },
  ADA: { id: "cardano", name: "Cardano" },
  AVAX: { id: "avalanche-2", name: "Avalanche" },
  TRX: { id: "tron", name: "TRON" },
  LINK: { id: "chainlink", name: "Chainlink" },
  TON: { id: "the-open-network", name: "Toncoin" },
  SUI: { id: "sui", name: "Sui" },
  PEPE: { id: "pepe", name: "Pepe" },
  SHIB: { id: "shiba-inu", name: "Shiba Inu" },
  DOT: { id: "polkadot", name: "Polkadot" },
  LTC: { id: "litecoin", name: "Litecoin" },
  BCH: { id: "bitcoin-cash", name: "Bitcoin Cash" },
  NEAR: { id: "near", name: "NEAR Protocol" },
  UNI: { id: "uniswap", name: "Uniswap" },
  APT: { id: "aptos", name: "Aptos" },
  ARB: { id: "arbitrum", name: "Arbitrum" },
  OP: { id: "optimism", name: "Optimism" },
  INJ: { id: "injective-protocol", name: "Injective" },
  AAVE: { id: "aave", name: "Aave" },
  WIF: { id: "dogwifcoin", name: "dogwifhat" },
  BONK: { id: "bonk", name: "Bonk" },
  FLOKI: { id: "floki", name: "FLOKI" },
  RENDER: { id: "render-token", name: "Render" },
  FET: { id: "fetch-ai", name: "Artificial Superintelligence Alliance" },
  TAO: { id: "bittensor", name: "Bittensor" },
  HBAR: { id: "hedera-hashgraph", name: "Hedera" },
  SEI: { id: "sei-network", name: "Sei" },
  TIA: { id: "celestia", name: "Celestia" },
  ATOM: { id: "cosmos", name: "Cosmos" },
  FIL: { id: "filecoin", name: "Filecoin" },
  XLM: { id: "stellar", name: "Stellar" }
};
var GLOBAL_CACHE_TTL_MS = 10 * 60 * 1e3;
var COIN_SENTIMENT_TTL_MS = 5 * 60 * 1e3;
var COIN_ID_TTL_MS = 24 * 60 * 60 * 1e3;
var REQUEST_TIMEOUT_MS2 = 5e3;
var SocialSentimentService = class {
  constructor(options) {
    this.fngCache = null;
    this.rssCache = null;
    this.coinIdCache = /* @__PURE__ */ new Map();
    this.sentimentCache = /* @__PURE__ */ new Map();
    this.inFlight = /* @__PURE__ */ new Map();
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }
  async fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS2);
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          "User-Agent": "ToobitPulse/1.0 (+https://toobitpulse.local)",
          Accept: "application/json, application/rss+xml, application/xml, text/xml"
        },
        signal: controller.signal
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async fetchJson(url) {
    const txt = await this.fetchText(url);
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }
  async getFearAndGreed() {
    const now = Date.now();
    if (this.fngCache && this.fngCache.expiresAt > now) {
      return { value: this.fngCache.value, label: this.fngCache.label };
    }
    const data = await this.fetchJson("https://api.alternative.me/fng/?limit=1");
    const first = data?.data?.[0];
    const parsedVal = first?.value ? Number(first.value) : NaN;
    const value = Number.isFinite(parsedVal) ? parsedVal : null;
    const label = first?.value_classification ?? null;
    if (value !== null) {
      this.fngCache = { value, label, expiresAt: now + GLOBAL_CACHE_TTL_MS };
    }
    return { value, label };
  }
  async getRssHeadlines() {
    const now = Date.now();
    if (this.rssCache && this.rssCache.expiresAt > now) {
      return this.rssCache.items;
    }
    const sources = [
      { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
      { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
      { name: "Decrypt", url: "https://decrypt.co/feed" }
    ];
    const settled = await Promise.allSettled(
      sources.map(async (src) => {
        const xml = await this.fetchText(src.url);
        return xml ? parseRssHeadlines(xml, src.name, 14) : [];
      })
    );
    const combined = [];
    for (const res of settled) {
      if (res.status === "fulfilled") {
        combined.push(...res.value);
      }
    }
    if (combined.length > 0) {
      this.rssCache = { items: combined, expiresAt: now + GLOBAL_CACHE_TTL_MS };
    }
    return combined;
  }
  async resolveCoinGeckoId(ticker) {
    const known = KNOWN_COINGECKO_IDS[ticker];
    if (known) return known;
    const now = Date.now();
    const cached = this.coinIdCache.get(ticker);
    if (cached && cached.expiresAt > now) {
      return { id: cached.id, name: cached.name };
    }
    const searchRes = await this.fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`);
    const coins = searchRes?.coins ?? [];
    const exactMatch = coins.find((c) => c.symbol?.toUpperCase() === ticker) ?? coins.find((c) => c.symbol?.toUpperCase().startsWith(ticker)) ?? coins[0];
    if (!exactMatch?.id || !exactMatch?.name) return null;
    const resolved = { id: exactMatch.id, name: exactMatch.name };
    this.coinIdCache.set(ticker, { ...resolved, expiresAt: now + COIN_ID_TTL_MS });
    return resolved;
  }
  async getCoinGeckoSentiment(ticker) {
    const coinRef = await this.resolveCoinGeckoId(ticker);
    if (!coinRef) {
      return { coinName: null, upPct: null, downPct: null, watchlistUsers: null };
    }
    const details = await this.fetchJson(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinRef.id)}?localization=false&tickers=false&market_data=false&community_data=true&developer_data=false&sparkline=false`
    );
    return {
      coinName: details?.name ?? coinRef.name,
      upPct: typeof details?.sentiment_votes_up_percentage === "number" ? details.sentiment_votes_up_percentage : null,
      downPct: typeof details?.sentiment_votes_down_percentage === "number" ? details.sentiment_votes_down_percentage : null,
      watchlistUsers: typeof details?.watchlist_portfolio_users === "number" ? details.watchlist_portfolio_users : null
    };
  }
  async getSentiment(symbol, forceRefresh = false) {
    const baseAsset = extractBaseAssetFromSymbol(symbol);
    const normalizedTicker = normalizeBaseTicker(baseAsset);
    const now = Date.now();
    if (!forceRefresh) {
      const cached = this.sentimentCache.get(normalizedTicker);
      if (cached && cached.expiresAt > now) {
        return {
          ...cached.data,
          symbol,
          baseAsset
        };
      }
    }
    const existingFlight = this.inFlight.get(normalizedTicker);
    if (existingFlight) {
      const data = await existingFlight;
      return { ...data, symbol, baseAsset };
    }
    const promise = (async () => {
      const [cg, fng, rssItems] = await Promise.all([
        this.getCoinGeckoSentiment(normalizedTicker),
        this.getFearAndGreed(),
        this.getRssHeadlines()
      ]);
      const aggregated = aggregateSocialSentiment({
        symbol,
        baseAsset,
        coinName: cg.coinName,
        coingeckoUpPct: cg.upPct,
        coingeckoDownPct: cg.downPct,
        watchlistUsers: cg.watchlistUsers,
        fearGreedValue: fng.value,
        fearGreedLabel: fng.label,
        rssItems,
        fetchedAt: Date.now()
      });
      this.sentimentCache.set(normalizedTicker, {
        data: aggregated,
        expiresAt: Date.now() + COIN_SENTIMENT_TTL_MS
      });
      return aggregated;
    })().finally(() => {
      this.inFlight.delete(normalizedTicker);
    });
    this.inFlight.set(normalizedTicker, promise);
    return promise;
  }
};
var socialSentimentService = new SocialSentimentService();

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var VALID_TIMEFRAMES = /* @__PURE__ */ new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"]);
function parseTimeframe(raw) {
  if (typeof raw === "string" && VALID_TIMEFRAMES.has(raw)) {
    return raw;
  }
  return "1h";
}
async function createServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json());
  toobitService.start();
  app.get("/api/health", (_req, res) => {
    res.json(toobitService.getHealth());
  });
  app.get("/api/market", async (_req, res) => {
    let market = toobitService.getMarketTickers();
    if (market.tickers.length === 0) {
      await toobitService.refreshMarketBatch();
      market = toobitService.getMarketTickers();
    }
    res.json(market);
  });
  app.get("/api/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const focusSym = typeof req.query.focus === "string" ? req.query.focus : "";
    if (focusSym) {
      toobitService.focusSymbol(focusSym);
    }
    const market = toobitService.getMarketTickers();
    if (market.tickers.length > 0) {
      res.write(
        `data: ${JSON.stringify({ type: "snapshot", wsConnected: market.wsConnected, serverTime: Date.now() })}

`
      );
    }
    const unsubscribe = toobitService.addStreamListener((event) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}

`);
      }
    });
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: ping ${Date.now()}

`);
      }
    }, 15e3);
    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
  app.post("/api/focus", (req, res) => {
    const symbol = typeof req.body?.symbol === "string" ? req.body.symbol : "";
    if (symbol) {
      toobitService.focusSymbol(symbol);
    }
    res.json({ ok: true });
  });
  app.get("/api/scanner", async (req, res) => {
    const tf = parseTimeframe(req.query.timeframe);
    const watchParam = typeof req.query.watch === "string" ? req.query.watch : "";
    const extraSymbols = watchParam.split(",").map((s) => s.trim()).filter(Boolean);
    const data = await toobitService.getScannerResults(tf, extraSymbols);
    res.json(data);
  });
  app.post("/api/scan-now", async (req, res) => {
    const tf = parseTimeframe(req.body?.timeframe);
    const watch = Array.isArray(req.body?.watch) ? req.body.watch.filter((s) => typeof s === "string") : [];
    await toobitService.refreshMarketBatch();
    const opportunities = await toobitService.runScannerCycle(tf, watch);
    const health = toobitService.getHealth();
    res.json({
      opportunities,
      updatedAt: Date.now(),
      scanning: false,
      scannedCount: health.scannedCount,
      scanTotal: health.scanTotal
    });
  });
  app.get("/api/analyze/:symbol", async (req, res) => {
    const symbol = req.params.symbol;
    const tf = parseTimeframe(req.query.timeframe);
    if (!symbol) {
      res.status(400).json({ error: "Missing symbol" });
      return;
    }
    try {
      const analysis = await toobitService.analyzeSymbol(symbol, tf);
      res.json(analysis);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to analyze symbol from Toobit API";
      const status = msg.includes("delisted") || msg.includes("Invalid Toobit") ? 404 : 502;
      res.status(status).json({ error: msg });
    }
  });
  app.get("/api/alerts", (_req, res) => {
    res.json(toobitService.getAlertsWithAccuracy());
  });
  app.get("/api/sentiment/:symbol", async (req, res) => {
    const symbol = req.params.symbol;
    if (!symbol) {
      res.status(400).json({ error: "Missing symbol" });
      return;
    }
    const forceRefresh = req.query.refresh === "1";
    try {
      const sentiment = await socialSentimentService.getSentiment(symbol, forceRefresh);
      res.json(sentiment);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch social sentiment";
      res.status(502).json({ error: msg });
    }
  });
  app.get("/api/webhooks/config", (_req, res) => {
    res.json({
      config: webhookNotifier.getConfig(),
      logs: webhookNotifier.getLogs()
    });
  });
  app.post("/api/webhooks/config", (req, res) => {
    const body = req.body ?? {};
    const result = webhookNotifier.updateConfig(body);
    if (!result.ok) {
      res.status(400).json({
        ok: false,
        errors: result.errors,
        config: result.config
      });
      return;
    }
    res.json({
      ok: true,
      config: result.config,
      logs: webhookNotifier.getLogs()
    });
  });
  app.post("/api/webhooks/test", async (req, res) => {
    const body = req.body ?? void 0;
    const outcome = await webhookNotifier.sendTestWebhook(body);
    if (!outcome.valid) {
      res.status(400).json({
        ok: false,
        errors: outcome.errors,
        results: [],
        logs: webhookNotifier.getLogs()
      });
      return;
    }
    const allSucceeded = outcome.results.length > 0 && outcome.results.every((r) => r.ok);
    res.status(allSucceeded ? 200 : 502).json({
      ok: allSucceeded,
      results: outcome.results,
      logs: webhookNotifier.getLogs()
    });
  });
  app.post("/api/webhooks/rule-trigger", async (req, res) => {
    const alert = req.body?.alert;
    const cfg = webhookNotifier.getConfig();
    if (!cfg.enabled || !alert || !alert.symbol || !alert.optimalEntry || !alert.stopLoss || !alert.tp1) {
      res.json({ ok: true, skipped: true });
      return;
    }
    const results = await webhookNotifier.dispatchSignal({
      symbol: alert.symbol,
      baseAsset: alert.baseAsset,
      timeframe: alert.timeframe,
      direction: alert.direction,
      phase: alert.phase,
      confidence: alert.confidence,
      sharpMoveScore: 0,
      lastPrice: alert.price,
      volumeZScore: alert.volumeZScore,
      summaryEn: alert.reasonEn,
      qualityGrade: alert.qualityGrade,
      tradePlan: {
        optimalEntry: alert.optimalEntry,
        stopLoss: alert.stopLoss,
        tp1: alert.tp1,
        tp2: alert.tp2 ?? alert.tp1,
        tp3: alert.tp3 ?? alert.tp1,
        riskReward2: alert.riskReward1 ?? 2
      },
      analyzedAt: alert.timestamp
    });
    res.json({ ok: true, results });
  });
  const PORT = Number(process.env.PORT) || 3e3;
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const hmrDisabled = process.env.DISABLE_HMR === "true";
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        port: PORT,
        hmr: hmrDisabled ? false : true,
        ws: { server: httpServer }
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = fs2.existsSync(path.resolve(__dirname, "dist", "index.html")) ? path.resolve(__dirname, "dist") : path.resolve(__dirname, "..", "dist");
    if (!fs2.existsSync(path.join(distPath, "index.html"))) {
      console.error(`Missing frontend build at ${distPath}. Run "npm run build" first.`);
      process.exit(1);
    }
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (base === "sw.js" || base === "registerSW.js" || base === "manifest.webmanifest" || base === "index.html") {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          }
        }
      })
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`ToobitPulse server listening on http://localhost:${PORT} (0.0.0.0:${PORT})`);
  });
}
createServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
