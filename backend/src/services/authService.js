require('dotenv').config();
const jwt   = require('jsonwebtoken');
const { query } = require('../config/db');

/**
 * FIXES applied:
 *
 * 1. jwt.sign(payload, undefined) silently accepts undefined as secret and signs
 *    successfully – every token becomes trivially forgeable.
 *    → Startup validation in server.js will catch missing secrets, but added
 *      an explicit guard here as belt-and-suspenders.
 *
 * 2. jwt.verify(token, secret) with no algorithms option is vulnerable to the
 *    "algorithm confusion" attack (attacker changes alg to 'none').
 *    → Explicitly pin { algorithms: ['HS256'] }.
 *
 * 3. verifyToken() caught ALL errors and re-threw a generic Error, losing the
 *    original error name. The global error handler needs JsonWebTokenError /
 *    TokenExpiredError to normalise the status code correctly.
 *    → Let the original jwt error propagate; only wrap unexpected errors.
 */
class AuthService {

  generateAccessToken(userId, role) {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not configured');
    return jwt.sign(
      { userId, role, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m', algorithm: 'HS256' }
    );
  }

  generateRefreshToken(userId) {
    if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET not configured');
    return jwt.sign(
      { userId, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d', algorithm: 'HS256' }
    );
  }

  // FIX: Let JsonWebTokenError / TokenExpiredError propagate naturally so
  //      globalErrorHandler can normalise them to 401 with a safe message.
  verifyToken(token, type = 'access') {
    const secret = type === 'access'
      ? process.env.JWT_SECRET
      : process.env.JWT_REFRESH_SECRET;
    if (!secret) throw new Error(`JWT secret for '${type}' not configured`);
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  }

  async findUserByPhone(phoneNumber) {
    const result = await query(
      'SELECT * FROM users WHERE phone_number=$1 AND deleted_at IS NULL',
      [phoneNumber]
    );
    return result.rows[0] || null;
  }

  async findUserById(userId) {
    const result = await query(
      'SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL',
      [userId]
    );
    return result.rows[0] || null;
  }

  async createSession(userId, refreshToken, deviceInfo = {}) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO sessions (user_id, refresh_token, device_info, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, refreshToken, JSON.stringify(deviceInfo), expiresAt]
    );
  }

  async deleteUserSessions(userId) {
    await query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  }
}

module.exports = new AuthService();
