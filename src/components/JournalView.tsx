import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  History,
  Plus,
  ShieldCheck,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  buildJournalEquityCurve,
  computeJournalStats,
  computePortfolioHeat,
  evaluateJournalEntry,
  resolveCloseReasonFromStatus,
} from '../engine/journal';
import {
  getDirectionLabel,
  getJournalCloseReasonLabel,
  getJournalStatusLabel,
  getPhaseLabel,
  translations,
} from '../i18n/translations';
import type { JournalEntry, JournalStatus, Language, MarketTicker, Timeframe } from '../types/futures';
import { formatDateTime, formatPercent, formatPrice, formatUsdSigned } from '../utils/formatters';
import { getPairAssets } from '../utils/futuresContracts';
import { PairSelectorDropdown } from './PairSelectorDropdown';

interface JournalViewProps {
  entries: JournalEntry[];
  tickers: MarketTicker[];
  lang: Language;
  autoLogSignals: boolean;
  autoMoveBreakeven?: boolean;
  onToggleAutoLog: () => void;
  onToggleAutoBreakeven?: () => void;
  onAddManualEntry: (entry: JournalEntry) => void;
  onUpdateEntry: (id: string, patch: Partial<JournalEntry>) => void;
  onDeleteEntry: (id: string) => void;
  onClearJournal: () => void;
  onSelectSymbol: (symbol: string) => void;
}

type JournalFilter = 'ALL' | 'OPEN' | 'CLOSED' | 'WINS' | 'LOSSES';

