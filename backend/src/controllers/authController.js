require('dotenv').config();
const { query }   = require('../config/db');
const smsService  = require('../services/smsService');
const authService = require('../services/authService');
const logger      = require('../config/logger');

// ── Constants ─────────────────────────────────────────────────────────────────
const OTP_TTL_MS          = 5 * 60 * 1000; // 5 minutes
const OTP_RESEND_COOLDOWN = 60;            // seconds between OTP sends per phone
const MAX_OTP_ATTEMPTS    = 5;             // FIX: bumped from 3 (too easy to lock out)

// ── Send OTP ──────────────────────────────────────────────────────────────────
const sendOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    let cleanPhone = phoneNumber.trim().replace(/\s/g, '');
    if (!cleanPhone.startsWith('+91')) {
      cleanPhone = '+91' + cleanPhone.replace(/^\+?91/, '');
    }
    if (!/^\+91[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Invalid Indian phone number format' });
    }

    // ── FIX: Per-phone OTP cooldown ───────────────────────────────────────────
    // IP-rate-limit in app.js only catches same-IP abuse. A single number can
    // still be spammed from many IPs (SMS bomber). Enforce cooldown in the DB.
    const existingUser = await authService.findUserByPhone(cleanPhone);
    if (existingUser?.last_otp_sent_at) {
      const elapsed = (Date.now() - new Date(existingUser.last_otp_sent_at).getTime()) / 1000;
      if (elapsed < OTP_RESEND_COOLDOWN) {
        const wait = Math.ceil(OTP_RESEND_COOLDOWN - elapsed);
        return res.status(429).json({
          success:    false,
          message:    `Please wait ${wait} seconds before requesting another OTP.`,
          retryAfter: wait,
        });
      }
    }

    const otp       = smsService.generateOTP();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    if (existingUser) {
      await query(
        `UPDATE users SET otp_code=$1, otp_expires_at=$2, otp_attempts=0, last_otp_sent_at=NOW()
         WHERE phone_number=$3`,
        [otp, expiresAt, cleanPhone]
      );
    } else {
      await query(
        `INSERT INTO users (phone_number, otp_code, otp_expires_at, otp_attempts, role, is_verified)
         VALUES ($1, $2, $3, 0, 'farmer', false)
         ON CONFLICT (phone_number)
         DO UPDATE SET otp_code=$2, otp_expires_at=$3, otp_attempts=0, last_otp_sent_at=NOW()`,
        [cleanPhone, otp, expiresAt]
      );
    }

    await smsService.sendOTP(cleanPhone, otp);

    // Log only masked phone to avoid PII in logs
    logger.info('OTP sent', { phone: `****${cleanPhone.slice(-4)}` });

    // ── FIX: dev_otp was leaked whenever USE_MOCK_OTP=true regardless of NODE_ENV.
    //    A misconfigured production server (USE_MOCK_OTP accidentally true) would
    //    return the live OTP in the API response, completely defeating auth.
    const isDevMode = process.env.USE_MOCK_OTP === 'true'
                   && process.env.NODE_ENV !== 'production';

    return res.status(200).json({
      success:   true,
      message:   'OTP sent successfully',
      expiresIn: OTP_TTL_MS / 1000,
      ...(isDevMode && { dev_otp: otp, dev_note: 'Dev mode only – never shown in production' }),
    });

  } catch (error) {
    logger.error('Send OTP error', { message: error.message });
    return res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

// ── Verify OTP ────────────────────────────────────────────────────────────────
const verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otp, fullName, role } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({ success: false, message: 'Phone number and OTP are required' });
    }

    let cleanPhone = phoneNumber.trim().replace(/\s/g, '');
    if (!cleanPhone.startsWith('+91')) {
      cleanPhone = '+91' + cleanPhone.replace(/^\+?91/, '');
    }

    const userResult = await query('SELECT * FROM users WHERE phone_number=$1', [cleanPhone]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found. Please request OTP first.' });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (user.otp_attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
    }

    // FIX: String comparison – OTP stored as string, submitted value may be string/number
    if (String(user.otp_code) !== String(otp).trim()) {
      await query('UPDATE users SET otp_attempts=otp_attempts+1 WHERE id=$1', [user.id]);
      const left = MAX_OTP_ATTEMPTS - (user.otp_attempts + 1);
      return res.status(400).json({
        success: false, message: 'Invalid OTP',
        attemptsLeft: Math.max(0, left),
      });
    }

    const isNewUser = !user.full_name || user.full_name.trim() === '';

    // Case 1 – OTP valid but registration details not yet provided
    if (isNewUser && (!fullName || !role)) {
      await query('UPDATE users SET otp_attempts=0 WHERE id=$1', [user.id]);
      return res.status(200).json({
        success: true, isNewUser: true, requiresRegistration: true,
        message: 'OTP verified. Please complete your profile.',
        userId:  user.id,
      });
    }

    // Case 2 – New user providing registration details
    if (isNewUser && fullName && role) {
      if (fullName.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters' });
      }
      if (!['farmer', 'owner'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Role must be farmer or owner' });
      }

      await query(
        `UPDATE users SET full_name=$1, role=$2, phone_verified=true, is_verified=true,
         otp_code=NULL, otp_expires_at=NULL, otp_attempts=0, updated_at=NOW()
         WHERE id=$3`,
        [fullName.trim(), role, user.id]
      );
      await query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1,0) ON CONFLICT (user_id) DO NOTHING',
        [user.id]
      );

      user.full_name = fullName.trim();
      user.role      = role;
      user.is_verified = true;
      logger.info('New user registered', { userId: user.id, role });
    }

    // Case 3 – Existing user logging in
    if (!isNewUser) {
      await query(
        `UPDATE users SET phone_verified=true, is_verified=true,
         otp_code=NULL, otp_expires_at=NULL, otp_attempts=0,
         last_login_at=NOW(), updated_at=NOW()
         WHERE id=$1`,
        [user.id]
      );
      user.is_verified = true;
      logger.info('User logged in', { userId: user.id });
    }

    const accessToken  = authService.generateAccessToken(user.id, user.role);
    const refreshToken = authService.generateRefreshToken(user.id);
    await authService.createSession(user.id, refreshToken);

    // Phase 6b: blocked users get tokens (so they can reach support chat)
    // but isBlocked=true tells the app to show the blocked/chat screen
    const isBlocked = user.is_active === false;

    return res.status(200).json({
      success:   true,
      isNewUser,
      isBlocked,
      message:   isBlocked
        ? 'Your account is blocked. You can contact support below.'
        : isNewUser ? 'Welcome to Sakkaram! Account created.' : 'Welcome back!',
      user: {
        id:           user.id,
        phoneNumber:  user.phone_number,
        fullName:     user.full_name,
        role:         user.role,
        profileImage: user.profile_image_url,
        isVerified:   user.is_verified,
        createdAt:    user.created_at,
      },
      tokens: { accessToken, refreshToken },
    });

  } catch (error) {
    logger.error('Verify OTP error', { message: error.message });
    return res.status(500).json({ success: false, message: 'Failed to verify OTP. Please try again.' });
  }
};

