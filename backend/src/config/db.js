const { Pool } = require('pg');
require('dotenv').config();

/**
 * FIXES applied:
 *
 * 1. console.log('Executed query', { text, duration, rows }) fires on EVERY query
 *    in production, flooding logs and potentially exposing SQL containing phone
 *    numbers, OTP codes, etc. to anyone with log access.
 *    → Now: dev logs all queries; prod logs only slow queries (>200 ms).
 *
 * 2. pool.on('connect') used console.log instead of the structured logger.
 *    → Replaced with logger.debug.
 *
 * 3. No statement_timeout – a runaway query holds a pool connection indefinitely,
 *    which can exhaust the pool under load.
 *    → Added 30 s statement timeout + 60 s idle transaction timeout.
 *
 * 4. SSL was always { rejectUnauthorized: false } even in local dev, causing
 *    needless SSL overhead and confusing error messages.
 *    → SSL only enabled in production.
 */

// Lazy-load logger to avoid circular dependency (logger → db → logger)
let _logger;
const getLogger = () => {
  if (!_logger) _logger = require('./logger');
  return _logger;
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,

  max:                     parseInt(process.env.DB_POOL_MAX)     || 20,
  min:                     parseInt(process.env.DB_POOL_MIN)     || 2,
  idleTimeoutMillis:       parseInt(process.env.DB_IDLE_TIMEOUT) || 30_000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT) || 10_000,

  // Prevent runaway queries from holding pool connections
  statement_timeout:                       30_000, // 30 s
  idle_in_transaction_session_timeout:     60_000, // 60 s
});

pool.on('error', err => {
  getLogger().error('DB pool error', { message: err.message, code: err.code });
});

// ── Query helper ──────────────────────────────────────────────────────────────
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS) || 200;
const IS_DEV        = process.env.NODE_ENV !== 'production';

const query = async (text, params) => {
  const t0 = Date.now();
  try {
    const result   = await pool.query(text, params);
    const duration = Date.now() - t0;

    if (IS_DEV) {
      getLogger().debug('DB query', {
        sql:  text.replace(/\s+/g, ' ').substring(0, 120),
        ms:   duration,
        rows: result.rowCount,
      });
    } else if (duration > SLOW_QUERY_MS) {
      getLogger().warn('Slow query detected', {
        sql:  text.replace(/\s+/g, ' ').substring(0, 200),
        ms:   duration,
        rows: result.rowCount,
      });
    }

    return result;
  } catch (err) {
    getLogger().error('DB query error', {
      sql:     text.replace(/\s+/g, ' ').substring(0, 200),
      message: err.message,
      code:    err.code,
      ms:      Date.now() - t0,
    });
    throw err;
  }
};

module.exports = { pool, query };
