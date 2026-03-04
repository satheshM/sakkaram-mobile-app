const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP to phone number
 * @access  Public
 */
router.post('/send-otp', authController.sendOTP);

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP and login/signup
 * @access  Public
 */
router.post('/verify-otp', authController.verifyOTP);

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Refresh access token
 * @access  Public
 */
router.post('/refresh-token', authController.refreshToken);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', verifyToken, authController.logout);

/**
 * ✅ FIX: Profile routes were MISSING — caused "Route not found" 404 on profile save
 *
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', verifyToken, authController.getProfile);

/**
 * @route   PUT /api/auth/profile
 * @desc    Update current user profile (name, email, address)
 * @access  Private
 */
router.put('/profile', verifyToken, authController.updateProfile);

module.exports = router;
