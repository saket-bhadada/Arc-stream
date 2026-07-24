// server/src/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// ── DB imported first ─────────────────────────────────────────────────────────
// db.js runs pool.connect() on import and calls process.exit(1) on failure.
// Importing before Express guarantees no route ever runs against a broken pool.
import db from './db.js';

import loginRoutes from './components/loginRoutes.js';
import dashboardRoutes from './components/DashboardRoutes.js';

dotenv.config();

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// ── Health check ──────────────────────────────────────────────────────────────
// Verifies both the server and the DB pool are alive.
// FastAPI also exposes /health — both can be polled by a load balancer.
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({
      status:   'ok',
      service:  'arc-stream-server',
      database: 'connected',
      seq_window: {
        min: 5,
        max: 9,
      },
    });
  } catch (err) {
    res.status(503).json({
      status:   'error',
      database: 'unreachable',
      detail:   err.message,
    });
  }
});

// ── Route mounting ────────────────────────────────────────────────────────────
app.use('/',       loginRoutes);      // GET  /login  /callback   POST /refresh_token
app.use('/api/ai', dashboardRoutes);  // POST /api/ai/buffer      POST /api/ai/playlist

// ── Global error handler ──────────────────────────────────────────────────────
// Catches any error passed via next(err) from route handlers.
// Hides stack traces from API responses in production.
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({
    error:  'Internal server error',
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Arc-Stream] Server        → http://localhost:${PORT}`);
  console.log(`[Arc-Stream] Frontend      → ${process.env.FRONTEND_URL}`);
  console.log(`[Arc-Stream] ML Service    → ${process.env.ML_SERVICE_URL}`);
  console.log(`[Arc-Stream] Environment   → ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Arc-Stream] Z-vector window → MIN=${5} MAX=${9}`);
  console.log('[Arc-Stream] Session cookie -> 3 month http only refresh token');
});