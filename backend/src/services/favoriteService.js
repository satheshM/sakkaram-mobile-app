const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Add vehicle to favorites
 */
const addToFavorites = async (userId, vehicleId) => {
  try {
    // Check if vehicle exists
    const vehicleCheck = await pool.query(
      'SELECT id FROM vehicles WHERE id = $1 AND deleted_at IS NULL',
      [vehicleId]
    );

    if (vehicleCheck.rows.length === 0) {
      throw new Error('Vehicle not found');
    }

    // Check if already favorited
    const existing = await pool.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND vehicle_id = $2',
      [userId, vehicleId]
    );

    if (existing.rows.length > 0) {
      throw new Error('Vehicle already in favorites');
    }

    // Add to favorites
    const result = await pool.query(
      `INSERT INTO favorites (user_id, vehicle_id, created_at)
       VALUES ($1, $2, NOW())
       RETURNING *`,
      [userId, vehicleId]
    );

    logger.info('Added to favorites', { userId, vehicleId });

    return result.rows[0];

  } catch (error) {
    logger.error('Add to favorites error:', error);
    throw error;
  }
};

/**
 * Remove from favorites
 */
const removeFromFavorites = async (userId, vehicleId) => {
  try {
    const result = await pool.query(
      `DELETE FROM favorites 
       WHERE user_id = $1 AND vehicle_id = $2
       RETURNING id`,
      [userId, vehicleId]
    );

    if (result.rows.length === 0) {
      throw new Error('Favorite not found');
    }

    logger.info('Removed from favorites', { userId, vehicleId });

    return true;

  } catch (error) {
    logger.error('Remove from favorites error:', error);
    throw error;
  }
};

/**
 * Get user's favorites
 */
const getUserFavorites = async (userId, page = 1, limit = 20) => {
  try {
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT 
        f.id as favorite_id,
        f.created_at as favorited_at,
        v.*,
        u.full_name as owner_name,
        u.phone_number as owner_phone
      FROM favorites f
      JOIN vehicles v ON v.id = f.vehicle_id
      LEFT JOIN users u ON u.id = v.owner_id
      WHERE f.user_id = $1 
        AND v.deleted_at IS NULL
      ORDER BY f.created_at DESC
      LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM favorites f
       JOIN vehicles v ON v.id = f.vehicle_id
       WHERE f.user_id = $1 AND v.deleted_at IS NULL`,
      [userId]
    );

    const totalCount = parseInt(countResult.rows[0].count);

    return {
      favorites: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalFavorites: totalCount,
        limit: parseInt(limit)
      }
    };

  } catch (error) {
    logger.error('Get favorites error:', error);
    throw error;
  }
};

/**
 * Check if vehicle is favorited
 */
const isFavorited = async (userId, vehicleId) => {
  try {
    const result = await pool.query(
      'SELECT id FROM favorites WHERE user_id = $1 AND vehicle_id = $2',
      [userId, vehicleId]
    );

    return result.rows.length > 0;

  } catch (error) {
    logger.error('Check favorite error:', error);
    throw error;
  }
};

/**
 * Get favorites count for user
 */
const getFavoritesCount = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM favorites f
       JOIN vehicles v ON v.id = f.vehicle_id
       WHERE f.user_id = $1 AND v.deleted_at IS NULL`,
      [userId]
    );

    return parseInt(result.rows[0].count);

  } catch (error) {
    logger.error('Get favorites count error:', error);
    throw error;
  }
};

module.exports = {
  addToFavorites,
  removeFromFavorites,
  getUserFavorites,
  isFavorited,
  getFavoritesCount
};