export const JournalView: React.FC<JournalViewProps> = ({
  entries,
  tickers,
  lang,
  autoLogSignals,
  autoMoveBreakeven = true,
  onToggleAutoLog,
  onToggleAutoBreakeven,
  onAddManualEntry,
  onUpdateEntry,
  onDeleteEntry,
  onClearJournal,
  onSelectSymbol,
}) => {
  const t = translations[lang];
  const [filter, setFilter] = useState<JournalFilter>('ALL');
  const [showAddForm, setShowAddForm] = useState(false);

  const [formSymbol, setFormSymbol] = useState('BTC-SWAP-USDT');
  const [formDirection, setFormDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [formEntry, setFormEntry] = useState('');
  const [formSl, setFormSl] = useState('');
  const [formTp1, setFormTp1] = useState('');
  const [formTp2, setFormTp2] = useState('');
  const [formTp3, setFormTp3] = useState('');
  const [formLev, setFormLev] = useState('10');
  const [formNotes, setFormNotes] = useState('');

  const livePriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tk of tickers) {
      map[tk.symbol] = tk.lastPrice;
    }
    return map;
  }, [tickers]);

  const stats = useMemo(() => computeJournalStats(entries, livePriceMap), [entries, livePriceMap]);
  const heat = useMemo(() => computePortfolioHeat(entries, 6), [entries]);
  const equity = useMemo(() => buildJournalEquityCurve(entries, livePriceMap), [entries, livePriceMap]);

  const openEntries = useMemo(() => {
    if (filter === 'CLOSED' || filter === 'WINS' || filter === 'LOSSES') return [];
    return entries.filter((entry) => entry.status === 'OPEN');
  }, [entries, filter]);

  const closedEntries = useMemo(() => {
    if (filter === 'OPEN') return [];
    return entries
      .filter((entry) => {
        if (entry.status === 'OPEN') return false;
        const ev = evaluateJournalEntry(entry, livePriceMap[entry.symbol]);
        if (filter === 'WINS') return ev.isWin;
        if (filter === 'LOSSES') return !ev.isWin;
        return true;
      })
      .sort((a, b) => (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt));
  }, [entries, filter, livePriceMap]);

  const handleOpenManualForm = () => {
    const tk = tickers.find((x) => x.symbol === formSymbol) ?? tickers[0];
    if (tk) {
      setFormSymbol(tk.symbol);
      const p = tk.lastPrice;
      setFormEntry(String(p));
      setFormSl(String(Number((p * 0.985).toFixed(4))));
      setFormTp1(String(Number((p * 1.022).toFixed(4))));
      setFormTp2(String(Number((p * 1.04).toFixed(4))));
      setFormTp3(String(Number((p * 1.065).toFixed(4))));
    }
    setShowAddForm(true);
  };

  const handleSubmitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const entryNum = Number(formEntry);
    const slNum = Number(formSl);
    const tp1Num = Number(formTp1);
    if (!Number.isFinite(entryNum) || entryNum <= 0 || !Number.isFinite(slNum) || slNum <= 0) {
      return;
    }
    const baseAsset = formSymbol.includes('-SWAP-') ? formSymbol.split('-SWAP-')[0] : formSymbol;
    const now = Date.now();
    const newEntry: JournalEntry = {
      id: `${formSymbol}-manual-${now}`,
      createdAt: now,
      updatedAt: now,
      symbol: formSymbol,
      baseAsset,
      timeframe: '1h' as Timeframe,
      direction: formDirection,
      phase: formDirection === 'LONG' ? 'PRE_PUMP' : 'PRE_DUMP',
      confidence: 75,
      entryPrice: entryNum,
      stopLoss: slNum,
      tp1: Number(tp1Num) || entryNum * (formDirection === 'LONG' ? 1.02 : 0.98),
      tp2: Number(formTp2) || entryNum * (formDirection === 'LONG' ? 1.04 : 0.96),
      tp3: Number(formTp3) || entryNum * (formDirection === 'LONG' ? 1.06 : 0.94),
      leverage: Math.max(1, Math.min(50, Number(formLev) || 10)),
      capitalUsd: 1000,
      riskPct: 2,
      status: 'OPEN',
      notes: formNotes.trim() || 'Manual entry',
      autoLogged: false,
    };
    onAddManualEntry(newEntry);
    setFormNotes('');
    setShowAddForm(false);
  };

  const handleExportCsv = () => {
    const header = [
      'OpenTime',
      'CloseTime',
      'Symbol',
      'Direction',
      'Timeframe',
      'Confidence',
      'OpenPrice',
      'StopLoss',
      'TP1',
      'TP2',
      'TP3',
      'Leverage',
      'Status',
      'CloseReason',
      'ClosePrice',
      'PnL_USD',
      'LeveragedPnL%',
      'R-Multiple',
      'Notes',
    ];
    const rows = entries.map((e) => {
      const ev = evaluateJournalEntry(e, livePriceMap[e.symbol]);
      const closeTimeIso = e.status === 'OPEN' ? '' : new Date(e.closedAt ?? e.updatedAt).toISOString();
      const closeReason =
        e.status === 'OPEN' ? '' : getJournalCloseReasonLabel(e.closeReason, e.status, 'en');
      return [
        new Date(e.createdAt).toISOString(),
        closeTimeIso,
        e.symbol,
        e.direction,
        e.timeframe,
        e.confidence,
        e.entryPrice,
        e.stopLoss,
        e.tp1,
        e.tp2,
        e.tp3,
        e.leverage,
        e.status,
        `"${closeReason}"`,
        e.exitPrice ?? ev.currentPrice,
        ev.pnlUsd,
        ev.leveragedPnlPct,
        ev.rMultiple,
        `"${(e.notes || '').replace(/"/g, '""')}"`,
      ].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `toobitpulse-journal-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filterButtons: { id: JournalFilter; label: string }[] = [
    { id: 'ALL', label: t.journalFilterAll },
    { id: 'OPEN', label: t.journalFilterOpen },
    { id: 'CLOSED', label: t.journalFilterClosed },
    { id: 'WINS', label: t.journalFilterWins },
    { id: 'LOSSES', label: t.journalFilterLosses },
  ];

  const statusOptions: JournalStatus[] = ['OPEN', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'SL_HIT', 'CLOSED'];

  return (
    <section className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            {t.journalTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t.journalSubtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="journal-autolog-toggle"
            onClick={onToggleAutoLog}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
              autoLogSignals
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'tp-panel text-slate-600 dark:text-slate-300'
            }`}
          >
            <span>{t.journalAutoLogSwitch}:</span>
            <span className="font-bold">{autoLogSignals ? t.toggleOn : t.toggleOff}</span>
          </button>

          {onToggleAutoBreakeven && (
            <button
              type="button"
              data-testid="journal-breakeven-toggle"
              onClick={onToggleAutoBreakeven}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
                autoMoveBreakeven
                  ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                  : 'tp-panel text-slate-600 dark:text-slate-300'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>{t.journalBreakevenSwitch}:</span>
              <span className="font-bold">{autoMoveBreakeven ? t.toggleOn : t.toggleOff}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenManualForm}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0 min-h-[38px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.journalNewEntry}</span>
          </button>

          {entries.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportCsv}
                className="tp-panel inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-sky-500/40 whitespace-nowrap shrink-0 min-h-[38px]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.journalExportCsv}</span>
              </button>
              <button
                type="button"
                onClick={onClearJournal}
                className="tp-panel inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-500 hover:bg-rose-500/10 whitespace-nowrap shrink-0 min-h-[38px]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.journalClearAll}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Unified 4-Col Hairline Performance Strip */}
      <div className="tp-panel rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x rtl:sm:divide-x-reverse divide-slate-200/80 dark:divide-slate-800/80">
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.journalKpiTotal}</div>
          <div className="mt-1.5 text-2xl font-extrabold font-mono-num text-slate-900 dark:text-slate-100">
            {stats.total}{' '}
            <span className="text-xs font-normal text-slate-400">
              ({stats.openCount} {t.journalFilterOpen})
            </span>
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.journalKpiWinRate}</div>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-2xl font-extrabold font-mono-num text-sky-500">{stats.winRatePct}%</span>
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" dir="ltr">
              <div className="h-full bg-sky-500" style={{ width: `${stats.winRatePct}%` }} />
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.journalKpiAvgR}</div>
          <div
            className={`mt-1.5 text-2xl font-extrabold font-mono-num ${
              stats.avgRMultiple >= 0 ? 'text-emerald-500' : 'text-rose-500'
            }`}
          >
            {stats.avgRMultiple >= 0 ? `+${stats.avgRMultiple}R` : `${stats.avgRMultiple}R`}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t.journalKpiNetPnl}</div>
          <div
            className={`mt-1.5 text-2xl font-extrabold font-mono-num ${
              stats.netLeveragedPnlPct >= 0 ? 'text-emerald-500' : 'text-rose-500'
            }`}
          >
            {formatPercent(stats.netLeveragedPnlPct)}
            <span className="text-xs font-semibold ms-2 opacity-85">
              ({formatUsdSigned(stats.netPnlUsd)})
            </span>
          </div>
        </div>
      </div>

      {/* Portfolio Risk-Heat Guard Bar */}
      {heat.openCount > 0 && (
        <div
          data-testid="portfolio-heat-guard"
          className={`tp-panel rounded-xl px-4 py-3 space-y-2 ${
            heat.isOverheated || heat.isDirectionSkewed ? 'border-amber-500/45' : ''
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
              <ShieldCheck className={`w-4 h-4 shrink-0 ${heat.isOverheated ? 'text-amber-500' : 'text-sky-500'}`} />
              <span>{t.journalHeatLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono-num" dir="ltr">
              <span className="text-emerald-500 font-semibold">
                LONG {heat.longCount} ({heat.longRiskPct}%)
              </span>
              <span className="text-rose-500 font-semibold">
                SHORT {heat.shortCount} ({heat.shortRiskPct}%)
              </span>
              <span className={`font-bold ${heat.isOverheated ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>
                Total {heat.totalOpenRiskPct}% / {heat.thresholdPct}%
              </span>
            </div>
          </div>

          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" dir="ltr">
            <div
              className={`h-full transition-all duration-300 ${
                heat.isOverheated ? 'bg-amber-500' : 'bg-sky-500'
              }`}
              style={{ width: `${Math.min(100, (heat.totalOpenRiskPct / Math.max(1, heat.thresholdPct)) * 100)}%` }}
            />
          </div>

          {(heat.isOverheated || heat.isDirectionSkewed) && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {heat.isOverheated ? t.journalHeatWarning : ''}
                {heat.isOverheated && heat.isDirectionSkewed ? ' · ' : ''}
                {heat.isDirectionSkewed ? t.journalSkewWarning : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Cumulative Equity Curve & R-Multiple Distribution */}
      {equity.points.length >= 2 && (
        <div
          data-testid="journal-equity-panel"
          className="tp-panel rounded-xl p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center"
        >
          <div className="lg:col-span-8 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.journalEquityTitle}
              </h2>
              <div className="flex items-center gap-4 text-xs font-mono-num" dir="ltr">
                <span>
                  {t.journalProfitFactor}:{' '}
                  <strong className="text-sky-500">{equity.profitFactor}</strong>
                </span>
                <span>
                  {t.journalMaxDrawdown}:{' '}
                  <strong className="text-rose-500">-${equity.maxDrawdownUsd}</strong>
                </span>
              </div>
            </div>

            {(() => {
              const w = 520;
              const h = 110;
              const pad = 10;
              const vals = [0, ...equity.points.map((p) => p.cumulativePnlUsd)];
              const minV = Math.min(...vals);
              const maxV = Math.max(...vals);
              const span = Math.max(1, maxV - minV);
              const xAt = (i: number) => pad + (i / Math.max(1, vals.length - 1)) * (w - pad * 2);
              const yAt = (v: number) => pad + (1 - (v - minV) / span) * (h - pad * 2);
              const pts = vals.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
              const zeroY = yAt(0);
              const finalVal = vals[vals.length - 1];
              const stroke = finalVal >= 0 ? '#10B981' : '#EF4444';

              return (
                <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28">
                  <line
                    x1={pad}
                    y1={zeroY}
                    x2={w - pad}
                    y2={zeroY}
                    stroke="#64748B"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                    opacity="0.5"
                  />
                  <polyline fill="none" stroke={stroke} strokeWidth="2.2" points={pts} />
                </svg>
              );
            })()}
          </div>

          <div className="lg:col-span-4 space-y-2 border-t lg:border-t-0 lg:border-s border-slate-200/80 dark:border-slate-800/80 pt-3 lg:pt-0 lg:ps-4">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {lang === 'fa' ? 'توزیع ضریب R معاملات' : 'R-Multiple Distribution'}
            </div>
            <div className="space-y-1.5 text-[11px] font-mono-num" dir="ltr">
              {(() => {
                const maxCount = Math.max(1, ...equity.buckets.map((b) => b.count));
                return equity.buckets.map((b) => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="w-14 text-slate-500">{b.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full ${b.positive ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        style={{ width: `${(b.count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-end font-semibold text-slate-700 dark:text-slate-300">
                      {b.count}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Manual Trade Modal/Form */}
      {showAddForm && (
        <form onSubmit={handleSubmitManual} className="tp-panel rounded-xl border-sky-500/40 p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800/80 pb-2.5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.journalAddTitle}</h2>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              {t.journalCancel}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-slate-500 mb-1">{t.colPair}</label>
              <PairSelectorDropdown
                compact
                fullWidth
                align="start"
                value={formSymbol}
                tickers={tickers}
                lang={lang}
                ariaLabel={t.colPair}
                onChange={(sym) => {
                  setFormSymbol(sym);
                  const tk = tickers.find((x) => x.symbol === sym);
                  if (tk) {
                    setFormEntry(String(tk.lastPrice));
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">Side</label>
              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] p-1 min-h-[40px]">
                <button
                  type="button"
                  onClick={() => setFormDirection('LONG')}
                  className={`rounded-lg text-xs font-bold transition-colors ${
                    formDirection === 'LONG'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  LONG
                </button>
                <button
                  type="button"
                  onClick={() => setFormDirection('SHORT')}
                  className={`rounded-lg text-xs font-bold transition-colors ${
                    formDirection === 'SHORT'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  SHORT
                </button>
              </div>
            </div>
            <div>
              <label className="block text-slate-500 mb-1">{t.entry}</label>
              <input
                type="number"
                step="any"
                required
                value={formEntry}
                onChange={(e) => setFormEntry(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">{t.stopLoss}</label>
              <input
                type="number"
                step="any"
                required
                value={formSl}
                onChange={(e) => setFormSl(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">{t.tp1}</label>
              <input
                type="number"
                step="any"
                value={formTp1}
                onChange={(e) => setFormTp1(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">{t.tp2}</label>
              <input
                type="number"
                step="any"
                value={formTp2}
                onChange={(e) => setFormTp2(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">{t.tp3}</label>
              <input
                type="number"
                step="any"
                value={formTp3}
                onChange={(e) => setFormTp3(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">{t.calcLeverage}</label>
              <input
                type="number"
                min={1}
                max={50}
                value={formLev}
                onChange={(e) => setFormLev(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-2 font-mono-num text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder={t.journalNotesPlaceholder}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 whitespace-nowrap"
            >
              {t.journalSaveEntry}
            </button>
          </div>
        </form>
      )}

      {/* Segmented Filter Rail */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-[#0C121E]/85 overflow-x-auto max-w-full">
        {filterButtons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            onClick={() => setFilter(btn.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[34px] ${
              filter === btn.id
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Open Positions Section */}
      {openEntries.length > 0 && (
        <div className="space-y-3" data-testid="journal-list">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {t.journalOpenPositionsTitle} ({openEntries.length})
            </h2>
          </div>

          <div
            className={
              filter === 'ALL' && openEntries.length > 3
                ? 'space-y-3 max-h-[420px] overflow-y-auto pe-1'
                : 'space-y-3'
            }
          >
            {openEntries.map((entry) => {
              const live = livePriceMap[entry.symbol];
              const ev = evaluateJournalEntry(entry, live);
              const isLong = entry.direction === 'LONG';
              const isProfit = ev.leveragedPnlPct >= 0;

              const lowBound = isLong ? entry.stopLoss : entry.tp3;
              const highBound = isLong ? entry.tp3 : entry.stopLoss;
              const totalSpan = Math.max(1e-9, Math.abs(highBound - lowBound));
              const liveRatio = Math.max(
                0,
                Math.min(100, ((ev.currentPrice - lowBound) / totalSpan) * 100),
              );
              const entryRatio = Math.max(
                0,
                Math.min(100, ((entry.entryPrice - lowBound) / totalSpan) * 100),
              );

              return (
                <article key={entry.id} className="tp-panel rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800/80">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {isLong ? (
                        <ArrowUpRight className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4 text-rose-500 shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectSymbol(entry.symbol)}
                        className="text-sm font-extrabold text-slate-900 dark:text-slate-100 hover:text-sky-500"
                      >
                        {entry.baseAsset}/{getPairAssets(entry.symbol).quoteAsset}
                      </button>
                      <span className={`font-bold ${isLong ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {getDirectionLabel(entry.direction, lang)} · {entry.leverage}x
                      </span>
                      <span className="text-slate-400" aria-hidden="true">·</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {getPhaseLabel(entry.phase, lang)} · {entry.timeframe} · {entry.confidence}%
                      </span>
                      <span className="text-slate-400" aria-hidden="true">·</span>
                      <span className="font-mono-num text-slate-400">{formatDateTime(entry.createdAt, lang)}</span>
                      {entry.autoLogged && (
                        <span className="text-sky-500 font-semibold">· {t.journalAutoBadge}</span>
                      )}
                      {entry.movedToBreakeven && (
                        <span className="text-emerald-500 font-bold">· {t.journalBreakevenBadge}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Status for ${entry.symbol}`}
                        value={entry.status}
                        onChange={(e) => {
                          const nextStatus = e.target.value as JournalStatus;
                          const now = Date.now();
                          onUpdateEntry(entry.id, {
                            status: nextStatus,
                            closeReason: resolveCloseReasonFromStatus(nextStatus),
                            exitPrice: nextStatus === 'OPEN' ? undefined : ev.currentPrice,
                            closedAt: nextStatus === 'OPEN' ? undefined : now,
                            updatedAt: now,
                          });
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 min-h-[36px]"
                      >
                        {statusOptions.map((st) => (
                          <option key={st} value={st}>
                            {getJournalStatusLabel(st, lang)}
                          </option>
                        ))}
                      </select>

                      {live && (
                        <button
                          type="button"
                          onClick={() => {
                            const now = Date.now();
                            onUpdateEntry(entry.id, {
                              status: 'CLOSED',
                              closeReason: 'MANUAL',
                              exitPrice: live,
                              closedAt: now,
                              updatedAt: now,
                            });
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:bg-sky-600 transition-colors whitespace-nowrap min-h-[36px]"
                        >
                          {t.journalCloseMarket}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onDeleteEntry(entry.id)}
                        aria-label={`Delete ${entry.symbol} entry`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Live Numbers Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs font-mono-num">
                    <div>
                      <div className="text-[11px] text-slate-400">{t.entry}</div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">${formatPrice(entry.entryPrice)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t.journalLivePrice}</div>
                      <div className="font-bold text-sky-500">${formatPrice(ev.currentPrice)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t.stopLoss}</div>
                      <div className="font-semibold text-rose-500">${formatPrice(entry.stopLoss)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t.tp1}</div>
                      <div className="font-semibold text-emerald-500">${formatPrice(entry.tp1)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t.tp2}</div>
                      <div className="font-semibold text-emerald-400">${formatPrice(entry.tp2)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t.tp3}</div>
                      <div className="font-semibold text-emerald-300">${formatPrice(entry.tp3)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t.journalLivePnl}</div>
                      <div className={`font-bold flex items-center gap-1 ${isProfit ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {isProfit ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        <span>
                          {formatPercent(ev.leveragedPnlPct)} ({formatUsdSigned(ev.pnlUsd)})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t.journalRMultiple}</div>
                      <div className={`font-bold ${ev.rMultiple >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {ev.rMultiple >= 0 ? `+${ev.rMultiple}R` : `${ev.rMultiple}R`}
                      </div>
                    </div>
                  </div>

                  {/* Live Price-to-SL/TP3 Range Track */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono-num text-slate-400">
                      <span>{t.priceTrackLabel}</span>
                      <span>${formatPrice(ev.currentPrice)}</span>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" dir="ltr">
                      <div
                        className="absolute inset-y-0 bg-slate-300 dark:bg-slate-700"
                        style={{ left: `${entryRatio}%`, width: '2px' }}
                      />
                      <div
                        className={`absolute top-0 bottom-0 w-2.5 rounded-full ${
                          isProfit ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                        style={{ left: `calc(${liveRatio}% - 5px)` }}
                      />
                    </div>
                  </div>

                  {/* Notes & Quick Analyze */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                    <input
                      type="text"
                      value={entry.notes}
                      onChange={(e) => onUpdateEntry(entry.id, { notes: e.target.value, updatedAt: Date.now() })}
                      placeholder={t.journalNotesPlaceholder}
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#080C14] px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => onSelectSymbol(entry.symbol)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 whitespace-nowrap self-start sm:self-auto"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>{t.analyzeBtn}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {entries.length === 0 && (
        <div className="tp-panel rounded-xl p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t.journalEmpty}</p>
        </div>
      )}

      {/* Dedicated Closed Signals History Section */}
      {filter !== 'OPEN' && (
        <div data-testid="closed-signals-history" className="tp-panel rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-sky-500 shrink-0" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {t.journalClosedHistoryTitle} ({closedEntries.length})
              </h2>
            </div>
          </div>

          {closedEntries.length === 0 ? (
            <p className="py-5 text-center text-xs text-slate-500 dark:text-slate-400">
              {t.journalClosedHistoryEmpty}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-start border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-2 font-semibold text-start">{t.colPair}</th>
                    <th className="py-2.5 px-2 font-semibold text-start whitespace-nowrap">{t.journalOpenDateTime}</th>
                    <th className="py-2.5 px-2 font-semibold text-start whitespace-nowrap">{t.journalOpenPrice}</th>
                    <th className="py-2.5 px-2 font-semibold text-start whitespace-nowrap">{t.journalCloseDateTime}</th>
                    <th className="py-2.5 px-2 font-semibold text-start whitespace-nowrap">{t.journalClosePrice}</th>
                    <th className="py-2.5 px-2 font-semibold text-start whitespace-nowrap">{t.journalCloseReason}</th>
                    <th className="py-2.5 px-2 font-semibold text-start whitespace-nowrap">{t.journalPnlUsd}</th>
                    <th className="py-2.5 px-2 font-semibold text-start whitespace-nowrap">{t.journalPnlPct}</th>
                    <th className="py-2.5 px-2 font-semibold text-end">{t.colAction}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono-num">
                  {closedEntries.map((entry) => {
                    const ev = evaluateJournalEntry(entry, livePriceMap[entry.symbol]);
                    const isLong = entry.direction === 'LONG';
                    const isProfit = ev.pnlUsd >= 0;
                    const closeTs = entry.closedAt ?? entry.updatedAt;
                    const closePrice = entry.exitPrice ?? ev.currentPrice;
                    const closeReasonLabel = getJournalCloseReasonLabel(
                      entry.closeReason,
                      entry.status,
                      lang,
                    );

                    return (
                      <tr
                        key={entry.id}
                        data-testid="closed-signal-row"
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                      >
                        <td className="py-3 px-2 whitespace-nowrap font-sans">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onSelectSymbol(entry.symbol)}
                              className="font-bold text-slate-900 dark:text-slate-100 hover:text-sky-500"
                            >
                              {entry.baseAsset}/{getPairAssets(entry.symbol).quoteAsset}
                            </button>
                            <span className={`text-[11px] font-semibold ${isLong ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {getDirectionLabel(entry.direction, lang)} {entry.leverage}x
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {formatDateTime(entry.createdAt, lang)}
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap font-semibold text-slate-900 dark:text-slate-100">
                          ${formatPrice(entry.entryPrice)}
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap text-slate-600 dark:text-slate-300">
                          {formatDateTime(closeTs, lang)}
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap font-semibold text-slate-900 dark:text-slate-100">
                          ${formatPrice(closePrice)}
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap font-sans">
                          <span
                            className={`font-semibold ${
                              entry.status === 'SL_HIT'
                                ? 'text-rose-500'
                                : entry.status === 'TP1_HIT' ||
                                    entry.status === 'TP2_HIT' ||
                                    entry.status === 'TP3_HIT'
                                  ? 'text-emerald-500'
                                  : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {closeReasonLabel}
                          </span>
                        </td>
                        <td className={`py-3 px-2 whitespace-nowrap font-bold ${isProfit ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {formatUsdSigned(ev.pnlUsd)}
                        </td>
                        <td className={`py-3 px-2 whitespace-nowrap font-bold ${isProfit ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {formatPercent(ev.leveragedPnlPct)}
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap text-end">
                          <button
                            type="button"
                            onClick={() => onDeleteEntry(entry.id)}
                            aria-label={`Delete ${entry.symbol} closed history`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
