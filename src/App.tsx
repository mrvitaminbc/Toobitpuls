import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpenCheck,
  CandlestickChart,
  Globe,
  LayoutDashboard,
  Moon,
  Radar,
  RefreshCw,
  Star,
  Sun,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { AlertsSettingsView } from './components/AlertsSettingsView';
import { AnalyzerView } from './components/AnalyzerView';
import { DashboardView } from './components/DashboardView';
import { JournalView } from './components/JournalView';
import { MarketView } from './components/MarketView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { PairSelectorDropdown } from './components/PairSelectorDropdown';
import { RadarView } from './components/RadarView';
import { SignalsView } from './components/SignalsView';
import {
  applyLivePriceToJournalEntry,
  createJournalFromAlert,
  createJournalFromAnalysis,
  createJournalFromOpportunity,
} from './engine/journal';
import { useSoundAlert } from './hooks/useSoundAlert';
import { translations } from './i18n/translations';
import type {
  AlertAccuracySummary,
  AlertEvent,
  AlertOutcomeRecord,
  AnalysisResult,
  JournalEntry,
  Language,
  MarketTicker,
  ScannerOpportunity,
  ScannerSettings,
  Timeframe,
  WatchlistAlertRule,
} from './types/futures';
import {
  analyzePair,
  fetchAlertsData,
  fetchMarketData,
  fetchScannerData,
  notifyFocusSymbol,
  subscribeLiveStream,
  triggerRuleWebhook,
  triggerScanNow,
} from './services/apiClient';
import { filterAlertsByMinProbability } from './utils/alerts';
import { evaluateWatchlistRules } from './utils/customRules';
import { formatPercent, formatPrice, formatTime } from './utils/formatters';
import { getPairAssets } from './utils/futuresContracts';
import { evaluateSignalQualification } from './utils/signalQualification';

type ActiveTab = 'dashboard' | 'radar' | 'signals' | 'journal' | 'market' | 'analyzer' | 'alerts';

