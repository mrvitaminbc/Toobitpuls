import type {
  SentimentMood,
  SignalDirection,
  SocialHeadlineItem,
  SocialPlatformScore,
  SocialSentimentData,
} from '../types/futures';

export interface ParsedRssItem {
  title: string;
  link: string;
  publishedAt: number;
  source: string;
}

const STRONG_BULL_TERMS = [
  'surge',
  'soar',
  'skyrocket',
  'breakout',
  'all-time high',
  'ath',
  'bullish',
  'etf approval',
  'approved',
  'inflow',
  'inflows',
  'accumulation',
  'rally',
  'moon',
  'institutional',
  'milestone',
  'outperform',
];

const MILD_BULL_TERMS = [
  'gain',
  'gains',
  'rise',
  'rises',
  'rising',
  'up ',
  'adoption',
  'partnership',
  'upgrade',
  'launch',
  'buy',
  'buying',
  'support',
  'rebound',
  'recover',
  'recovery',
  'growth',
  'positive',
  'optimism',
  'whale buy',
];

const STRONG_BEAR_TERMS = [
  'crash',
  'plunge',
  'collapse',
  'hack',
  'hacked',
  'exploit',
  'exploited',
  'bankrupt',
  'bankruptcy',
  'lawsuit',
  'bearish',
  'liquidation',
  'liquidated',
  'sell-off',
  'selloff',
  'dump',
  'scam',
  'fraud',
  'rug pull',
  'ban',
];

const MILD_BEAR_TERMS = [
  'drop',
  'drops',
  'fall',
  'falls',
  'falling',
  'decline',
  'fear',
  'slump',
  'outflow',
  'outflows',
  'resistance',
  'warning',
  'risk',
  'weak',
  'loss',
  'losses',
  'sell',
  'selling',
  'pressure',
  'concern',
];

export function extractBaseAssetFromSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (upper.includes('-SWAP-')) {
    return upper.split('-SWAP-')[0] || upper;
  }
  if (upper.endsWith('USDT') && upper.length > 4) {
    return upper.slice(0, -4);
  }
  if (upper.endsWith('USDC') && upper.length > 4) {
    return upper.slice(0, -4);
  }
  return upper;
}

export function normalizeBaseTicker(baseAsset: string): string {
  const cleaned = baseAsset.trim().toUpperCase().replace(/^10+(?=[A-Z]{2,})/, '');
  return cleaned || baseAsset.trim().toUpperCase();
}

export function classifyMood(score: number): SentimentMood {
  if (score >= 55) return 'BULLISH';
  if (score <= 45) return 'BEARISH';
  return 'NEUTRAL';
}

export function scoreHeadlineSentiment(text: string): { score: number; mood: SentimentMood } {
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
    mood: classifyMood(score),
  };
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTagValue(block: string, tag: string): string {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = block.match(regex);
  return match ? decodeXmlEntities(match[1]) : '';
}

export function parseRssHeadlines(xml: string, source: string, limit = 18): ParsedRssItem[] {
  if (!xml) return [];
  const items: ParsedRssItem[] = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  for (const block of itemMatches) {
    if (items.length >= limit) break;
    const title = extractTagValue(block, 'title');
    const link = extractTagValue(block, 'link');
    const pubRaw = extractTagValue(block, 'pubDate') || extractTagValue(block, 'dc:date');
    if (!title || !link.startsWith('http')) continue;

    const parsedDate = pubRaw ? Date.parse(pubRaw) : NaN;
    items.push({
      title,
      link,
      publishedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now(),
      source,
    });
  }

  return items;
}

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesCoinMention(
  title: string,
  baseTicker: string,
  coinName: string | null,
): boolean {
  const upperTicker = normalizeBaseTicker(baseTicker);
  if (coinName && coinName.trim().length >= 3) {
    const nameRegex = new RegExp(`\\b${escapeRegExp(coinName.trim())}\\b`, 'i');
    if (nameRegex.test(title)) return true;
  }

  if (upperTicker.length >= 2) {
    const cashtagRegex = new RegExp(`\\$${escapeRegExp(upperTicker)}\\b`, 'i');
    if (cashtagRegex.test(title)) return true;
  }

  if (upperTicker.length >= 3) {
    const tickerRegex = new RegExp(`\\b${escapeRegExp(upperTicker)}\\b`, 'i');
    if (tickerRegex.test(title)) return true;
  }

  return false;
}

export interface AggregateSocialInput {
  symbol: string;
  baseAsset: string;
  coinName: string | null;
  coingeckoUpPct: number | null;
  coingeckoDownPct: number | null;
  watchlistUsers: number | null;
  fearGreedValue: number | null;
  fearGreedLabel: string | null;
  rssItems: ParsedRssItem[];
  fetchedAt?: number;
}

