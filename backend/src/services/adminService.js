const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Get platform statistics
 */
const getPlatformStats = async () => {
  try {
    // Total users by role
    const usersStats = await pool.query(`
      SELECT 
        role,
        COUNT(*) as count,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_last_30_days
      FROM users
      WHERE deleted_at IS NULL
      GROUP BY role
    `);

    // Total bookings by status
    const bookingsStats = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(total_farmer_pays) as total_amount
      FROM bookings
      WHERE deleted_at IS NULL
      GROUP BY status
    `);

    // Total vehicles
    const vehiclesStats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_available = true THEN 1 END) as available,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_last_30_days
      FROM vehicles
      WHERE deleted_at IS NULL
    `);

    // Total payments
    const paymentsStats = await pool.query(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END) as total_revenue,
        SUM(CASE WHEN status = 'success' AND created_at >= NOW() - INTERVAL '30 days' THEN amount ELSE 0 END) as revenue_last_30_days
      FROM payments
    `);

    // Platform earnings (commission)
    const earningsStats = await pool.query(`
      SELECT 
        SUM(platform_earning) as total_platform_earnings,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN platform_earning ELSE 0 END) as earnings_last_30_days
      FROM bookings
      WHERE status = 'completed' AND deleted_at IS NULL
    `);

    // Reviews stats
    const reviewsStats = await pool.query(`
      SELECT 
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_last_30_days
      FROM reviews
    `);

    return {
      users: {
        byRole: usersStats.rows,
        total: usersStats.rows.reduce((sum, row) => sum + parseInt(row.count), 0)
      },
      bookings: {
        byStatus: bookingsStats.rows,
        total: bookingsStats.rows.reduce((sum, row) => sum + parseInt(row.count), 0)
      },
      vehicles: vehiclesStats.rows[0],
      payments: paymentsStats.rows[0],
      earnings: earningsStats.rows[0],
      reviews: reviewsStats.rows[0]
    };

  } catch (error) {
    logger.error('Get platform stats error:', error);
    throw error;
  }
};

/**
 * Get all users with filters
 */
const getAllUsers = async (role = null, status = null, page = 1, limit = 20) => {
  try {
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT 
        u.id,
        u.email,
        u.phone_number,
        u.role,
        u.full_name,
        u.is_active,
        u.is_verified,
        u.created_at,
        u.last_login_at,
        COUNT(DISTINCT CASE WHEN u.role = 'farmer' THEN b.id END) as total_bookings_as_farmer,
        COUNT(DISTINCT CASE WHEN u.role = 'owner' THEN v.id END) as total_vehicles_owned
      FROM users u
      LEFT JOIN bookings b ON b.farmer_id = u.id AND b.deleted_at IS NULL
      LEFT JOIN vehicles v ON v.owner_id = u.id AND v.deleted_at IS NULL
      WHERE u.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 0;

    if (role) {
      paramCount++;
      query += ` AND u.role = $${paramCount}`;
      params.push(role);
    }

    if (status === 'active') {
      query += ` AND u.is_active = true`;
    } else if (status === 'blocked') {
      query += ` AND u.is_active = false`;
    }

    query += ` GROUP BY u.id ORDER BY u.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM users WHERE deleted_at IS NULL';
    const countParams = [];
    let countParamCount = 0;

    if (role) {
      countParamCount++;
      countQuery += ` AND role = $${countParamCount}`;
      countParams.push(role);
    }

    if (status === 'active') {
      countQuery += ` AND is_active = true`;
    } else if (status === 'blocked') {
      countQuery += ` AND is_active = false`;
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    return {
      users: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalUsers: totalCount,
        limit: parseInt(limit)
      }
    };

  } catch (error) {
    logger.error('Get all users error:', error);
    throw error;
  }
};

/**
 * Block/Unblock user
 */
