const app = require('./app');
const { pool } = require('./config/db');
const logger = require('./config/logger');

const PORT = process.env.PORT || 5000;

// Test Database Connection
const testDatabaseConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    logger.info('✅ Database connection successful');
    logger.info(`Database time: ${result.rows[0].now}`);
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Start Server
const startServer = async () => {
  try {
    // Test database connection first
    const dbConnected = await testDatabaseConnection();
    
    if (!dbConnected) {
      logger.error('⚠️ Starting server without database connection');
    }

    // Start Express server
    app.listen(PORT, () => {
      logger.info('='.repeat(50));
      logger.info(`🚀 Sakkaram Backend Server Started`);
      logger.info(`📡 Server running on: http://localhost:${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`💾 Database: ${dbConnected ? 'Connected ✅' : 'Disconnected ❌'}`);
      logger.info('='.repeat(50));
    });

  } catch (error) {
    logger.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server...');
  pool.end(() => {
    logger.info('Database pool closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, closing server...');
  pool.end(() => {
    logger.info('Database pool closed');
    process.exit(0);
  });
});


// Schedule cleanup tasks
const { runAllCleanupTasks } = require('./services/cleanupService');

// Run cleanup every 24 hours
setInterval(() => {
  runAllCleanupTasks().catch(err => {
    logger.error('Scheduled cleanup failed:', err);
  });
}, 24 * 60 * 60 * 1000); // 24 hours

// Run cleanup on startup
runAllCleanupTasks().catch(err => {
  logger.error('Startup cleanup failed:', err);
});
// Start the server
startServer();