export function aggregateSocialSentiment(input: AggregateSocialInput): SocialSentimentData {
  const normalizedTicker = normalizeBaseTicker(input.baseAsset);
  const fetchedAt = input.fetchedAt ?? Date.now();

  // 1. CoinGecko Community Votes
  const hasCg =
    typeof input.coingeckoUpPct === 'number' &&
    Number.isFinite(input.coingeckoUpPct) &&
    input.coingeckoUpPct >= 0 &&
    input.coingeckoUpPct <= 100 &&
    ((input.coingeckoUpPct ?? 0) > 0 || (input.coingeckoDownPct ?? 0) > 0);
  const cgScore = hasCg ? Math.round(input.coingeckoUpPct!) : 50;

  const cgPlatform: SocialPlatformScore = {
    id: 'coingecko',
    nameEn: 'CoinGecko Community',
    nameFa: 'رأی جامعه کوین‌گکو',
    score: cgScore,
    mood: classifyMood(cgScore),
    available: hasCg,
    detailEn: hasCg
      ? `${cgScore}% bullish votes${input.watchlistUsers ? ` · ${input.watchlistUsers.toLocaleString('en-US')} watchlists` : ''}`
      : 'Community vote breakdown unavailable for this token',
    detailFa: hasCg
      ? `${cgScore}٪ رأی صعودی${input.watchlistUsers ? ` · ${input.watchlistUsers.toLocaleString('en-US')} واچ‌لیست` : ''}`
      : 'آمار رأی جامعه برای این توکن در دسترس نیست',
  };

  // 2. Fear & Greed Index
  const hasFng =
    typeof input.fearGreedValue === 'number' &&
    Number.isFinite(input.fearGreedValue) &&
    input.fearGreedValue >= 0 &&
    input.fearGreedValue <= 100;
  const fngScore = hasFng ? Math.round(input.fearGreedValue!) : 50;
  const fngPlatform: SocialPlatformScore = {
    id: 'fear_greed',
    nameEn: 'Crypto Fear & Greed',
    nameFa: 'شاخص ترس و طمع بازار',
    score: fngScore,
    mood: classifyMood(fngScore),
    available: hasFng,
    detailEn: hasFng
      ? `${fngScore}/100 (${input.fearGreedLabel ?? 'Index'})`
      : 'Fear & Greed feed unavailable',
    detailFa: hasFng
      ? `${fngScore} از ۱۰۰ (${input.fearGreedLabel ?? 'شاخص'})`
      : 'فید شاخص ترس و طمع در دسترس نیست',
  };

  // 3. Crypto Media & Social Headline Pulse
  const scoredHeadlines: SocialHeadlineItem[] = input.rssItems.map((item) => {
    const scored = scoreHeadlineSentiment(item.title);
    const matchedCoin = matchesCoinMention(item.title, normalizedTicker, input.coinName);
    return {
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.link,
      sentiment: scored.mood,
      matchedCoin,
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

  const mediaPlatform: SocialPlatformScore = {
    id: 'media_pulse',
    nameEn: 'Crypto Media Pulse',
    nameFa: 'نبض رسانه‌های کریپتو',
    score: mediaScore,
    mood: classifyMood(mediaScore),
    available: hasMedia,
    detailEn: hasMedia
      ? `${coinMatched.length} ${normalizedTicker} mentions across ${scoredHeadlines.length} posts`
      : 'Social/news feeds temporarily unavailable',
    detailFa: hasMedia
      ? `${coinMatched.length} اشاره مستقیم به ${normalizedTicker} در ${scoredHeadlines.length} خبر`
      : 'فید خبری موقتا در دسترس نیست',
  };

  const platforms: SocialPlatformScore[] = [cgPlatform, mediaPlatform, fngPlatform];
  const weights: Record<SocialPlatformScore['id'], number> = {
    coingecko: 0.45,
    media_pulse: 0.3,
    fear_greed: 0.25,
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
    ...scoredHeadlines.filter((h) => !h.matchedCoin),
  ]
    .sort((a, b) => {
      if (a.matchedCoin !== b.matchedCoin) return a.matchedCoin ? -1 : 1;
      return b.publishedAt - a.publishedAt;
    })
    .slice(0, 4);

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
    fetchedAt,
  };
}

export function compareSentimentWithTechnical(
  mood: SentimentMood,
  techDirection: SignalDirection,
): 'CONFIRMING' | 'DIVERGING' | 'NEUTRAL' {
  if (mood === 'NEUTRAL' || techDirection === 'NEUTRAL') return 'NEUTRAL';
  if (
    (mood === 'BULLISH' && techDirection === 'LONG') ||
    (mood === 'BEARISH' && techDirection === 'SHORT')
  ) {
    return 'CONFIRMING';
  }
  return 'DIVERGING';
}
