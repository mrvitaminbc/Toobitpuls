import type { Candle, DetectedPattern } from '../types/futures';
import { clamp } from './indicators';

export interface PatternSuiteResult {
  patterns: DetectedPattern[];
  smcZone: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM';
  smcStructure: 'BULLISH' | 'BEARISH' | 'RANGING';
  candlestickAndChartScore: number; // -100..+100
  smcScore: number; // -100..+100
}

function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function candleRange(c: Candle): number {
  return Math.max(0, c.high - c.low);
}

function isBull(c: Candle): boolean {
  return c.close > c.open;
}

function isBear(c: Candle): boolean {
  return c.close < c.open;
}

function linearSlopePct(values: number[]): number {
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
  return (slopePerBar / meanY) * 100;
}

export function detectCandlestickPatterns(candles: Candle[]): DetectedPattern[] {
  if (candles.length < 5) return [];
  const patterns: DetectedPattern[] = [];

  // Inspect latest completed/forming bar pair (c2 = latest, c1 = prev, c0 = prev-1)
  const c0 = candles[candles.length - 3];
  const c1 = candles[candles.length - 2];
  const c2 = candles[candles.length - 1];

  const r0 = candleRange(c0);
  const r1 = candleRange(c1);
  const r2 = candleRange(c2);
  const b0 = bodySize(c0);
  const b1 = bodySize(c1);
  const b2 = bodySize(c2);

  // Average range over last 14 bars for significance check
  const recent14 = candles.slice(-14);
  const avgRange = recent14.reduce((a, c) => a + candleRange(c), 0) / recent14.length || r2 || 1;

  // 1. Bullish Engulfing
  if (
    isBear(c1) &&
    isBull(c2) &&
    b2 >= avgRange * 0.45 &&
    c2.open <= c1.close * 1.0015 &&
    c2.close >= c1.open
  ) {
    patterns.push({
      id: 'bullish_engulfing',
      category: 'CANDLESTICK',
      bias: 'BULLISH',
      strength: 78,
      nameEn: 'Bullish Engulfing',
      nameFa: 'الگوی پوشای صعودی (Bullish Engulfing)',
      detailEn: 'Current bullish candle completely engulfs the prior bearish body, signaling strong buyer takeover.',
      detailFa: 'کندل صعودی اخیر بدنه کندل نزولی قبلی را کاملاً پوشانده و نشان‌دهنده چرخش قدرت به سمت خریداران است.',
    });
  }

  // 2. Bearish Engulfing
  if (
    isBull(c1) &&
    isBear(c2) &&
    b2 >= avgRange * 0.45 &&
    c2.open >= c1.close * 0.9985 &&
    c2.close <= c1.open
  ) {
    patterns.push({
      id: 'bearish_engulfing',
      category: 'CANDLESTICK',
      bias: 'BEARISH',
      strength: 78,
      nameEn: 'Bearish Engulfing',
      nameFa: 'الگوی پوشای نزولی (Bearish Engulfing)',
      detailEn: 'Current bearish candle engulfs the prior bullish body, indicating aggressive supply.',
      detailFa: 'کندل نزولی اخیر بدنه کندل صعودی قبلی را بلعیده و نشانه برتری فروشندگان است.',
    });
  }

  // 3. Morning Star (3-candle bullish reversal)
  if (
    isBear(c0) &&
    b0 >= avgRange * 0.4 &&
    b1 <= Math.max(r1 * 0.35, b0 * 0.4) &&
    isBull(c2) &&
    c2.close > (c0.open + c0.close) / 2
  ) {
    patterns.push({
      id: 'morning_star',
      category: 'CANDLESTICK',
      bias: 'BULLISH',
      strength: 84,
      nameEn: 'Morning Star',
      nameFa: 'ستاره صبحگاهی (Morning Star)',
      detailEn: '3-bar reversal transition from selling pressure through indecision into strong bullish follow-through.',
      detailFa: 'الگوی سه‌کندلی بازگشت صعودی از فشار فروش به تردید و سپس حمله قدرتمند خریداران.',
    });
  }

  // 4. Evening Star (3-candle bearish reversal)
  if (
    isBull(c0) &&
    b0 >= avgRange * 0.4 &&
    b1 <= Math.max(r1 * 0.35, b0 * 0.4) &&
    isBear(c2) &&
    c2.close < (c0.open + c0.close) / 2
  ) {
    patterns.push({
      id: 'evening_star',
      category: 'CANDLESTICK',
      bias: 'BEARISH',
      strength: 84,
      nameEn: 'Evening Star',
      nameFa: 'ستاره شامگاهی (Evening Star)',
      detailEn: '3-bar bearish reversal showing buying exhaustion and strong supply takeover.',
      detailFa: 'الگوی سه‌کندلی بازگشت نزولی که تخلیه مومنتوم خرید و ورود فروشندگان را تایید می‌کند.',
    });
  }

  // 5. Hammer / Bullish Pin Bar (check c1 or c2)
  for (const bar of [c1, c2]) {
    const r = candleRange(bar);
    const b = bodySize(bar);
    if (r < avgRange * 0.5 || r <= 0) continue;
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    if (lowerWick >= r * 0.58 && upperWick <= r * 0.18 && b <= r * 0.35) {
      patterns.push({
        id: 'bullish_pinbar',
        category: 'CANDLESTICK',
        bias: 'BULLISH',
        strength: 72,
        nameEn: 'Hammer / Bullish Pin Bar',
        nameFa: 'الگوی چکش / پین‌بار صعودی',
        detailEn: 'Long lower rejection wick confirms aggressive dip-buying and stop-sweep absorption.',
        detailFa: 'شدوی بلند پایینی نشان‌دهنده جمع‌آوری نقدینگی کف و دفاع سنگین خریداران است.',
      });
      break;
    }
    if (upperWick >= r * 0.58 && lowerWick <= r * 0.18 && b <= r * 0.35) {
      patterns.push({
        id: 'bearish_pinbar',
        category: 'CANDLESTICK',
        bias: 'BEARISH',
        strength: 72,
        nameEn: 'Shooting Star / Bearish Pin Bar',
        nameFa: 'ستاره ثاقب / پین‌بار نزولی',
        detailEn: 'Long upper rejection wick reveals supply rejection at highs.',
        detailFa: 'شدوی بلند بالایی نشان‌دهنده رد شدن قیمت از مقاومت و فشار فروش در سقف است.',
      });
      break;
    }
  }

  // 6. Three White Soldiers / Three Black Crows
  if (
    isBull(c0) &&
    isBull(c1) &&
    isBull(c2) &&
    c1.close > c0.close &&
    c2.close > c1.close &&
    b0 >= r0 * 0.45 &&
    b1 >= r1 * 0.45 &&
    b2 >= r2 * 0.45
  ) {
    patterns.push({
      id: 'three_white_soldiers',
      category: 'CANDLESTICK',
      bias: 'BULLISH',
      strength: 80,
      nameEn: 'Three White Soldiers',
      nameFa: 'سه سرباز سفید (روند صعودی پرقدرت)',
      detailEn: 'Three consecutive strong-bodied bullish candles closing near highs.',
      detailFa: 'سه کندل صعودی متوالی با بدنه پرقدرت و بسته شدن نزدیک سقف.',
    });
  } else if (
    isBear(c0) &&
    isBear(c1) &&
    isBear(c2) &&
    c1.close < c0.close &&
    c2.close < c1.close &&
    b0 >= r0 * 0.45 &&
    b1 >= r1 * 0.45 &&
    b2 >= r2 * 0.45
  ) {
    patterns.push({
      id: 'three_black_crows',
      category: 'CANDLESTICK',
      bias: 'BEARISH',
      strength: 80,
      nameEn: 'Three Black Crows',
      nameFa: 'سه کلاغ سیاه (فشار نزولی متوالی)',
      detailEn: 'Three consecutive strong bearish candles expanding downward momentum.',
      detailFa: 'سه کندل نزولی متوالی با بدنه پر و تسلط کامل فروشندگان.',
    });
  }

  return patterns;
}

