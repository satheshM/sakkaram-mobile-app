const {
  advancedVehicleSearch,
  getVehiclesInMapBounds
} = require('../services/vehicleService');
const {
  addToFavorites,
  removeFromFavorites,
  getUserFavorites,
  isFavorited
} = require('../services/favoriteService');
const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Advanced vehicle search with filters
 * GET /api/search/vehicles
 */
const searchVehicles = async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      maxDistance,
      minPrice,
      maxPrice,
      minRating,
      vehicleType,
      serviceType,
      sortBy,
      sortOrder,
      page,
      limit
    } = req.query;

    const filters = {
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      maxDistance: maxDistance ? parseFloat(maxDistance) : 50,
      minPrice: minPrice ? parseFloat(minPrice) : null,
      maxPrice: maxPrice ? parseFloat(maxPrice) : null,
      minRating: minRating ? parseFloat(minRating) : null,
      vehicleType: vehicleType || null,
      serviceType: serviceType || null,
      sortBy: sortBy || 'newest',
      sortOrder: sortOrder || 'desc',
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20
    };

    const result = await advancedVehicleSearch(filters);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Search vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search vehicles'
    });
  }
};

/**
 * Get vehicles for map view
 * GET /api/search/map
 */
const getMapVehicles = async (req, res) => {
  try {
    const { north, south, east, west } = req.query;

    if (!north || !south || !east || !west) {
      return res.status(400).json({
        success: false,
        message: 'Map bounds required (north, south, east, west)'
      });
    }

    const bounds = {
      north: parseFloat(north),
      south: parseFloat(south),
      east: parseFloat(east),
      west: parseFloat(west)
    };

    const vehicles = await getVehiclesInMapBounds(bounds);

    res.status(200).json({
      success: true,
      vehicles,
      count: vehicles.length
    });

  } catch (error) {
    logger.error('Get map vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch map vehicles'
    });
  }
};

/**
 * Get search suggestions
 * GET /api/search/suggestions
 */
const getSearchSuggestions = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.status(200).json({
        success: true,
        suggestions: []
      });
    }

    // Search in vehicle names, types, locations
    const result = await pool.query(
      `SELECT DISTINCT
        v.id,
        v.name,
        v.type,
        v.location_address
       FROM vehicles v
       WHERE v.deleted_at IS NULL
         AND v.is_available = true
         AND (
           v.name ILIKE $1
           OR v.type ILIKE $1
           OR v.location_address ILIKE $1
           OR v.model ILIKE $1
         )
       LIMIT 10`,
      [`%${query}%`]
    );

    const suggestions = result.rows.map(vehicle => ({
      id: vehicle.id,
      text: vehicle.name,
      type: vehicle.type,
      location: vehicle.location_address
    }));

    res.status(200).json({
      success: true,
      suggestions
    });

  } catch (error) {
    logger.error('Get suggestions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get suggestions'
    });
  }
};

/**
 * Get popular searches / trending vehicles
 * GET /api/search/trending
 */
const getTrendingVehicles = async (req, res) => {
  try {
    // Get most booked vehicles in last 30 days
    const result = await pool.query(
      `SELECT 
        v.id,
        v.name,
        v.type,
        v.model,
        v.images,
        v.average_rating,
        v.base_price,
        v.location_address,
        u.full_name as owner_name,
        COUNT(b.id) as booking_count
      FROM vehicles v
      LEFT JOIN users u ON u.id = v.owner_id
      LEFT JOIN bookings b ON b.vehicle_id = v.id
        AND b.created_at >= NOW() - INTERVAL '30 days'
        AND b.deleted_at IS NULL
      WHERE v.deleted_at IS NULL
        AND v.is_available = true
      GROUP BY v.id, u.full_name
      ORDER BY booking_count DESC, v.average_rating DESC
      LIMIT 10`
    );

    res.status(200).json({
      success: true,
      trending: result.rows
    });

  } catch (error) {
    logger.error('Get trending error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trending vehicles'
    });
  }
};

/**
 * Add vehicle to favorites
 * POST /api/search/favorites/:vehicleId
 */
