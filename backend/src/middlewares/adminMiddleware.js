const logger = require('../config/logger');

/**
 * Middleware to check if user is admin
 */
const isAdmin = (req, res, next) => {
  try {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user is admin
    if (req.user.role !== 'admin') {
      logger.warn('Unauthorized admin access attempt', {
        userId: req.user.userId,
        role: req.user.role,
        path: req.path
      });

      return res.status(403).json({
        success: false,
        message: 'Admin access required. You do not have permission to access this resource.'
      });
    }

    // User is admin, proceed
    next();

  } catch (error) {
    logger.error('Admin middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = { isAdmin };