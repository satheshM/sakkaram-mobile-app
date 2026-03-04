require('dotenv').config();
const { query } = require('../config/db');
const smsService = require('../services/smsService');
const authService = require('../services/authService');
const logger = require('../config/logger');

/**
 * Send OTP to Phone Number
 */
const sendOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    // Validate phone number
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Clean phone number (remove spaces, ensure +91)
    let cleanPhone = phoneNumber.trim().replace(/\s/g, '');
    if (!cleanPhone.startsWith('+91')) {
      cleanPhone = '+91' + cleanPhone.replace(/^\+?91/, '');
    }

    // Validate Indian phone number format
    const phoneRegex = /^\+91[6-9]\d{9}$/;
    if (!phoneRegex.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Indian phone number format'
      });
    }

    // Check if user exists
    const existingUser = await authService.findUserByPhone(cleanPhone);

    // Generate OTP
    const otp = smsService.generateOTP();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // If user exists, update OTP
    if (existingUser) {
      await query(
        `UPDATE users 
         SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0, last_otp_sent_at = NOW()
         WHERE phone_number = $3`,
        [otp, otpExpiresAt, cleanPhone]
      );
    } else {
      // Create temporary user record with OTP
      await query(
        `INSERT INTO users (phone_number, otp_code, otp_expires_at, otp_attempts, role, is_verified)
         VALUES ($1, $2, $3, 0, 'farmer', false)
         ON CONFLICT (phone_number) 
         DO UPDATE SET otp_code = $2, otp_expires_at = $3, otp_attempts = 0, last_otp_sent_at = NOW()`,
        [cleanPhone, otp, otpExpiresAt]
      );
    }

    // Send OTP via SMS
    await smsService.sendOTP(cleanPhone, otp);

    logger.info(`OTP sent to ${cleanPhone}`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      phoneNumber: cleanPhone,
      expiresIn: 300, // 5 minutes in seconds
      ...(process.env.USE_MOCK_OTP === 'true' && { 
        dev_otp: otp, // Only in development
        dev_note: 'Use this OTP for testing'
      })
    });

  } catch (error) {
    logger.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * ✅ FIXED: Two-Step Verify OTP and Login/Signup
 * 
 * FLOW:
 * 1. First call: Verify OTP only
 * 2. If new user: Return { isNewUser: true, requiresRegistration: true }
 * 3. Second call: Include fullName and role
 * 4. If existing user: Login directly with tokens
 */
const verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otp, fullName, role } = req.body;

    // Validation
    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }

    // Clean phone number
    let cleanPhone = phoneNumber.trim().replace(/\s/g, '');
    if (!cleanPhone.startsWith('+91')) {
      cleanPhone = '+91' + cleanPhone.replace(/^\+?91/, '');
    }

    // Get user with OTP
    const userResult = await query(
      'SELECT * FROM users WHERE phone_number = $1',
      [cleanPhone]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please request OTP first.'
      });
    }

    // Check OTP expiry
    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    // Check OTP attempts
    if (user.otp_attempts >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.'
      });
    }

    // Verify OTP
    if (user.otp_code !== otp) {
      // Increment failed attempts
      await query(
        'UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = $1',
        [user.id]
      );

      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
        attemptsLeft: 3 - (user.otp_attempts + 1)
      });
    }

    // ✅ OTP is valid! Now determine if user is new or existing
    const isNewUser = !user.full_name || user.full_name === null || user.full_name.trim() === '';

    // ✅ CASE 1: New user without registration details
    if (isNewUser && (!fullName || !role)) {
      // OTP verified but user needs to complete registration
      logger.info(`New user detected: ${user.id}, awaiting registration details`);
      
      return res.status(200).json({
        success: true,
        isNewUser: true,
        requiresRegistration: true,
        message: 'OTP verified successfully. Please complete your profile.',
        userId: user.id,
      });
    }

    // ✅ CASE 2: New user with registration details
    if (isNewUser && fullName && role) {
      // Validate inputs
      if (fullName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Full name must be at least 2 characters'
        });
      }

      if (!['farmer', 'owner'].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Role must be either farmer or owner'
        });
      }

      // Update user profile
      await query(
        `UPDATE users 
         SET full_name = $1, role = $2, phone_verified = true, 
             is_verified = true, otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0,
             updated_at = NOW()
         WHERE id = $3`,
        [fullName.trim(), role, user.id]
      );

      // Create wallet for new user
      await query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
        [user.id]
      );

      // Update local user object
      user.full_name = fullName.trim();
      user.role = role;
      user.phone_verified = true;
      user.is_verified = true;

      logger.info(`New user registered: ${user.id} - ${fullName} (${role})`);
    }

    // ✅ CASE 3: Existing user
    if (!isNewUser) {
      // Just verify phone and clear OTP
      await query(
        `UPDATE users 
         SET phone_verified = true, is_verified = true, 
             otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0,
             last_login_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [user.id]
      );

      user.phone_verified = true;
      user.is_verified = true;

      logger.info(`Existing user logged in: ${user.id} - ${user.full_name}`);
    }

    // ✅ Generate tokens for both new and existing users
    const accessToken = authService.generateAccessToken(user.id, user.role);
    const refreshToken = authService.generateRefreshToken(user.id);

    // Create session
    await authService.createSession(user.id, refreshToken);

    // Return success response
    res.status(200).json({
      success: true,
      message: isNewUser ? '🎉 Welcome to Sakkaram! Your account has been created.' : '👋 Welcome back!',
      isNewUser: isNewUser,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        fullName: user.full_name,
        role: user.role,
        profileImage: user.profile_image_url,
        isVerified: user.is_verified,
        createdAt: user.created_at,
      },
      tokens: {
        accessToken,
        refreshToken,
      },
    });

  } catch (error) {
    logger.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get User Profile
 */
const getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    const userResult = await query(
      'SELECT id, phone_number, full_name, role, email, profile_image_url, address, is_verified, phone_verified, created_at, updated_at FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        fullName: user.full_name,
        role: user.role,
        email: user.email,
        profileImage: user.profile_image_url,
        address: user.address,
        isVerified: user.is_verified,
        phoneVerified: user.phone_verified,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      }
    });

  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
};

/**
 * Update User Profile
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fullName, email, address } = req.body;

    // Validate inputs
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (fullName !== undefined) {
      if (fullName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Full name must be at least 2 characters'
        });
      }
      updates.push(`full_name = $${paramCount}`);
      values.push(fullName.trim());
      paramCount++;
    }

    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (email && !emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }
      updates.push(`email = $${paramCount}`);
      values.push(email || null);
      paramCount++;
    }

    if (address !== undefined) {
      updates.push(`address = $${paramCount}`);
      values.push(address || null);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add userId for WHERE clause
    values.push(userId);

    // Update user
    const updateQuery = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount} AND deleted_at IS NULL
      RETURNING id, phone_number, full_name, role, email, profile_image_url, address, is_verified, updated_at
    `;

    const result = await query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    logger.info(`Profile updated for user: ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        fullName: user.full_name,
        role: user.role,
        email: user.email,
        profileImage: user.profile_image_url,
        address: user.address,
        isVerified: user.is_verified,
        updatedAt: user.updated_at,
      }
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

/**
 * Refresh Access Token
 */
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = authService.verifyToken(refreshToken, 'refresh');

    // Check if session exists
    const sessionResult = await query(
      'SELECT * FROM sessions WHERE refresh_token = $1 AND expires_at > NOW()',
      [refreshToken]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    // Get user
    const user = await authService.findUserById(decoded.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate new access token
    const accessToken = authService.generateAccessToken(user.id, user.role);

    res.status(200).json({
      success: true,
      accessToken
    });

  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
  }
};

/**
 * Logout
 */
const logout = async (req, res) => {
  try {
    const userId = req.user.userId; // From auth middleware

    // Delete all user sessions
    await authService.deleteUserSessions(userId);

    logger.info(`User ${userId} logged out`);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  getProfile,
  updateProfile,
  refreshToken,
  logout
};