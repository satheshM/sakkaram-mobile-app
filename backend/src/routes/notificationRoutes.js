const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { verifyToken } = require('../middlewares/authMiddleware');
const { savePushToken } = require('../services/pushService');
const logger = require('../config/logger');

// Phase 8: Register/update Expo push token
// POST /api/notifications/push-token
router.post('/push-token', verifyToken, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required' });
    await savePushToken(req.user.userId, token);
    res.status(200).json({ success: true, message: 'Push token registered' });
  } catch (err) {
    logger.error('Save push token error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save push token' });
  }
});

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get unread notifications count
 * @access  Private
 * 
 * IMPORTANT: This must come BEFORE /api/notifications/:id
 */
router.get('/unread-count', verifyToken, notificationController.getUnreadCountController);

/**
 * @route   PUT /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 * 
 * IMPORTANT: This must come BEFORE /api/notifications/:id/read
 */
router.put('/read-all', verifyToken, notificationController.markAllNotificationsAsRead);

/**
 * @route   DELETE /api/notifications/read-all
 * @desc    Delete all read notifications
 * @access  Private
 * 
 * IMPORTANT: Changed from /read to /read-all to avoid conflict with /:id
 */
router.delete('/read-all', verifyToken, notificationController.deleteAllReadNotifications);

/**
 * @route   GET /api/notifications
 * @desc    Get user notifications
 * @access  Private
 */
router.get('/', verifyToken, notificationController.getNotifications);

/**
 * @route   PUT /api/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:id/read', verifyToken, notificationController.markNotificationAsRead);

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete a notification
 * @access  Private
 */
router.delete('/:id', verifyToken, notificationController.deleteNotificationController);

module.exports = router;