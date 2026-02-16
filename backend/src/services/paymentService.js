// Payment Service - Business logic for payment operations
const { query, pool } = require('../config/db');
const logger = require('../config/logger');
const { 
  createPaymentOrder, 
  verifyPayment, 
  processRefund,
  generateOrderId 
} = require('../config/cashfree');

/**
 * Initiate payment for booking
 * @param {String} bookingId - Booking UUID
 * @param {String} userId - User UUID
 * @returns {Promise<Object>} - Payment order details
 */
const initiateBookingPayment = async (bookingId, userId) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Get booking details with CORRECT column names
    const bookingQuery = `
      SELECT 
        b.id, b.farmer_id, b.owner_id, 
        b.total_farmer_pays,
        b.farmer_service_fee, 
        b.status, 
        b.payment_status,
        u.phone_number, u.full_name
      FROM bookings b
      JOIN users u ON u.id = b.farmer_id
      WHERE b.id = $1 AND b.farmer_id = $2 AND b.deleted_at IS NULL
    `;
    
    const bookingResult = await client.query(bookingQuery, [bookingId, userId]);
    
    if (bookingResult.rows.length === 0) {
      throw new Error('Booking not found or unauthorized');
    }

    const booking = bookingResult.rows[0];

    // Validate booking status
    if (booking.status !== 'confirmed' && booking.status !== 'completed') {
      throw new Error(`Booking must be confirmed or completed before payment. Current status: ${booking.status}`);
    }

    if (booking.payment_status === 'paid') {
      throw new Error('Payment already completed for this booking');
    }

    // Calculate total amount farmer needs to pay
    const totalAmount = parseFloat(booking.total_farmer_pays) || 0;

    if (totalAmount <= 0) {
      throw new Error('Invalid booking amount');
    }

    // Generate order ID
    const orderId = generateOrderId();

   // Create payment record in database
    const paymentQuery = `
      INSERT INTO payments (
        payment_id,
        booking_id, 
        user_id, 
        amount,
        currency,
        payment_method,
        payment_gateway,
        status,
        transaction_id,
        description,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING id
    `;

    const paymentResult = await client.query(paymentQuery, [
      orderId, // payment_id
      bookingId,
      userId,
      totalAmount,
      'INR',
      'cashfree_online',
      'cashfree',
      'pending',
      orderId, // transaction_id (same as payment_id for now)
      `Payment for booking ${bookingId}`
    ]);


    const paymentId = paymentResult.rows[0].id;

    // Create Cashfree order
    const cashfreeOrder = await createPaymentOrder({
      amount: totalAmount,
      customerId: userId,
      customerPhone: booking.phone_number,
      customerName: booking.full_name,
      orderId: orderId,
      returnUrl: `${process.env.FRONTEND_URL}/booking/${bookingId}/payment-status`
    });

   // Update payment with Cashfree details
    await client.query(
      `UPDATE payments 
       SET gateway_response = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(cashfreeOrder), paymentId]
    );

    await client.query('COMMIT');

    logger.info('Payment initiated successfully', { 
      bookingId, 
      orderId, 
      amount: totalAmount 
    });

    return {
      paymentId,
      orderId: cashfreeOrder.orderId,
      paymentSessionId: cashfreeOrder.paymentSessionId,
      orderToken: cashfreeOrder.orderToken,
      amount: totalAmount,
      bookingId
    };

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Payment initiation failed', { 
      bookingId, 
      userId, 
      error: error.message 
    });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Verify and complete payment
 * @param {String} orderId - Cashfree order ID
 * @returns {Promise<Object>} - Payment verification result
 */
const verifyAndCompletePayment = async (orderId) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

   // Get payment record
    const paymentQuery = `
      SELECT p.*, b.owner_id, b.base_amount, b.owner_commission
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.transaction_id = $1
    `;
    
    const paymentResult = await client.query(paymentQuery, [orderId]);
    
    if (paymentResult.rows.length === 0) {
      throw new Error('Payment record not found');
    }

    const payment = paymentResult.rows[0];

    // Check if already completed
    if (payment.status === 'success' || payment.status === 'paid') {
      logger.info('Payment already completed', { orderId });
      return {
        success: true,
        status: 'ALREADY_PAID',
        message: 'Payment already completed',
        bookingId: payment.booking_id
      };
    }

    // Verify payment with Cashfree
    const verification = await verifyPayment(orderId);

    if (!verification.success) {
      // Update payment as failed
      await client.query(
        `UPDATE payments 
         SET status = $1, 
             gateway_response = $2,
             updated_at = NOW()
         WHERE transaction_id = $3`,
        ['failed', JSON.stringify(verification), orderId]
      );

      await client.query('COMMIT');

      return {
        success: false,
        status: verification.status,
        message: 'Payment verification failed'
      };
    }

    // Payment successful - update payment record
    await client.query(
      `UPDATE payments 
       SET status = $1,
           payment_method = $2,
           gateway_response = $3,
           updated_at = NOW()
       WHERE transaction_id = $4`,
      [
        'success',
        verification.paymentMethod || 'cashfree_online',
        JSON.stringify(verification),
        orderId
      ]
    );

    // Update booking payment status
    await client.query(
      `UPDATE bookings 
       SET payment_status = $1,
           payment_method = $2,
           updated_at = NOW()
       WHERE id = $3`,
      ['paid', 'online', payment.booking_id]
    );

   // Credit owner wallet (base amount - commission)
    const ownerAmount = parseFloat(payment.base_amount || 0) - parseFloat(payment.owner_commission || 0);
    
    if (ownerAmount > 0) {
      // Get wallet
      const walletResult = await client.query(
        'SELECT id, balance FROM wallets WHERE user_id = $1',
        [payment.owner_id]
      );

      if (walletResult.rows.length > 0) {
        const wallet = walletResult.rows[0];
        const oldBalance = parseFloat(wallet.balance);
        const newBalance = oldBalance + ownerAmount;

        // Update wallet balance
        await client.query(
          `UPDATE wallets 
           SET balance = $1, updated_at = NOW()
           WHERE user_id = $2`,
          [newBalance, payment.owner_id]
        );

        // Record wallet transaction with new columns
        await client.query(
          `INSERT INTO wallet_transactions (
            wallet_id, 
            transaction_type,
            amount,
            balance_before,
            balance_after,
            description, 
            reference_type, 
            reference_id,
            booking_id,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            wallet.id,
            'credit',
            ownerAmount,
            oldBalance,
            newBalance,
            'Payment received for booking',
            'booking',
            payment.booking_id,
            payment.booking_id
          ]
        );

        logger.info('Owner wallet credited', { 
          ownerId: payment.owner_id, 
          amount: ownerAmount,
          oldBalance,
          newBalance
        });
      } else {
    logger.warn('Owner wallet not found', { ownerId: payment.owner_id });
  }
    }

    await client.query('COMMIT');

    logger.info('Payment completed successfully', { 
      orderId, 
      bookingId: payment.booking_id 
    });

    return {
      success: true,
      status: 'SUCCESS',
      message: 'Payment completed successfully',
      bookingId: payment.booking_id,
      amount: payment.amount
    };

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Payment verification failed', { 
      orderId, 
      error: error.message 
    });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Process refund for booking
 * @param {String} bookingId - Booking UUID
 * @param {String} userId - User UUID
 * @param {String} reason - Refund reason
 * @returns {Promise<Object>} - Refund result
 */
