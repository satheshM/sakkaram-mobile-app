const logger = require('./logger');
const axios  = require('axios');
const crypto = require('crypto');

// ── Use CASHFREE_ENV not NODE_ENV so test credentials work on Railway ─────────
const IS_PROD = process.env.CASHFREE_ENV === 'PROD';

const CASHFREE_CONFIG = {
  appId:      process.env.CASHFREE_APP_ID,
  secretKey:  process.env.CASHFREE_SECRET_KEY,
  apiVersion: '2023-08-01',
  baseURL:    IS_PROD
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg',
};

if (!CASHFREE_CONFIG.appId || !CASHFREE_CONFIG.secretKey) {
  logger.warn('Cashfree credentials not configured. Payment features will not work.');
}

logger.info(`Cashfree initialised — ${IS_PROD ? 'LIVE' : 'SANDBOX'} mode (${CASHFREE_CONFIG.baseURL})`);

const cashfreeAPI = axios.create({
  baseURL:  CASHFREE_CONFIG.baseURL,
  timeout:  15000,
  headers: {
    'x-client-id':     CASHFREE_CONFIG.appId,
    'x-client-secret': CASHFREE_CONFIG.secretKey,
    'x-api-version':   CASHFREE_CONFIG.apiVersion,
    'Content-Type':    'application/json',
  },
});

// ── Generate unique order ID ──────────────────────────────────────────────────
const generateOrderId = () => {
  const ts  = Date.now();
  const rnd = Math.floor(Math.random() * 10000);
  return `SAK_${ts}_${rnd}`;
};

// ── Create payment order ──────────────────────────────────────────────────────
const createPaymentOrder = async (orderData) => {
  const { amount, customerId, customerPhone, customerName, orderId, returnUrl } = orderData;

  // Cashfree requires phone in 10-digit format (no +91)
  const cleanPhone = String(customerPhone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10);

  const body = {
    order_id:       orderId || generateOrderId(),
    order_amount:   parseFloat(amount).toFixed(2),
    order_currency: 'INR',
    order_note:     'Sakkaram Payment',
    customer_details: {
      customer_id:    String(customerId).slice(0, 50),  // max 50 chars
      customer_phone: cleanPhone || '9999999999',
      customer_name:  (customerName || 'Sakkaram User').slice(0, 100),
    },
    order_meta: {
      return_url: returnUrl,
      notify_url: `${process.env.BACKEND_URL}/api/payments/webhook`,
    },
  };

  logger.info('Creating Cashfree order', { orderId: body.order_id, amount });

  try {
    const response = await cashfreeAPI.post('/orders', body);
    return {
      success:          true,
      orderId:          response.data.order_id,
      paymentSessionId: response.data.payment_session_id,
      orderStatus:      response.data.order_status,
      orderToken:       response.data.order_token,
    };
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    logger.error('Cashfree order creation failed', { error: error.response?.data || error.message });
    throw new Error(msg || 'Failed to create payment order');
  }
};

// ── Verify payment status ─────────────────────────────────────────────────────
const verifyPayment = async (orderId) => {
  logger.info('Verifying payment with Cashfree', { orderId });
  try {
    const response = await cashfreeAPI.get(`/orders/${orderId}/payments`);

    if (!response.data || response.data.length === 0) {
      return { success: false, status: 'NOT_FOUND', message: 'No payment found for this order' };
    }

    // Find the successful payment if multiple exist
    const payments = Array.isArray(response.data) ? response.data : [response.data];
    const successPay = payments.find(p => p.payment_status === 'SUCCESS');
    const payment    = successPay || payments[0];

    return {
      success:       payment.payment_status === 'SUCCESS',
      status:        payment.payment_status,
      paymentId:     payment.cf_payment_id,
      paymentMethod: payment.payment_group,
      amount:        payment.order_amount || payment.payment_amount,
      time:          payment.payment_time,
    };
  } catch (error) {
    logger.error('Payment verification failed', { orderId, error: error.response?.data || error.message });
    throw new Error('Failed to verify payment');
  }
};

// ── Process refund ────────────────────────────────────────────────────────────
const processRefund = async (refundData) => {
  const { orderId, refundAmount, refundId, refundNote } = refundData;
  try {
    const body = {
      refund_amount: parseFloat(refundAmount).toFixed(2),
      refund_id:     refundId || `REFUND_${Date.now()}`,
      refund_note:   refundNote || 'Booking cancelled',
    };
    logger.info('Processing refund', { orderId, refundAmount });
    const response = await cashfreeAPI.post(`/orders/${orderId}/refunds`, body);
    return {
      success:       true,
      refundId:      response.data.refund_id,
      refundStatus:  response.data.refund_status,
      refundAmount:  response.data.refund_amount,
    };
  } catch (error) {
    logger.error('Refund failed', { orderId, error: error.response?.data || error.message });
    throw new Error('Failed to process refund');
  }
};

// ── Verify webhook signature ──────────────────────────────────────────────────
// Cashfree sends: x-webhook-signature and x-webhook-timestamp
// Secret used here is CASHFREE_WEBHOOK_SECRET (from dashboard), NOT the API secret key
const verifyWebhookSignature = (signature, timestamp, rawBody) => {
  try {
    const secret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY;
    const data   = `${timestamp}${rawBody}`;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64');
    return signature === expected;
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
  CASHFREE_CONFIG,
};
