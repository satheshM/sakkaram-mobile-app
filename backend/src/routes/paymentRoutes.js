const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/payments/initiate
 * @desc    Initiate payment for booking
 * @access  Private (Farmer)
 */
router.post('/initiate', verifyToken, paymentController.initiatePayment);

/**
 * @route   GET /api/payments/verify/:orderId
 * @desc    Verify payment status
 * @access  Private
 */
router.get('/verify/:orderId', verifyToken, paymentController.verifyPaymentStatus);

/**
 * @route   POST /api/payments/callback
 * @desc    Handle payment callback from Cashfree
 * @access  Private
 */
router.post('/callback', verifyToken, paymentController.handlePaymentCallback);

/**
 * @route   POST /api/payments/webhook
 * @desc    Handle Cashfree webhook
 * @access  Public (but signature verified)
 */
router.post('/webhook', paymentController.handleWebhook);

/**
 * @route   POST /api/payments/refund
 * @desc    Initiate refund for cancelled booking
 * @access  Private (Farmer/Owner)
 */
router.post('/refund', verifyToken, paymentController.initiateRefund);

/**
 * @route   GET /api/payments/booking/:bookingId
 * @desc    Get payment details for a booking
 * @access  Private
 */
router.get('/booking/:bookingId', verifyToken, paymentController.getBookingPayment);

module.exports = router;