const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { verifyToken } = require('../middlewares/authMiddleware');

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