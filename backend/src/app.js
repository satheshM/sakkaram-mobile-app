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