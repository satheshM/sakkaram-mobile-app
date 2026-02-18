const {
  addToFavorites,
  removeFromFavorites,
  getUserFavorites,
  isFavorited
} = require('../services/favoriteService');
const logger = require('../config/logger');

const addFavorite = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { vehicleId } = req.body;

    if (!vehicleId) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle ID is required'
      });
    }

    const favorite = await addToFavorites(userId, vehicleId);

    res.status(201).json({
      success: true,
      message: 'Added to favorites',
      favorite
    });

  } catch (error) {
    logger.error('Add favorite error:', error);

    if (error.message.includes('already in favorites')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to add favorite'
    });
  }
};

const removeFavorite = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { vehicleId } = req.params;

    await removeFromFavorites(userId, vehicleId);

    res.status(200).json({
      success: true,
      message: 'Removed from favorites'
    });

  } catch (error) {
    logger.error('Remove favorite error:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to remove favorite'
    });
  }
};

const getFavorites = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    const result = await getUserFavorites(userId, page, limit);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Get favorites error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch favorites'
    });
  }
};

const checkFavorite = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { vehicleId } = req.params;

    const favorited = await isFavorited(userId, vehicleId);

    res.status(200).json({
      success: true,
      isFavorited: favorited
    });

  } catch (error) {
    logger.error('Check favorite error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check favorite'
    });
  }
};

module.exports = {
  addFavorite,
  removeFavorite,
  getFavorites,
  checkFavorite
};