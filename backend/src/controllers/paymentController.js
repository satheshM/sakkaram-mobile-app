// Payment Controller - HTTP request handlers
const {
  initiateBookingPayment,
  verifyAndCompletePayment,
  processBookingRefund,
  getPaymentDetails
} = require('../services/paymentService');
const { verifyWebhookSignature } = require('../config/cashfree');
const { query } = require('../config/db');
const logger = require('../config/logger');

/**
 * BUG 12 FIX: walletPayment() added.
 * The frontend calls POST /api/payments/wallet-payment when farmer pays
 * from their wallet balance in the payment modal.
 */

/**
 * Initiate payment for a booking
 * POST /api/payments/initiate
 */
const initiatePayment = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const userId = req.user.userId;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Booking ID is required' });
    }

    const result = await initiateBookingPayment(bookingId, userId);

    res.status(200).json({
      success: true,
      message: 'Payment initiated successfully',
      data: result
    });

  } catch (error) {
    logger.error('Initiate payment error', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to initiate payment' });
  }
};

/**
 * Verify payment status
 * GET /api/payments/verify/:orderId
 */
const verifyPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    const result = await verifyAndCompletePayment(orderId);
    res.status(200).json(result);

  } catch (error) {
    logger.error('Verify payment error', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to verify payment' });
  }
};

/**
 * Handle payment callback from frontend
 * POST /api/payments/callback
 */
const handlePaymentCallback = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    const result = await verifyAndCompletePayment(orderId);

    res.status(200).json({
      success:   result.success,
      status:    result.status,
      message:   result.message,
      bookingId: result.bookingId
    });

  } catch (error) {
    logger.error('Payment callback error', { error: error.message });
    res.status(500).json({ success: false, message: 'Payment callback failed' });
  }
};

/**
 * Handle Cashfree webhook
 * POST /api/payments/webhook
 */
const handleWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (!signature || !timestamp) {
      logger.warn('Webhook missing signature or timestamp');
      return res.status(400).json({ success: false, message: 'Invalid webhook request' });
    }

    const rawBody = JSON.stringify(req.body);
    const isValid = verifyWebhookSignature(signature, timestamp, rawBody);

    if (!isValid) {
      logger.warn('Webhook signature verification failed');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const { type, data } = req.body;
    logger.info('Webhook received', { type, orderId: data?.order?.order_id });

    switch (type) {
      case 'PAYMENT_SUCCESS_WEBHOOK':
        await verifyAndCompletePayment(data.order.order_id);
        break;
      case 'PAYMENT_FAILED_WEBHOOK':
        logger.warn('Payment failed webhook', { orderId: data.order.order_id });
        break;
      case 'REFUND_STATUS_WEBHOOK':
        logger.info('Refund status webhook', { orderId: data.order.order_id, status: data.refund?.refund_status });
        break;
      default:
        logger.info('Unhandled webhook type', { type });
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });

  } catch (error) {
    logger.error('Webhook processing error', { error: error.message });
    res.status(200).json({ success: false, message: 'Webhook processing failed' });
  }
};

/**
 * Initiate refund
 * POST /api/payments/refund
 */
const initiateRefund = async (req, res) => {
  try {
    const { bookingId, reason } = req.body;
    const userId = req.user.userId;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Booking ID is required' });
    }

    const result = await processBookingRefund(bookingId, userId, reason);

    res.status(200).json({ success: true, message: 'Refund initiated successfully', data: result });

  } catch (error) {
    logger.error('Refund initiation error', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to initiate refund' });
  }
};

/**
 * Get payment details for a booking
 * GET /api/payments/booking/:bookingId
 */
const getBookingPayment = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.userId;

    const payment = await getPaymentDetails(bookingId, userId);

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.status(200).json({ success: true, data: payment });

  } catch (error) {
    logger.error('Get payment error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to fetch payment details' });
  }
};

/**
 * Pay booking from wallet balance
 * POST /api/payments/wallet-payment
 *
 * BUG 12 FIX: This endpoint was missing. Frontend calls it when farmer
 * selects "Pay from Wallet" in the payment modal after work is completed.
 */
const walletPayment = async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    const userId = req.user.userId;

    if (!bookingId || !amount) {
      return res.status(400).json({ success: false, message: 'Booking ID and amount are required' });
    }

    // Verify booking belongs to this farmer and is completed
    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id = $1 AND farmer_id = $2 AND deleted_at IS NULL',
      [bookingId, userId]
    );
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = bookingResult.rows[0];
    if (booking.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Payment can only be made after work is completed' });
    }
    if (booking.payment_status === 'paid') {
      return res.status(400).json({ success: false, message: 'Booking is already paid' });
    }

    // Get wallet with row-level lock to prevent race conditions
    const walletResult = await query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (walletResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }
    const wallet    = walletResult.rows[0];
    const payAmount = parseFloat(amount);

    if (parseFloat(wallet.balance) < payAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Available: ₹${wallet.balance}, Required: ₹${payAmount}`
      });
    }

    // Deduct from wallet
    await query(
      'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
      [payAmount, userId]
    );

    // Record wallet transaction
    await query(
      `INSERT INTO wallet_transactions (wallet_id, transaction_type, amount, description, reference_id, created_at)
       VALUES ($1, 'debit', $2, $3, $4, NOW())`,
      [wallet.id, payAmount, `Payment for booking #${booking.booking_number}`, booking.id]
    );

    // Mark booking as paid
    await query(
      `UPDATE bookings SET payment_status = 'paid', payment_method = 'wallet', updated_at = NOW() WHERE id = $1`,
      [bookingId]
    );

    logger.info('Wallet payment completed', { bookingId, userId, amount: payAmount });

    res.status(200).json({
      success:    true,
      message:    'Payment successful',
      amountPaid: payAmount,
      newBalance: parseFloat(wallet.balance) - payAmount,
    });

  } catch (error) {
    logger.error('Wallet payment error:', error);
    res.status(500).json({ success: false, message: 'Wallet payment failed' });
  }
};

module.exports = {
  initiatePayment,
  verifyPaymentStatus,
  handlePaymentCallback,
  handleWebhook,
  initiateRefund,
  getBookingPayment,
  walletPayment,   // BUG 12 FIX
};
