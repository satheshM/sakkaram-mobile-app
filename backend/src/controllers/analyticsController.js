const {
  getUserAnalytics,
  getPopularVehicles,
  getPlatformTrends
} = require('../services/analyticsService');
const logger = require('../config/logger');

const getMyAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    const analytics = await getUserAnalytics(userId, role);

    res.status(200).json({
      success: true,
      analytics
    });

  } catch (error) {
    logger.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get analytics'
    });
  }
};

const getPopular = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const vehicles = await getPopularVehicles(parseInt(limit));

    res.status(200).json({
      success: true,
      vehicles
    });

  } catch (error) {
    logger.error('Get popular vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get popular vehicles'
    });
  }
};

const getTrends = async (req, res) => {
  try {
    const trends = await getPlatformTrends();

    res.status(200).json({
      success: true,
      trends
    });

  } catch (error) {
    logger.error('Get trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get trends'
    });
  }
};

module.exports = { getMyAnalytics, getPopular, getTrends };