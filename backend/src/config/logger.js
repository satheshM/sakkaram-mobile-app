const winston = require('winston');
const path = require('path');

// ── Custom log levels ─────────────────────────────────────────────
const LEVELS = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

// ── Sensitive-field redaction ─────────────────────────────────────
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

// ── Formats ────────────────────────────────────────────────────────
const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactTransform(),
);

const jsonFormat = winston.format.combine(baseFormat, winston.format.json());

const prettyFormat = winston.format.combine(
  baseFormat,
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const m = Object.keys(meta).length
      ? '\n  ' + JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')
      : '';
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}${m}`;
  }),
);

// ── Transports ─────────────────────────────────────────────────────
const transports = [
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? jsonFormat : prettyFormat,
  }),
];

if (process.env.LOG_DIR) {
  transports.push(
    new winston.transports.File({
      filename: path.join(process.env.LOG_DIR, 'error.log'),
      level: 'error',
      format: jsonFormat,
    }),
    new winston.transports.File({
      filename: path.join(process.env.LOG_DIR, 'app.log'),
      format: jsonFormat,
    }),
  );
}

// ── Logger ─────────────────────────────────────────────────────────
const logger = winston.createLogger({
  levels: LEVELS,
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'http' : 'debug'),
  transports,
  exitOnError: false,
});

module.exports = logger;