const processBookingRefund = async (bookingId, userId, reason) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Get booking and payment details
    const bookingQuery = `
      SELECT b.*, p.transaction_id, p.amount, p.status as payment_status
      FROM bookings b
      LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.id = $1 AND (b.farmer_id = $2 OR b.owner_id = $2)
      AND b.deleted_at IS NULL
    `;
    
    const bookingResult = await client.query(bookingQuery, [bookingId, userId]);
    
    if (bookingResult.rows.length === 0) {
      throw new Error('Booking not found or unauthorized');
    }

    const booking = bookingResult.rows[0];

    // Validate refund eligibility
    if (booking.payment_status !== 'paid') {
      throw new Error('Cannot refund unpaid booking');
    }

    if (booking.status === 'completed') {
      throw new Error('Cannot refund completed booking');
    }

    // Process refund with Cashfree
    const refundResult = await processRefund({
      orderId: booking.transaction_id,
      refundAmount: booking.amount,
      refundNote: reason || 'Booking cancelled'
    });

    // Update booking status
    await client.query(
      `UPDATE bookings 
       SET status = $1,
           payment_status = $2, 
           updated_at = NOW()
       WHERE id = $3`,
      ['cancelled', 'refunded', bookingId]
    );

    // Update payment status
    await client.query(
      `UPDATE payments 
       SET status = $1, updated_at = NOW()
       WHERE booking_id = $2`,
      ['refunded', bookingId]
    );

    await client.query('COMMIT');

    logger.info('Refund processed successfully', { 
      bookingId, 
      refundId: refundResult.refundId 
    });

    return {
      success: true,
      refundId: refundResult.refundId,
      refundStatus: refundResult.refundStatus,
      amount: refundResult.refundAmount
    };

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Refund processing failed', { 
      bookingId, 
      userId, 
      error: error.message 
    });
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get payment details for booking
 * @param {String} bookingId - Booking UUID
 * @param {String} userId - User UUID
 * @returns {Promise<Object>} - Payment details
 */
const getPaymentDetails = async (bookingId, userId) => {
  try {
    const paymentQuery = `
      SELECT p.*, b.status as booking_status, b.farmer_id, b.owner_id
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.booking_id = $1 AND (b.farmer_id = $2 OR b.owner_id = $2)
      ORDER BY p.created_at DESC
      LIMIT 1
    `;
    
    const result = await query(paymentQuery, [bookingId, userId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];

  } catch (error) {
    logger.error('Get payment details failed', { 
      bookingId, 
      userId, 
      error: error.message 
    });
    throw error;
  }
};

module.exports = {
  initiateBookingPayment,
  verifyAndCompletePayment,
  processBookingRefund,
  getPaymentDetails
};