const addFavorite = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { vehicleId } = req.params;

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

/**
 * Remove vehicle from favorites
 * DELETE /api/search/favorites/:vehicleId
 */
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

/**
 * Get user's favorites
 * GET /api/search/favorites
 */
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

/**
 * Check if vehicle is favorited
 * GET /api/search/favorites/:vehicleId/check
 */
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

/**
 * Get booking analytics for user
 * GET /api/search/analytics
 */
const getBookingAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    let analytics = {};

    if (userRole === 'farmer') {
      // Farmer analytics
      const bookingStats = await pool.query(
        `SELECT 
          COUNT(*) as total_bookings,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_bookings,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_bookings,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bookings,
          SUM(CASE WHEN status = 'completed' THEN total_farmer_pays ELSE 0 END) as total_spent,
          AVG(CASE WHEN status = 'completed' THEN total_farmer_pays END) as avg_booking_value
        FROM bookings
        WHERE farmer_id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      // Most used service types
      const serviceStats = await pool.query(
        `SELECT 
          service_type,
          COUNT(*) as count
        FROM bookings
        WHERE farmer_id = $1 AND deleted_at IS NULL
        GROUP BY service_type
        ORDER BY count DESC
        LIMIT 5`,
        [userId]
      );

      // Monthly spending
      const monthlyStats = await pool.query(
        `SELECT 
          TO_CHAR(created_at, 'YYYY-MM') as month,
          COUNT(*) as bookings,
          SUM(total_farmer_pays) as spent
        FROM bookings
        WHERE farmer_id = $1 
          AND deleted_at IS NULL
          AND status = 'completed'
          AND created_at >= NOW() - INTERVAL '6 months'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM')
        ORDER BY month DESC`,
        [userId]
      );

      analytics = {
        overview: bookingStats.rows[0],
        topServices: serviceStats.rows,
        monthlySpending: monthlyStats.rows
      };

    } else if (userRole === 'owner') {
      // Owner analytics
      const earningStats = await pool.query(
        `SELECT 
          COUNT(*) as total_bookings,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_bookings,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_bookings,
          SUM(CASE WHEN status = 'completed' THEN total_owner_receives ELSE 0 END) as total_earned,
          AVG(CASE WHEN status = 'completed' THEN total_owner_receives END) as avg_earning_per_booking
        FROM bookings
        WHERE owner_id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      // Vehicle performance
      const vehicleStats = await pool.query(
        `SELECT 
          v.name as vehicle_name,
          v.type as vehicle_type,
          v.average_rating,
          COUNT(b.id) as total_bookings,
          SUM(CASE WHEN b.status = 'completed' THEN b.total_owner_receives ELSE 0 END) as total_earned
        FROM vehicles v
        LEFT JOIN bookings b ON b.vehicle_id = v.id AND b.deleted_at IS NULL
        WHERE v.owner_id = $1 AND v.deleted_at IS NULL
        GROUP BY v.id
        ORDER BY total_earned DESC`,
        [userId]
      );

      // Monthly earnings
      const monthlyStats = await pool.query(
        `SELECT 
          TO_CHAR(created_at, 'YYYY-MM') as month,
          COUNT(*) as bookings,
          SUM(total_owner_receives) as earned
        FROM bookings
        WHERE owner_id = $1
          AND deleted_at IS NULL
          AND status = 'completed'
          AND created_at >= NOW() - INTERVAL '6 months'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM')
        ORDER BY month DESC`,
        [userId]
      );

      analytics = {
        overview: earningStats.rows[0],
        vehiclePerformance: vehicleStats.rows,
        monthlyEarnings: monthlyStats.rows
      };
    }

    res.status(200).json({
      success: true,
      role: userRole,
      analytics
    });

  } catch (error) {
    logger.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
};

module.exports = {
  searchVehicles,
  getMapVehicles,
  getSearchSuggestions,
  getTrendingVehicles,
  addFavorite,
  removeFavorite,
  getFavorites,
  checkFavorite,
  getBookingAnalytics
};