const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Notification Types
 */
const NOTIFICATION_TYPES = {
  BOOKING_NEW: 'booking_new',
  BOOKING_ACCEPTED: 'booking_accepted',
  BOOKING_REJECTED: 'booking_rejected',
  BOOKING_STARTED: 'booking_started',
  BOOKING_COMPLETED: 'booking_completed',
  BOOKING_CANCELLED: 'booking_cancelled',
  PAYMENT_RECEIVED: 'payment_received',
  PAYMENT_SENT: 'payment_sent',
  REVIEW_RECEIVED: 'review_received',
  WALLET_LOW_BALANCE: 'wallet_low_balance',
  WALLET_CREDITED: 'wallet_credited',
  WALLET_DEBITED: 'wallet_debited',
  SYSTEM_ANNOUNCEMENT: 'system_announcement'
};

/**
 * Create a notification
 */
const createNotification = async (userId, type, title, message, referenceType = null, referenceId = null) => {
  try {
    const result = await pool.query(
      `INSERT INTO notifications (
        user_id,
        type,
        title,
        message,
        reference_type,
        reference_id,
        is_read,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
      RETURNING *`,
      [userId, type, title, message, referenceType, referenceId]
    );

    logger.info('Notification created', {
      notificationId: result.rows[0].id,
      userId,
      type
    });

    return result.rows[0];

  } catch (error) {
    logger.error('Create notification error:', error);
    throw error;
  }
};

/**
 * Get user notifications
 */
const getUserNotifications = async (userId, page = 1, limit = 20, unreadOnly = false) => {
  try {
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT * FROM notifications 
      WHERE user_id = $1
    `;
    
    const params = [userId];
    
    if (unreadOnly) {
      query += ` AND is_read = false`;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    params.push(limit, offset);
    
    const notifications = await pool.query(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM notifications WHERE user_id = $1';
    const countParams = [userId];
    
    if (unreadOnly) {
      countQuery += ' AND is_read = false';
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);
    
    return {
      notifications: notifications.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalNotifications: totalCount,
        limit: parseInt(limit)
      }
    };

  } catch (error) {
    logger.error('Get notifications error:', error);
    throw error;
  }
};

/**
 * Get unread count
 */
const getUnreadCount = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    );
    
    return parseInt(result.rows[0].count);

  } catch (error) {
    logger.error('Get unread count error:', error);
    throw error;
  }
};

/**
 * Mark notification as read
 */
const markAsRead = async (notificationId, userId) => {
  try {
    const result = await pool.query(
      `UPDATE notifications 
       SET is_read = true, read_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Notification not found');
    }

    return result.rows[0];

  } catch (error) {
    logger.error('Mark as read error:', error);
    throw error;
  }
};

/**
 * Mark all notifications as read
 */
const markAllAsRead = async (userId) => {
  try {
    const result = await pool.query(
      `UPDATE notifications 
       SET is_read = true, read_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND is_read = false
       RETURNING id`,
      [userId]
    );

    logger.info('Marked all as read', {
      userId,
      count: result.rowCount
    });

    return result.rowCount;

  } catch (error) {
    logger.error('Mark all as read error:', error);
    throw error;
  }
};

/**
 * Delete notification
 */
const deleteNotification = async (notificationId, userId) => {
  try {
    const result = await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Notification not found');
    }

    return true;

  } catch (error) {
    logger.error('Delete notification error:', error);
    throw error;
  }
};

/**
 * Delete all read notifications
 */
const deleteAllRead = async (userId) => {
  try {
    const result = await pool.query(
      'DELETE FROM notifications WHERE user_id = $1 AND is_read = true RETURNING id',
      [userId]
    );

    return result.rowCount;

  } catch (error) {
    logger.error('Delete all read error:', error);
    throw error;
  }
};

// ====================================
// HELPER FUNCTIONS FOR AUTO-NOTIFICATIONS
// ====================================

/**
 * Send booking notification to owner when new booking created
 */
const notifyNewBooking = async (ownerId, bookingId, bookingNumber, farmerName) => {
  return createNotification(
    ownerId,
    NOTIFICATION_TYPES.BOOKING_NEW,
    'New Booking Request',
    `${farmerName} has requested to book your vehicle. Booking #${bookingNumber}`,
    'booking',
    bookingId
  );
};

/**
 * Send notification to farmer when booking accepted
 */
const notifyBookingAccepted = async (farmerId, bookingId, bookingNumber, vehicleName) => {
  return createNotification(
    farmerId,
    NOTIFICATION_TYPES.BOOKING_ACCEPTED,
    'Booking Confirmed',
    `Your booking for ${vehicleName} has been accepted. Booking #${bookingNumber}`,
    'booking',
    bookingId
  );
};

/**
 * Send notification to farmer when booking rejected
 */
const notifyBookingRejected = async (farmerId, bookingId, bookingNumber, vehicleName) => {
  return createNotification(
    farmerId,
    NOTIFICATION_TYPES.BOOKING_REJECTED,
    'Booking Rejected',
    `Your booking for ${vehicleName} has been rejected. Booking #${bookingNumber}`,
    'booking',
    bookingId
  );
};

/**
 * Send notification when work started
 */
const notifyWorkStarted = async (farmerId, bookingId, bookingNumber) => {
  return createNotification(
    farmerId,
    NOTIFICATION_TYPES.BOOKING_STARTED,
    'Work Started',
    `Work has started for your booking #${bookingNumber}`,
    'booking',
    bookingId
  );
};

/**
 * Send notification when work completed
 */
const notifyWorkCompleted = async (farmerId, bookingId, bookingNumber, amountToPay) => {
  return createNotification(
    farmerId,
    NOTIFICATION_TYPES.BOOKING_COMPLETED,
    'Work Completed',
    `Work completed for booking #${bookingNumber}. Amount to pay: ₹${amountToPay}`,
    'booking',
    bookingId
  );
};

/**
 * Send notification when payment received
 */
const notifyPaymentReceived = async (ownerId, bookingId, amount) => {
  return createNotification(
    ownerId,
    NOTIFICATION_TYPES.PAYMENT_RECEIVED,
    'Payment Received',
    `You have received ₹${amount} in your wallet`,
    'booking',
    bookingId
  );
};

/**
 * Send notification for low wallet balance
 */
const notifyLowBalance = async (userId, currentBalance) => {
  return createNotification(
    userId,
    NOTIFICATION_TYPES.WALLET_LOW_BALANCE,
    'Low Wallet Balance',
    `Your wallet balance is low (₹${currentBalance}). Please add money to continue accepting bookings.`,
    'wallet',
    null
  );
};

/**
 * Send notification when review received
 */
const notifyReviewReceived = async (ownerId, vehicleName, rating) => {
  return createNotification(
    ownerId,
    NOTIFICATION_TYPES.REVIEW_RECEIVED,
    'New Review',
    `Your ${vehicleName} received a ${rating}-star review`,
    'review',
    null
  );
};

module.exports = {
  NOTIFICATION_TYPES,
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllRead,
  
  // Helper functions
  notifyNewBooking,
  notifyBookingAccepted,
  notifyBookingRejected,
  notifyWorkStarted,
  notifyWorkCompleted,
  notifyPaymentReceived,
  notifyLowBalance,
  notifyReviewReceived
};