export function detectDivergences(
  candles: Candle[],
  rsiSeries: (number | null)[],
  macdHistSeries: (number | null)[],
): DetectedPattern[] {
  if (candles.length < 30) return [];
  const patterns: DetectedPattern[] = [];
  const start = Math.max(5, candles.length - 48);
  const end = candles.length - 3;

  const swingLows: number[] = [];
  const swingHighs: number[] = [];

  for (let i = start; i <= end; i++) {
    const low = candles[i].low;
    const high = candles[i].high;
    if (
      low <= candles[i - 1].low &&
      low <= candles[i - 2].low &&
      low <= candles[i + 1].low &&
      low <= candles[i + 2].low
    ) {
      swingLows.push(i);
    }
    if (
      high >= candles[i - 1].high &&
      high >= candles[i - 2].high &&
      high >= candles[i + 1].high &&
      high >= candles[i + 2].high
    ) {
      swingHighs.push(i);
    }
  }

  // Bullish RSI / MACD Divergences between last two swing lows
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
            id: 'rsi_bullish_div',
            category: 'DIVERGENCE',
            bias: 'BULLISH',
            strength: 82,
            nameEn: 'Regular Bullish RSI Divergence',
            nameFa: 'واگرایی مثبت (صعودی) کلاسیک RSI',
            detailEn: `Price printed a lower low while RSI climbed from ${rPrev.toFixed(1)} to ${rLast.toFixed(1)}.`,
            detailFa: `قیمت کف پایین‌تر ثبت کرده اما RSI از ${rPrev.toFixed(1)} به ${rLast.toFixed(1)} صعود کرده است.`,
          });
        } else if (pLast > pPrev * 1.002 && rLast < rPrev - 2.5 && rPrev > 40) {
          patterns.push({
            id: 'rsi_hidden_bull_div',
            category: 'DIVERGENCE',
            bias: 'BULLISH',
            strength: 70,
            nameEn: 'Hidden Bullish RSI Divergence',
            nameFa: 'واگرایی مخفی صعودی RSI (ادامه‌دهنده)',
            detailEn: 'Higher low in price with lower RSI reset signals bullish trend continuation.',
            detailFa: 'کف بالاتر قیمت همزمان با تخلیه اندیکاتور RSI نشانه ادامه روند صعودی است.',
          });
        }
      }

      if (mPrev !== null && mLast !== null && pLast < pPrev * 0.999 && mLast > mPrev && mPrev < 0) {
        patterns.push({
          id: 'macd_bullish_div',
          category: 'DIVERGENCE',
          bias: 'BULLISH',
          strength: 74,
          nameEn: 'MACD Bullish Divergence',
          nameFa: 'واگرایی مثبت هیستوگرام مکدی (MACD)',
          detailEn: 'Downward selling momentum weakened noticeably on the recent retest low.',
          detailFa: 'فشار فروش در هیستوگرام مکدی هنگام لمس کف جدید به‌شدت تضعیف شده است.',
        });
      }
    }
  }

  // Bearish RSI / MACD Divergences between last two swing highs
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
            id: 'rsi_bearish_div',
            category: 'DIVERGENCE',
            bias: 'BEARISH',
            strength: 82,
            nameEn: 'Regular Bearish RSI Divergence',
            nameFa: 'واگرایی منفی (نزولی) کلاسیک RSI',
            detailEn: `Price made a higher high while RSI fell from ${rPrev.toFixed(1)} to ${rLast.toFixed(1)}.`,
            detailFa: `قیمت سقف بالاتر زده اما RSI از ${rPrev.toFixed(1)} به ${rLast.toFixed(1)} افت کرده است.`,
          });
        } else if (pLast < pPrev * 0.998 && rLast > rPrev + 2.5 && rLast < 65) {
          patterns.push({
            id: 'rsi_hidden_bear_div',
            category: 'DIVERGENCE',
            bias: 'BEARISH',
            strength: 70,
            nameEn: 'Hidden Bearish RSI Divergence',
            nameFa: 'واگرایی مخفی نزولی RSI (ادامه‌دهنده)',
            detailEn: 'Lower high in price paired with higher RSI bounce warns of bearish continuation.',
            detailFa: 'سقف پایین‌تر قیمت همزمان با رشد کاذب RSI احتمال ادامه ریزش را نشان می‌دهد.',
          });
        }
      }

      if (mPrev !== null && mLast !== null && pLast > pPrev * 1.001 && mLast < mPrev && mPrev > 0) {
        patterns.push({
          id: 'macd_bearish_div',
          category: 'DIVERGENCE',
          bias: 'BEARISH',
          strength: 74,
          nameEn: 'MACD Bearish Divergence',
          nameFa: 'واگرایی منفی هیستوگرام مکدی (MACD)',
          detailEn: 'Bullish MACD histogram faded on a higher price peak.',
          detailFa: 'مومنتوم خرید در هیستوگرام مکدی هنگام ثبت سقف جدید تضعیف شده است.',
        });
      }
    }
  }

  return patterns;
}

