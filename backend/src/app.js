const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const xss          = require('xss-clean');
require('dotenv').config();

const { pool }   = require('./config/db');
const logger     = require('./config/logger');
const { notFoundHandler, globalErrorHandler } = require('./middlewares/errorMiddleware');

// ── Route imports ─────────────────────────────────────────────────────────────
const authRoutes         = require('./routes/authRoutes');
const vehicleRoutes      = require('./routes/vehicleRoutes');
const walletRoutes       = require('./routes/walletRoutes');
const bookingRoutes      = require('./routes/bookingRoutes');
const paymentRoutes      = require('./routes/paymentRoutes');
const reviewRoutes       = require('./routes/reviewRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const adminRoutes        = require('./routes/adminRoutes');
const searchRoutes       = require('./routes/searchRoutes');
const mapsRoutes         = require('./routes/mapsRoutes');
const favoriteRoutes     = require('./routes/favoriteRoutes');
const referralRoutes     = require('./routes/referralRoutes');
const couponRoutes       = require('./routes/couponRoutes');
const analyticsRoutes    = require('./routes/analyticsRoutes');

const app = express();

// ── Trust proxy (correct IP behind Railway / Render / Nginx) ─────────────────
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
// FIX: helmet() with no args uses outdated defaults; HSTS was not configured.
app.use(helmet({
  crossOriginEmbedderPolicy: false, // needed for Cloudinary image loads in React Native
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
app.use(xss());

// ── CORS ──────────────────────────────────────────────────────────────────────
// FIX: Was `'*'` wildcard when CORS_ORIGIN env var not set.
// Mobile apps don't send Origin headers so strict CORS does not affect them.
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : [];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                       // mobile / curl / health check
    if (process.env.NODE_ENV !== 'production') return cb(null, true); // dev: open
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// FIX 1: One flat 100/15min limiter was too coarse – auth needs tighter limits,
//         browsing APIs need looser ones for mobile clients.
// FIX 2: No separate OTP send limit; added 3/min IP guard for send-otp.
const generalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 300,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, message: 'Too many requests. Please try again later.' },
  skip: req => req.path === '/health' || req.path === '/api/health',
});

const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many auth attempts. Please wait 15 minutes.' },
});

const otpSendLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             3,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many OTP requests. Please wait a minute.' },
});

const mapsLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30, // Google Maps charges per call – protect budget
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Maps API rate limit reached.' },
});

app.use('/api/',              generalLimiter);
app.use('/api/auth/',         authLimiter);
app.use('/api/auth/send-otp', otpSendLimiter);
app.use('/api/maps/',         mapsLimiter);

// ── Body parser ───────────────────────────────────────────────────────────────
// FIX: 10mb JSON body limit enables trivial DoS. Images go via multipart (multer),
//      not JSON body. 100kb is plenty for any legitimate JSON request.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// ── HTTP request logging ──────────────────────────────────────────────────────
// FIX: morgan was only active in development – production had zero access logs.
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(
    process.env.NODE_ENV === 'production' ? 'combined' : 'dev',
    { stream: { write: msg => logger.http(msg.trimEnd()) } }
  ));
}

// ── Health checks ─────────────────────────────────────────────────────────────
// FIX: /api/health was leaking which 3rd-party services are configured/missing –
//      that's a recon gift. Removed service config from public response.
app.get('/health', (_req, res) => res.status(200).json({
  success: true, status: 'ok', uptime: Math.floor(process.uptime()),
}));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'healthy', database: 'connected', uptime: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

// FIX: /api was listing internal endpoint map to anonymous callers.
app.get('/api', (_req, res) => res.status(200).json({ success: true, message: 'Sakkaram API v1.0' }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/vehicles',      vehicleRoutes);
app.use('/api/wallet',        walletRoutes);
app.use('/api/bookings',      bookingRoutes);
app.use('/api/payments',      paymentRoutes);
app.use('/api/reviews',       reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/search',        searchRoutes);
app.use('/api/maps',          mapsRoutes);
app.use('/api/favorites',     favoriteRoutes);
app.use('/api/referral',      referralRoutes);
app.use('/api/coupons',       couponRoutes);
app.use('/api/analytics',     analyticsRoutes);

// ── Error handlers (MUST be last) ────────────────────────────────────────────
app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = app;
