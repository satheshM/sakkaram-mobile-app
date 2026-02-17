const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Advanced vehicle search with multiple filters
 */
const advancedVehicleSearch = async (filters = {}) => {
  try {
    const {
      // Location filters
      latitude,
      longitude,
      maxDistance = 50, // km
      
      // Price filters
      minPrice,
      maxPrice,
      
      // Rating filter
      minRating,
      
      // Type filter
      vehicleType,
      
      // Service filter
      serviceType,
      
      // Availability
      isAvailable = true,
      
      // Sort
      sortBy = 'distance', // distance, price, rating, newest
      sortOrder = 'asc', // asc, desc
      
      // Pagination
      page = 1,
      limit = 20
    } = filters;

    const offset = (page - 1) * limit;
    
    let query = `
      SELECT 
        v.*,
        u.full_name as owner_name,
        u.phone_number as owner_phone
    `;

    // Add distance calculation if location provided
    if (latitude && longitude) {
      query += `,
        (
          6371 * acos(
            cos(radians($1)) * cos(radians(v.location_lat)) *
            cos(radians(v.location_lng) - radians($2)) +
            sin(radians($1)) * sin(radians(v.location_lat))
          )
        ) as distance_km
      `;
    }

    query += `
      FROM vehicles v
      LEFT JOIN users u ON u.id = v.owner_id
      WHERE v.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 0;

    // Location params (always first if present)
    if (latitude && longitude) {
      params.push(latitude, longitude);
      paramCount = 2;
    }

    // Availability filter
    if (isAvailable !== undefined) {
      query += ` AND v.is_available = $${paramCount + 1}`;
      params.push(isAvailable);
      paramCount++;
    }

    // Distance filter
    if (latitude && longitude && maxDistance) {
      query += ` AND (
        6371 * acos(
          cos(radians($1)) * cos(radians(v.location_lat)) *
          cos(radians(v.location_lng) - radians($2)) +
          sin(radians($1)) * sin(radians(v.location_lat))
        )
      ) <= $${paramCount + 1}`;
      params.push(maxDistance);
      paramCount++;
    }

    // Vehicle type filter
    if (vehicleType) {
      paramCount++;
      query += ` AND v.type = $${paramCount}`;
      params.push(vehicleType);
    }

    // Rating filter
    if (minRating) {
      paramCount++;
      query += ` AND v.average_rating >= $${paramCount}`;
      params.push(minRating);
    }

    // Service type filter (check in services_offered JSONB)
    if (serviceType) {
      query += ` AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v.services_offered) AS service
        WHERE service->>'serviceType' = $${paramCount + 1}
      )`;
      params.push(serviceType);
      paramCount++;
    }

    // Price filter (check services_offered for price range)
    if (minPrice || maxPrice) {
      query += ` AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v.services_offered) AS service
        WHERE 1=1
      `;
      
      if (minPrice) {
        paramCount++;
        query += ` AND (
          (service->>'hourlyRate')::numeric >= $${paramCount}
          OR (service->>'perAcreRate')::numeric >= $${paramCount}
          OR (service->>'fixedPrice')::numeric >= $${paramCount}
        )`;
        params.push(minPrice);
      }
      
      if (maxPrice) {
        paramCount++;
        query += ` AND (
          (service->>'hourlyRate')::numeric <= $${paramCount}
          OR (service->>'perAcreRate')::numeric <= $${paramCount}
          OR (service->>'fixedPrice')::numeric <= $${paramCount}
        )`;
        params.push(maxPrice);
      }
      
      query += `)`;
    }

    // Sort
    let orderBy = '';
    if (latitude && longitude && sortBy === 'distance') {
      orderBy = 'distance_km ' + (sortOrder === 'desc' ? 'DESC' : 'ASC');
    } else if (sortBy === 'rating') {
      orderBy = 'v.average_rating ' + (sortOrder === 'desc' ? 'DESC NULLS LAST' : 'ASC NULLS LAST');
    } else if (sortBy === 'newest') {
      orderBy = 'v.created_at DESC';
    } else {
      orderBy = 'v.created_at DESC';
    }

    query += ` ORDER BY ${orderBy}`;
    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count with same filters
    let countQuery = `
      SELECT COUNT(*) 
      FROM vehicles v
      WHERE v.deleted_at IS NULL
    `;

    const countParams = [];
    let countParamIndex = 0;

    if (isAvailable !== undefined) {
      countParamIndex++;
      countQuery += ` AND v.is_available = $${countParamIndex}`;
      countParams.push(isAvailable);
    }

    if (latitude && longitude && maxDistance) {
      countQuery += ` AND (
        6371 * acos(
          cos(radians($${countParamIndex + 1})) * cos(radians(v.location_lat)) *
          cos(radians(v.location_lng) - radians($${countParamIndex + 2})) +
          sin(radians($${countParamIndex + 1})) * sin(radians(v.location_lat))
        )
      ) <= $${countParamIndex + 3}`;
      countParams.push(latitude, longitude, maxDistance);
      countParamIndex += 3;
    }

    if (vehicleType) {
      countParamIndex++;
      countQuery += ` AND v.type = $${countParamIndex}`;
      countParams.push(vehicleType);
    }

    if (minRating) {
      countParamIndex++;
      countQuery += ` AND v.average_rating >= $${countParamIndex}`;
      countParams.push(minRating);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    logger.info('Advanced search executed', {
      filters: Object.keys(filters),
      results: result.rows.length,
      total: totalCount
    });

    return {
      vehicles: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalVehicles: totalCount,
        limit: parseInt(limit)
      },
      filters: {
        applied: {
          distance: maxDistance,
          minPrice,
          maxPrice,
          minRating,
          vehicleType,
          serviceType,
          sortBy
        }
      }
    };

  } catch (error) {
    logger.error('Advanced search error:', error);
    throw error;
  }
};

/**
 * Get vehicles within map bounds
 */
const getVehiclesInMapBounds = async (bounds) => {
  try {
    const { north, south, east, west } = bounds;

    if (!north || !south || !east || !west) {
      throw new Error('Invalid map bounds');
    }

    const result = await pool.query(
      `SELECT 
        v.id,
        v.name,
        v.type,
        v.model,
        v.location_lat,
        v.location_lng,
        v.location_address,
        v.average_rating,
        v.total_reviews,
        v.images,
        v.is_available,
        v.services_offered,
        u.full_name as owner_name
      FROM vehicles v
      LEFT JOIN users u ON u.id = v.owner_id
      WHERE v.deleted_at IS NULL
        AND v.is_available = true
        AND v.location_lat BETWEEN $1 AND $2
        AND v.location_lng BETWEEN $3 AND $4
      LIMIT 100`,
      [south, north, west, east]
    );

    logger.info('Map bounds search', {
      bounds,
      results: result.rows.length
    });

    return result.rows;

  } catch (error) {
    logger.error('Get vehicles in bounds error:', error);
    throw error;
  }
};

/**
 * Get popular vehicles (most booked)
 */
const getPopularVehicles = async (limit = 10) => {
  try {
    const result = await pool.query(
      `SELECT 
        v.*,
        u.full_name as owner_name,
        COUNT(b.id) as total_bookings,
        COUNT(CASE WHEN b.created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as bookings_last_30_days
      FROM vehicles v
      LEFT JOIN users u ON u.id = v.owner_id
      LEFT JOIN bookings b ON b.vehicle_id = v.id AND b.deleted_at IS NULL
      WHERE v.deleted_at IS NULL
        AND v.is_available = true
      GROUP BY v.id, u.full_name
      HAVING COUNT(b.id) > 0
      ORDER BY total_bookings DESC, v.average_rating DESC
      LIMIT $1`,
      [limit]
    );

    return result.rows;

  } catch (error) {
    logger.error('Get popular vehicles error:', error);
    throw error;
  }
};

/**
 * Get booking analytics for user
 */
const getUserBookingAnalytics = async (userId) => {
  try {
    // Total bookings by status
    const statusStats = await pool.query(
      `SELECT 
        status,
        COUNT(*) as count,
        SUM(total_farmer_pays) as total_spent
      FROM bookings
      WHERE farmer_id = $1 AND deleted_at IS NULL
      GROUP BY status`,
      [userId]
    );

    // Favorite vehicle types
    const typeStats = await pool.query(
      `SELECT 
        v.type,
        COUNT(*) as bookings_count,
        AVG(b.total_farmer_pays) as avg_spent
      FROM bookings b
      JOIN vehicles v ON v.id = b.vehicle_id
      WHERE b.farmer_id = $1 AND b.deleted_at IS NULL
      GROUP BY v.type
      ORDER BY bookings_count DESC`,
      [userId]
    );

    // Monthly spending
    const monthlyStats = await pool.query(
      `SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as bookings,
        SUM(total_farmer_pays) as total_spent
      FROM bookings
      WHERE farmer_id = $1 
        AND deleted_at IS NULL
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC`,
      [userId]
    );

    // Total summary
    const summary = await pool.query(
      `SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_bookings,
        SUM(total_farmer_pays) as total_spent,
        AVG(total_farmer_pays) as avg_booking_value
      FROM bookings
      WHERE farmer_id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    return {
      summary: summary.rows[0],
      byStatus: statusStats.rows,
      byVehicleType: typeStats.rows,
      monthlyTrend: monthlyStats.rows
    };

  } catch (error) {
    logger.error('Get user analytics error:', error);
    throw error;
  }
};

module.exports = {
  advancedVehicleSearch,
  getVehiclesInMapBounds,
  getPopularVehicles,
  getUserBookingAnalytics
};