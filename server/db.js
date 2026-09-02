import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const databaseName = process.env.DB_DATABASE || process.env.DB_NAME;
const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter((key) => !process.env[key]);
if (!databaseName) missing.push('DB_DATABASE or DB_NAME');
if (missing.length) {
  throw new Error(`[DB] Missing environment variables: ${missing.join(', ')}`);
}

const db = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: databaseName,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number.parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 10,
  idleTimeoutMillis: Number.parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) || 30_000,
  connectionTimeoutMillis: Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 5_000,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '../database/database_schema.sql');

export const databaseReady = (async () => {
  const client = await db.connect();
  try {
    await client.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('[DB] Schema verified successfully.');
  } catch (error) {
    if (error.message.includes('vector')) {
      throw new Error(`[DB] pgvector is required for Arc-Stream recommendations: ${error.message}`);
    }
    throw error;
  } finally {
    client.release();
  }
})();

db.on('error', (error) => {
  console.error('[DB] Unexpected pool error:', error.message);
});

export default db;
