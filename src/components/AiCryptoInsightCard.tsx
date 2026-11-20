import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { translations } from '../i18n/translations';
import { AiClientError, requestAiCryptoAnalysis } from '../services/apiClient';
import type { AiCryptoAnalysisReport, AiVerdict, Language, Timeframe } from '../types/futures';

interface AiCryptoInsightCardProps {
  symbol: string;
  timeframe: Timeframe;
  lang: Language;
  autoTriggerToken?: number;
}

export const AiCryptoInsightCard: React.FC<AiCryptoInsightCardProps> = ({
  symbol,
  timeframe,
  lang,
  autoTriggerToken = 0,
}) => {
  const t = translations[lang];
  const [report, setReport] = useState<AiCryptoAnalysisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ code: string; message: string } | null>(null);
  const lastHandledTokenRef = useRef<number>(0);

  useEffect(() => {
    setReport(null);
    setErrorInfo(null);
  }, [symbol, timeframe]);

  const runAnalysis = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setErrorInfo(null);
      try {
        const res = await requestAiCryptoAnalysis(symbol, timeframe, forceRefresh);
        setReport(res);
      } catch (err) {
        if (err instanceof AiClientError) {
          setErrorInfo({ code: err.code, message: err.message });
        } else {
          setErrorInfo({
            code: 'AI_UPSTREAM_ERROR',
            message: err instanceof Error ? err.message : 'AI analysis failed',
          });
        }
      } finally {
        setLoading(false);
      }
    },
    [symbol, timeframe],
  );

  useEffect(() => {
    if (autoTriggerToken > 0 && autoTriggerToken !== lastHandledTokenRef.current) {
      lastHandledTokenRef.current = autoTriggerToken;
      void runAnalysis(false);
    }
  }, [autoTriggerToken, runAnalysis]);

  const getVerdictLabel = (verdict: AiVerdict): string => {
    const map: Record<AiVerdict, { en: string; fa: string }> = {
      STRONG_LONG: { en: 'STRONG LONG', fa: 'لانگ پرقدرت' },
      LONG: { en: 'LONG', fa: 'لانگ (خرید)' },
      NEUTRAL_WAIT: { en: 'WAIT / NEUTRAL', fa: 'انتظار / خنثی' },
      SHORT: { en: 'SHORT', fa: 'شورت (فروش)' },
      STRONG_SHORT: { en: 'STRONG SHORT', fa: 'شورت پرقدرت' },
    };
    return map[verdict][lang];
  };

  const getVerdictColor = (verdict: AiVerdict): string => {
    if (verdict === 'STRONG_LONG' || verdict === 'LONG') {
      return 'text-emerald-600 dark:text-emerald-400';
    }
    if (verdict === 'STRONG_SHORT' || verdict === 'SHORT') {
      return 'text-rose-600 dark:text-rose-400';
    }
    return 'text-amber-600 dark:text-amber-400';
  };

  const warnings = report
    ? lang === 'fa'
      ? report.riskWarningsFa
      : report.riskWarningsEn
    : [];

  return (
    <div
      data-testid="ai-crypto-insight-card"
      className="tp-panel rounded-xl p-4 space-y-3.5 bg-gradient-to-br from-sky-500/[0.04] via-transparent to-indigo-500/[0.03]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="min-w-0 flex-1 basis-[180px]">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-sky-500 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
              {t.aiInsightTitle}
            </h2>
          </div>
          <div className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {t.aiInsightModelBadge}
            {report?.cached ? ` · ${t.aiInsightCached}` : ''}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void runAnalysis(Boolean(report))}
          disabled={loading}
          data-testid="run-ai-analysis-btn"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
        >
          {loading ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          <span>{report ? t.aiInsightRefreshBtn : t.aiInsightTriggerBtn}</span>
        </button>
      </div>

      {loading && !report && (
        <div className="py-4 text-xs text-sky-600 dark:text-sky-400 flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>{t.aiInsightLoading}</span>
        </div>
      )}

      {!loading && errorInfo && (
        <div
          data-testid="ai-insight-error"
          className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1"
        >
          <div className="flex items-start gap-2 font-semibold">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {errorInfo.code === 'MISSING_GEMINI_API_KEY'
                ? t.aiInsightMissingKey
                : errorInfo.code === 'NATIVE_APK_NO_SERVER_KEY'
                  ? t.aiInsightNativeNote
                  : errorInfo.message}
            </span>
          </div>
        </div>
      )}

      {!loading && !errorInfo && !report && (
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {t.aiInsightPromptHint}
        </p>
      )}

      {report && (
        <div className="space-y-3" data-testid="ai-insight-report">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-extrabold ${getVerdictColor(report.verdict)}`}>
                {getVerdictLabel(report.verdict)}
              </span>
              <span dir="ltr" className="font-mono-num text-xs font-bold text-slate-600 dark:text-slate-300">
                ({report.confidence}%)
              </span>
            </div>

            <span
              className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                report.agreesWithTechnical
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {report.agreesWithTechnical ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{report.agreesWithTechnical ? t.aiInsightAgrees : t.aiInsightCautions}</span>
            </span>
          </div>

          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
            {lang === 'fa' ? report.headlineFa : report.headlineEn}
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {lang === 'fa' ? report.summaryFa : report.summaryEn}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px]">
            <div className="space-y-0.5">
              <div className="font-bold text-emerald-600 dark:text-emerald-400">
                {t.aiInsightBullCase}
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {lang === 'fa' ? report.bullCaseFa : report.bullCaseEn}
              </p>
            </div>
            <div className="space-y-0.5">
              <div className="font-bold text-rose-600 dark:text-rose-400">
                {t.aiInsightBearCase}
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {lang === 'fa' ? report.bearCaseFa : report.bearCaseEn}
              </p>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
              <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                {t.aiInsightRisks}
              </div>
              <ul className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400 list-disc ps-4">
                {warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px]">
            <span className="font-bold text-sky-600 dark:text-sky-400">{t.aiInsightAdvice}: </span>
            <span className="text-slate-700 dark:text-slate-300">
              {lang === 'fa' ? report.executionAdviceFa : report.executionAdviceEn}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
