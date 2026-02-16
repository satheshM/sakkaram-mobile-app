const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Clean up expired sessions from database
 */
const cleanupExpiredSessions = async () => {
  try {
    const result = await pool.query(
      'DELETE FROM sessions WHERE expires_at < NOW() RETURNING id'
    );
    
    const count = result.rowCount;
    
    if (count > 0) {
      logger.info(`Cleaned up ${count} expired sessions`);
    }
    
    return count;
  } catch (error) {
    logger.error('Session cleanup error:', error);
    throw error;
  }
};

/**
 * Limit sessions per user (keep only latest N sessions)
 */
const limitUserSessions = async (userId, maxSessions = 5) => {
  try {
    const result = await pool.query(`
      DELETE FROM sessions
      WHERE user_id = $1
        AND id NOT IN (
          SELECT id FROM sessions
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2
        )
      RETURNING id
    `, [userId, maxSessions]);
    
    return result.rowCount;
  } catch (error) {
    logger.error('Limit user sessions error:', error);
    throw error;
  }
};

/**
 * Clean up old audit logs (older than 90 days)
 */
const cleanupOldAuditLogs = async (daysToKeep = 90) => {
  try {
    const result = await pool.query(`
      DELETE FROM audit_logs
      WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'
      RETURNING id
    `);
    
    const count = result.rowCount;
    
    if (count > 0) {
      logger.info(`Cleaned up ${count} old audit logs`);
    }
    
    return count;
  } catch (error) {
    logger.error('Audit log cleanup error:', error);
    throw error;
  }
};

/**
 * Clean up soft-deleted records (older than 30 days)
 */
const cleanupSoftDeletedRecords = async (daysToKeep = 30) => {
  try {
    const tables = ['bookings', 'vehicles', 'users'];
    let totalCleaned = 0;
    
    for (const table of tables) {
      const result = await pool.query(`
        DELETE FROM ${table}
        WHERE deleted_at IS NOT NULL
          AND deleted_at < NOW() - INTERVAL '${daysToKeep} days'
        RETURNING id
      `);
      
      totalCleaned += result.rowCount;
    }
    
    if (totalCleaned > 0) {
      logger.info(`Cleaned up ${totalCleaned} soft-deleted records`);
    }
    
    return totalCleaned;
  } catch (error) {
    logger.error('Soft-deleted cleanup error:', error);
    throw error;
  }
};

/**
 * Get database statistics
 */
const getDatabaseStats = async () => {
  try {
    const stats = {};
    
    // Table row counts
    const tables = ['users', 'sessions', 'vehicles', 'bookings', 'payments', 'wallets', 'wallet_transactions'];
    
    for (const table of tables) {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      stats[table] = parseInt(result.rows[0].count);
    }
    
    // Expired sessions
    const expiredSessions = await pool.query(
      'SELECT COUNT(*) as count FROM sessions WHERE expires_at < NOW()'
    );
    stats.expired_sessions = parseInt(expiredSessions.rows[0].count);
    
    return stats;
  } catch (error) {
    logger.error('Get database stats error:', error);
    throw error;
  }
};

/**
 * Run all cleanup tasks
 */
const runAllCleanupTasks = async () => {
  logger.info('Starting scheduled cleanup tasks...');
  
  try {
    const results = {
      expiredSessions: await cleanupExpiredSessions(),
      oldAuditLogs: await cleanupOldAuditLogs(),
      softDeletedRecords: await cleanupSoftDeletedRecords()
    };
    
    logger.info('Cleanup tasks completed', results);
    
    return results;
  } catch (error) {
    logger.error('Cleanup tasks failed:', error);
    throw error;
  }
};

module.exports = {
  cleanupExpiredSessions,
  limitUserSessions,
  cleanupOldAuditLogs,
  cleanupSoftDeletedRecords,
  getDatabaseStats,
  runAllCleanupTasks
};