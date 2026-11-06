import dotenv from 'dotenv';
import db from './db.js';

dotenv.config();

const ML_BASE = process.env.ML_SERVICE_URL || process.env.ML_BASE || 'http://localhost:8000';

// Configurable interval in hours (defaults to 48 hours = 2 days)
const DEFAULT_INTERVAL_HOURS = 48;
const configuredIntervalHours = process.env.KEEP_ALIVE_INTERVAL_HOURS;
const intervalHours = configuredIntervalHours === undefined
  ? DEFAULT_INTERVAL_HOURS
  : Number(configuredIntervalHours);
if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
  throw new Error('KEEP_ALIVE_INTERVAL_HOURS must be a positive number');
}

const INTERVAL_MS = intervalHours * 60 * 60 * 1000;
let schedulerTimer;

export const keepAliveState = {
  startedAt: new Date().toISOString(),
  intervalHours,
  intervalMs: INTERVAL_MS,
  totalPings: 0,
  lastPingTime: null,
  lastPingStatus: 'initialized',
  nextPingTime: new Date().toISOString(),
  lastDiagnostics: null,
};

/**
 * Performs a comprehensive keep-alive ping:
 * 1. Executes a warm-up query on PostgreSQL (`SELECT 1`)
 * 2. Pings the FastAPI ML service to verify model loaded & track features
 * 3. Optionally pings the external app URL (e.g. Render/Railway/Koyeb) to prevent container sleep
 */
export const performHealthPing = async (triggeredBy = 'automated') => {
  const startTime = Date.now();
  const report = {
    triggeredBy,
    timestamp: new Date().toISOString(),
    database: { status: 'unknown', latencyMs: null },
    mlService: { status: 'unknown', latencyMs: null },
    selfPing: { status: 'skipped', latencyMs: null, url: null },
  };

  // 1. Touch Database
  try {
    const dbStart = Date.now();
    await db.query('SELECT 1');
    report.database.status = 'connected';
    report.database.latencyMs = Date.now() - dbStart;
  } catch (err) {
    report.database.status = 'error';
    report.database.error = err.message;
  }

  // 2. Touch ML Service
  try {
    const mlStart = Date.now();
    const mlRes = await fetch(`${ML_BASE}/`, { signal: AbortSignal.timeout(10000) });
    if (mlRes.ok) {
      const mlData = await mlRes.json();
      report.mlService.status = 'connected';
      report.mlService.latencyMs = Date.now() - mlStart;
      report.mlService.trackFeaturesRows = mlData.track_features_rows;
      report.mlService.modelLoaded = mlData.model_loaded;
    } else {
      report.mlService.status = `http_${mlRes.status}`;
      report.mlService.latencyMs = Date.now() - mlStart;
    }
  } catch (err) {
    report.mlService.status = 'unreachable';
    report.mlService.error = err.message;
  }

  // 3. Ping external app URL if set (e.g. Render / Railway / Koyeb keep-alive)
  const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
  if (appUrl) {
    try {
      const selfStart = Date.now();
      const target = `${appUrl.replace(/\/$/, '')}/health`;
      report.selfPing.url = target;
      const selfRes = await fetch(target, { signal: AbortSignal.timeout(15000) });
      report.selfPing.status = selfRes.ok ? 'ok' : `http_${selfRes.status}`;
      report.selfPing.latencyMs = Date.now() - selfStart;
    } catch (err) {
      report.selfPing.status = 'failed';
      report.selfPing.error = err.message;
    }
  }

  // Update State
  keepAliveState.totalPings += 1;
  keepAliveState.lastPingTime = new Date().toISOString();
  keepAliveState.nextPingTime = new Date(Date.now() + INTERVAL_MS).toISOString();
  keepAliveState.lastDiagnostics = report;
  keepAliveState.lastPingStatus =
    report.database.status === 'connected' && report.mlService.status === 'connected'
      ? 'healthy'
      : 'degraded';

  console.log(
    `[KeepAlive] Heartbeat #${keepAliveState.totalPings} completed in ${Date.now() - startTime}ms (${keepAliveState.lastPingStatus}). Next scheduled run: ${keepAliveState.nextPingTime}`
  );

  return report;
};

/**
 * Starts the automated recurring keep-alive scheduler.
 */
export const startKeepAliveScheduler = () => {
  if (schedulerTimer) {
    return schedulerTimer;
  }

  const scheduleNextPing = (triggeredBy) => {
    performHealthPing(triggeredBy).catch((err) => {
      console.error('[KeepAlive] Automated ping failed:', err.message);
    });
  };

  console.log(
    `[KeepAlive] Automated background keep-alive active: pinging now and every ${intervalHours} hours`
  );
  scheduleNextPing('startup');

  schedulerTimer = setInterval(() => {
    scheduleNextPing('automated');
  }, INTERVAL_MS);

  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }

  return schedulerTimer;
};
