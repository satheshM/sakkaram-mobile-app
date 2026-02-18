const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
require('dotenv').config();

const logger = require('./config/logger');

// Import Routes
const authRoutes = require('./routes/authRoutes');

// Vehicle Routes
const vehicleRoutes = require('./routes/vehicleRoutes');


const app = express();

// Security Middlewares
app.use(helmet());
app.use(xss());

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
      api: '/api',
      auth: '/api/auth',
      vehicles: '/api/vehicles (coming soon)',
      bookings: '/api/bookings (coming soon)',
      payments: '/api/payments (coming soon)'
    }
  });
});

// Authentication Routes
app.use('/api/auth', authRoutes);

// Vehicle Routes
app.use('/api/vehicles', vehicleRoutes);
// Wallet Routes
const walletRoutes = require('./routes/walletRoutes');
app.use('/api/wallet', walletRoutes);

// Booking Routes
const bookingRoutes = require('./routes/bookingRoutes');
app.use('/api/bookings', bookingRoutes);


// Payment Routes
const paymentRoutes = require('./routes/paymentRoutes');
app.use('/api/payments', paymentRoutes);

// Review Routes  ← ADD THIS
const reviewRoutes = require('./routes/reviewRoutes');
app.use('/api/reviews', reviewRoutes);

// Notification Routes  ← ADD THIS
const notificationRoutes = require('./routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);

// Admin Routes  ← ADD THIS
const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin', adminRoutes);

// Search Routes  ← ADD THIS
const searchRoutes = require('./routes/searchRoutes');
app.use('/api/search', searchRoutes);

// Maps Routes  ← ADD THIS
const mapsRoutes = require('./routes/mapsRoutes');
app.use('/api/maps', mapsRoutes);


// Favorites Routes  ← ADD
const favoriteRoutes = require('./routes/favoriteRoutes');
app.use('/api/favorites', favoriteRoutes);

// Referral Routes  ← ADD
const referralRoutes = require('./routes/referralRoutes');
app.use('/api/referrals', referralRoutes);

// Coupon Routes  ← ADD
const couponRoutes = require('./routes/couponRoutes');
app.use('/api/coupons', couponRoutes);

// Analytics Routes  ← ADD
const analyticsRoutes = require('./routes/analyticsRoutes');
app.use('/api/analytics', analyticsRoutes);


// Health Check Endpoint  ← ADD THIS
app.get('/api/health', async (req, res) => {
  try {
    // Check database connection
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
      apis: 69
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
    message: 'Route not found'
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