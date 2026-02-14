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
 * Verify OTP and Login/Signup
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

    // OTP is valid!
    let isNewUser = !user.full_name; // Check if profile is complete

    // If new user, update profile
    if (isNewUser && fullName && role) {
      await query(
        `UPDATE users 
         SET full_name = $1, role = $2, phone_verified = true, 
             is_verified = true, otp_code = NULL, otp_expires_at = NULL
         WHERE id = $3`,
        [fullName, role, user.id]
      );

      // Fetch updated user
      const updatedUserResult = await query(
        'SELECT * FROM users WHERE id = $1',
        [user.id]
      );
      
      const updatedUser = updatedUserResult.rows[0];
      user.full_name = updatedUser.full_name;
      user.role = updatedUser.role;
      user.phone_verified = true;
      user.is_verified = true;
      
      // Create wallet for new user
      await query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
        [user.id]
      );
    } else if (!isNewUser) {
      // Existing user, just verify phone and clear OTP
      await query(
        `UPDATE users 
         SET phone_verified = true, is_verified = true, 
             otp_code = NULL, otp_expires_at = NULL
         WHERE id = $1`,
        [user.id]
      );
    } else {
      // New user but missing fullName or role
      return res.status(400).json({
        success: false,
        message: 'Full name and role are required for new users',
        isNewUser: true
      });
    }

    // Generate tokens
    const accessToken = authService.generateAccessToken(user.id, user.role);
    const refreshToken = authService.generateRefreshToken(user.id);

    // Create session
    await authService.createSession(user.id, refreshToken);

    // Update last login
    await authService.updateLastLogin(user.id);

    logger.info(`User ${user.id} logged in successfully`);

    res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      isNewUser,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        fullName: user.full_name,
        role: user.role,
        profileImage: user.profile_image_url,
        isVerified: user.is_verified
      },
      tokens: {
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    logger.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
  refreshToken,
  logout
};