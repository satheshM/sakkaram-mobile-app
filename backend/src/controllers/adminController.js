const {
  getPlatformStats,
  getAllUsers,
  toggleUserStatus,
  getAllBookings,
  getAllVehicles,
  getRevenueReport
} = require('../services/adminService');
const logger = require('../config/logger');

/**
 * Get platform statistics dashboard
 * GET /api/admin/stats
 */
const getPlatformStatistics = async (req, res) => {
  try {
    const stats = await getPlatformStats();

    res.status(200).json({
      success: true,
      stats
    });

  } catch (error) {
    logger.error('Get platform stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch platform statistics'
    });
  }
};

/**
 * Get all users with filters
 * GET /api/admin/users
 */
const getUsers = async (req, res) => {
  try {
    const { role, status, page = 1, limit = 20 } = req.query;

    const result = await getAllUsers(role, status, page, limit);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
};

/**
 * Block a user
 * PUT /api/admin/users/:userId/block
 */
const blockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const user = await toggleUserStatus(userId, 'block');

    logger.info('User blocked by admin', {
      adminId: req.user.userId,
      userId,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'User blocked successfully',
      user
    });

  } catch (error) {
    logger.error('Block user error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to block user'
    });
  }
};

/**
 * Unblock a user
 * PUT /api/admin/users/:userId/unblock
 */
const unblockUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const user = await toggleUserStatus(userId, 'unblock');

    logger.info('User unblocked by admin', {
      adminId: req.user.userId,
      userId
    });

    res.status(200).json({
      success: true,
      message: 'User unblocked successfully',
      user
    });

  } catch (error) {
    logger.error('Unblock user error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to unblock user'
    });
  }
};

/**
 * Get all bookings
 * GET /api/admin/bookings
 */
const getBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const result = await getAllBookings(status, page, limit);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings'
    });
  }
};

/**
 * Get all vehicles
 * GET /api/admin/vehicles
 */
const getVehicles = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await getAllVehicles(page, limit);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Get vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicles'
    });
  }
};

/**
 * Get revenue report
 * GET /api/admin/revenue
 */
const getRevenue = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const result = await getRevenueReport(startDate, endDate);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Get revenue error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch revenue report'
    });
  }
};

/**
 * Export data to CSV
 * GET /api/admin/export/:type
 */
const exportData = async (req, res) => {
  try {
    const { type } = req.params; // users, bookings, vehicles, revenue
    const { status, role } = req.query;

    let data = [];
    let filename = '';
    let headers = [];

    switch (type) {
      case 'users':
        const usersResult = await getAllUsers(role, status, 1, 10000);
        data = usersResult.users;
        filename = `users_export_${Date.now()}.csv`;
        headers = ['ID', 'Name', 'Phone', 'Email', 'Role', 'Status', 'Created At', 'Last Login'];
        
        // Convert to CSV
        const usersCsv = convertToCSV(data, [
          'id', 'full_name', 'phone_number', 'email', 'role', 
          row => row.is_active ? 'Active' : 'Blocked',
          'created_at', 'last_login_at'
        ], headers);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(usersCsv);

      case 'bookings':
        const bookingsResult = await getAllBookings(status, 1, 10000);
        data = bookingsResult.bookings;
        filename = `bookings_export_${Date.now()}.csv`;
        headers = ['Booking Number', 'Farmer', 'Owner', 'Vehicle', 'Service', 'Amount', 'Status', 'Date'];
        
        const bookingsCsv = convertToCSV(data, [
          'booking_number', 'farmer_name', 'owner_name', 'vehicle_name', 
          'service_type', 'total_farmer_pays', 'status', 'created_at'
        ], headers);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(bookingsCsv);

      case 'vehicles':
        const vehiclesResult = await getAllVehicles(1, 10000);
        data = vehiclesResult.vehicles;
        filename = `vehicles_export_${Date.now()}.csv`;
        headers = ['Name', 'Type', 'Model', 'Owner', 'Phone', 'Rating', 'Total Bookings', 'Created At'];
        
        const vehiclesCsv = convertToCSV(data, [
          'name', 'type', 'model', 'owner_name', 'owner_phone', 
          'average_rating', 'total_bookings', 'created_at'
        ], headers);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(vehiclesCsv);

      case 'revenue':
        const revenueResult = await getRevenueReport();
        data = revenueResult.dailyReport;
        filename = `revenue_export_${Date.now()}.csv`;
        headers = ['Date', 'Bookings', 'Base Amount', 'Farmer Fees', 'Owner Commission', 'Platform Earnings'];
        
        const revenueCsv = convertToCSV(data, [
          'date', 'total_bookings', 'total_base_amount', 
          'total_farmer_fees', 'total_owner_commission', 'total_platform_earnings'
        ], headers);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(revenueCsv);

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type. Use: users, bookings, vehicles, or revenue'
        });
    }

  } catch (error) {
    logger.error('Export data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data'
    });
  }
};

/**
 * Helper function to convert data to CSV
 */
function convertToCSV(data, fields, headers) {
  if (data.length === 0) {
    return headers.join(',') + '\n';
  }

  // Create CSV header
  let csv = headers.join(',') + '\n';

  // Add data rows
  data.forEach(row => {
    const values = fields.map(field => {
      let value;
      
      if (typeof field === 'function') {
        value = field(row);
      } else {
        value = row[field];
      }
      
      // Handle null/undefined
      if (value === null || value === undefined) {
        return '';
      }
      
      // Handle dates
      if (value instanceof Date) {
        value = value.toISOString().split('T')[0];
      }
      
      // Handle strings with commas or quotes
      if (typeof value === 'string') {
        value = value.replace(/"/g, '""'); // Escape quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          value = `"${value}"`;
        }
      }
      
      return value;
    });
    
    csv += values.join(',') + '\n';
  });

  return csv;
}

module.exports = {
  getPlatformStatistics,
  getUsers,
  blockUser,
  unblockUser,
  getBookings,
  getVehicles,
  getRevenue,
  exportData
};