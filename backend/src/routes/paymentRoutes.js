const express = require('express');
const router  = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

// ── Original routes (kept exactly) ───────────────────────────────────────────

router.post('/initiate',         verifyToken,                      paymentController.initiatePayment);
router.get('/verify/:orderId',   verifyToken,                      paymentController.verifyPaymentStatus);
router.post('/callback',         verifyToken,                      paymentController.handlePaymentCallback);
router.post('/webhook',                                             paymentController.handleWebhook);
router.post('/refund',           verifyToken,                      paymentController.initiateRefund);
router.get('/booking/:bookingId',verifyToken,                      paymentController.getBookingPayment);
router.post('/wallet-payment',   verifyToken, checkRole('farmer'), paymentController.walletPayment);

// ── NEW: Cashfree wallet top-up routes ───────────────────────────────────────

// Farmer/Owner: create Cashfree order to top up in-app wallet
router.post('/wallet-topup',          verifyToken, paymentController.initiateTopup);

// Poll payment status after Cashfree sheet closes
router.get('/verify-topup/:orderId',  verifyToken, paymentController.verifyTopup);

// Browser redirect after Cashfree web payment (called by Cashfree, no auth needed)
router.get('/topup-return',                        paymentController.handleTopupReturn);

module.exports = router;