const toggleUserStatus = async (userId, action) => {
  try {
    const isActive = action === 'unblock';

    const result = await pool.query(
      `UPDATE users 
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, phone_number, full_name, is_active`,
      [isActive, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    logger.info(`User ${action}ed`, {
      userId,
      action,
      isActive
    });

    return result.rows[0];

  } catch (error) {
    logger.error('Toggle user status error:', error);
    throw error;
  }
};

/**
 * Get all bookings (admin view)
 */
const getAllBookings = async (status = null, page = 1, limit = 20) => {
  try {
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT 
        b.*,
        v.name as vehicle_name,
        v.type as vehicle_type,
        farmer.full_name as farmer_name,
        farmer.phone_number as farmer_phone,
        owner.full_name as owner_name,
        owner.phone_number as owner_phone
      FROM bookings b
      LEFT JOIN vehicles v ON v.id = b.vehicle_id
      LEFT JOIN users farmer ON farmer.id = b.farmer_id
      LEFT JOIN users owner ON owner.id = b.owner_id
      WHERE b.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND b.status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY b.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM bookings WHERE deleted_at IS NULL';
    const countParams = [];

    if (status) {
      countQuery += ' AND status = $1';
      countParams.push(status);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    return {
      bookings: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalBookings: totalCount,
        limit: parseInt(limit)
      }
    };

  } catch (error) {
    logger.error('Get all bookings error:', error);
    throw error;
  }
};

/**
 * Get all vehicles (admin view)
 */
const getAllVehicles = async (page = 1, limit = 20) => {
  try {
    const offset = (page - 1) * limit;
    
    const result = await pool.query(
      `SELECT 
        v.*,
        u.full_name as owner_name,
        u.phone_number as owner_phone,
        COUNT(b.id) as total_bookings,
        AVG(r.rating) as average_rating
      FROM vehicles v
      LEFT JOIN users u ON u.id = v.owner_id
      LEFT JOIN bookings b ON b.vehicle_id = v.id AND b.deleted_at IS NULL
      LEFT JOIN reviews r ON r.vehicle_id = v.id
      WHERE v.deleted_at IS NULL
      GROUP BY v.id, u.full_name, u.phone_number
      ORDER BY v.created_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL'
    );
    const totalCount = parseInt(countResult.rows[0].count);

    return {
      vehicles: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalVehicles: totalCount,
        limit: parseInt(limit)
      }
    };

  } catch (error) {
    logger.error('Get all vehicles error:', error);
    throw error;
  }
};

/**
 * Get revenue report
 */
const getRevenueReport = async (startDate = null, endDate = null) => {
  try {
    let dateFilter = '';
    const params = [];

    if (startDate && endDate) {
      dateFilter = 'AND b.created_at BETWEEN $1 AND $2';
      params.push(startDate, endDate);
    }

    const result = await pool.query(
      `SELECT 
        DATE(b.created_at) as date,
        COUNT(b.id) as total_bookings,
        SUM(b.base_amount) as total_base_amount,
        SUM(b.farmer_service_fee) as total_farmer_fees,
        SUM(b.owner_commission) as total_owner_commission,
        SUM(b.platform_earning) as total_platform_earnings,
        SUM(b.total_farmer_pays) as total_farmer_paid,
        SUM(b.total_owner_receives) as total_owner_received
      FROM bookings b
      WHERE b.status = 'completed' AND b.deleted_at IS NULL ${dateFilter}
      GROUP BY DATE(b.created_at)
      ORDER BY date DESC
      LIMIT 30`,
      params
    );

    // Summary totals
    const summaryResult = await pool.query(
      `SELECT 
        COUNT(id) as total_bookings,
        SUM(platform_earning) as total_platform_earnings,
        SUM(total_farmer_pays) as total_revenue
      FROM bookings
      WHERE status = 'completed' AND deleted_at IS NULL ${dateFilter}`,
      params
    );

    return {
      dailyReport: result.rows,
      summary: summaryResult.rows[0]
    };

  } catch (error) {
    logger.error('Get revenue report error:', error);
    throw error;
  }
};

module.exports = {
  getPlatformStats,
  getAllUsers,
  toggleUserStatus,
  getAllBookings,
  getAllVehicles,
  getRevenueReport
};