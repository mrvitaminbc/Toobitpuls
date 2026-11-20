import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AlertEvent, Timeframe, WebhookConfig } from './src/types/futures';
import { toobitService } from './server/toobitService';
import { webhookNotifier } from './server/webhookNotifier';
import { socialSentimentService } from './server/socialSentimentService';
import { aiCryptoService, AiServiceError } from './server/aiCryptoService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_TIMEFRAMES = new Set<Timeframe>(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']);

function parseTimeframe(raw: unknown): Timeframe {
  if (typeof raw === 'string' && VALID_TIMEFRAMES.has(raw as Timeframe)) {
    return raw as Timeframe;
  }
  return '1h';
}

async function createServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json());

  toobitService.start();

  app.get('/api/health', (_req, res) => {
    res.json(toobitService.getHealth());
  });

  app.get('/api/market', async (_req, res) => {
    let market = toobitService.getMarketTickers();
    if (market.tickers.length === 0) {
      await toobitService.refreshMarketBatch();
      market = toobitService.getMarketTickers();
    }
    res.json(market);
  });

  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const focusSym = typeof req.query.focus === 'string' ? req.query.focus : '';
    if (focusSym) {
      toobitService.focusSymbol(focusSym);
    }

    const market = toobitService.getMarketTickers();
    if (market.tickers.length > 0) {
      res.write(
        `data: ${JSON.stringify({ type: 'snapshot', wsConnected: market.wsConnected, serverTime: Date.now() })}\n\n`,
      );
    }

    const unsubscribe = toobitService.addStreamListener((event) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: ping ${Date.now()}\n\n`);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.post('/api/focus', (req, res) => {
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '';
    if (symbol) {
      toobitService.focusSymbol(symbol);
    }
    res.json({ ok: true });
  });

  app.get('/api/scanner', async (req, res) => {
    const tf = parseTimeframe(req.query.timeframe);
    const watchParam = typeof req.query.watch === 'string' ? req.query.watch : '';
    const extraSymbols = watchParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const data = await toobitService.getScannerResults(tf, extraSymbols);
    res.json(data);
  });

  app.post('/api/scan-now', async (req, res) => {
    const tf = parseTimeframe(req.body?.timeframe);
    const watch = Array.isArray(req.body?.watch)
      ? req.body.watch.filter((s: unknown): s is string => typeof s === 'string')
      : [];

    await toobitService.refreshMarketBatch();
    const opportunities = await toobitService.runScannerCycle(tf, watch);
    const health = toobitService.getHealth();
    res.json({
      opportunities,
      updatedAt: Date.now(),
      scanning: false,
      scannedCount: health.scannedCount,
      scanTotal: health.scanTotal,
    });
  });

  app.get('/api/analyze/:symbol', async (req, res) => {
    const symbol = req.params.symbol;
    const tf = parseTimeframe(req.query.timeframe);
    if (!symbol) {
      res.status(400).json({ error: 'Missing symbol' });
      return;
    }

    try {
      const analysis = await toobitService.analyzeSymbol(symbol, tf);
      res.json(analysis);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to analyze symbol from Toobit API';
      const status = msg.includes('delisted') || msg.includes('Invalid Toobit') ? 404 : 502;
      res.status(status).json({ error: msg });
    }
  });

  app.get('/api/alerts', (_req, res) => {
    res.json(toobitService.getAlertsWithAccuracy());
  });

  app.get('/api/sentiment/:symbol', async (req, res) => {
    const symbol = req.params.symbol;
    if (!symbol) {
      res.status(400).json({ error: 'Missing symbol' });
      return;
    }
    const forceRefresh = req.query.refresh === '1';
    try {
      const sentiment = await socialSentimentService.getSentiment(symbol, forceRefresh);
      res.json(sentiment);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch social sentiment';
      res.status(502).json({ error: msg });
    }
  });

  app.post('/api/ai-analyze/:symbol', async (req, res) => {
    const symbol = req.params.symbol;
    const tf = parseTimeframe(req.body?.timeframe ?? req.query.timeframe);
    const forceRefresh = Boolean(req.body?.forceRefresh);
    if (!symbol) {
      res.status(400).json({ error: 'Missing symbol' });
      return;
    }
    try {
      const report = await aiCryptoService.analyzeCrypto(symbol, tf, forceRefresh);
      res.json(report);
    } catch (err) {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      const msg = err instanceof Error ? err.message : 'AI analysis unavailable';
      res.status(502).json({ error: msg, code: 'AI_UPSTREAM_ERROR' });
    }
  });

  app.get('/api/webhooks/config', (_req, res) => {
    res.json({
      config: webhookNotifier.getConfig(),
      logs: webhookNotifier.getLogs(),
    });
  });

  app.post('/api/webhooks/config', (req, res) => {
    const body = (req.body ?? {}) as Partial<WebhookConfig>;
    const result = webhookNotifier.updateConfig(body);
    if (!result.ok) {
      res.status(400).json({
        ok: false,
        errors: result.errors,
        config: result.config,
      });
      return;
    }

    res.json({
      ok: true,
      config: result.config,
      logs: webhookNotifier.getLogs(),
    });
  });

  app.post('/api/webhooks/test', async (req, res) => {
    const body = (req.body ?? undefined) as Partial<WebhookConfig> | undefined;
    const outcome = await webhookNotifier.sendTestWebhook(body);
    if (!outcome.valid) {
      res.status(400).json({
        ok: false,
        errors: outcome.errors,
        results: [],
        logs: webhookNotifier.getLogs(),
      });
      return;
    }

    const allSucceeded = outcome.results.length > 0 && outcome.results.every((r) => r.ok);
    res.status(allSucceeded ? 200 : 502).json({
      ok: allSucceeded,
      results: outcome.results,
      logs: webhookNotifier.getLogs(),
    });
  });

  app.post('/api/webhooks/rule-trigger', async (req, res) => {
    const alert = req.body?.alert as AlertEvent | undefined;
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
        riskReward2: alert.riskReward1 ?? 2,
      },
      analyzedAt: alert.timestamp,
    });
    res.json({ ok: true, results });
  });

  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        port: PORT,
        hmr: hmrDisabled ? false : true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = fs.existsSync(path.resolve(__dirname, 'dist', 'index.html'))
      ? path.resolve(__dirname, 'dist')
      : path.resolve(__dirname, '..', 'dist');

    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      console.error(`Missing frontend build at ${distPath}. Run "npm run build" first.`);
      process.exit(1);
    }

    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'manifest.webmanifest' ||
            base === 'index.html'
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ToobitPulse server listening on http://localhost:${PORT} (0.0.0.0:${PORT})`);
  });
}

createServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
