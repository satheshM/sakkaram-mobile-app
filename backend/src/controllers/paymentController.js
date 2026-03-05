/**
 * paymentController.js — Phase 2
 *
 * WHAT CHANGED vs original:
 *  - All original functions kept exactly (initiatePayment, verifyPaymentStatus,
 *    handlePaymentCallback, handleWebhook, initiateRefund, getBookingPayment, walletPayment)
 *  - handleWebhook: now also handles wallet_topup_orders via webhook
 *  - NEW: initiateTopup    — POST /api/payments/wallet-topup
 *  - NEW: verifyTopup      — GET  /api/payments/verify-topup/:orderId
 *  - NEW: handleTopupReturn— GET  /api/payments/topup-return  (browser redirect)
 */

const {
  initiateBookingPayment,
  verifyAndCompletePayment,
  initiateWalletTopup,
  verifyWalletTopup,
  processBookingRefund,
  getPaymentDetails,
} = require('../services/paymentService');
const { verifyWebhookSignature } = require('../config/cashfree');
const { query, pool }            = require('../config/db');
const logger                     = require('../config/logger');

// ── Original: Initiate booking payment ───────────────────────────────────────

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
      data:    result,
    });

  } catch (error) {
    logger.error('Initiate payment error', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to initiate payment' });
  }
};

// ── Original: Verify booking payment status (polling) ────────────────────────

const verifyPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required' });

    const result = await verifyAndCompletePayment(orderId);
    res.status(200).json(result);

  } catch (error) {
    logger.error('Verify payment error', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to verify payment' });
  }
};

// ── Original: Frontend callback after payment sheet closes ───────────────────

const handlePaymentCallback = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required' });

    const result = await verifyAndCompletePayment(orderId);

    res.status(200).json({
      success:   result.success,
      status:    result.status,
      message:   result.message,
      bookingId: result.bookingId,
    });

  } catch (error) {
    logger.error('Payment callback error', { error: error.message });
    res.status(500).json({ success: false, message: 'Payment callback failed' });
  }
};

// ── Updated: Cashfree webhook — now handles topup orders too ─────────────────

const handleWebhook = async (req, res) => {
  // Always respond 200 first so Cashfree doesn't retry
  res.status(200).json({ success: true, message: 'Webhook received' });

  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (signature && timestamp) {
      const rawBody  = JSON.stringify(req.body);
      const isValid  = verifyWebhookSignature(signature, timestamp, rawBody);
      if (!isValid) {
        logger.warn('Webhook signature invalid — ignoring');
        return;
      }
    } else {
      logger.warn('Webhook missing signature headers — processing anyway (dev/sandbox)');
    }

    const { type, data } = req.body;
    const orderId = data?.order?.order_id;
    logger.info('Cashfree webhook received', { type, orderId });

    switch (type) {
      case 'PAYMENT_SUCCESS_WEBHOOK': {
        if (!orderId) break;
        // Check if this is a wallet topup or booking payment
        const topupCheck = await query(
          'SELECT id FROM wallet_topup_orders WHERE cashfree_order_id=$1', [orderId]
        );
        if (topupCheck.rows.length > 0) {
          await verifyWalletTopup(orderId);
          logger.info('Wallet topup completed via webhook', { orderId });
        } else {
          await verifyAndCompletePayment(orderId);
          logger.info('Booking payment completed via webhook', { orderId });
        }
        break;
      }
      case 'PAYMENT_FAILED_WEBHOOK': {
        logger.warn('Payment failed webhook', { orderId });
        if (orderId) {
          await query(
            `UPDATE payments SET status='failed', updated_at=NOW()
             WHERE transaction_id=$1 OR payment_id=$1`,
            [orderId]
          ).catch(() => {});
          await query(
            `UPDATE wallet_topup_orders SET status='failed', updated_at=NOW()
             WHERE cashfree_order_id=$1`,
            [orderId]
          ).catch(() => {});
        }
        break;
      }
      case 'REFUND_STATUS_WEBHOOK': {
        logger.info('Refund status webhook', {
          orderId, refundStatus: data?.refund?.refund_status
        });
        break;
      }
      default:
        logger.info('Unhandled webhook type', { type });
    }

  } catch (error) {
    logger.error('Webhook processing error', { error: error.message });
  }
};

// ── Original: Refund ──────────────────────────────────────────────────────────

