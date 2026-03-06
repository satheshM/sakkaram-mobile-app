require('dotenv').config();
const authService = require('../services/authService');
const { query }   = require('../config/db');
const logger      = require('../config/logger');

/**
 * Verify JWT Token Middleware
 *
 * Phase 6b change:
 *   - Blocked users (is_active=false) are NOT rejected with 403 here.
 *   - Instead req.user.isBlocked = true is set and they pass through.
 *   - The requireActive middleware below blocks them from normal routes.
 *   - Support chat routes only check verifyToken (not requireActive),
 *     so blocked users can still send/receive support messages.
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    const token   = authHeader.split(' ')[1];
    const decoded = authService.verifyToken(token, 'access');

    // DB check — does user exist and what is their active status?
    const userRes = await query(
      'SELECT is_active FROM users WHERE id=$1 AND deleted_at IS NULL',
      [decoded.userId]
    );

    if (!userRes.rows.length) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = {
      userId:    decoded.userId,
      role:      decoded.role,
      isBlocked: userRes.rows[0].is_active === false,
    };

    next();
  } catch (error) {
    logger.error('Token verification error:', error.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/**
 * requireActive — blocks blocked users from normal routes.
 * Use after verifyToken on all normal routes.
 * Support routes skip this middleware so blocked users can still chat.
 */
const requireActive = (req, res, next) => {
  if (req.user?.isBlocked) {
    return res.status(403).json({
      success: false,
      code:    'ACCOUNT_BLOCKED',
      message: 'Your account has been blocked. Please contact support via the app.',
    });
  }
  next();
};

/**
 * Check User Role Middleware
 */
const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

module.exports = { verifyToken, requireActive, checkRole };
