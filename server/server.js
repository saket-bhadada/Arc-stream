import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

import dashboardRoutes from './components/DashboardRoutes.js';
import loginRoutes from './components/loginRoutes.js';
import db, { databaseReady } from './db.js';

const app = express();
const frontendUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:5173');
const allowedOrigins = new Set([frontendUrl.origin]);

if (frontendUrl.hostname === 'localhost') {
  const loopbackUrl = new URL(frontendUrl);
  loopbackUrl.hostname = '127.0.0.1';
  allowedOrigins.add(loopbackUrl.origin);
} else if (frontendUrl.hostname === '127.0.0.1') {
  const localhostUrl = new URL(frontendUrl);
  localhostUrl.hostname = 'localhost';
  allowedOrigins.add(localhostUrl.origin);
}

app.use(cors({
  origin: (origin, callback) => callback(null, Boolean(!origin || allowedOrigins.has(origin))),
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({
      status: 'ok',
      service: 'arc-stream-server',
      database: 'connected',
      vector_dimension: 7,
      seq_window: { min: 5, max: 9 },
    });
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'unreachable', detail: error.message });
  }
});

app.use('/', loginRoutes);
app.use('/api/ai', dashboardRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use((error, _req, res, _next) => {
  console.error('[Server] Unhandled error:', error.message);
  res.status(500).json({
    error: 'Internal server error',
    detail: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
});

const port = Number(process.env.PORT) || 3000;
try {
  await databaseReady;
  app.listen(port, () => {
    console.log(`[Arc-Stream] Server: http://localhost:${port}`);
  });
} catch (error) {
  console.error('[Server] Startup failed:', error.message);
  await db.end();
  process.exitCode = 1;
}
