/**
 * pushService.js — Phase 8
 *
 * Uses Expo Push Notification API (https://exp.host/--/api/v2/push/send)
 * Works for both Android (FCM via Expo) and iOS (APNs via Expo).
 * No Firebase console or google-services.json needed for Expo managed builds.
 *
 * For production iOS builds you need to add APNs credentials in Expo dashboard.
 * For Android it works out of the box with Expo's FCM account.
 */

const axios  = require('axios');
const { query } = require('../config/db');
const logger = require('../config/logger');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ── Get push token for a user ─────────────────────────────────────────────────
const getUserPushToken = async (userId) => {
  try {
    const result = await query(
      'SELECT push_token, push_enabled FROM users WHERE id=$1 AND deleted_at IS NULL',
      [userId]
    );
    const row = result.rows[0];
    if (!row || !row.push_token || row.push_enabled === false) return null;
    return row.push_token;
  } catch (err) {
    logger.error('getUserPushToken error:', err.message);
    return null;
  }
};

// ── Send a single push notification ──────────────────────────────────────────
const sendPush = async (userId, title, body, data = {}) => {
  try {
    const token = await getUserPushToken(userId);
    if (!token) return; // user has no token or disabled push — silent skip

    // Expo push tokens start with "ExponentPushToken["
    if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
      logger.warn('Invalid Expo push token format', { userId, token: token.slice(0, 20) });
      return;
    }

    const message = {
      to:    token,
      sound: 'default',
      title,
      body,
      data,
      priority:    'high',
      channelId:   'default', // Android notification channel
      badge:       1,
    };

    const response = await axios.post(EXPO_PUSH_URL, message, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 5000,
    });

    const result = response.data?.data;
    if (result?.status === 'error') {
      logger.warn('Expo push error', { userId, details: result.details, message: result.message });
      // If token is invalid/unregistered, clear it from DB
      if (result.details?.error === 'DeviceNotRegistered') {
        await query('UPDATE users SET push_token=NULL WHERE id=$1', [userId]).catch(() => {});
        logger.info('Cleared stale push token', { userId });
      }
      return;
    }

    logger.info('Push sent', { userId, title });
  } catch (err) {
    // Push is always non-critical — never throw, just log
    logger.error('sendPush error:', err.message);
  }
};

// ── Send push to multiple users ────────────────────────────────────────────────
const sendPushToMany = async (userIds, title, body, data = {}) => {
  await Promise.allSettled(userIds.map(id => sendPush(id, title, body, data)));
};

// ── Save/update push token for a user ─────────────────────────────────────────
const savePushToken = async (userId, token) => {
  try {
    await query(
      'UPDATE users SET push_token=$1, updated_at=NOW() WHERE id=$2',
      [token, userId]
    );
    logger.info('Push token saved', { userId });
  } catch (err) {
    logger.error('savePushToken error:', err.message);
    throw err;
  }
};

// ── Pre-built push senders matching existing notification helpers ──────────────

const pushNewBooking = (ownerId, bookingNumber, farmerName) =>
  sendPush(ownerId, '📋 New Booking Request',
    `${farmerName} wants to book your vehicle. #${bookingNumber}`,
    { type: 'booking_new', bookingNumber });

const pushBookingAccepted = (farmerId, bookingNumber, vehicleName) =>
  sendPush(farmerId, '✅ Booking Confirmed',
    `Your booking for ${vehicleName} is confirmed. #${bookingNumber}`,
    { type: 'booking_accepted', bookingNumber });

const pushBookingRejected = (farmerId, bookingNumber, vehicleName) =>
  sendPush(farmerId, '❌ Booking Rejected',
    `Your booking for ${vehicleName} was rejected. #${bookingNumber}`,
    { type: 'booking_rejected', bookingNumber });

const pushWorkStarted = (farmerId, bookingNumber) =>
  sendPush(farmerId, '🚜 Work Started',
    `Work has started for booking #${bookingNumber}`,
    { type: 'booking_started', bookingNumber });

const pushWorkCompleted = (farmerId, bookingNumber, amount) =>
  sendPush(farmerId, '🎉 Work Completed',
    `Booking #${bookingNumber} done. Amount due: ₹${amount}`,
    { type: 'booking_completed', bookingNumber });

const pushPaymentReceived = (ownerId, amount, bookingNumber) =>
  sendPush(ownerId, '💰 Payment Received',
    `₹${amount} added to your wallet for booking #${bookingNumber}`,
    { type: 'payment_received' });

const pushWalletTopup = (userId, amount) =>
  sendPush(userId, '💳 Wallet Credited',
    `₹${parseFloat(amount).toFixed(2)} added to your Sakkaram wallet`,
    { type: 'wallet_credited' });

const pushSupportReply = (userId) =>
  sendPush(userId, '📬 Support Reply',
    'The support team has replied to your message',
    { type: 'support_reply' });

module.exports = {
  sendPush,
  sendPushToMany,
  savePushToken,
  pushNewBooking,
  pushBookingAccepted,
  pushBookingRejected,
  pushWorkStarted,
  pushWorkCompleted,
  pushPaymentReceived,
  pushWalletTopup,
  pushSupportReply,
};
