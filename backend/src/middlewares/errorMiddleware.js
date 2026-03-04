/**
 * errorMiddleware.js
 *
 * Centralises all error handling so every controller can simply:
 *   throw new AppError('Not found', 404);   ← operational (safe message)
 *   throw new Error('...');                 ← programmer (generic 500 to client)
 *
 * Previously each controller had its own ad-hoc error responses, leaking
 * raw error.message to the client in several places (paymentController,
 * reviewController, adminController).
 */

const logger = require('../config/logger');

// ─────────────────────────────────────────────────────────────────────────────
// AppError – operational errors whose message is safe to send to the client
// ─────────────────────────────────────────────────────────────────────────────
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode    = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 404 handler – place just before globalErrorHandler
// ─────────────────────────────────────────────────────────────────────────────
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
const globalErrorHandler = (err, req, res, _next) => {
  // ── Postgres-specific normalisation ──────────────────────────────────────
  if (err.code === '23505') { // unique constraint violation
    return res.status(409).json({ success: false, message: 'Record already exists.' });
  }
  if (err.code === '23503') { // foreign key violation
    return res.status(400).json({ success: false, message: 'Referenced record does not exist.' });
  }
  if (err.code === '22P02') { // invalid UUID / type
    return res.status(400).json({ success: false, message: 'Invalid ID format.' });
  }

  // ── JWT errors ────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token has expired.' });
  }

  // ── Operational errors (safe to expose message) ───────────────────────────
  if (err.isOperational) {
    logger.warn('Operational error', {
      status:  err.statusCode,
      message: err.message,
      path:    req.originalUrl,
      userId:  req.user?.userId,
    });
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }

  // ── Programmer / unexpected errors (hide details from client) ─────────────
  logger.error('Unhandled server error', {
    message: err.message,
    stack:   err.stack,
    path:    req.originalUrl,
    method:  req.method,
    userId:  req.user?.userId,
    ip:      req.ip,
  });

  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again later.',
  });
};

module.exports = { AppError, notFoundHandler, globalErrorHandler };