// ── Get Profile ───────────────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, phone_number, full_name, role, email, profile_image_url,
              address, is_verified, phone_verified, created_at, updated_at
       FROM users WHERE id=$1 AND deleted_at IS NULL`,
      [req.user.userId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const u = result.rows[0];
    return res.status(200).json({
      success: true,
      user: {
        id: u.id, phoneNumber: u.phone_number, fullName: u.full_name,
        role: u.role, email: u.email, profileImage: u.profile_image_url,
        address: u.address, isVerified: u.is_verified,
        phoneVerified: u.phone_verified,
        createdAt: u.created_at, updatedAt: u.updated_at,
      },
    });
  } catch (error) {
    logger.error('Get profile error', { message: error.message });
    return res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
};

// ── Update Profile ────────────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fullName, email, address } = req.body;
    const updates = [], values = [];
    let p = 1;

    if (fullName !== undefined) {
      if (fullName.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters' });
      }
      updates.push(`full_name=$${p++}`); values.push(fullName.trim());
    }
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email format' });
      }
      updates.push(`email=$${p++}`); values.push(email || null);
    }
    if (address !== undefined) {
      updates.push(`address=$${p++}`); values.push(address || null);
    }
    if (!updates.length) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    updates.push('updated_at=NOW()');
    values.push(userId);

    const result = await query(
      `UPDATE users SET ${updates.join(',')}
       WHERE id=$${p} AND deleted_at IS NULL
       RETURNING id,phone_number,full_name,role,email,profile_image_url,address,is_verified,updated_at`,
      values
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const u = result.rows[0];
    logger.info('Profile updated', { userId });
    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: u.id, phoneNumber: u.phone_number, fullName: u.full_name,
        role: u.role, email: u.email, profileImage: u.profile_image_url,
        address: u.address, isVerified: u.is_verified, updatedAt: u.updated_at,
      },
    });
  } catch (error) {
    logger.error('Update profile error', { message: error.message });
    return res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// ── Refresh Token ─────────────────────────────────────────────────────────────
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }

    const decoded = authService.verifyToken(refreshToken, 'refresh');

    const sessionResult = await query(
      'SELECT * FROM sessions WHERE refresh_token=$1 AND expires_at > NOW()',
      [refreshToken]
    );
    if (!sessionResult.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const user = await authService.findUserById(decoded.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success:     true,
      isBlocked:   user.is_active === false,
      accessToken: authService.generateAccessToken(user.id, user.role),
    });
  } catch (error) {
    // FIX: was 500 for JWT errors; JWT errors should be 401
    logger.warn('Refresh token failed', { message: error.message });
    return res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
};

// ── Logout ────────────────────────────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    await authService.deleteUserSessions(req.user.userId);
    logger.info('User logged out', { userId: req.user.userId });
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error', { message: error.message });
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

module.exports = { sendOTP, verifyOTP, getProfile, updateProfile, refreshToken, logout };
