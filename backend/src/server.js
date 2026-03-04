const app      = require('./app');
const { pool } = require('./config/db');
const logger   = require('./config/logger');

const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Startup env validation
// FIX: Server was starting silently with missing JWT_SECRET.
//      jwt.sign(payload, undefined) uses `undefined` as secret → all tokens
//      are trivially forgeable. Now we crash fast with a clear error message.
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

const validateEnv = () => {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    logger.error(`FATAL: Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') {
    if ((process.env.JWT_SECRET || '').length < 32) {
      logger.warn('SECURITY: JWT_SECRET is shorter than 32 chars – use a longer secret in production');
    }
    if (process.env.USE_MOCK_OTP === 'true') {
      logger.warn('SECURITY: USE_MOCK_OTP=true in production! Authentication can be bypassed.');
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Process-level error handlers
// FIX: No handlers existed. In Node ≥ 15, unhandledRejection exits the process.
// ─────────────────────────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack:  reason instanceof Error ? reason.stack   : undefined,
  });
  // Do not crash – log and keep running; health check will surface the issue.
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception – process will exit', {
    message: err.message,
    stack:   err.stack,
  });
  process.exit(1); // uncaught exceptions leave process in undefined state
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────
let httpServer;

const gracefulShutdown = (signal) => {
  logger.info(`${signal} received – shutting down gracefully`);
  httpServer && httpServer.close(() => {
    logger.info('HTTP server closed');
    pool.end(() => {
      logger.info('DB pool closed');
      process.exit(0);
    });
  });
  // Force-kill after 15 s if graceful close hangs
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15_000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
const start = async () => {
  validateEnv();

  try {
    await pool.query('SELECT 1');
    logger.info('Database connection verified');
  } catch (err) {
    logger.warn('DB check failed at startup – some routes will error', { message: err.message });
  }

  httpServer = app.listen(PORT, () => {
    logger.info('Server started', {
      port:    PORT,
      env:     process.env.NODE_ENV || 'development',
      node:    process.version,
      pid:     process.pid,
    });
  });

  // FIX: Node default keepAliveTimeout is 5 s – shorter than most load balancers
  //      (Railway/Render use 60 s+), causing 502 errors under sustained traffic.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout   = 70_000; // must be > keepAliveTimeout
};

// ── Scheduled cleanup ─────────────────────────────────────────────────────────
const { runAllCleanupTasks } = require('./services/cleanupService');

setInterval(() => {
  runAllCleanupTasks().catch(err =>
    logger.error('Scheduled cleanup failed', { message: err.message })
  );
}, 24 * 60 * 60 * 1000);

runAllCleanupTasks().catch(err =>
  logger.warn('Startup cleanup error (non-fatal)', { message: err.message })
);

start().catch(err => {
  logger.error('Failed to start server', { message: err.message, stack: err.stack });
  process.exit(1);
});