const DEFAULT_SETTINGS: ScannerSettings = {
  timeframe: '1h',
  minVolume24h: 0,
  minConfidence: 55,
  onlySuspiciousVolume: false,
  soundAlerts: true,
  browserAlerts: false,
  refreshSeconds: 20,
  autoLogSignals: false,
  autoTrackJournal: true,
  autoMoveBreakeven: true,
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const BrandMark: React.FC = () => (
  <svg
    viewBox="0 0 28 28"
    className="w-7 h-7 shrink-0"
    aria-hidden="true"
  >
    <rect
      x="1.5"
      y="1.5"
      width="25"
      height="25"
      rx="7"
      className="fill-sky-500/12 stroke-sky-500/40"
      strokeWidth="1.2"
    />
    <path
      d="M5.5 15.5h4.2l2.4-6.2 3.3 9.4 2.6-5.2h4.5"
      fill="none"
      stroke="#0EA5E9"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="22.5" cy="13.5" r="2" fill="#10B981" />
  </svg>
);

export default function App() {
  const [lang, setLang] = useState<Language>(() => readStorage<Language>('tp_lang', 'fa'));
  const [isDark, setIsDark] = useState<boolean>(() => readStorage<boolean>('tp_dark', true));
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [watchlist, setWatchlist] = useState<string[]>(() =>
    readStorage<string[]>('tp_watchlist', ['BTC-SWAP-USDT', 'ETH-SWAP-USDT', 'SOL-SWAP-USDT']),
  );
  const [settings, setSettings] = useState<ScannerSettings>(() => {
    const saved = readStorage<Partial<ScannerSettings>>('tp_settings', DEFAULT_SETTINGS);
    const merged: ScannerSettings = {
      ...DEFAULT_SETTINGS,
      ...saved,
    };
    try {
      if (!localStorage.getItem('tp_settings_all_futures_v1')) {
        if (merged.minVolume24h === 100_000) {
          merged.minVolume24h = 0;
        }
        localStorage.setItem('tp_settings_all_futures_v1', '1');
      }
      if (!localStorage.getItem('tp_settings_mtf_v2')) {
        if (
          merged.timeframe === '1m' ||
          merged.timeframe === '5m' ||
          merged.timeframe === '15m' ||
          merged.timeframe === '30m'
        ) {
          merged.timeframe = '1h';
        }
        localStorage.setItem('tp_settings_mtf_v2', '1');
      }
      if (!localStorage.getItem('tp_settings_manual_journal_v3')) {
        merged.autoLogSignals = false;
        localStorage.setItem('tp_settings_manual_journal_v3', '1');
      }
    } catch {
      // Ignore storage restrictions
    }
    return merged;
  });
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() =>
    readStorage<JournalEntry[]>('tp_journal', []),
  );
  const [customRules, setCustomRules] = useState<WatchlistAlertRule[]>(() =>
    readStorage<WatchlistAlertRule[]>('tp_custom_rules', []),
  );

  const [tickers, setTickers] = useState<MarketTicker[]>([]);
  const [opportunities, setOpportunities] = useState<ScannerOpportunity[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [alertOutcomes, setAlertOutcomes] = useState<AlertOutcomeRecord[]>([]);
  const [alertAccuracy, setAlertAccuracy] = useState<AlertAccuracySummary | undefined>(undefined);
  const [clearedAlertIds, setClearedAlertIds] = useState<Set<string>>(new Set());

  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC-SWAP-USDT');
  const [analyzerTimeframe, setAnalyzerTimeframe] = useState<Timeframe>(() => settings.timeframe);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [aiTriggerToken, setAiTriggerToken] = useState<number>(0);

  const [loadingMarket, setLoadingMarket] = useState(true);
  const [loadingScan, setLoadingScan] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [scanningNow, setScanningNow] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const prevAlertCountRef = useRef<number>(0);
  const autoLoggedKeysRef = useRef<Set<string>>(new Set());
  const { playChime } = useSoundAlert();
  const t = translations[lang];

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    localStorage.setItem('tp_lang', JSON.stringify(lang));
  }, [lang]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('tp_dark', JSON.stringify(isDark));
  }, [isDark]);

  useEffect(() => {
    localStorage.setItem('tp_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem('tp_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('tp_journal', JSON.stringify(journalEntries));
  }, [journalEntries]);

  useEffect(() => {
    localStorage.setItem('tp_custom_rules', JSON.stringify(customRules));
  }, [customRules]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const notifyAlert = useCallback(
    (latest: AlertEvent) => {
      if (settings.soundAlerts) {
        playChime(latest.direction === 'SHORT' ? 'BEAR' : 'BULL');
      }
      if (
        settings.browserAlerts &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        const { quoteAsset } = getPairAssets(latest.symbol);
        new Notification(`ToobitPulse: ${latest.baseAsset}/${quoteAsset}`, {
          body: lang === 'fa' ? latest.reasonFa : latest.reasonEn,
        });
      }
    },
    [settings.soundAlerts, settings.browserAlerts, lang, playChime],
  );

  const fetchMarketAndScanner = useCallback(async () => {
    try {
      const [marketData, scanData, alertsData] = await Promise.all([
        fetchMarketData(),
        fetchScannerData(settings.timeframe, watchlist),
        fetchAlertsData(),
      ]);

      const nextTickers = marketData.tickers || [];
      setTickers(nextTickers);
      if (nextTickers.length > 0 && !nextTickers.some((tk) => tk.symbol === selectedSymbol)) {
        const fallback =
          nextTickers.find((tk) => tk.symbol === 'BTC-SWAP-USDT')?.symbol ?? nextTickers[0].symbol;
        setSelectedSymbol(fallback);
      }
      setOpportunities(scanData.opportunities || []);
      if (Array.isArray(alertsData.alerts)) {
        setAlerts((prev) => {
          const serverIds = new Set(alertsData.alerts.map((a) => a.id));
          const clientRules = prev.filter((a) => a.id.startsWith('rule-') && !serverIds.has(a.id));
          return [...clientRules, ...alertsData.alerts].slice(0, 100);
        });
      }
      if (Array.isArray(alertsData.outcomes)) setAlertOutcomes(alertsData.outcomes);
      if (alertsData.accuracy) setAlertAccuracy(alertsData.accuracy);
      setLastSyncAt(marketData.updatedAt || Date.now());
      setSyncError(marketData.error);

      const newCount = alertsData.alerts?.length ?? 0;
      if (newCount > prevAlertCountRef.current && prevAlertCountRef.current > 0 && alertsData.alerts[0]) {
        notifyAlert(alertsData.alerts[0]);
      }
      prevAlertCountRef.current = newCount;
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setLoadingMarket(false);
      setLoadingScan(false);
    }
  }, [settings.timeframe, watchlist, notifyAlert, selectedSymbol]);

  const fetchAnalysis = useCallback(async (sym: string, tf: Timeframe, silent = false) => {
    if (!silent) {
      setLoadingAnalysis(true);
      setAnalysisError(null);
    }
    try {
      const data = await analyzePair(sym, tf);
      setAnalysis(data);
    } catch (err) {
      if (!silent) {
        setAnalysisError(err instanceof Error ? err.message : 'Failed to analyze symbol');
      }
    } finally {
      if (!silent) {
        setLoadingAnalysis(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchMarketAndScanner();
    const intervalMs = Math.max(8, settings.refreshSeconds) * 1000;
    const id = setInterval(() => {
      void fetchMarketAndScanner();
    }, intervalMs);
    return () => clearInterval(id);
  }, [fetchMarketAndScanner, settings.refreshSeconds]);

  useEffect(() => {
    const unsubscribe = subscribeLiveStream(selectedSymbol, {
      onStatusChange: (connected) => {
        setSseConnected(connected);
        if (connected) setSyncError(null);
      },
      onSnapshot: (serverTime) => {
        setSseConnected(true);
        setLastSyncAt(serverTime);
      },
      onTicks: (ticks, serverTime) => {
        setSseConnected(true);
        setLastSyncAt(serverTime || Date.now());
        const patchMap = new Map<string, MarketTicker>();
        for (const tk of ticks) {
          patchMap.set(tk.symbol, tk);
        }

        setTickers((prev) => {
          if (prev.length === 0) return ticks;
          let changed = false;
          const next = prev.map((existing) => {
            const updated = patchMap.get(existing.symbol);
            if (updated) {
              changed = true;
              return updated;
            }
            return existing;
          });
          return changed ? next : prev;
        });

        setOpportunities((prev) => {
          if (prev.length === 0) return prev;
          let changed = false;
          const next = prev.map((opp) => {
            const updated = patchMap.get(opp.symbol);
            if (!updated) return opp;
            changed = true;
            return {
              ...opp,
              lastPrice: updated.lastPrice,
              markPrice: updated.markPrice,
              priceChangePct: updated.priceChangePct,
              openInterestUsd: updated.openInterestUsd,
              fundingRate: updated.fundingRate,
            };
          });
          return changed ? next : prev;
        });
      },
      onAlerts: (incomingAlerts) => {
        setAlerts((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          const fresh = incomingAlerts.filter((a) => !seen.has(a.id));
          if (fresh.length === 0) return prev;
          notifyAlert(fresh[0]);
          return [...fresh, ...prev].slice(0, 60);
        });
      },
    });

    return () => {
      unsubscribe();
      setSseConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifyAlert]);

  useEffect(() => {
    void notifyFocusSymbol(selectedSymbol);
  }, [selectedSymbol]);

  useEffect(() => {
    if (activeTab !== 'analyzer') return;
    void fetchAnalysis(selectedSymbol, analyzerTimeframe, false);
    const id = setInterval(() => {
      void fetchAnalysis(selectedSymbol, analyzerTimeframe, true);
    }, 5000);
    return () => clearInterval(id);
  }, [activeTab, selectedSymbol, analyzerTimeframe, fetchAnalysis]);

  useEffect(() => {
    if (!settings.autoLogSignals || opportunities.length === 0) return;
    const candidates = opportunities.filter(
      (o) =>
        o.quoteVolume24h >= settings.minVolume24h &&
        evaluateSignalQualification(o, { minCriteriaRequired: 5, minConfidence: 72 }).qualified,
    );
    if (candidates.length === 0) return;

    setJournalEntries((prev) => {
      const openKeys = new Set(
        prev.filter((e) => e.status === 'OPEN').map((e) => `${e.symbol}-${e.timeframe}`),
      );
      const additions: JournalEntry[] = [];
      for (const opp of candidates) {
        const key = `${opp.symbol}-${opp.timeframe}`;
        if (!openKeys.has(key) && !autoLoggedKeysRef.current.has(key)) {
          const entry = createJournalFromOpportunity(opp, { autoLogged: true });
          if (entry) {
            autoLoggedKeysRef.current.add(key);
            openKeys.add(key);
            additions.push(entry);
          }
        }
      }
      return additions.length > 0 ? [...additions, ...prev].slice(0, 200) : prev;
    });
  }, [opportunities, settings.autoLogSignals, settings.minVolume24h]);

  useEffect(() => {
    if (tickers.length === 0) return;
    const priceMap = new Map<string, number>();
    for (const tk of tickers) {
      priceMap.set(tk.symbol, tk.lastPrice);
    }

    setJournalEntries((prev) => {
      let changed = false;
      const now = Date.now();
      const next = prev.map((entry) => {
        if (entry.status !== 'OPEN') return entry;
        const live = priceMap.get(entry.symbol);
        const updated = applyLivePriceToJournalEntry(entry, live, {
          autoCloseOnTakeProfit: settings.autoTrackJournal,
          moveStopToBreakevenOnTp1: settings.autoMoveBreakeven ?? true,
          now,
        });
        if (updated !== entry) {
          changed = true;
        }
        return updated;
      });
      return changed ? next : prev;
    });
  }, [tickers, settings.autoTrackJournal, settings.autoMoveBreakeven]);

  useEffect(() => {
    if (opportunities.length === 0 || customRules.length === 0) return;
    const { triggeredAlerts, updatedRules } = evaluateWatchlistRules(opportunities, customRules);
    if (triggeredAlerts.length === 0) return;

    setCustomRules(updatedRules);
    setAlerts((prev) => [...triggeredAlerts, ...prev].slice(0, 100));
    notifyAlert(triggeredAlerts[0]);
    for (const al of triggeredAlerts) {
      void triggerRuleWebhook(al);
    }
  }, [opportunities, customRules, notifyAlert]);

  const handleExportBackup = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      journalEntries,
      watchlist,
      customRules,
      settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `toobitpulse-workspace-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async (file: File): Promise<boolean> => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        journalEntries?: JournalEntry[];
        watchlist?: string[];
        customRules?: WatchlistAlertRule[];
        settings?: Partial<ScannerSettings>;
      };
      if (!parsed || typeof parsed !== 'object') return false;
      if (Array.isArray(parsed.journalEntries)) setJournalEntries(parsed.journalEntries);
      if (Array.isArray(parsed.watchlist)) setWatchlist(parsed.watchlist);
      if (Array.isArray(parsed.customRules)) setCustomRules(parsed.customRules);
      if (parsed.settings) setSettings((prev) => ({ ...prev, ...parsed.settings }));
      return true;
    } catch {
      return false;
    }
  };

  const handleScanNow = async () => {
    setScanningNow(true);
    try {
      const data = await triggerScanNow(settings.timeframe, watchlist);
      setOpportunities(data.opportunities || []);
      setLastSyncAt(data.updatedAt || Date.now());
      if (activeTab === 'analyzer') {
        await fetchAnalysis(selectedSymbol, analyzerTimeframe, false);
      }
    } catch {
      // Keep previous opportunities on transient failure
    } finally {
      setScanningNow(false);
    }
  };

  const handleToggleWatchlist = (symbol: string) => {
    setWatchlist((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );
  };

  const handleSelectSymbol = (symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveTab('analyzer');
  };

  const handleSelectSymbolWithAi = (symbol: string) => {
    setSelectedSymbol(symbol);
    setAiTriggerToken((n) => n + 1);
    setActiveTab('analyzer');
  };

  const handleLogOpportunity = (opp: ScannerOpportunity) => {
    const entry = createJournalFromOpportunity(opp);
    if (!entry) return;
    setJournalEntries((prev) => [entry, ...prev]);
  };

  const handleLogAnalysis = (res: AnalysisResult, capitalUsd: number, riskPct: number) => {
    const entry = createJournalFromAnalysis(res, { capitalUsd, riskPct });
    if (!entry) return;
    setJournalEntries((prev) => [entry, ...prev]);
  };

  const handleAddManualJournal = (entry: JournalEntry) => {
    setJournalEntries((prev) => [entry, ...prev]);
  };

  const handleUpdateJournal = (id: string, patch: Partial<JournalEntry>) => {
    setJournalEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const handleDeleteJournal = (id: string) => {
    setJournalEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleClearJournal = () => {
    setJournalEntries([]);
    autoLoggedKeysRef.current.clear();
  };

  const handleLogAlert = (alert: AlertEvent) => {
    const matchingOpp = opportunities.find((o) => o.symbol === alert.symbol);
    const entry = createJournalFromAlert(alert, matchingOpp);
    setJournalEntries((prev) => [entry, ...prev]);
  };

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((o) => o.quoteVolume24h >= settings.minVolume24h);
  }, [opportunities, settings.minVolume24h]);

  const visibleAlerts = useMemo(() => {
    return filterAlertsByMinProbability(
      alerts.filter((a) => !clearedAlertIds.has(a.id)),
      50,
    );
  }, [alerts, clearedAlertIds]);

  const loggedOpenSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const e of journalEntries) {
      if (e.status === 'OPEN') set.add(e.symbol);
    }
    return set;
  }, [journalEntries]);

  const liveSelectedTicker = useMemo(
    () => tickers.find((tk) => tk.symbol === selectedSymbol),
    [tickers, selectedSymbol],
  );

  const actionableSignalsCount = useMemo(
    () =>
      filteredOpportunities.filter(
        (o) =>
          evaluateSignalQualification(o, {
            minCriteriaRequired: 5,
            minConfidence: settings.minConfidence,
          }).qualified,
      ).length,
    [filteredOpportunities, settings.minConfidence],
  );

  const watchlistTickers = useMemo(() => {
    if (watchlist.length === 0) return [];
    const map = new Map(tickers.map((tk) => [tk.symbol, tk]));
    return watchlist
      .map((sym) => {
        const tk = map.get(sym);
        const { baseAsset, quoteAsset } = getPairAssets(sym);
        return {
          symbol: sym,
          baseAsset,
          quoteAsset,
          lastPrice: tk?.lastPrice ?? 0,
          priceChangePct: tk?.priceChangePct ?? 0,
        };
      })
      .slice(0, 6);
  }, [watchlist, tickers]);

  // 5 primary views for Bottom Mobile Bar & Sidebar
  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }[] = [
    { id: 'dashboard', label: t.navDashboard, icon: LayoutDashboard },
    { id: 'radar', label: t.navRadar, icon: Radar, count: filteredOpportunities.length || undefined },
    { id: 'signals', label: t.navSignals, icon: Activity, count: actionableSignalsCount || undefined },
    { id: 'journal', label: t.navJournal, icon: BookOpenCheck, count: loggedOpenSymbols.size || undefined },
    { id: 'market', label: t.navMarket, icon: BarChart3, count: tickers.length || undefined },
    { id: 'analyzer', label: t.navAnalyzer, icon: CandlestickChart },
  ];

  const mobileNavItems = navItems.filter((item) => item.id !== 'market');

  return (
    <div className="min-h-screen tp-canvas text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Workspace Sidebar (lg+) */}
      <aside className="hidden lg:flex lg:w-[244px] xl:w-[256px] shrink-0 flex-col sticky top-0 h-screen border-e border-slate-200/80 dark:border-slate-800/70 bg-white/88 dark:bg-[#090D16]/94 backdrop-blur-xl">
        {/* Brand Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800/70">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2.5 text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            <BrandMark />
            <span>{t.brand}</span>
          </button>
        </div>

        {/* Navigation Rail */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          <div className="space-y-1">
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              {t.workspaceSection}
            </div>
            <nav aria-label="Main navigation" className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`relative w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap min-h-[40px] ${
                      active
                        ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/45 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-sky-500"
                      />
                    )}
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {typeof item.count === 'number' && item.count > 0 && (
                      <span
                        className={`font-mono-num text-[11px] font-semibold ${
                          active ? 'text-sky-500' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Alerts & Webhooks Workspace Item */}
              <button
                type="button"
                onClick={() => setActiveTab('alerts')}
                aria-label={t.navAlerts}
                className={`relative w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap min-h-[40px] ${
                  activeTab === 'alerts'
                    ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/45 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {activeTab === 'alerts' && (
                  <span
                    aria-hidden="true"
                    className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full bg-sky-500"
                  />
                )}
                <span className="flex items-center gap-2.5 min-w-0">
                  <Bell className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="truncate">{t.navAlerts}</span>
                </span>
                {visibleAlerts.length > 0 && (
                  <span className="font-mono-num text-[11px] font-bold text-amber-500">
                    ({visibleAlerts.length})
                  </span>
                )}
              </button>
            </nav>
          </div>

          {/* Live Watchlist Quick-Jump */}
          <div className="pt-4 border-t border-slate-200/70 dark:border-slate-800/70 space-y-2">
            <div className="px-2.5 flex items-center justify-between text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              <span>{t.watchlistQuickJump}</span>
              <Star className="w-3 h-3 text-amber-400" />
            </div>
            {watchlistTickers.length === 0 ? (
              <p className="px-2.5 text-[11px] text-slate-400">{t.watchlistEmptyHint}</p>
            ) : (
              <div className="space-y-0.5">
                {watchlistTickers.map((wt) => {
                  const isSel = selectedSymbol === wt.symbol && activeTab === 'analyzer';
                  const isUp = wt.priceChangePct >= 0;
                  return (
                    <button
                      key={wt.symbol}
                      type="button"
                      onClick={() => handleSelectSymbol(wt.symbol)}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                        isSel
                          ? 'bg-sky-500/10 text-slate-900 dark:text-slate-100'
                          : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/45 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span className="font-bold truncate">
                        {wt.baseAsset}
                        <span className="text-[10px] font-normal text-slate-400">/{wt.quoteAsset}</span>
                      </span>
                      <div className="text-end font-mono-num shrink-0">
                        <div className="text-[11px] font-semibold">
                          {wt.lastPrice > 0 ? `$${formatPrice(wt.lastPrice)}` : '—'}
                        </div>
                        <div className={`text-[10px] font-semibold ${isUp ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {wt.lastPrice > 0 ? formatPercent(wt.priceChangePct) : ''}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Footer Utilities */}
        <div className="p-3 border-t border-slate-200/80 dark:border-slate-800/70 space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setLang((l) => (l === 'fa' ? 'en' : 'fa'))}
              aria-label="Toggle language"
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/70 px-2 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500/40 whitespace-nowrap min-h-[36px]"
            >
              <Globe className="w-3.5 h-3.5 text-sky-500" />
              <span>{lang === 'fa' ? 'EN' : 'فارسی'}</span>
            </button>

            <button
              type="button"
              onClick={() => setSettings((s) => ({ ...s, soundAlerts: !s.soundAlerts }))}
              aria-label={settings.soundAlerts ? t.soundOn : t.soundOff}
              title={settings.soundAlerts ? t.soundOn : t.soundOff}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/70 px-2 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500/40 whitespace-nowrap min-h-[36px]"
            >
              {settings.soundAlerts ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              aria-label={isDark ? t.lightMode : t.darkMode}
              title={isDark ? t.lightMode : t.darkMode}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/70 px-2 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500/40 whitespace-nowrap min-h-[36px]"
            >
              {isDark ? (
                <Sun className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-slate-600" />
              )}
            </button>
          </div>
          <PWAInstallButton lang={lang} />
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Command Bar (Single Clean Row) */}
        <header className="sticky top-0 z-30 h-12 lg:h-14 border-b border-slate-200/80 dark:border-slate-800/70 bg-white/90 dark:bg-[#090D16]/88 backdrop-blur-xl">
          <div className="max-w-[1440px] mx-auto h-full px-3 sm:px-5 flex items-center justify-between gap-3">
            {/* Zone 1: Brand (mobile/tablet) + Live Stream Telemetry */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className="lg:hidden flex items-center gap-2 text-sm font-extrabold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
              >
                <BrandMark />
                <span>{t.brand}</span>
              </button>

              <div className="hidden sm:flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 min-w-0">
                <span
                  data-testid="live-stream-status"
                  className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${
                    sseConnected ? 'text-emerald-500' : 'text-amber-500'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      sseConnected ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  <span>{sseConnected ? t.liveStreamOn : t.liveStreamWait}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  {tickers.length} {t.liveContracts}
                </span>
                <span className="hidden md:inline" aria-hidden="true">·</span>
                <span className="hidden md:inline font-mono-num whitespace-nowrap">
                  {t.lastSync}: {formatTime(lastSyncAt)}
                </span>
                {syncError && (
                  <span className="hidden xl:inline text-amber-500 font-medium truncate">
                    · {t.errorBanner}
                  </span>
                )}
              </div>
            </div>

            {/* Zone 2 (Desktop): Quick Pair Search + Segmented Timeframe */}
            <div className="hidden md:flex items-center gap-2.5">
              {tickers.length > 0 && activeTab !== 'analyzer' && (
                <div className="hidden xl:block">
                  <PairSelectorDropdown
                    compact
                    value={selectedSymbol}
                    tickers={tickers}
                    lang={lang}
                    watchlist={watchlist}
                    onToggleWatchlist={handleToggleWatchlist}
                    onChange={(sym) => handleSelectSymbol(sym)}
                    ariaLabel={t.selectPair}
                  />
                </div>
              )}

              <div
                className="flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-[#0D1320] p-0.5"
                dir="ltr"
              >
                {(['1h', '4h', '1d'] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => {
                      setSettings((s) => ({ ...s, timeframe: tf }));
                      setAnalyzerTimeframe(tf);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                      settings.timeframe === tf
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Zone 3: Mobile Shortcuts + Primary Scan CTA */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('alerts')}
                aria-label={t.navAlerts}
                className={`lg:hidden inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold whitespace-nowrap min-h-[34px] ${
                  activeTab === 'alerts'
                    ? 'border-sky-500 bg-sky-600 text-white'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] text-slate-700 dark:text-slate-200'
                }`}
              >
                <Bell className="w-3.5 h-3.5 text-amber-400" />
                {visibleAlerts.length > 0 && (
                  <span className="font-mono-num text-[11px]">({visibleAlerts.length})</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setLang((l) => (l === 'fa' ? 'en' : 'fa'))}
                aria-label="Toggle language"
                className="lg:hidden inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] px-2 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap min-h-[34px]"
              >
                {lang === 'fa' ? 'EN' : 'فا'}
              </button>

              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                aria-label={isDark ? t.lightMode : t.darkMode}
                className="lg:hidden inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1320] p-1.5 text-slate-700 dark:text-slate-200 min-h-[34px] min-w-[34px]"
              >
                {isDark ? (
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-slate-600" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleScanNow()}
                disabled={scanningNow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 lg:px-4 lg:py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 min-h-[34px] lg:min-h-[38px] shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${scanningNow ? 'animate-spin' : ''}`} />
                <span>{scanningNow ? t.scanning : t.scanNow}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Non-Sticky Timeframe + Stream Bar */}
        <div className="md:hidden border-b border-slate-200/70 dark:border-slate-800/60 bg-white/60 dark:bg-[#090D16]/70 px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-1.5 font-mono-num text-slate-500 dark:text-slate-400 min-w-0">
            <span className="font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
              {tickers.length} {t.liveContracts}
            </span>
            <span aria-hidden="true">·</span>
            <span dir="ltr" className="whitespace-nowrap">
              {formatTime(lastSyncAt)}
            </span>
          </div>
          <div
            className="flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-[#0D1320] p-0.5"
            dir="ltr"
          >
            {(['1h', '4h', '1d'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setSettings((s) => ({ ...s, timeframe: tf }));
                  setAnalyzerTimeframe(tf);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  settings.timeframe === tf
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Offline Banner */}
        {!isOnline && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-600 dark:text-amber-300 flex items-center justify-center gap-2">
            <WifiOff className="w-4 h-4" />
            <span>{t.offlineBanner}</span>
          </div>
        )}

        {/* Main Workspace Viewport */}
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-5 lg:px-6 py-5 pb-24 lg:pb-8">
          {activeTab === 'dashboard' && (
            <DashboardView
              tickers={tickers}
              opportunities={filteredOpportunities}
              alerts={visibleAlerts}
              accuracy={alertAccuracy}
              journalEntries={journalEntries}
              watchlist={watchlist}
              loggedSymbols={loggedOpenSymbols}
              minVolume24h={settings.minVolume24h}
              loadingMarket={loadingMarket}
              loadingScan={loadingScan}
              lang={lang}
              onSelectSymbol={handleSelectSymbol}
              onToggleWatchlist={handleToggleWatchlist}
              onLogSignal={handleLogOpportunity}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'radar' && (
            <RadarView
              opportunities={filteredOpportunities}
              loading={loadingScan}
              lang={lang}
              watchlist={watchlist}
              loggedSymbols={loggedOpenSymbols}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectSymbol={handleSelectSymbol}
              onLogSignal={handleLogOpportunity}
            />
          )}

          {activeTab === 'signals' && (
            <SignalsView
              opportunities={filteredOpportunities}
              minConfidence={settings.minConfidence}
              lang={lang}
              loggedSymbols={loggedOpenSymbols}
              onSelectSymbol={handleSelectSymbol}
              onSelectSymbolWithAi={handleSelectSymbolWithAi}
              onLogSignal={handleLogOpportunity}
            />
          )}

          {activeTab === 'journal' && (
            <JournalView
              entries={journalEntries}
              tickers={tickers}
              lang={lang}
              autoLogSignals={settings.autoLogSignals}
              autoMoveBreakeven={settings.autoMoveBreakeven ?? true}
              onToggleAutoLog={() =>
                setSettings((s) => ({ ...s, autoLogSignals: !s.autoLogSignals }))
              }
              onToggleAutoBreakeven={() =>
                setSettings((s) => ({
                  ...s,
                  autoMoveBreakeven: !(s.autoMoveBreakeven ?? true),
                }))
              }
              onAddManualEntry={handleAddManualJournal}
              onUpdateEntry={handleUpdateJournal}
              onDeleteEntry={handleDeleteJournal}
              onClearJournal={handleClearJournal}
              onSelectSymbol={handleSelectSymbol}
            />
          )}

          {activeTab === 'market' && (
            <MarketView
              tickers={tickers}
              loading={loadingMarket}
              lang={lang}
              watchlist={watchlist}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectSymbol={handleSelectSymbol}
            />
          )}

          {activeTab === 'analyzer' && (
            <AnalyzerView
              symbol={selectedSymbol}
              timeframe={analyzerTimeframe}
              analysis={analysis}
              liveTicker={liveSelectedTicker}
              loading={loadingAnalysis}
              error={analysisError}
              tickers={tickers}
              lang={lang}
              watchlist={watchlist}
              isLogged={loggedOpenSymbols.has(selectedSymbol)}
              aiTriggerToken={aiTriggerToken}
              onToggleWatchlist={handleToggleWatchlist}
              onChangeSymbol={setSelectedSymbol}
              onChangeTimeframe={setAnalyzerTimeframe}
              onRefresh={() => void fetchAnalysis(selectedSymbol, analyzerTimeframe, false)}
              onLogSignal={handleLogAnalysis}
            />
          )}

          {activeTab === 'alerts' && (
            <AlertsSettingsView
              alerts={visibleAlerts}
              outcomes={alertOutcomes}
              accuracy={alertAccuracy}
              settings={settings}
              lang={lang}
              loggedSymbols={loggedOpenSymbols}
              customRules={customRules}
              tickers={tickers}
              watchlist={watchlist}
              onUpdateSettings={setSettings}
              onClearAlerts={() => setClearedAlertIds(new Set(alerts.map((a) => a.id)))}
              onSelectSymbol={handleSelectSymbol}
              onLogAlert={handleLogAlert}
              onAddRule={(rule) => setCustomRules((prev) => [rule, ...prev])}
              onToggleRule={(id) =>
                setCustomRules((prev) =>
                  prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
                )
              }
              onDeleteRule={(id) => setCustomRules((prev) => prev.filter((r) => r.id !== id))}
              onExportBackup={handleExportBackup}
              onImportBackup={handleImportBackup}
            />
          )}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 pb-safe border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#090D16]/95 backdrop-blur-xl grid grid-cols-5 items-center"
      >
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                active ? 'text-sky-500' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="truncate max-w-full px-1">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
