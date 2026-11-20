import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Award,
  Bell,
  BellRing,
  BookOpenCheck,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Plus,
  Send,
  Sliders,
  Smartphone,
  Trash2,
  Upload,
  Webhook,
  XCircle,
  Zap,
} from 'lucide-react';
import { getDirectionLabel, getPhaseLabel, translations } from '../i18n/translations';
import type {
  AlertAccuracySummary,
  AlertEvent,
  AlertOutcomeRecord,
  Language,
  MarketTicker,
  ScannerSettings,
  Timeframe,
  WatchlistAlertRule,
  WatchlistConditionMetric,
  WebhookConfig,
  WebhookDeliveryLog,
} from '../types/futures';
import {
  estimateAlertFallbackMove,
  getAlertProbability,
  splitAndSortAlerts,
} from '../utils/alerts';
import { formatRuleConditionLabel } from '../utils/customRules';
import { formatPrice, formatTime } from '../utils/formatters';
import { getPairAssets } from '../utils/futuresContracts';
import { DEFAULT_WEBHOOK_CONFIG, validateWebhookConfig } from '../utils/webhook';
import {
  fetchWebhookConfig,
  saveWebhookConfig,
  sendTestWebhook,
} from '../services/apiClient';
import { PWAInstallButton } from './PWAInstallButton';

interface AlertsSettingsViewProps {
  alerts: AlertEvent[];
  outcomes?: AlertOutcomeRecord[];
  accuracy?: AlertAccuracySummary;
  settings: ScannerSettings;
  lang: Language;
  loggedSymbols: Set<string>;
  customRules?: WatchlistAlertRule[];
  tickers?: MarketTicker[];
  watchlist?: string[];
  onUpdateSettings: (next: ScannerSettings) => void;
  onClearAlerts: () => void;
  onSelectSymbol: (symbol: string) => void;
  onLogAlert: (alert: AlertEvent) => void;
  onAddRule?: (rule: WatchlistAlertRule) => void;
  onToggleRule?: (id: string) => void;
  onDeleteRule?: (id: string) => void;
  onExportBackup?: () => void;
  onImportBackup?: (file: File) => Promise<boolean>;
}

