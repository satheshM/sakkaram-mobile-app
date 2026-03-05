/**
 * paymentService.js — Phase 2
 *
 * WHAT CHANGED vs original:
 *  1. initiateBookingPayment  — same as before but also saves cashfree_order_id on booking
 *  2. verifyAndCompletePayment— same as before but also auto-credits owner wallet
 *                               (original credited owner wallet already; we keep that + fix)
 *  3. initiateWalletTopup     — NEW: create Cashfree order for wallet top-up
 *  4. verifyWalletTopup       — NEW: verify topup payment and credit user wallet
 *  5. processBookingRefund    — same as original
 *  6. getPaymentDetails       — same as original
 */

const { query, pool } = require('../config/db');
const logger          = require('../config/logger');
const {
  createPaymentOrder,
  verifyPayment,
  processRefund,
  generateOrderId,
} = require('../config/cashfree');

// ─── 1. Initiate Booking Payment ──────────────────────────────────────────────

const initiateBookingPayment = async (bookingId, userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookingRes = await client.query(
      `SELECT b.id, b.booking_number, b.farmer_id, b.owner_id,
              b.total_farmer_pays, b.status, b.payment_status,
              u.phone_number, u.full_name
       FROM bookings b
       JOIN users u ON u.id = b.farmer_id
       WHERE b.id = $1 AND b.farmer_id = $2 AND b.deleted_at IS NULL`,
      [bookingId, userId]
    );

    if (!bookingRes.rows.length) throw new Error('Booking not found or unauthorized');

    const booking = bookingRes.rows[0];

    if (!['confirmed', 'completed'].includes(booking.status)) {
      throw new Error(`Booking must be confirmed or completed before payment. Current: ${booking.status}`);
    }
    if (booking.payment_status === 'paid') {
      throw new Error('Payment already completed for this booking');
    }

    const totalAmount = parseFloat(booking.total_farmer_pays) || 0;
    if (totalAmount <= 0) throw new Error('Invalid booking amount');

    const orderId = generateOrderId();

    // Create payment record
    const payRes = await client.query(
      `INSERT INTO payments
         (payment_id, booking_id, user_id, amount, currency,
          payment_method, payment_gateway, status, transaction_id,
          description, created_at)
       VALUES ($1,$2,$3,$4,'INR','cashfree_online','cashfree','pending',$5,$6,NOW())
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING id`,
      [orderId, bookingId, userId, totalAmount, orderId,
       `Booking #${booking.booking_number}`]
    );

    // Create Cashfree order
    const cfOrder = await createPaymentOrder({
      amount:        totalAmount,
      customerId:    userId,
      customerPhone: booking.phone_number,
      customerName:  booking.full_name,
      orderId,
      returnUrl: `${process.env.BACKEND_URL}/api/payments/return?bookingId=${bookingId}&orderId=${orderId}`,
    });

    // Save session id on payment record
    if (payRes.rows.length > 0) {
      await client.query(
        `UPDATE payments SET gateway_response=$1 WHERE id=$2`,
        [JSON.stringify(cfOrder), payRes.rows[0].id]
      );
    }

    // Save cashfree_order_id on booking for easy lookup
    await client.query(
      `UPDATE bookings SET cashfree_order_id=$1, updated_at=NOW() WHERE id=$2`,
      [orderId, bookingId]
    );

    await client.query('COMMIT');

    logger.info('Booking payment initiated', { bookingId, orderId, totalAmount });

    return {
      paymentSessionId: cfOrder.paymentSessionId,
      orderId:          cfOrder.orderId,
      orderToken:       cfOrder.orderToken,
      amount:           totalAmount,
      bookingId,
      bookingNumber:    booking.booking_number,
    };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('initiateBookingPayment error:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

// ─── 2. Verify & Complete Booking Payment ─────────────────────────────────────

const verifyAndCompletePayment = async (orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find payment record
    const payRes = await client.query(
      `SELECT p.*, b.owner_id, b.booking_number,
              b.base_amount, b.owner_commission, b.total_owner_receives
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE p.transaction_id = $1 OR p.payment_id = $1
       LIMIT 1`,
      [orderId]
    );

    if (!payRes.rows.length) throw new Error('Payment record not found');

    const payment = payRes.rows[0];

    // Idempotent
    if (['success', 'paid'].includes(payment.status)) {
      await client.query('ROLLBACK');
      return { success: true, status: 'ALREADY_PAID', bookingId: payment.booking_id };
    }

    // Verify with Cashfree
    const verification = await verifyPayment(orderId);

    if (!verification.success) {
      await client.query(
        `UPDATE payments SET status='failed', gateway_response=$1, updated_at=NOW()
         WHERE transaction_id=$2 OR payment_id=$2`,
        [JSON.stringify(verification), orderId]
      );
      await client.query('COMMIT');
      return { success: false, status: verification.status, message: 'Payment failed' };
    }

    // Mark payment success
    await client.query(
      `UPDATE payments SET status='success', payment_method=$1,
         gateway_response=$2, updated_at=NOW()
       WHERE transaction_id=$3 OR payment_id=$3`,
      [verification.paymentMethod || 'cashfree_online',
       JSON.stringify(verification), orderId]
    );

    // Mark booking paid
    await client.query(
      `UPDATE bookings
         SET payment_status='paid', payment_method='cashfree_online',
             cashfree_payment_id=$1, platform_fee_deducted=true, updated_at=NOW()
       WHERE id=$2`,
      [verification.paymentId, payment.booking_id]
    );

    // Credit owner wallet (total_owner_receives = base - commission)
    const ownerShare = parseFloat(payment.total_owner_receives) || 0;
    if (ownerShare > 0) {
      await _creditWallet(
        client, payment.owner_id, ownerShare, payment.booking_id,
        `Payment received for booking #${payment.booking_number}`, 'booking_credit'
      );
    }

    await client.query('COMMIT');

    logger.info('Booking payment verified & completed', {
      orderId, bookingId: payment.booking_id, ownerCredited: ownerShare
    });

    return {
      success:   true,
      status:    'SUCCESS',
      bookingId: payment.booking_id,
      amount:    payment.amount,
    };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('verifyAndCompletePayment error:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

// ─── 3. Initiate Wallet Top-up ────────────────────────────────────────────────

const initiateWalletTopup = async (userId, amount) => {
  const topupAmount = parseFloat(amount);
  if (!topupAmount || topupAmount < 10) throw new Error('Minimum top-up amount is ₹10');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      'SELECT id, full_name, phone_number FROM users WHERE id=$1', [userId]
    );
    if (!userRes.rows.length) throw new Error('User not found');
    const user = userRes.rows[0];

    const orderId = generateOrderId();

    const cfOrder = await createPaymentOrder({
      amount:        topupAmount,
      customerId:    userId,
      customerPhone: user.phone_number,
      customerName:  user.full_name,
      orderId,
      returnUrl: `${process.env.BACKEND_URL}/api/payments/topup-return?orderId=${orderId}`,
    });

    // Record topup order
    await client.query(
      `INSERT INTO wallet_topup_orders
         (user_id, cashfree_order_id, cashfree_session_id, amount, status, created_at)
       VALUES ($1,$2,$3,$4,'pending',NOW())
       ON CONFLICT (cashfree_order_id) DO NOTHING`,
      [userId, orderId, cfOrder.paymentSessionId, topupAmount]
    );

    await client.query('COMMIT');

    logger.info('Wallet topup initiated', { userId, orderId, topupAmount });

    return {
      paymentSessionId: cfOrder.paymentSessionId,
      orderId:          cfOrder.orderId,
      orderToken:       cfOrder.orderToken,
      amount:           topupAmount,
    };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('initiateWalletTopup error:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

// ─── 4. Verify Wallet Top-up ──────────────────────────────────────────────────

const verifyWalletTopup = async (orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const topupRes = await client.query(
      'SELECT * FROM wallet_topup_orders WHERE cashfree_order_id=$1', [orderId]
    );
    if (!topupRes.rows.length) throw new Error(`Topup order not found: ${orderId}`);

    const topup = topupRes.rows[0];

    // Idempotent
    if (topup.wallet_credited) {
      await client.query('ROLLBACK');
      return { success: true, status: 'ALREADY_CREDITED', amount: topup.amount };
    }

    const verification = await verifyPayment(orderId);

    if (!verification.success) {
      await client.query(
        `UPDATE wallet_topup_orders SET status='failed', updated_at=NOW()
         WHERE cashfree_order_id=$1`,
        [orderId]
      );
      await client.query('COMMIT');
      return { success: false, status: verification.status, message: 'Payment not successful' };
    }

    // Credit wallet
    await _creditWallet(
      client, topup.user_id, parseFloat(topup.amount), null,
      'Wallet top-up via Cashfree', 'topup'
    );

    // Mark credited
    await client.query(
      `UPDATE wallet_topup_orders
         SET status='success', wallet_credited=true, updated_at=NOW()
       WHERE cashfree_order_id=$1`,
      [orderId]
    );

    await client.query('COMMIT');

    logger.info('Wallet topup credited', { userId: topup.user_id, amount: topup.amount });

    return { success: true, status: 'SUCCESS', amount: topup.amount };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('verifyWalletTopup error:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

// ─── 5. Process Booking Refund (unchanged from original) ─────────────────────

const processBookingRefund = async (bookingId, userId, reason) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookingRes = await client.query(
      `SELECT b.*, p.transaction_id, p.amount as paid_amount, p.status as pay_status
       FROM bookings b
       LEFT JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
       WHERE b.id=$1 AND (b.farmer_id=$2 OR b.owner_id=$2) AND b.deleted_at IS NULL`,
      [bookingId, userId]
    );

    if (!bookingRes.rows.length) throw new Error('Booking not found or unauthorized');

    const booking = bookingRes.rows[0];
    if (booking.payment_status !== 'paid') throw new Error('Cannot refund unpaid booking');
    if (booking.status === 'completed')    throw new Error('Cannot refund completed booking');
    if (!booking.transaction_id)           throw new Error('No payment order found for this booking');

    const refundResult = await processRefund({
      orderId:      booking.transaction_id,
      refundAmount: booking.paid_amount,
      refundNote:   reason || 'Booking cancelled',
    });

    await client.query(
      `UPDATE bookings SET status='cancelled', payment_status='refunded', updated_at=NOW()
       WHERE id=$1`,
      [bookingId]
    );
    await client.query(
      `UPDATE payments SET status='refunded', updated_at=NOW() WHERE booking_id=$1`,
      [bookingId]
    );

    await client.query('COMMIT');
    return { success: true, ...refundResult };

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('processBookingRefund error:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

// ─── 6. Get Payment Details (unchanged from original) ────────────────────────

const getPaymentDetails = async (bookingId, userId) => {
  const result = await query(
    `SELECT p.*, b.status as booking_status, b.farmer_id, b.owner_id
     FROM payments p
     JOIN bookings b ON b.id = p.booking_id
     WHERE p.booking_id=$1 AND (b.farmer_id=$2 OR b.owner_id=$2)
     ORDER BY p.created_at DESC LIMIT 1`,
    [bookingId, userId]
  );
  return result.rows[0] || null;
};

// ─── Internal: Credit a wallet ────────────────────────────────────────────────

const _creditWallet = async (client, userId, amount, bookingId, description, refType) => {
  let walletRes = await client.query(
    'SELECT id, balance FROM wallets WHERE user_id=$1', [userId]
  );
  if (!walletRes.rows.length) {
    await client.query(
      'INSERT INTO wallets (user_id, balance) VALUES ($1,0) ON CONFLICT DO NOTHING', [userId]
    );
    walletRes = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id=$1', [userId]
    );
  }

  const wallet     = walletRes.rows[0];
  const oldBalance = parseFloat(wallet.balance) || 0;
  const newBalance = oldBalance + amount;

  await client.query(
    'UPDATE wallets SET balance=$1, updated_at=NOW() WHERE id=$2',
    [newBalance, wallet.id]
  );

  await client.query(
    `INSERT INTO wallet_transactions
       (wallet_id, transaction_type, amount, balance_before, balance_after,
        description, reference_type, reference_id, booking_id, created_at)
     VALUES ($1,'credit',$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [wallet.id, amount, oldBalance, newBalance,
     description, refType,
     bookingId || null, bookingId || null]
  );

  logger.info('Wallet credited', { userId, amount, newBalance, refType });
  return newBalance;
};

module.exports = {
  initiateBookingPayment,
  verifyAndCompletePayment,
  initiateWalletTopup,
  verifyWalletTopup,
  processBookingRefund,
  getPaymentDetails,
};
