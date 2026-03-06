const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken } = require('../middlewares/authMiddleware');
const { isAdmin } = require('../middlewares/adminMiddleware');

// All admin routes require authentication + admin role
router.use(verifyToken);
router.use(isAdmin);

/**
 * @route   GET /api/admin/stats
 * @desc    Get platform statistics
 * @access  Admin only
 */
router.get('/stats', adminController.getPlatformStatistics);

/**
 * @route   GET /api/admin/users
 * @desc    Get all users with filters
 * @access  Admin only
 */
router.get('/users', adminController.getUsers);

/**
 * @route   PUT /api/admin/users/:userId/block
 * @desc    Block a user
 * @access  Admin only
 */
router.put('/users/:userId/block', adminController.blockUser);

/**
 * @route   PUT /api/admin/users/:userId/unblock
 * @desc    Unblock a user
 * @access  Admin only
 */
router.put('/users/:userId/unblock', adminController.unblockUser);

/**
 * @route   GET /api/admin/bookings
 * @desc    Get all bookings
 * @access  Admin only
 */
router.get('/bookings', adminController.getBookings);

/**
 * @route   GET /api/admin/vehicles
 * @desc    Get all vehicles
 * @access  Admin only
 */
router.get('/vehicles', adminController.getVehicles);

/**
 * @route   GET /api/admin/revenue
 * @desc    Get revenue report
 * @access  Admin only
 */
router.get('/revenue', adminController.getRevenue);

/**
 * @route   GET /api/admin/export/:type
 * @desc    Export data to CSV (types: users, bookings, vehicles, revenue)
 * @access  Admin only
 */
router.get('/export/:type', adminController.exportData);

/**
 * @route   GET  /api/admin/topup-requests
 * @desc    Get all wallet topup requests (filterable by status)
 * @access  Admin only
 */
router.get('/topup-requests', adminController.getTopupRequestsHandler);

/**
 * @route   PUT  /api/admin/topup-requests/:requestId/approve
 * @desc    Approve a topup request and credit user wallet
 * @access  Admin only
 */
router.put('/topup-requests/:requestId/approve', adminController.approveTopup);

/**
 * @route   PUT  /api/admin/topup-requests/:requestId/reject
 * @desc    Reject a topup request
 * @access  Admin only
 */
router.put('/topup-requests/:requestId/reject', adminController.rejectTopup);

module.exports = router;