export const AlertsSettingsView: React.FC<AlertsSettingsViewProps> = ({
  alerts,
  outcomes = [],
  accuracy,
  settings,
  lang,
  loggedSymbols,
  customRules = [],
  tickers = [],
  watchlist = [],
  onUpdateSettings,
  onClearAlerts,
  onSelectSymbol,
  onLogAlert,
  onAddRule,
  onToggleRule,
  onDeleteRule,
  onExportBackup,
  onImportBackup,
}) => {
  const t = translations[lang];
  const [notifStatus, setNotifStatus] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );

  const [webhookDraft, setWebhookDraft] = useState<WebhookConfig>(DEFAULT_WEBHOOK_CONFIG);
  const [deliveryLogs, setDeliveryLogs] = useState<WebhookDeliveryLog[]>([]);
  const [fieldErrors, setFieldErrors] = useState<{ discord?: string; telegram?: string }>({});
  const [webhookFeedback, setWebhookFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  // Custom Watchlist Rule Builder State
  const [ruleName, setRuleName] = useState('');
  const [ruleSymbol, setRuleSymbol] = useState('*');
  const [ruleMatchMode, setRuleMatchMode] = useState<'ALL' | 'ANY'>('ALL');
  const [ruleMetric1, setRuleMetric1] = useState<WatchlistConditionMetric>('MTF_ALIGNED');
  const [ruleThresh1, setRuleThresh1] = useState('2');
  const [ruleMetric2, setRuleMetric2] = useState<WatchlistConditionMetric | 'NONE'>('TTM_SQUEEZE_BARS');
  const [ruleThresh2, setRuleThresh2] = useState('4');
  const [ruleCooldown, setRuleCooldown] = useState('15');
  const [backupFeedback, setBackupFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [termuxCopied, setTermuxCopied] = useState(false);

  const outcomeMap = useMemo(() => {
    const m = new Map<string, AlertOutcomeRecord>();
    for (const o of outcomes) m.set(o.alertId, o);
    return m;
  }, [outcomes]);

  const { pumpAlerts, dumpAlerts } = useMemo(() => splitAndSortAlerts(alerts, 50), [alerts]);
  const totalFilteredAlerts = pumpAlerts.length + dumpAlerts.length;

  useEffect(() => {
    let active = true;
    fetchWebhookConfig()
      .then((data) => {
        if (!active || !data) return;
        if (data.config) setWebhookDraft(data.config);
        if (Array.isArray(data.logs)) setDeliveryLogs(data.logs);
      })
      .catch(() => {
        // Non-fatal if server unavailable during initial load
      });
    return () => {
      active = false;
    };
  }, []);

  const requestPushPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setNotifStatus(perm);
    if (perm === 'granted') {
      onUpdateSettings({ ...settings, browserAlerts: true });
    }
  };

  const handleSaveWebhooks = async (overrideDraft?: WebhookConfig) => {
    const targetDraft = overrideDraft ?? webhookDraft;
    setWebhookFeedback(null);
    const localCheck = validateWebhookConfig(targetDraft);
    if (!localCheck.valid) {
      setFieldErrors(localCheck.errors);
      return;
    }

    setFieldErrors({});
    setSavingWebhook(true);
    try {
      const { ok, data } = await saveWebhookConfig(localCheck.config);
      if (!ok) {
        setFieldErrors(data.errors ?? {});
        setWebhookFeedback({ type: 'error', message: t.webhookTestFailMsg });
        return;
      }
      if (data.config) setWebhookDraft(data.config);
      if (Array.isArray(data.logs)) setDeliveryLogs(data.logs);
      setWebhookFeedback({ type: 'success', message: t.webhookSavedMsg });
    } catch {
      setWebhookFeedback({ type: 'error', message: t.webhookTestFailMsg });
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleTestWebhook = async () => {
    setWebhookFeedback(null);
    const localCheck = validateWebhookConfig(webhookDraft);
    if (!localCheck.valid) {
      setFieldErrors(localCheck.errors);
      return;
    }

    if (!localCheck.config.discordWebhookUrl && !localCheck.config.telegramWebhookUrl) {
      setFieldErrors({ discord: t.webhookNoUrlMsg });
      return;
    }

    setFieldErrors({});
    setTestingWebhook(true);
    try {
      const { ok, data } = await sendTestWebhook(localCheck.config);
      if (Array.isArray(data.logs)) {
        setDeliveryLogs(data.logs);
      }
      if (!ok) {
        if (data.errors) setFieldErrors(data.errors);
        const firstErr = data.results?.find((r) => !r.ok)?.error;
        setWebhookFeedback({
          type: 'error',
          message: firstErr ? `${t.webhookTestFailMsg} (${firstErr})` : t.webhookTestFailMsg,
        });
        return;
      }
      setWebhookFeedback({ type: 'success', message: t.webhookTestOkMsg });
    } catch {
      setWebhookFeedback({ type: 'error', message: t.webhookTestFailMsg });
    } finally {
      setTestingWebhook(false);
    }
  };

  const renderAlertRow = (al: AlertEvent, isPump: boolean) => {
    const prob = getAlertProbability(al);
    const isLogged = loggedSymbols.has(al.symbol);
    const estMove = estimateAlertFallbackMove(al);
    const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
    const minMoveStr = fmtPct(estMove.expectedMoveMinPct);
    const maxMoveStr = fmtPct(estMove.expectedMoveMaxPct);
    const horizonStr = lang === 'fa' ? estMove.expectedWindowFa : estMove.expectedWindowEn;

    const gradeClass =
      al.qualityGrade === 'A+'
        ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/35 bg-emerald-500/10'
        : al.qualityGrade === 'A'
          ? 'text-sky-600 dark:text-sky-400 border-sky-500/35 bg-sky-500/10'
          : 'text-amber-600 dark:text-amber-400 border-amber-500/35 bg-amber-500/10';

    return (
      <div
        key={al.id}
        data-testid={isPump ? 'pump-alert-row' : 'dump-alert-row'}
        data-probability={prob}
        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/25 px-1.5 rounded-lg transition-colors"
      >
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <button
              type="button"
              onClick={() => onSelectSymbol(al.symbol)}
              className="font-extrabold text-sm text-slate-900 dark:text-slate-100 hover:text-sky-500 transition-colors"
            >
              {al.baseAsset}/{getPairAssets(al.symbol).quoteAsset}
            </button>
            {al.qualityGrade && (
              <span
                dir="ltr"
                className={`px-1.5 py-0.5 rounded border text-[10px] font-mono-num font-bold ${gradeClass}`}
              >
                {al.qualityGrade}
              </span>
            )}
            <span className={`font-semibold ${isPump ? 'text-emerald-500' : 'text-rose-500'}`}>
              {getPhaseLabel(al.phase, lang)} · {getDirectionLabel(al.direction, lang)}
            </span>
            <span
              className={`font-mono-num font-bold inline-flex items-center gap-1 ${
                isPump ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              <span>{t.alertsProbLabel}:</span>
              <span dir="ltr">{prob}%</span>
            </span>
            <span dir="ltr" className="font-mono-num text-slate-400 inline-flex items-center gap-1.5">
              <span>{formatTime(al.timestamp)}</span>
              <span aria-hidden="true">·</span>
              <span>Z {al.volumeZScore}</span>
              <span aria-hidden="true">·</span>
              <span>{al.confidence}%</span>
              {typeof al.alignedTimeframes === 'number' && al.alignedTimeframes > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>MTF {al.alignedTimeframes}/3</span>
                </>
              )}
            </span>
          </div>

          {/* Expected Price Change % within Defined Time Window */}
          <div
            data-testid="alert-expected-move"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          >
            <span
              className={`inline-flex items-center gap-1.5 font-semibold ${
                isPump ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              <span>{t.alertsEstMoveLabel}:</span>
              <span className="inline-flex items-center gap-1 font-mono-num font-bold">
                <span dir="ltr">{minMoveStr}</span>
                <span>{lang === 'fa' ? 'تا' : 'to'}</span>
                <span dir="ltr">{maxMoveStr}</span>
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium">
              <span>{t.alertsHorizonLabel}:</span>
              <span className="font-semibold text-sky-600 dark:text-sky-400">{horizonStr}</span>
            </span>
            {typeof al.takerBuyPct === 'number' && (
              <span className="inline-flex items-center gap-1 font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                <span>{t.takerBuy}</span>
                <span dir="ltr">{al.takerBuyPct}%</span>
              </span>
            )}
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {lang === 'fa' ? al.reasonFa : al.reasonEn}
          </p>

          {(() => {
            const out = outcomeMap.get(al.id);
            if (!out) return null;
            const statusText =
              out.status === 'HIT_TARGET'
                ? t.alertsStatusHit
                : out.status === 'EXPIRED_PROFIT'
                  ? t.alertsStatusExpired
                  : out.status === 'INVALIDATED'
                    ? t.alertsStatusInvalidated
                    : t.alertsStatusTracking;
            const statusColor =
              out.status === 'HIT_TARGET' || out.status === 'EXPIRED_PROFIT'
                ? 'text-emerald-500'
                : out.status === 'INVALIDATED'
                  ? 'text-rose-500'
                  : 'text-sky-500';
            return (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono-num">
                <span className={`font-semibold font-sans ${statusColor}`}>{statusText}</span>
                <span dir="ltr" className="text-emerald-500">
                  MFE +{out.mfePct}%
                </span>
                <span dir="ltr" className="text-rose-500">
                  MAE -{out.maePct}%
                </span>
              </div>
            );
          })()}

          {/* Micro probability strength bar */}
          <div className="h-1 w-32 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" dir="ltr">
            <div
              className={`h-full ${isPump ? 'bg-emerald-500' : 'bg-rose-500'}`}
              style={{ width: `${Math.min(100, prob)}%` }}
            />
          </div>
        </div>

        {/* Action Cluster: Log to Journal button positioned on the visual left */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0 w-full sm:w-auto">
          <span className="text-xs font-mono-num font-bold text-slate-900 dark:text-slate-100">
            ${formatPrice(al.price)}
          </span>
          <div className="flex items-center gap-1.5 rtl:flex-row ltr:flex-row-reverse">
            <button
              type="button"
              onClick={() => onSelectSymbol(al.symbol)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500 min-h-[36px] whitespace-nowrap"
            >
              <Zap className="w-3 h-3" />
              <span>{t.analyzeBtn}</span>
            </button>
            <button
              type="button"
              data-testid="alert-log-journal-btn"
              disabled={isLogged}
              onClick={() => onLogAlert(al)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap min-h-[36px] ${
                isLogged
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/70 text-slate-800 dark:text-slate-200 hover:border-sky-500/60 hover:text-sky-500'
              }`}
            >
              <BookOpenCheck className="w-3.5 h-3.5" />
              <span>{isLogged ? t.loggedDone : t.logToJournal}</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t.alertsTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t.alertsSubtitle}
          </p>
        </div>
        <PWAInstallButton lang={lang} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Separated Pump & Dump Alerts Sections (Sorted High -> Low Probability) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Automated Alert Signal Precision & MFE/MAE Scoreboard */}
          {accuracy && (
            <div
              data-testid="alerts-accuracy-scoreboard"
              className="tp-panel rounded-xl p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <Award className="w-4 h-4 text-sky-500 shrink-0" />
                  <h2>{t.alertsAccuracyTitle}</h2>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono-num" dir="ltr">
                  <span className="font-bold text-emerald-500">
                    {t.alertsAccuracyWinRate}: {accuracy.overallWinRatePct}%
                  </span>
                  <span className="text-slate-500">
                    {t.alertsAccuracyTracked}: {accuracy.totalTracked} ({accuracy.resolvedCount} {t.alertsAccuracyResolved})
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-xs font-mono-num">
                {accuracy.byGrade.map((g) => (
                  <div
                    key={g.grade}
                    className="rounded-lg border border-slate-200/70 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#080C14]/70 p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-bold ${
                          g.grade === 'A+'
                            ? 'text-emerald-500'
                            : g.grade === 'A'
                              ? 'text-sky-500'
                              : 'text-amber-500'
                        }`}
                      >
                        {g.grade}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100" dir="ltr">
                        {g.winRatePct}% ({g.wins}/{g.resolved || g.total})
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500" dir="ltr">
                      <span className="text-emerald-500">MFE +{g.avgMfePct}%</span>
                      <span className="text-rose-500">MAE -{g.avgMaePct}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="tp-panel flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                <BellRing className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {t.navAlerts} ({totalFilteredAlerts})
                </span>
                <span className="text-slate-400" aria-hidden="true">·</span>
                <span className="text-slate-500 dark:text-slate-400">{t.alertsSortedHint}</span>
              </div>
              <p className="text-[11px] font-medium text-sky-600 dark:text-sky-400">
                {t.alertsMtfGateHint}
              </p>
            </div>
            {alerts.length > 0 && (
              <button
                type="button"
                onClick={onClearAlerts}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-rose-500 transition-colors min-h-[36px]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.clearAlerts}</span>
              </button>
            )}
          </div>

          {/* Pump Alerts Section */}
          <div
            data-testid="alerts-pump-section"
            className="tp-panel relative overflow-hidden rounded-xl border-emerald-500/25 p-4 space-y-2"
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-400/35 to-transparent"
            />
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                <ArrowUpRight className="w-4 h-4 shrink-0" />
                <h2>
                  {t.alertsPumpSection} ({pumpAlerts.length})
                </h2>
              </div>
              <span className="text-[11px] font-mono-num text-slate-400">{t.alertsProbLabel} ↓</span>
            </div>

            {pumpAlerts.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                <Bell className="w-6 h-6 mx-auto mb-1.5 opacity-35" />
                <p>{t.alertsNoPump}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {pumpAlerts.map((al) => renderAlertRow(al, true))}
              </div>
            )}
          </div>

          {/* Dump Alerts Section */}
          <div
            data-testid="alerts-dump-section"
            className="tp-panel relative overflow-hidden rounded-xl border-rose-500/25 p-4 space-y-2"
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-rose-500/80 via-rose-400/35 to-transparent"
            />
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
              <div className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400">
                <ArrowDownRight className="w-4 h-4 shrink-0" />
                <h2>
                  {t.alertsDumpSection} ({dumpAlerts.length})
                </h2>
              </div>
              <span className="text-[11px] font-mono-num text-slate-400">{t.alertsProbLabel} ↓</span>
            </div>

            {dumpAlerts.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                <Bell className="w-6 h-6 mx-auto mb-1.5 opacity-35" />
                <p>{t.alertsNoDump}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {dumpAlerts.map((al) => renderAlertRow(al, false))}
              </div>
            )}
          </div>
        </div>

        {/* Settings & Webhook Integrations Column */}
        <div className="lg:col-span-5 space-y-5">
          {/* Discord & Telegram Webhooks Card */}
          <div className="tp-panel rounded-xl p-4 space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <Webhook className="w-4 h-4 text-sky-500 shrink-0" />
                  <h2>{t.webhookTitle}</h2>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.webhookSubtitle}
                </p>
              </div>
              <button
                type="button"
                data-testid="webhook-enabled-toggle"
                onClick={() => {
                  const next = { ...webhookDraft, enabled: !webhookDraft.enabled };
                  setWebhookDraft(next);
                  if (!next.discordWebhookUrl && !next.telegramWebhookUrl) return;
                  void handleSaveWebhooks(next);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                  webhookDraft.enabled
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {webhookDraft.enabled ? t.toggleOn : t.toggleOff}
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between font-medium text-slate-700 dark:text-slate-300 mb-1">
                  <label htmlFor="webhook-confidence-slider">{t.webhookMinConf}</label>
                  <span className="font-mono-num text-sky-500 font-bold">
                    ≥ {webhookDraft.minConfidence}%
                  </span>
                </div>
                <input
                  id="webhook-confidence-slider"
                  data-testid="webhook-confidence-slider"
                  type="range"
                  min={50}
                  max={95}
                  step={5}
                  value={webhookDraft.minConfidence}
                  onChange={(e) =>
                    setWebhookDraft((prev) => ({
                      ...prev,
                      minConfidence: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="webhook-discord-url"
                  className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {t.webhookDiscordLabel}
                </label>
                <input
                  id="webhook-discord-url"
                  data-testid="webhook-discord-url"
                  type="url"
                  dir="ltr"
                  value={webhookDraft.discordWebhookUrl}
                  onChange={(e) => {
                    setWebhookDraft((prev) => ({ ...prev, discordWebhookUrl: e.target.value }));
                    if (fieldErrors.discord) {
                      setFieldErrors((prev) => ({ ...prev, discord: undefined }));
                    }
                  }}
                  placeholder={t.webhookDiscordPlaceholder}
                  className={`w-full rounded-lg border bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-left text-xs font-mono-num text-slate-900 dark:text-slate-100 placeholder:text-slate-400 min-h-[40px] ${
                    fieldErrors.discord
                      ? 'border-rose-500'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                />
                {fieldErrors.discord && (
                  <p className="mt-1 text-[11px] text-rose-500 font-medium">{fieldErrors.discord}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="webhook-telegram-url"
                  className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  {t.webhookTelegramLabel}
                </label>
                <input
                  id="webhook-telegram-url"
                  data-testid="webhook-telegram-url"
                  type="url"
                  dir="ltr"
                  value={webhookDraft.telegramWebhookUrl}
                  onChange={(e) => {
                    setWebhookDraft((prev) => ({ ...prev, telegramWebhookUrl: e.target.value }));
                    if (fieldErrors.telegram) {
                      setFieldErrors((prev) => ({ ...prev, telegram: undefined }));
                    }
                  }}
                  placeholder={t.webhookTelegramPlaceholder}
                  className={`w-full rounded-lg border bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-left text-xs font-mono-num text-slate-900 dark:text-slate-100 placeholder:text-slate-400 min-h-[40px] ${
                    fieldErrors.telegram
                      ? 'border-rose-500'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                />
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {t.webhookTelegramHint}
                </p>
                {fieldErrors.telegram && (
                  <p className="mt-1 text-[11px] text-rose-500 font-medium">{fieldErrors.telegram}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  data-testid="webhook-save-btn"
                  disabled={savingWebhook}
                  onClick={() => void handleSaveWebhooks()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60 transition-colors min-h-[40px]"
                >
                  <span>{savingWebhook ? t.webhookSaving : t.webhookSave}</span>
                </button>
                <button
                  type="button"
                  data-testid="webhook-test-btn"
                  disabled={testingWebhook}
                  onClick={() => void handleTestWebhook()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 transition-colors min-h-[40px]"
                >
                  <Send className="w-3.5 h-3.5 text-sky-500" />
                  <span>{testingWebhook ? t.webhookTesting : t.webhookTest}</span>
                </button>
              </div>

              {webhookFeedback && (
                <div
                  data-testid="webhook-feedback"
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                    webhookFeedback.type === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {webhookFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{webhookFeedback.message}</span>
                </div>
              )}

              {deliveryLogs.length > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t.webhookLogsTitle}
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {deliveryLogs.slice(0, 4).map((log) => (
                      <div key={log.id} className="py-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold uppercase text-slate-700 dark:text-slate-300">
                            {log.platform}
                          </span>
                          <span className="font-mono-num text-slate-500 truncate">
                            {log.symbol} · {log.confidence}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 font-mono-num">
                          <span className={log.ok ? 'text-emerald-500 font-semibold' : 'text-rose-500 font-semibold'}>
                            {log.ok ? t.webhookLogOk : `${t.webhookLogFail}${log.statusCode ? ` (${log.statusCode})` : ''}`}
                          </span>
                          <span className="text-slate-400">{formatTime(log.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Scanner Engine Settings */}
          <div className="tp-panel rounded-xl p-4 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
              {t.settingsTitle}
            </h2>

            <div className="space-y-4 text-xs">
              <div>
                <label htmlFor="setting-tf" className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.timeframe}
                </label>
                <select
                  id="setting-tf"
                  dir="ltr"
                  value={settings.timeframe}
                  onChange={(e) => onUpdateSettings({ ...settings, timeframe: e.target.value as Timeframe })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-left text-slate-900 dark:text-slate-100 min-h-[40px]"
                >
                  <option value="1h">1h (Intraday MTF Entry)</option>
                  <option value="4h">4h (Swing Structure & SMC)</option>
                  <option value="1d">1d (Macro Ichimoku Trend)</option>
                </select>
              </div>

              <div>
                <label htmlFor="setting-vol" className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.settingMinVol}
                </label>
                <select
                  id="setting-vol"
                  value={settings.minVolume24h}
                  onChange={(e) => onUpdateSettings({ ...settings, minVolume24h: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-start text-slate-900 dark:text-slate-100 font-mono-num min-h-[40px]"
                >
                  <option value={0}>{t.allFuturesVol}</option>
                  <option value={100_000}>$100,000+</option>
                  <option value={500_000}>$500,000+</option>
                  <option value={2_000_000}>$2,000,000+</option>
                  <option value={10_000_000}>$10,000,000+</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between font-medium text-slate-700 dark:text-slate-300 mb-1">
                  <label htmlFor="setting-conf">{t.settingMinConf}</label>
                  <span dir="ltr" className="font-mono-num text-sky-500 font-bold">{settings.minConfidence}%</span>
                </div>
                <input
                  id="setting-conf"
                  type="range"
                  min={40}
                  max={85}
                  step={5}
                  value={settings.minConfidence}
                  onChange={(e) => onUpdateSettings({ ...settings, minConfidence: Number(e.target.value) })}
                  className="w-full accent-sky-500"
                />
              </div>

              <div>
                <label htmlFor="setting-refresh" className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.settingRefresh}
                </label>
                <select
                  id="setting-refresh"
                  dir="ltr"
                  value={settings.refreshSeconds}
                  onChange={(e) => onUpdateSettings({ ...settings, refreshSeconds: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-left text-slate-900 dark:text-slate-100 font-mono-num min-h-[40px]"
                >
                  <option value={10}>10s</option>
                  <option value={20}>20s</option>
                  <option value={30}>30s</option>
                  <option value={60}>60s</option>
                </select>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <span className="font-medium text-slate-700 dark:text-slate-300">{t.settingSound}</span>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, soundAlerts: !settings.soundAlerts })}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors min-h-[38px] ${
                    settings.soundAlerts
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {settings.soundAlerts ? t.toggleOn : t.toggleOff}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <span className="font-medium text-slate-700 dark:text-slate-300">{t.settingAutoLog}</span>
                <button
                  type="button"
                  data-testid="settings-autolog-toggle"
                  onClick={() => onUpdateSettings({ ...settings, autoLogSignals: !settings.autoLogSignals })}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap min-h-[38px] ${
                    settings.autoLogSignals
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {settings.autoLogSignals ? t.toggleOn : t.toggleOff}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <span className="font-medium text-slate-700 dark:text-slate-300">{t.settingAutoTrack}</span>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ ...settings, autoTrackJournal: !settings.autoTrackJournal })}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap min-h-[38px] ${
                    settings.autoTrackJournal
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {settings.autoTrackJournal ? t.toggleOn : t.toggleOff}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <span className="font-medium text-slate-700 dark:text-slate-300">{t.journalBreakevenSwitch}</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      autoMoveBreakeven: !(settings.autoMoveBreakeven ?? true),
                    })
                  }
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap min-h-[38px] ${
                    (settings.autoMoveBreakeven ?? true)
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {(settings.autoMoveBreakeven ?? true) ? t.toggleOn : t.toggleOff}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <span className="font-medium text-slate-700 dark:text-slate-300">{t.settingBrowserNotif}</span>
                {notifStatus === 'granted' ? (
                  <span className="text-emerald-500 font-semibold">{t.notifGranted}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void requestPushPermission()}
                    className="px-3 py-1.5 rounded-lg bg-sky-600 text-white font-semibold hover:bg-sky-500 transition-colors min-h-[38px]"
                  >
                    {t.enableNotif}
                  </button>
                )}
              </div>

              {/* Local Workspace Backup & Restore */}
              {(onExportBackup || onImportBackup) && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">{t.backupTitle}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.backupSub}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {onExportBackup && (
                      <button
                        type="button"
                        data-testid="workspace-export-btn"
                        onClick={onExportBackup}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-sky-500 transition-colors min-h-[38px]"
                      >
                        <Download className="w-3.5 h-3.5 text-sky-500" />
                        <span>{t.backupExport}</span>
                      </button>
                    )}
                    {onImportBackup && (
                      <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-emerald-500 transition-colors cursor-pointer min-h-[38px]">
                        <Upload className="w-3.5 h-3.5 text-emerald-500" />
                        <span>{t.backupImport}</span>
                        <input
                          type="file"
                          accept="application/json,.json"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const ok = await onImportBackup(file);
                            setBackupFeedback({
                              type: ok ? 'success' : 'error',
                              message: ok ? t.backupSuccess : t.backupInvalid,
                            });
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {backupFeedback && (
                    <p className={`text-[11px] font-medium ${backupFeedback.type === 'success' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {backupFeedback.message}
                    </p>
                  )}
                </div>
              )}

              {/* Android Termux Standalone PWA Launcher Guide */}
              <div
                data-testid="termux-android-card"
                className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{t.termuxTitle}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {t.termuxSub}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-3 py-2">
                  <code dir="ltr" className="text-[11px] font-mono-num text-sky-600 dark:text-sky-400 truncate">
                    bash android-termux.sh
                  </code>
                  <button
                    type="button"
                    data-testid="termux-copy-btn"
                    onClick={() => {
                      const cmd = 'bash android-termux.sh';
                      const fallbackCopy = () => {
                        const ta = document.createElement('textarea');
                        ta.value = cmd;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        try {
                          document.execCommand('copy');
                        } catch {
                          // ignore copy restriction in sandboxed environments
                        }
                        document.body.removeChild(ta);
                      };
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(cmd).catch(fallbackCopy);
                      } else {
                        fallbackCopy();
                      }
                      setTermuxCopied(true);
                      setTimeout(() => setTermuxCopied(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500 transition-colors whitespace-nowrap shrink-0"
                  >
                    {termuxCopied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span>{t.termuxCopied}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>{t.termuxCopyCmd}</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t.termuxNote}
                </p>
              </div>
            </div>
          </div>

          {/* Custom Multi-Condition Watchlist Rules Builder */}
          {onAddRule && (
            <div data-testid="custom-rules-card" className="tp-panel rounded-xl p-4 space-y-4">
              <div className="pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                  <Sliders className="w-4 h-4 text-sky-500 shrink-0" />
                  <h2>{t.customRulesTitle}</h2>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t.customRulesSub}
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const conditions = [{ metric: ruleMetric1, threshold: Number(ruleThresh1) || 0 }];
                  if (ruleMetric2 !== 'NONE') {
                    conditions.push({ metric: ruleMetric2, threshold: Number(ruleThresh2) || 0 });
                  }
                  const symLabel = ruleSymbol === '*' ? 'All Pairs' : ruleSymbol.split('-SWAP-')[0];
                  const newRule: WatchlistAlertRule = {
                    id: `rule-${Date.now()}`,
                    symbol: ruleSymbol,
                    name: ruleName.trim() || `${symLabel} Alert`,
                    enabled: true,
                    matchMode: ruleMatchMode,
                    conditions,
                    cooldownMinutes: Math.max(1, Number(ruleCooldown) || 15),
                    createdAt: Date.now(),
                  };
                  onAddRule(newRule);
                  setRuleName('');
                }}
                className="space-y-3 text-xs"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    placeholder={t.customRuleNamePlaceholder}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-slate-900 dark:text-slate-100 min-h-[38px]"
                  />
                  <select
                    value={ruleSymbol}
                    onChange={(e) => setRuleSymbol(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-slate-900 dark:text-slate-100 min-h-[38px]"
                  >
                    <option value="*">{t.customRuleAllPairs}</option>
                    {watchlist.map((sym) => (
                      <option key={`wl-${sym}`} value={sym}>
                        ★ {sym}
                      </option>
                    ))}
                    {tickers
                      .filter((tk) => !watchlist.includes(tk.symbol))
                      .slice(0, 40)
                      .map((tk) => (
                        <option key={tk.symbol} value={tk.symbol}>
                          {tk.symbol}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={ruleMetric1}
                    onChange={(e) => setRuleMetric1(e.target.value as WatchlistConditionMetric)}
                    className="col-span-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 text-slate-900 dark:text-slate-100 min-h-[38px]"
                  >
                    <option value="MTF_ALIGNED">MTF Aligned ≥ (/3)</option>
                    <option value="TTM_SQUEEZE_BARS">TTM Squeeze ≥ (bars)</option>
                    <option value="FUNDING_LTE">Funding Rate ≤ (%)</option>
                    <option value="FUNDING_GTE">Funding Rate ≥ (%)</option>
                    <option value="CONFIDENCE_GTE">Confidence ≥ (%)</option>
                    <option value="PUMP_PROB_GTE">Pump Prob ≥ (%)</option>
                    <option value="DUMP_PROB_GTE">Dump Prob ≥ (%)</option>
                    <option value="VOL_RATIO_GTE">Vol Ratio ≥ (x)</option>
                  </select>
                  <input
                    type="number"
                    step="any"
                    value={ruleThresh1}
                    onChange={(e) => setRuleThresh1(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100 min-h-[38px]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={ruleMetric2}
                    onChange={(e) => setRuleMetric2(e.target.value as WatchlistConditionMetric | 'NONE')}
                    className="col-span-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 text-slate-900 dark:text-slate-100 min-h-[38px]"
                  >
                    <option value="NONE">— No 2nd Condition —</option>
                    <option value="TTM_SQUEEZE_BARS">TTM Squeeze ≥ (bars)</option>
                    <option value="MTF_ALIGNED">MTF Aligned ≥ (/3)</option>
                    <option value="FUNDING_LTE">Funding Rate ≤ (%)</option>
                    <option value="FUNDING_GTE">Funding Rate ≥ (%)</option>
                    <option value="CONFIDENCE_GTE">Confidence ≥ (%)</option>
                    <option value="PUMP_PROB_GTE">Pump Prob ≥ (%)</option>
                    <option value="DUMP_PROB_GTE">Dump Prob ≥ (%)</option>
                    <option value="VOL_RATIO_GTE">Vol Ratio ≥ (x)</option>
                  </select>
                  <input
                    type="number"
                    step="any"
                    disabled={ruleMetric2 === 'NONE'}
                    value={ruleThresh2}
                    onChange={(e) => setRuleThresh2(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100 disabled:opacity-50 min-h-[38px]"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={ruleMatchMode}
                      onChange={(e) => setRuleMatchMode(e.target.value as 'ALL' | 'ANY')}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-1.5 text-slate-900 dark:text-slate-100 min-h-[36px]"
                    >
                      <option value="ALL">{t.customRuleMatchAll}</option>
                      <option value="ANY">{t.customRuleMatchAny}</option>
                    </select>
                    <label className="text-[11px] text-slate-500 flex items-center gap-1">
                      <span>{t.customRuleCooldown}:</span>
                      <input
                        type="number"
                        min={1}
                        max={240}
                        value={ruleCooldown}
                        onChange={(e) => setRuleCooldown(e.target.value)}
                        className="w-14 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2 py-1 font-mono-num text-slate-900 dark:text-slate-100"
                      />
                    </label>
                  </div>

                  <button
                    type="submit"
                    data-testid="custom-rule-submit"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition-colors min-h-[36px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.customRuleAdd}</span>
                  </button>
                </div>
              </form>

              {customRules.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                  {t.customRuleNoRules}
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                  {customRules.map((rule) => (
                    <div key={rule.id} data-testid="custom-rule-row" className="py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                          <span className="truncate">{rule.name}</span>
                          <span dir="ltr" className="font-mono-num text-[11px] text-sky-500">
                            {rule.symbol}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
                          {rule.matchMode} · {rule.conditions.map((c) => formatRuleConditionLabel(c, lang)).join(' + ')}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {onToggleRule && (
                          <button
                            type="button"
                            onClick={() => onToggleRule(rule.id)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                              rule.enabled
                                ? 'bg-emerald-500/15 text-emerald-500'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                            }`}
                          >
                            {rule.enabled ? t.toggleOn : t.toggleOff}
                          </button>
                        )}
                        {onDeleteRule && (
                          <button
                            type="button"
                            onClick={() => onDeleteRule(rule.id)}
                            aria-label={`Delete rule ${rule.name}`}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
