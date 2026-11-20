import type { Candle, Timeframe } from '../types/futures';
import { calcEMA } from '../engine/indicators';

export type ChartStyle = 'candles' | 'hollow' | 'heikin' | 'area';

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  hist: number | null;
}

export function computeHeikinAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const result: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen =
      i === 0 ? (c.open + c.close) / 2 : (result[i - 1].open + result[i - 1].close) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    result.push({
      ...c,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
    });
  }
  return result;
}

export function computeMacdSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdPoint[] {
  if (closes.length === 0) return [];
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  const macdRaw: (number | null)[] = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== null && s !== null ? f - s : null;
  });

  const validStart = macdRaw.findIndex((v) => v !== null);
  const signalArr: (number | null)[] = new Array(closes.length).fill(null);

  if (validStart !== -1) {
    const validMacd = macdRaw.slice(validStart).map((v) => v as number);
    const sig = calcEMA(validMacd, signalPeriod);
    for (let i = 0; i < sig.length; i++) {
      signalArr[validStart + i] = sig[i];
    }
  }

  return closes.map((_, i) => {
    const m = macdRaw[i];
    const s = signalArr[i];
    return {
      macd: m,
      signal: s,
      hist: m !== null && s !== null ? m - s : null,
    };
  });
}

export function clampChartViewport(params: {
  totalCandles: number;
  visibleCount: number;
  rightOffset: number;
}): { visibleCount: number; startIdx: number; endIdx: number; rightOffset: number } {
  const { totalCandles } = params;
  if (totalCandles <= 0) {
    return { visibleCount: 0, startIdx: 0, endIdx: 0, rightOffset: 0 };
  }
  const minVis = Math.min(20, totalCandles);
  const maxVis = Math.min(240, totalCandles);
  const visibleCount = Math.max(minVis, Math.min(maxVis, Math.round(params.visibleCount)));
  const maxRightOffset = Math.max(0, totalCandles - visibleCount);
  const rightOffset = Math.max(0, Math.min(maxRightOffset, Math.round(params.rightOffset)));
  const endIdx = totalCandles - rightOffset;
  const startIdx = Math.max(0, endIdx - visibleCount);
  return { visibleCount, startIdx, endIdx, rightOffset };
}

export function formatChartAxisTime(timestampMs: number, timeframe: Timeframe): string {
  const d = new Date(timestampMs);
  if (timeframe === '1d' || timeframe === '1w' || timeframe === '1M') {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    if (timeframe === '1M') {
      return `${String(d.getFullYear()).slice(-2)}/${mm}`;
    }
    return `${mm}/${dd}`;
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  if (timeframe === '4h') {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${min}`;
  }
  return `${hh}:${min}`;
}
