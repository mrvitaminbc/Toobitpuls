export interface SparklinePoint {
  x: number;
  y: number;
  value: number;
}

export interface RsiSparklineGeometry {
  polylinePoints: string;
  areaPath: string;
  lastPoint: SparklinePoint | null;
  y70: number;
  y50: number;
  y30: number;
  minVal: number;
  maxVal: number;
}

export interface MacdSparklineBar {
  x: number;
  y: number;
  width: number;
  height: number;
  positive: boolean;
  value: number;
}

export interface MacdSparklineGeometry {
  zeroY: number;
  bars: MacdSparklineBar[];
  macdPoints: string;
  signalPoints: string;
  lastMacd: SparklinePoint | null;
}

export function buildRsiSparklineGeometry(
  rsiSeries: (number | null)[],
  width = 280,
  height = 76,
  windowBars = 48,
): RsiSparklineGeometry {
  const padX = 4;
  const padY = 6;
  const plotW = Math.max(10, width - padX * 2);
  const plotH = Math.max(10, height - padY * 2);

  const mapY = (val: number) => {
    const clamped = Math.min(100, Math.max(0, val));
    return Number((padY + ((100 - clamped) / 100) * plotH).toFixed(2));
  };

  const sliced = rsiSeries.slice(-windowBars);
  const validEntries: { idx: number; val: number }[] = [];
  for (let i = 0; i < sliced.length; i++) {
    const v = sliced[i];
    if (v !== null && Number.isFinite(v)) {
      validEntries.push({ idx: i, val: v });
    }
  }

  if (validEntries.length === 0) {
    return {
      polylinePoints: '',
      areaPath: '',
      lastPoint: null,
      y70: mapY(70),
      y50: mapY(50),
      y30: mapY(30),
      minVal: 50,
      maxVal: 50,
    };
  }

  const denom = Math.max(1, sliced.length - 1);
  const points: SparklinePoint[] = validEntries.map((entry) => ({
    x: Number((padX + (entry.idx / denom) * plotW).toFixed(2)),
    y: mapY(entry.val),
    value: entry.val,
  }));

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const baseBottom = Number((padY + plotH).toFixed(2));
  const areaPath =
    points.length >= 2
      ? `M ${first.x} ${baseBottom} L ${points.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${last.x} ${baseBottom} Z`
      : '';

  const vals = validEntries.map((e) => e.val);
  return {
    polylinePoints,
    areaPath,
    lastPoint: last,
    y70: mapY(70),
    y50: mapY(50),
    y30: mapY(30),
    minVal: Number(Math.min(...vals).toFixed(1)),
    maxVal: Number(Math.max(...vals).toFixed(1)),
  };
}

export function buildMacdSparklineGeometry(
  macdLine: (number | null)[],
  signalLine: (number | null)[],
  histogram: (number | null)[],
  width = 280,
  height = 76,
  windowBars = 48,
): MacdSparklineGeometry {
  const padX = 4;
  const padY = 6;
  const plotW = Math.max(10, width - padX * 2);
  const plotH = Math.max(10, height - padY * 2);

  const mSlice = macdLine.slice(-windowBars);
  const sSlice = signalLine.slice(-windowBars);
  const hSlice = histogram.slice(-windowBars);
  const count = Math.max(mSlice.length, sSlice.length, hSlice.length);

  let maxAbs = 0;
  for (const arr of [mSlice, sSlice, hSlice]) {
    for (const v of arr) {
      if (v !== null && Number.isFinite(v)) {
        const a = Math.abs(v);
        if (a > maxAbs) maxAbs = a;
      }
    }
  }
  if (maxAbs <= 0) maxAbs = 1e-6;

  const mapY = (val: number) => {
    const norm = Math.max(-1, Math.min(1, val / maxAbs));
    return Number((padY + ((1 - norm) / 2) * plotH).toFixed(2));
  };

  const zeroY = mapY(0);
  if (count === 0) {
    return {
      zeroY,
      bars: [],
      macdPoints: '',
      signalPoints: '',
      lastMacd: null,
    };
  }

  const slotW = plotW / count;
  const barW = Number(Math.max(1.5, Math.min(5, slotW * 0.65)).toFixed(2));
  const bars: MacdSparklineBar[] = [];

  for (let i = 0; i < hSlice.length; i++) {
    const v = hSlice[i];
    if (v === null || !Number.isFinite(v)) continue;
    const centerX = padX + (i + 0.5) * slotW;
    const yVal = mapY(v);
    const barTop = Math.min(zeroY, yVal);
    const barH = Math.max(1, Math.abs(yVal - zeroY));
    bars.push({
      x: Number((centerX - barW / 2).toFixed(2)),
      y: Number(barTop.toFixed(2)),
      width: barW,
      height: Number(barH.toFixed(2)),
      positive: v >= 0,
      value: v,
    });
  }

  const macdPts: SparklinePoint[] = [];
  const signalPts: SparklinePoint[] = [];

  for (let i = 0; i < count; i++) {
    const cx = Number((padX + (i + 0.5) * slotW).toFixed(2));
    const mv = mSlice[i];
    const sv = sSlice[i];
    if (mv !== null && mv !== undefined && Number.isFinite(mv)) {
      macdPts.push({ x: cx, y: mapY(mv), value: mv });
    }
    if (sv !== null && sv !== undefined && Number.isFinite(sv)) {
      signalPts.push({ x: cx, y: mapY(sv), value: sv });
    }
  }

  return {
    zeroY,
    bars,
    macdPoints: macdPts.map((p) => `${p.x},${p.y}`).join(' '),
    signalPoints: signalPts.map((p) => `${p.x},${p.y}`).join(' '),
    lastMacd: macdPts.length > 0 ? macdPts[macdPts.length - 1] : null,
  };
}