const initiateRefund = async (req, res) => {
  try {
    const { bookingId, reason } = req.body;
    const userId = req.user.userId;

    if (!bookingId) return res.status(400).json({ success: false, message: 'Booking ID is required' });

    const result = await processBookingRefund(bookingId, userId, reason);
    res.status(200).json({ success: true, message: 'Refund initiated successfully', data: result });

  } catch (error) {
    logger.error('Refund initiation error', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to initiate refund' });
  }
};

// ── Original: Get payment details ────────────────────────────────────────────

const getBookingPayment = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.userId;

    const payment = await getPaymentDetails(bookingId, userId);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

    res.status(200).json({ success: true, data: payment });

  } catch (error) {
    logger.error('Get payment error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to fetch payment details' });
  }
};

// ── Original: Wallet payment (BUG 12 FIX — kept from original) ───────────────

const walletPayment = async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    const userId = req.user.userId;

    if (!bookingId || !amount) {
      return res.status(400).json({ success: false, message: 'Booking ID and amount are required' });
    }

    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id=$1 AND farmer_id=$2 AND deleted_at IS NULL',
      [bookingId, userId]
    );
    if (!bookingResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const booking = bookingResult.rows[0];

    if (booking.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Payment can only be made after work is completed' });
    }
    if (booking.payment_status === 'paid') {
      return res.status(400).json({ success: false, message: 'Booking is already paid' });
    }

    const walletResult = await query(
      'SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]
    );
    if (!walletResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }
    const wallet    = walletResult.rows[0];
    const payAmount = parseFloat(amount);

    if (parseFloat(wallet.balance) < payAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ₹${wallet.balance}, Required: ₹${payAmount}`
      });
    }

    // Deduct from wallet
    await query(
      'UPDATE wallets SET balance = balance - $1, updated_at=NOW() WHERE user_id=$2',
      [payAmount, userId]
    );

    // Record transaction
    await query(
      `INSERT INTO wallet_transactions
         (wallet_id, transaction_type, amount, balance_before, balance_after,
          description, reference_type, booking_id, created_at)
       VALUES ($1,'debit',$2,$3,$4,$5,'booking_payment',$6,NOW())`,
      [wallet.id, payAmount,
       parseFloat(wallet.balance),
       parseFloat(wallet.balance) - payAmount,
       `Payment for booking #${booking.booking_number}`,
       bookingId]
    );

    // Mark booking paid
    await query(
      `UPDATE bookings SET payment_status='paid', payment_method='wallet',
         platform_fee_deducted=true, updated_at=NOW() WHERE id=$1`,
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

// ── NEW: Initiate wallet top-up via Cashfree ──────────────────────────────────

const initiateTopup = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.userId;

    if (!amount || parseFloat(amount) < 10) {
      return res.status(400).json({ success: false, message: 'Minimum top-up amount is ₹10' });
    }

    const result = await initiateWalletTopup(userId, parseFloat(amount));

    res.status(200).json({
      success: true,
      message: 'Top-up order created',
      data:    result,  // { paymentSessionId, orderId, orderToken, amount }
    });

  } catch (error) {
    logger.error('Initiate topup error:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to initiate top-up' });
  }
};

// ── NEW: Verify wallet top-up (polling from app) ──────────────────────────────

const verifyTopup = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ success: false, message: 'Order ID is required' });

    const result = await verifyWalletTopup(orderId);
    res.status(200).json(result);

  } catch (error) {
    logger.error('Verify topup error:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Verification failed' });
  }
};

// ── NEW: Browser return URL after wallet topup (redirect handler) ─────────────

const handleTopupReturn = async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.redirect(`${process.env.FRONTEND_URL || 'sakkaram://'}/wallet?topup=error`);

    const result = await verifyWalletTopup(orderId);

    if (result.success) {
      return res.redirect(`${process.env.FRONTEND_URL || 'sakkaram://'}/wallet?topup=success&amount=${result.amount}`);
    }
    return res.redirect(`${process.env.FRONTEND_URL || 'sakkaram://'}/wallet?topup=failed`);

  } catch (err) {
    logger.error('handleTopupReturn error:', err.message);
    res.redirect(`${process.env.FRONTEND_URL || 'sakkaram://'}/wallet?topup=error`);
  }
};

module.exports = {
  // Original
  initiatePayment,
  verifyPaymentStatus,
  handlePaymentCallback,
  handleWebhook,
  initiateRefund,
  getBookingPayment,
  walletPayment,
  // New
  initiateTopup,
  verifyTopup,
  handleTopupReturn,
};
