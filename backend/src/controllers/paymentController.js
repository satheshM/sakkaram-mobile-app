// Payment Controller - HTTP request handlers
const {
  initiateBookingPayment,
  verifyAndCompletePayment,
  processBookingRefund,
  getPaymentDetails
} = require('../services/paymentService');
const { verifyWebhookSignature } = require('../config/cashfree');
const logger = require('../config/logger');

/**
 * Initiate payment for a booking
 * POST /api/payments/initiate
 */
const initiatePayment = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const userId = req.user.userId;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    const result = await initiateBookingPayment(bookingId, userId);

    res.status(200).json({
      success: true,
      message: 'Payment initiated successfully',
      data: result
    });

  } catch (error) {
    logger.error('Initiate payment error', { error: error.message });
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate payment'
    });
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
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    const result = await verifyAndCompletePayment(orderId);

    res.status(200).json(result);

  } catch (error) {
    logger.error('Verify payment error', { error: error.message });
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to verify payment'
    });
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
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    // Verify payment
    const result = await verifyAndCompletePayment(orderId);

    // Send JSON response instead of redirect (for API usage)
    res.status(200).json({
      success: result.success,
      status: result.status,
      message: result.message,
      bookingId: result.bookingId
    });

  } catch (error) {
    logger.error('Payment callback error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Payment callback failed'
    });
  }
};

/**
 * Handle Cashfree webhook
 * POST /api/payments/webhook
 */
const handleWebhook = async (req, res) => {
  try {
    // Get signature from headers
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (!signature || !timestamp) {
      logger.warn('Webhook missing signature or timestamp');
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook request'
      });
    }

    // Get raw body
    const rawBody = JSON.stringify(req.body);

    // Verify webhook signature
    const isValid = verifyWebhookSignature(signature, timestamp, rawBody);

    if (!isValid) {
      logger.warn('Webhook signature verification failed');
      return res.status(401).json({
        success: false,
        message: 'Invalid signature'
      });
    }

    // Process webhook event
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
        logger.info('Refund status webhook', { 
          orderId: data.order.order_id,
          status: data.refund?.refund_status
        });
        break;

      default:
        logger.info('Unhandled webhook type', { type });
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).json({
      success: true,
      message: 'Webhook processed'
    });

  } catch (error) {
    logger.error('Webhook processing error', { error: error.message });
    // Still respond 200 to prevent retries for our errors
    res.status(200).json({
      success: false,
      message: 'Webhook processing failed'
    });
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
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    const result = await processBookingRefund(bookingId, userId, reason);

    res.status(200).json({
      success: true,
      message: 'Refund initiated successfully',
      data: result
    });

  } catch (error) {
    logger.error('Refund initiation error', { error: error.message });
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate refund'
    });
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
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: payment
    });

  } catch (error) {
    logger.error('Get payment error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details'
    });
  }
};

module.exports = {
  initiatePayment,
  verifyPaymentStatus,
  handlePaymentCallback,
  handleWebhook,
  initiateRefund,
  getBookingPayment
};