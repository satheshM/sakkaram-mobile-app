const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
require('dotenv').config();

const { pool } = require('./config/db');
const logger = require('./config/logger');

// Import Routes
const authRoutes = require('./routes/authRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');

const app = express();

// Security Middlewares
app.use(helmet());
app.use(xss());
app.set('trust proxy', 1);

// Rate Limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body Parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health Check Route
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Sakkaram API is running! 🚜',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API Info Route
app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Sakkaram API v1.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      vehicles: '/api/vehicles',
      bookings: '/api/bookings',
      wallet: '/api/wallet',
      referral: '/api/referral',
      coupons: '/api/coupons',
      analytics: '/api/analytics',
    }
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);

const walletRoutes = require('./routes/walletRoutes');
app.use('/api/wallet', walletRoutes);

const bookingRoutes = require('./routes/bookingRoutes');
app.use('/api/bookings', bookingRoutes);

const paymentRoutes = require('./routes/paymentRoutes');
app.use('/api/payments', paymentRoutes);

const reviewRoutes = require('./routes/reviewRoutes');
app.use('/api/reviews', reviewRoutes);

const notificationRoutes = require('./routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);

const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin', adminRoutes);

const supportRoutes = require('./routes/supportRoutes');
app.use('/api/support', supportRoutes);

const searchRoutes = require('./routes/searchRoutes');
app.use('/api/search', searchRoutes);

const mapsRoutes = require('./routes/mapsRoutes');
app.use('/api/maps', mapsRoutes);

const favoriteRoutes = require('./routes/favoriteRoutes');
app.use('/api/favorites', favoriteRoutes);

// ✅ FIX: Was '/api/referrals' — frontend calls '/api/referral' (no trailing 's')
const referralRoutes = require('./routes/referralRoutes');
app.use('/api/referral', referralRoutes);

const couponRoutes = require('./routes/couponRoutes');
app.use('/api/coupons', couponRoutes);

const analyticsRoutes = require('./routes/analyticsRoutes');
app.use('/api/analytics', analyticsRoutes);

// ─── Health Check with DB ──────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW()');
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      database: {
        status: 'connected',
        timestamp: dbCheck.rows[0].now
      },
      services: {
        cloudinary: process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'missing',
        cashfree: process.env.CASHFREE_APP_ID ? 'configured' : 'missing',
        googleMaps: process.env.GOOGLE_MAPS_BACKEND_KEY ? 'configured' : 'missing'
      },
      version: '1.0.0',
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error(err.message, { error: err.stack });
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

module.exports = app;
