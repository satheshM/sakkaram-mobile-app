const {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllRead
} = require('../services/notificationService');
const logger = require('../config/logger');

/**
 * Get user notifications
 * GET /api/notifications
 */
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    
    const unread = unreadOnly === 'true' || unreadOnly === true;
    
    const result = await getUserNotifications(userId, page, limit, unread);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
};

/**
 * Get unread count
 * GET /api/notifications/unread-count
 */
const getUnreadCountController = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const count = await getUnreadCount(userId);

    res.status(200).json({
      success: true,
      unreadCount: count
    });

  } catch (error) {
    logger.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count'
    });
  }
};

/**
 * Mark notification as read
 * PUT /api/notifications/:id/read
 */
const markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Notification ID is required'
      });
    }

    const notification = await markAsRead(id, userId);

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      notification
    });

  } catch (error) {
    logger.error('Mark as read error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

/**
 * Mark all notifications as read
 * PUT /api/notifications/read-all
 */
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const count = await markAllAsRead(userId);

    res.status(200).json({
      success: true,
      message: `Marked ${count} notification(s) as read`,
      count
    });

  } catch (error) {
    logger.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all as read'
    });
  }
};

/**
 * Delete a notification
 * DELETE /api/notifications/:id
 */
const deleteNotificationController = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Notification ID is required'
      });
    }

    await deleteNotification(id, userId);

    res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });

  } catch (error) {
    logger.error('Delete notification error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
};

/**
 * Delete all read notifications
 * DELETE /api/notifications/read
 */
const deleteAllReadNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const count = await deleteAllRead(userId);

    res.status(200).json({
      success: true,
      message: `Deleted ${count} read notification(s)`,
      count
    });

  } catch (error) {
    logger.error('Delete all read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete read notifications'
    });
  }
};

module.exports = {
  getNotifications,
  getUnreadCountController,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotificationController,
  deleteAllReadNotifications
};