export function analyzeSmcAndChartPatterns(
  candles: Candle[],
  rsiSeries: (number | null)[],
  macdHistSeries: (number | null)[],
): PatternSuiteResult {
  if (candles.length < 30) {
    return {
      patterns: [],
      smcZone: 'EQUILIBRIUM',
      smcStructure: 'RANGING',
      candlestickAndChartScore: 0,
      smcScore: 0,
    };
  }

  const patterns: DetectedPattern[] = [
    ...detectCandlestickPatterns(candles),
    ...detectDivergences(candles, rsiSeries, macdHistSeries),
  ];

  const lastPrice = candles[candles.length - 1].close;
  const dealingSlice = candles.slice(-48);
  const rangeHigh = Math.max(...dealingSlice.map((c) => c.high));
  const rangeLow = Math.min(...dealingSlice.map((c) => c.low));
  const span = Math.max(rangeHigh - rangeLow, lastPrice * 0.001);
  const posRatio = (lastPrice - rangeLow) / span;

  const smcZone: 'DISCOUNT' | 'EQUILIBRIUM' | 'PREMIUM' =
    posRatio <= 0.38 ? 'DISCOUNT' : posRatio >= 0.62 ? 'PREMIUM' : 'EQUILIBRIUM';

  // SMC Swing Points for BOS / CHoCH & Chart Patterns
  const recent = candles.slice(-45);
  const swingHighs: { idx: number; price: number }[] = [];
  const swingLows: { idx: number; price: number }[] = [];

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

  let smcStructure: 'BULLISH' | 'BEARISH' | 'RANGING' = 'RANGING';
  let smcScore = 0;

  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const hPrev = swingHighs[swingHighs.length - 2].price;
    const hLast = swingHighs[swingHighs.length - 1].price;
    const lPrev = swingLows[swingLows.length - 2].price;
    const lLast = swingLows[swingLows.length - 1].price;

    if (lastPrice > hLast && lLast >= lPrev * 0.997) {
      smcStructure = 'BULLISH';
      smcScore += 45;
      patterns.push({
        id: 'smc_bull_bos',
        category: 'SMC',
        bias: 'BULLISH',
        strength: 82,
        nameEn: 'Bullish Break of Structure (BOS)',
        nameFa: 'شکست ساختار صعودی اسمارت‌مانی (BOS)',
        detailEn: 'Price closed above the latest swing high while defending higher swing lows.',
        detailFa: 'قیمت بالای آخرین سقف ساختاری بسته شده و ساختار کف‌های بالاتر حفظ شده است.',
      });
    } else if (lastPrice < lLast && hLast <= hPrev * 1.003) {
      smcStructure = 'BEARISH';
      smcScore -= 45;
      patterns.push({
        id: 'smc_bear_bos',
        category: 'SMC',
        bias: 'BEARISH',
        strength: 82,
        nameEn: 'Bearish Break of Structure (BOS)',
        nameFa: 'شکست ساختار نزولی اسمارت‌مانی (BOS)',
        detailEn: 'Price broke below structural swing support while printing lower highs.',
        detailFa: 'قیمت حمایت ساختاری اخیر را به پایین شکسته و سقف‌های پایین‌تر تایید شده است.',
      });
    } else if (hLast < hPrev && lastPrice > hLast) {
      smcStructure = 'BULLISH';
      smcScore += 35;
      patterns.push({
        id: 'smc_bull_choch',
        category: 'SMC',
        bias: 'BULLISH',
        strength: 78,
        nameEn: 'Bullish Change of Character (CHoCH)',
        nameFa: 'تغییر کاراکتر صعودی روند (CHoCH)',
        detailEn: 'First bullish structural break after a sequence of lower highs.',
        detailFa: 'اولین شکست رو به بالای ساختار پس از یک دوره سقف‌های نزولی (هشدار تغییر روند).',
      });
    } else if (lLast > lPrev && lastPrice < lLast) {
      smcStructure = 'BEARISH';
      smcScore -= 35;
      patterns.push({
        id: 'smc_bear_choch',
        category: 'SMC',
        bias: 'BEARISH',
        strength: 78,
        nameEn: 'Bearish Change of Character (CHoCH)',
        nameFa: 'تغییر کاراکتر نزولی روند (CHoCH)',
        detailEn: 'First bearish breakdown below a higher swing low.',
        detailFa: 'اولین شکست به زیر کف صعودی قبلی و نشانه تغییر کاراکتر بازار به نزولی.',
      });
    } else if (hLast > hPrev && lLast > lPrev) {
      smcStructure = 'BULLISH';
      smcScore += 22;
    } else if (hLast < hPrev && lLast < lPrev) {
      smcStructure = 'BEARISH';
      smcScore -= 22;
    }

    // Classical Double Bottom / Double Top
    const tol = 0.008;
    if (
      swingLows.length >= 2 &&
      swingLows[swingLows.length - 1].idx - swingLows[swingLows.length - 2].idx >= 5 &&
      Math.abs(lLast - lPrev) / lPrev <= tol &&
      lastPrice > lLast * 1.008
    ) {
      patterns.push({
        id: 'double_bottom',
        category: 'CHART',
        bias: 'BULLISH',
        strength: 76,
        nameEn: 'Double Bottom (W Reversal)',
        nameFa: 'الگوی کف دوقلو (Double Bottom)',
        detailEn: 'Two aligned demand lows held firm with upward rebound toward neckline.',
        detailFa: 'دو کف هم‌تراز تقاضا با واکنش صعودی قدرتمند شکل گرفته است.',
      });
    }

    if (
      swingHighs.length >= 2 &&
      swingHighs[swingHighs.length - 1].idx - swingHighs[swingHighs.length - 2].idx >= 5 &&
      Math.abs(hLast - hPrev) / hPrev <= tol &&
      lastPrice < hLast * 0.992
    ) {
      patterns.push({
        id: 'double_top',
        category: 'CHART',
        bias: 'BEARISH',
        strength: 76,
        nameEn: 'Double Top (M Reversal)',
        nameFa: 'الگوی سقف دوقلو (Double Top)',
        detailEn: 'Two aligned supply rejections at resistance point to downside rotation.',
        detailFa: 'دو سقف هم‌تراز عرضه و ناتوانی قیمت در عبور از مقاومت مشاهده شد.',
      });
    }
  }

  // Fair Value Gap (FVG) proximity check over last 15 bars
  for (let i = candles.length - 2; i >= Math.max(2, candles.length - 15); i--) {
    const cLeft = candles[i - 2];
    const cRight = candles[i];
    // Bullish FVG below/near price
    if (cRight.low > cLeft.high) {
      const gapLow = cLeft.high;
      const gapHigh = cRight.low;
      const gapWidthPct = ((gapHigh - gapLow) / lastPrice) * 100;
      if (gapWidthPct >= 0.15 && lastPrice >= gapLow * 0.995 && lastPrice <= gapHigh * 1.018) {
        smcScore += 25;
        patterns.push({
          id: 'smc_bull_fvg',
          category: 'SMC',
          bias: 'BULLISH',
          strength: 72,
          nameEn: 'Bullish Fair Value Gap (FVG)',
          nameFa: 'گپ ارزش منصفانه صعودی (Bullish FVG)',
          detailEn: 'Price is tapping/holding an active institutional bullish imbalance zone.',
          detailFa: 'قیمت در حال واکنش به ناحیه عدم تعادل تقاضا (FVG صعودی) است.',
        });
        break;
      }
    }
    // Bearish FVG above/near price
    if (cRight.high < cLeft.low) {
      const gapLow = cRight.high;
      const gapHigh = cLeft.low;
      const gapWidthPct = ((gapHigh - gapLow) / lastPrice) * 100;
      if (gapWidthPct >= 0.15 && lastPrice <= gapHigh * 1.005 && lastPrice >= gapLow * 0.982) {
        smcScore -= 25;
        patterns.push({
          id: 'smc_bear_fvg',
          category: 'SMC',
          bias: 'BEARISH',
          strength: 72,
          nameEn: 'Bearish Fair Value Gap (FVG)',
          nameFa: 'گپ ارزش منصفانه نزولی (Bearish FVG)',
          detailEn: 'Price is reacting into an unmitigated institutional supply FVG zone.',
          detailFa: 'قیمت به ناحیه عدم تعادل عرضه (FVG نزولی) برخورد کرده است.',
        });
        break;
      }
    }
  }

  // Discount / Premium SMC zone weighting
  if (smcZone === 'DISCOUNT') smcScore += 18;
  else if (smcZone === 'PREMIUM') smcScore -= 18;

  // Classical Triangle / Wedge / Flag channel detection using swing slopes over recent 30 bars
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const highSlope = linearSlopePct(swingHighs.map((s) => s.price));
    const lowSlope = linearSlopePct(swingLows.map((s) => s.price));

    if (Math.abs(highSlope) < 0.08 && lowSlope > 0.12) {
      patterns.push({
        id: 'ascending_triangle',
        category: 'CHART',
        bias: 'BULLISH',
        strength: 75,
        nameEn: 'Ascending Triangle',
        nameFa: 'مثلث صعودی (فشار خرید زیر مقاومت)',
        detailEn: 'Flat ceiling resistance paired with steadily rising higher lows.',
        detailFa: 'سقف مقاومتی افقی همراه با کف‌های صعودی که احتمال شکست رو به بالا را افزایش می‌دهد.',
      });
    } else if (Math.abs(lowSlope) < 0.08 && highSlope < -0.12) {
      patterns.push({
        id: 'descending_triangle',
        category: 'CHART',
        bias: 'BEARISH',
        strength: 75,
        nameEn: 'Descending Triangle',
        nameFa: 'مثلث نزولی (فشار فروش روی حمایت)',
        detailEn: 'Horizontal support tested repeatedly against lower highs.',
        detailFa: 'حمایت افقی همراه با سقف‌های پایین‌تر که ریسک شکست نزولی را بالا می‌برد.',
      });
    } else if (highSlope < -0.1 && lowSlope < -0.02 && highSlope < lowSlope - 0.04) {
      patterns.push({
        id: 'falling_wedge',
        category: 'CHART',
        bias: 'BULLISH',
        strength: 74,
        nameEn: 'Falling Wedge (Bullish Breakout Bias)',
        nameFa: 'گوه نزولی (کنج صعودی)',
        detailEn: 'Converging downward channel losing bearish expansion speed.',
        detailFa: 'کانال همگرای رو به پایین با کاهش فشار فروش (مستعد شکست صعودی).',
      });
    } else if (highSlope > 0.02 && lowSlope > 0.1 && lowSlope > highSlope + 0.04) {
      patterns.push({
        id: 'rising_wedge',
        category: 'CHART',
        bias: 'BEARISH',
        strength: 74,
        nameEn: 'Rising Wedge (Bearish Breakdown Bias)',
        nameFa: 'گوه صعودی (کنج نزولی)',
        detailEn: 'Narrowing upward wedge often precedes sharp downside breakdown.',
        detailFa: 'کانال همگرای رو به بالا که معمولاً با شکست نزولی همراه می‌شود.',
      });
    } else if (highSlope < -0.06 && lowSlope > 0.06) {
      patterns.push({
        id: 'symmetrical_triangle',
        category: 'CHART',
        bias: 'NEUTRAL',
        strength: 76,
        nameEn: 'Symmetrical Coil / Pennant Apex',
        nameFa: 'مثلث متقارن / فشردگی فنر انفجاری',
        detailEn: 'Converging lower highs and higher lows signaling imminent high-volatility breakout.',
        detailFa: 'همگرایی سقف‌های پایین‌تر و کف‌های بالاتر (فشردگی شدید پیش از حرکت شارپ).',
      });
    }
  }

  // Head & Shoulders / Inverse Head & Shoulders (3-swing structural reversal)
  if (swingHighs.length >= 3) {
    const ls = swingHighs[swingHighs.length - 3].price;
    const head = swingHighs[swingHighs.length - 2].price;
    const rs = swingHighs[swingHighs.length - 1].price;
    const shoulderSymmetry = Math.abs(ls - rs) / Math.max(ls, 1e-8);
    if (head > ls * 1.008 && head > rs * 1.008 && shoulderSymmetry <= 0.025 && lastPrice < rs) {
      patterns.push({
        id: 'head_and_shoulders',
        category: 'CHART',
        bias: 'BEARISH',
        strength: 82,
        nameEn: 'Head & Shoulders Top',
        nameFa: 'الگوی سر و شانه سقف (ریزش سنگین)',
        detailEn: 'Classic 3-peak bearish reversal structure warning of steep downside breakdown.',
        detailFa: 'ساختار کلاسیک سه قله نزولی با پتانسیل شکست نک‌لاین و ریزش شارپ.',
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
        id: 'inverse_head_and_shoulders',
        category: 'CHART',
        bias: 'BULLISH',
        strength: 82,
        nameEn: 'Inverse Head & Shoulders Bottom',
        nameFa: 'الگوی سر و شانه معکوس (پامپ بازگشتی)',
        detailEn: '3-trough bottoming reversal signaling strong upside breakout potential.',
        detailFa: 'ساختار کلاسیک سه دره بازگشتی با پتانسیل شکست مقاومت گردن و جهش پرقدرت.',
      });
    }
  }

  // Wyckoff Spring (Stop-Hunt Sweep & Reclaim) and UTAD (Upthrust Sweep & Rejection)
  if (candles.length >= 22) {
    const priorRange = candles.slice(-20, -2);
    const rangeLow = Math.min(...priorRange.map((c) => c.low));
    const rangeHigh = Math.max(...priorRange.map((c) => c.high));
    const avgVol =
      priorRange.reduce((acc, c) => acc + (c.quoteVolume > 0 ? c.quoteVolume : c.volume * c.close), 0) /
      priorRange.length;

    const latestBars = candles.slice(-2);
    for (const bar of latestBars) {
      const barVol = bar.quoteVolume > 0 ? bar.quoteVolume : bar.volume * bar.close;
      const volOk = avgVol <= 0 || barVol >= avgVol * 1.25;
      if (bar.low < rangeLow * 0.999 && bar.close > rangeLow && volOk) {
        patterns.push({
          id: 'wyckoff_spring',
          category: 'SMC',
          bias: 'BULLISH',
          strength: 85,
          nameEn: 'Wyckoff Spring (Liquidity Sweep & Reclaim)',
          nameFa: 'اسپرینگ وایکوف (شکار نقدینگی کف و بازگشت)',
          detailEn: 'Swept below prior 18-bar range support and closed sharply back inside with heavy volume.',
          detailFa: 'جمع‌آوری استاپ‌های زیر کف ۱۸ کندل اخیر و بازگشت فوری بالای حمایت با حجم بالا (تریگر پامپ).',
        });
        smcScore += 32;
        break;
      }
      if (bar.high > rangeHigh * 1.001 && bar.close < rangeHigh && volOk) {
        patterns.push({
          id: 'wyckoff_utad',
          category: 'SMC',
          bias: 'BEARISH',
          strength: 85,
          nameEn: 'Wyckoff UTAD (Upthrust Distribution Sweep)',
          nameFa: 'الگوی UTAD وایکوف (تله شکست سقف و ریزش)',
          detailEn: 'Swept above 18-bar range highs to trap longs before rejecting back below resistance.',
          detailFa: 'شکار نقدینگی بالای سقف و بازگشت سریع زیر مقاومت همراه با حجم سنگین (هشدار دامپ شارپ).',
        });
        smcScore -= 32;
        break;
      }
    }
  }

  // Institutional Order Block (OB) Tap over last 24 bars
  for (let i = candles.length - 4; i >= Math.max(2, candles.length - 24); i--) {
    const ob = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];
    const obRange = Math.max(ob.high - ob.low, lastPrice * 0.001);
    // Bullish OB: last bearish candle before strong 2-bar bullish expansion (>2.2x OB range)
    if (isBear(ob) && isBull(next1) && next2.close - ob.open > obRange * 2.1) {
      if (lastPrice >= ob.low * 0.996 && lastPrice <= ob.high * 1.012) {
        smcScore += 22;
        patterns.push({
          id: 'smc_bull_ob',
          category: 'SMC',
          bias: 'BULLISH',
          strength: 77,
          nameEn: 'Institutional Bullish Order Block',
          nameFa: 'اوردر بلاک تقاضای نهادی (Bullish OB)',
          detailEn: 'Price is retesting an unmitigated institutional accumulation origin candle.',
          detailFa: 'قیمت در حال پولبک به منشأ حرکت انفجاری خریداران (Order Block صعودی) است.',
        });
        break;
      }
    }
    // Bearish OB: last bullish candle before sharp 2-bar bearish flush
    if (isBull(ob) && isBear(next1) && ob.open - next2.close > obRange * 2.1) {
      if (lastPrice <= ob.high * 1.004 && lastPrice >= ob.low * 0.988) {
        smcScore -= 22;
        patterns.push({
          id: 'smc_bear_ob',
          category: 'SMC',
          bias: 'BEARISH',
          strength: 77,
          nameEn: 'Institutional Bearish Order Block',
          nameFa: 'اوردر بلاک عرضه نهادی (Bearish OB)',
          detailEn: 'Price bounced into an unmitigated institutional distribution supply block.',
          detailFa: 'قیمت به ناحیه عرضه و منشأ ریزش قبلی (Order Block نزولی) رسیده است.',
        });
        break;
      }
    }
  }

  // Flag continuation pattern: strong impulse in bars [-30..-12] followed by tight flag in [-12..-1]
  if (candles.length >= 32) {
    const poleStart = candles[candles.length - 30].close;
    const poleEnd = candles[candles.length - 12].close;
    const poleReturnPct = poleStart > 0 ? ((poleEnd - poleStart) / poleStart) * 100 : 0;
    const flagSlice = candles.slice(-12);
    const flagHigh = Math.max(...flagSlice.map((c) => c.high));
    const flagLow = Math.min(...flagSlice.map((c) => c.low));
    const flagRangePct = lastPrice > 0 ? ((flagHigh - flagLow) / lastPrice) * 100 : 100;

    if (poleReturnPct >= 6 && flagRangePct <= poleReturnPct * 0.65 && lastPrice >= poleEnd * 0.96) {
      patterns.push({
        id: 'bull_flag',
        category: 'CHART',
        bias: 'BULLISH',
        strength: 79,
        nameEn: 'Bullish Continuation Flag',
        nameFa: 'الگوی پرچم صعودی (Bull Flag)',
        detailEn: `Strong +${poleReturnPct.toFixed(1)}% impulse pole followed by tight ${flagRangePct.toFixed(1)}% consolidation.`,
        detailFa: `موج صعودی قدرتمند (+${poleReturnPct.toFixed(1)}٪) و استراحت فشرده در کانال پرچم.`,
      });
    } else if (poleReturnPct <= -6 && flagRangePct <= Math.abs(poleReturnPct) * 0.65 && lastPrice <= poleEnd * 1.04) {
      patterns.push({
        id: 'bear_flag',
        category: 'CHART',
        bias: 'BEARISH',
        strength: 79,
        nameEn: 'Bearish Continuation Flag',
        nameFa: 'الگوی پرچم نزولی (Bear Flag)',
        detailEn: `Sharp ${poleReturnPct.toFixed(1)}% drop followed by narrow bearish flag consolidation.`,
        detailFa: `ریزش تند (${poleReturnPct.toFixed(1)}٪) همراه با اصلاح کم‌عمق مستعد ادامه ریزش.`,
      });
    }
  }

  // Deduplicate & score candlestick + chart patterns
  const uniqueMap = new Map<string, DetectedPattern>();
  for (const p of patterns) {
    const existing = uniqueMap.get(p.id);
    if (!existing || p.strength > existing.strength) {
      uniqueMap.set(p.id, p);
    }
  }
  const uniquePatterns = Array.from(uniqueMap.values()).sort((a, b) => b.strength - a.strength);

  let rawPatternScore = 0;
  for (const p of uniquePatterns) {
    if (p.category === 'SMC') continue; // SMC weighted in smcScore
    const sign = p.bias === 'BULLISH' ? 1 : p.bias === 'BEARISH' ? -1 : 0;
    rawPatternScore += sign * (p.strength * 0.45);
  }

  return {
    patterns: uniquePatterns.slice(0, 8),
    smcZone,
    smcStructure,
    candlestickAndChartScore: clamp(rawPatternScore, -100, 100),
    smcScore: clamp(smcScore, -100, 100),
  };
}
