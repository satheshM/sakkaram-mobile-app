// Cashfree Payment Gateway Configuration
const logger = require('./logger');
const axios = require('axios');

// Cashfree configuration
const CASHFREE_CONFIG = {
  appId: process.env.CASHFREE_APP_ID,
  secretKey: process.env.CASHFREE_SECRET_KEY,
  apiVersion: '2023-08-01',
  baseURL: process.env.NODE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg'
};

// Validate configuration
if (!CASHFREE_CONFIG.appId || !CASHFREE_CONFIG.secretKey) {
  logger.warn('Cashfree credentials not configured. Payment features will not work.');
}

// Create axios instance for Cashfree API calls
const cashfreeAPI = axios.create({
  baseURL: CASHFREE_CONFIG.baseURL,
  headers: {
    'x-client-id': CASHFREE_CONFIG.appId,
    'x-client-secret': CASHFREE_CONFIG.secretKey,
    'x-api-version': CASHFREE_CONFIG.apiVersion,
    'Content-Type': 'application/json'
  }
});

/**
 * Generate unique order ID
 */
const generateOrderId = () => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `SAKKARAM_${timestamp}_${random}`;
};

/**
 * Create payment order
 * @param {Object} orderData - Order details
 * @returns {Promise<Object>} - Cashfree order response
 */
const createPaymentOrder = async (orderData) => {
  try {
    const { amount, customerId, customerPhone, customerName, orderId, returnUrl } = orderData;

    const requestBody = {
      order_amount: parseFloat(amount).toFixed(2),
      order_currency: 'INR',
      order_id: orderId || generateOrderId(),
      customer_details: {
        customer_id: customerId,
        customer_phone: customerPhone,
        customer_name: customerName
      },
      order_meta: {
        return_url: returnUrl || `${process.env.FRONTEND_URL}/payment/callback`,
        notify_url: `${process.env.BACKEND_URL}/api/payments/webhook`
      },
      order_note: 'Sakkaram Booking Payment'
    };

    logger.info('Creating Cashfree order', { orderId: requestBody.order_id, amount });

    const response = await cashfreeAPI.post('/orders', requestBody);
    
    return {
      success: true,
      orderId: response.data.order_id,
      paymentSessionId: response.data.payment_session_id,
      orderStatus: response.data.order_status,
      orderToken: response.data.order_token
    };
  } catch (error) {
    logger.error('Cashfree order creation failed', { 
      error: error.response?.data || error.message 
    });
    throw new Error(error.response?.data?.message || 'Failed to create payment order');
  }
};

/**
 * Verify payment status
 * @param {String} orderId - Cashfree order ID
 * @returns {Promise<Object>} - Payment status
 */
const verifyPayment = async (orderId) => {
  try {
    logger.info('Verifying payment with Cashfree', { orderId });

    const response = await cashfreeAPI.get(`/orders/${orderId}/payments`);
    
    if (!response.data || response.data.length === 0) {
      return {
        success: false,
        status: 'NOT_FOUND',
        message: 'No payment found for this order'
      };
    }

    const payment = response.data[0];
    
    return {
      success: payment.payment_status === 'SUCCESS',
      status: payment.payment_status,
      paymentId: payment.cf_payment_id,
      paymentMethod: payment.payment_group,
      amount: payment.payment_amount,
      time: payment.payment_time
    };
  } catch (error) {
    logger.error('Payment verification failed', { 
      orderId, 
      error: error.response?.data || error.message 
    });
    throw new Error('Failed to verify payment');
  }
};

/**
 * Process refund
 * @param {Object} refundData - Refund details
 * @returns {Promise<Object>} - Refund response
 */
const processRefund = async (refundData) => {
  try {
    const { orderId, refundAmount, refundId, refundNote } = refundData;

    const requestBody = {
      refund_amount: parseFloat(refundAmount).toFixed(2),
      refund_id: refundId || `REFUND_${Date.now()}`,
      refund_note: refundNote || 'Booking cancelled - refund initiated'
    };

    logger.info('Processing refund with Cashfree', { orderId, refundAmount });

    const response = await cashfreeAPI.post(`/orders/${orderId}/refunds`, requestBody);
    
    return {
      success: true,
      refundId: response.data.refund_id,
      refundStatus: response.data.refund_status,
      refundAmount: response.data.refund_amount
    };
  } catch (error) {
    logger.error('Refund processing failed', { 
      orderId,
      error: error.response?.data || error.message 
    });
    throw new Error('Failed to process refund');
  }
};

/**
 * Verify webhook signature
 * @param {String} signature - Webhook signature from header
 * @param {String} timestamp - Webhook timestamp from header
 * @param {String} body - Raw webhook body
 * @returns {Boolean} - Signature valid or not
 */
const verifyWebhookSignature = (signature, timestamp, body) => {
  try {
    const crypto = require('crypto');
    const signatureData = `${timestamp}${body}`;
    const expectedSignature = crypto
      .createHmac('sha256', CASHFREE_CONFIG.secretKey)
      .update(signatureData)
      .digest('base64');

    return signature === expectedSignature;
  } catch (error) {
    logger.error('Webhook signature verification failed', { error: error.message });
    return false;
  }
};

module.exports = {
  generateOrderId,
  createPaymentOrder,
  verifyPayment,
  processRefund,
  verifyWebhookSignature,
  CASHFREE_CONFIG
};