require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const logger = require('../config/logger');

class AuthService {
  /**
   * Generate JWT Access Token
   */
  generateAccessToken(userId, role) {
    return jwt.sign(
      { userId, role, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
    );
  }

  /**
   * Generate JWT Refresh Token
   */
  generateRefreshToken(userId) {
    return jwt.sign(
      { userId, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
    );
  }

  /**
   * Verify JWT Token
   */
  verifyToken(token, type = 'access') {
    try {
      const secret = type === 'access' 
        ? process.env.JWT_SECRET 
        : process.env.JWT_REFRESH_SECRET;
      
      return jwt.verify(token, secret);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Hash password
   */
  async hashPassword(password) {
    return await bcrypt.hash(password, 10);
  }

  /**
   * Compare password
   */
  async comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  /**
   * Find user by phone number
   */
  async findUserByPhone(phoneNumber) {
    const result = await query(
      'SELECT * FROM users WHERE phone_number = $1 AND deleted_at IS NULL',
      [phoneNumber]
    );
    return result.rows[0];
  }

  /**
   * Find user by ID
   */
  async findUserById(userId) {
    const result = await query(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );
    return result.rows[0];
  }

  /**
   * Update user's last login
   */
  async updateLastLogin(userId) {
    await query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [userId]
    );
  }

  /**
   * Create refresh token session
   */
  async createSession(userId, refreshToken, deviceInfo = {}) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await query(
      `INSERT INTO sessions (user_id, refresh_token, device_info, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, refreshToken, JSON.stringify(deviceInfo), expiresAt]
    );
  }

  /**
   * Delete user sessions (logout)
   */
  async deleteUserSessions(userId) {
    await query(
      'DELETE FROM sessions WHERE user_id = $1',
      [userId]
    );
  }
}

module.exports = new AuthService();