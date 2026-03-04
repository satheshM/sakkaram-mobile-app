const winston = require('winston');
const path    = require('path');

/**
 * FIXES applied:
 *
 * 1. No 'http' level existed – morgan could not write to winston cleanly.
 *    → Added custom 'http' level between info and debug.
 *
 * 2. No redaction – OTP codes, tokens, or passwords sent in request bodies
 *    could appear verbatim in log metadata.
 *    → Added a redactTransform that masks common sensitive field names.
 *
 * 3. No file transport – on container restart all logs were lost with no
 *    persistent record (relevant if LOG_DIR is mounted on Render/Railway).
 *    → Added optional rotating file transports when LOG_DIR env var is set.
 *
 * 4. Production format was always JSON in the createLogger config, but the
 *    Console transport overrode it with a pretty format – inconsistent.
 *    → Now: pretty in dev, JSON in prod.
 */

// ── Custom log levels (adds 'http' between info and debug) ───────────────────
const LEVELS  = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const COLOURS = { error: 'red', warn: 'yellow', info: 'green', http: 'cyan', debug: 'gray' };
winston.addColors(COLOURS);

// ── Sensitive-field redaction ─────────────────────────────────────────────────
const SENSITIVE_KEYS = new Set([
  'password', 'otp', 'otp_code', 'token', 'accessToken', 'refreshToken',
  'refresh_token', 'authorization', 'jwt', 'secret', 'api_key', 'apikey',
]);

const redact = (obj, depth = 0) => {
  if (!obj || typeof obj !== 'object' || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.map(v => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1),
    ])
  );
};

const redactTransform = winston.format(info => {
  const { message, level, timestamp, stack, ...meta } = info;
  return { ...redact(meta), message, level, timestamp, stack };
});

// ── Formats ───────────────────────────────────────────────────────────────────
const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactTransform(),
);

const jsonFormat = winston.format.combine(baseFormat, winston.format.json());

const prettyFormat = winston.format.combine(
  baseFormat,
  winston.format.colorize({ level: true }), // only color level
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const m = Object.keys(meta).length
      ? '\n  ' + JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')
      : '';
    return `${timestamp} [${level}]: ${stack || message}${m}`;
  }),
);

// ── Transports ────────────────────────────────────────────────────────────────
const transports = [
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? jsonFormat : prettyFormat,
  }),
];

// Optional file logging when LOG_DIR is configured (e.g. mounted volume)
if (process.env.LOG_DIR) {
  transports.push(
    new winston.transports.File({
      filename: path.join(process.env.LOG_DIR, 'error.log'),
      level:    'error',
      format:   jsonFormat,
      maxsize:  10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(process.env.LOG_DIR, 'app.log'),
      format:   jsonFormat,
      maxsize:  50 * 1024 * 1024, // 50 MB
      maxFiles: 5,
    }),
  );
}

// ── Logger ────────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  levels:      LEVELS,
  level:       process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'http' : 'debug'),
  transports,
  exitOnError: false,
});

module.exports = logger;
