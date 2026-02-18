const { pool } = require('../config/db');
const logger = require('../config/logger');

// Get user's personal booking analytics
const getUserAnalytics = async (userId, role) => {
  try {
    const idField = role === 'farmer' ? 'farmer_id' : 'owner_id';

    // Booking stats
    const bookingStats = await pool.query(
      `SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        SUM(CASE WHEN status = 'completed' THEN total_farmer_pays ELSE 0 END) as total_spent,
        AVG(CASE WHEN status = 'completed' THEN total_farmer_pays END) as avg_booking_value
       FROM bookings
       WHERE ${idField} = $1 AND deleted_at IS NULL`,
      [userId]
    );

    // Monthly trend (last 6 months)
    const monthlyTrend = await pool.query(
      `SELECT 
        TO_CHAR(created_at, 'Mon YYYY') as month,
        COUNT(*) as bookings,
        SUM(CASE WHEN status = 'completed' THEN total_farmer_pays ELSE 0 END) as amount
       FROM bookings
       WHERE ${idField} = $1 
         AND deleted_at IS NULL
         AND created_at >= NOW() - INTERVAL '6 months'
       GROUP BY TO_CHAR(created_at, 'Mon YYYY'), DATE_TRUNC('month', created_at)
       ORDER BY DATE_TRUNC('month', created_at) ASC`,
      [userId]
    );

    // Most used services
    const topServices = await pool.query(
      `SELECT 
        service_type,
        COUNT(*) as count
       FROM bookings
       WHERE ${idField} = $1 
         AND deleted_at IS NULL
         AND status = 'completed'
       GROUP BY service_type
       ORDER BY count DESC
       LIMIT 5`,
      [userId]
    );

    // Owner specific: earnings analytics
    let earningsStats = null;
    if (role === 'owner') {
      const earnings = await pool.query(
        `SELECT 
          SUM(total_owner_receives) as total_earned,
          SUM(owner_commission) as total_commission_paid,
          AVG(total_owner_receives) as avg_per_booking
         FROM bookings
         WHERE owner_id = $1 
           AND status = 'completed'
           AND deleted_at IS NULL`,
        [userId]
      );
      earningsStats = earnings.rows[0];
    }

    // Wallet stats
    const walletStats = await pool.query(
      `SELECT 
        w.balance,
        COUNT(wt.id) as total_transactions,
        SUM(CASE WHEN wt.transaction_type = 'credit' THEN wt.amount ELSE 0 END) as total_credited,
        SUM(CASE WHEN wt.transaction_type = 'debit' THEN wt.amount ELSE 0 END) as total_debited
       FROM wallets w
       LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
       WHERE w.user_id = $1
       GROUP BY w.balance`,
      [userId]
    );

    return {
      bookings: {
        ...bookingStats.rows[0],
        monthlyTrend: monthlyTrend.rows,
        topServices: topServices.rows
      },
      wallet: walletStats.rows[0] || {
        balance: 0,
        total_transactions: 0,
        total_credited: 0,
        total_debited: 0
      },
      earnings: earningsStats
    };

  } catch (error) {
    logger.error('User analytics error:', error);
    throw error;
  }
};

// Get popular vehicles
const getPopularVehicles = async (limit = 10) => {
  try {
    const result = await pool.query(
      `SELECT 
        v.id,
        v.name,
        v.type,
        v.average_rating,
        v.total_reviews,
        v.images,
        u.full_name as owner_name,
        COUNT(b.id) as total_bookings,
        SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) as completed_bookings
       FROM vehicles v
       LEFT JOIN users u ON u.id = v.owner_id
       LEFT JOIN bookings b ON b.vehicle_id = v.id AND b.deleted_at IS NULL
       WHERE v.deleted_at IS NULL
       GROUP BY v.id, u.full_name
       ORDER BY total_bookings DESC, v.average_rating DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;

  } catch (error) {
    logger.error('Popular vehicles error:', error);
    throw error;
  }
};

// Get platform trends
const getPlatformTrends = async () => {
  try {
    // Peak booking hours
    const peakHours = await pool.query(
      `SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as bookings
       FROM bookings
       WHERE deleted_at IS NULL
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY bookings DESC
       LIMIT 5`
    );

    // Peak booking days
    const peakDays = await pool.query(
      `SELECT 
        TO_CHAR(created_at, 'Day') as day,
        COUNT(*) as bookings
       FROM bookings
       WHERE deleted_at IS NULL
       GROUP BY TO_CHAR(created_at, 'Day'), EXTRACT(DOW FROM created_at)
       ORDER BY EXTRACT(DOW FROM created_at)`
    );

    // Popular service types
    const popularServices = await pool.query(
      `SELECT 
        service_type,
        COUNT(*) as count,
        AVG(total_farmer_pays) as avg_price
       FROM bookings
       WHERE deleted_at IS NULL AND status = 'completed'
       GROUP BY service_type
       ORDER BY count DESC`
    );

    // Weekly booking trend
    const weeklyTrend = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as bookings
       FROM bookings
       WHERE deleted_at IS NULL
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    return {
      peakHours: peakHours.rows,
      peakDays: peakDays.rows,
      popularServices: popularServices.rows,
      weeklyTrend: weeklyTrend.rows
    };

  } catch (error) {
    logger.error('Platform trends error:', error);
    throw error;
  }
};

module.exports = {
  getUserAnalytics,
  getPopularVehicles,
  getPlatformTrends
};