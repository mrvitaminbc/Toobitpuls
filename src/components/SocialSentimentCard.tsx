import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, MessageSquareText, RefreshCw } from 'lucide-react';
import { translations } from '../i18n/translations';
import type {
  Language,
  SentimentMood,
  SignalDirection,
  SocialSentimentData,
} from '../types/futures';
import { compareSentimentWithTechnical } from '../utils/socialSentiment';
import { fetchSocialSentiment } from '../services/apiClient';

interface SocialSentimentCardProps {
  symbol: string;
  techDirection: SignalDirection;
  lang: Language;
}

export const SocialSentimentCard: React.FC<SocialSentimentCardProps> = ({
  symbol,
  techDirection,
  lang,
}) => {
  const t = translations[lang];
  const [data, setData] = useState<SocialSentimentData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  const loadSentiment = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(false);
      try {
        const json = await fetchSocialSentiment(symbol, forceRefresh);
        setData(json);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [symbol],
  );

  useEffect(() => {
    void loadSentiment(false);
  }, [loadSentiment]);

  const getMoodText = (mood: SentimentMood): string => {
    if (mood === 'BULLISH') return t.sentimentBullish;
    if (mood === 'BEARISH') return t.sentimentBearish;
    return t.sentimentNeutral;
  };

  const getMoodColor = (mood: SentimentMood): string => {
    if (mood === 'BULLISH') return 'text-emerald-600 dark:text-emerald-400';
    if (mood === 'BEARISH') return 'text-rose-600 dark:text-rose-400';
    return 'text-amber-600 dark:text-amber-400';
  };

  const alignment = data ? compareSentimentWithTechnical(data.mood, techDirection) : 'NEUTRAL';

  return (
    <div
      data-testid="social-sentiment-card"
      className="tp-panel rounded-xl p-4 space-y-3.5"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquareText className="w-4 h-4 text-sky-500 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
            {t.sentimentTitle}
          </h2>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {data && alignment !== 'NEUTRAL' && (
            <span
              data-testid="sentiment-tech-alignment"
              className={`text-[11px] font-semibold ${
                alignment === 'CONFIRMING' ? 'text-emerald-500' : 'text-amber-500'
              }`}
            >
              {alignment === 'CONFIRMING' ? t.sentimentConfirming : t.sentimentDiverging}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadSentiment(true)}
            aria-label="Refresh social sentiment"
            className="min-h-[30px] min-w-[30px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] text-slate-500 hover:text-sky-500 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="py-5 text-xs text-slate-500 dark:text-slate-400">{t.sentimentLoading}</div>
      ) : error && !data ? (
        <div className="py-4 text-xs text-rose-500">{t.sentimentUnavailable}</div>
      ) : data ? (
        <>
          {/* Primary Bullish / Bearish Mood Score + Split Meter */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span
                  data-testid="social-mood-score"
                  className={`text-2xl font-extrabold font-mono-num ${getMoodColor(data.mood)}`}
                >
                  {data.moodScore}
                </span>
                <span className="text-xs font-mono-num text-slate-400">/ 100</span>
              </div>
              <span
                data-testid="social-mood-label"
                className={`text-sm font-bold ${getMoodColor(data.mood)}`}
              >
                {getMoodText(data.mood)}
              </span>
            </div>

            <div className="h-2 w-full rounded-full bg-rose-500/25 overflow-hidden flex" dir="ltr">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${data.bullishPct}%` }}
              />
              <div
                className="h-full bg-rose-500 transition-all duration-300"
                style={{ width: `${data.bearishPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono-num">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                {data.bullishPct}% {t.sentimentBullish}
              </span>
              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                {data.bearishPct}% {t.sentimentBearish}
              </span>
            </div>
          </div>

          {/* Platform Breakdown */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {t.sentimentSourcesTitle}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {data.platforms.map((platform) => (
                <div key={platform.id} className="py-2 first:pt-0 last:pb-0 space-y-0.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {lang === 'fa' ? platform.nameFa : platform.nameEn}
                    </span>
                    <span
                      className={`font-mono-num font-bold ${
                        platform.available ? getMoodColor(platform.mood) : 'text-slate-400'
                      }`}
                    >
                      {platform.available ? `${platform.score}/100` : '—'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {lang === 'fa' ? platform.detailFa : platform.detailEn}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Crypto Media & Social Headlines */}
          {data.headlines.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {t.sentimentHeadlinesTitle}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {data.headlines.slice(0, 3).map((item, idx) => (
                  <a
                    key={`${item.url}-${idx}`}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block py-2.5 first:pt-0.5 last:pb-0 hover:bg-slate-50/70 dark:hover:bg-white/[0.02] -mx-1.5 px-1.5 rounded-lg transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        dir="ltr"
                        className="text-[11px] font-medium text-slate-700 dark:text-slate-300 group-hover:text-sky-500 leading-snug line-clamp-2 text-left"
                      >
                        {item.title}
                      </p>
                      <ExternalLink className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-mono-num">
                      <span className="text-slate-400">
                        {item.source}
                        {item.matchedCoin ? ` · ${t.sentimentCoinTag}` : ''}
                      </span>
                      <span className={`font-bold ${getMoodColor(item.sentiment)}`}>
                        {getMoodText(item.sentiment)}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
