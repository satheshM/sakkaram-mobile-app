const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/bookings
 * @desc    Create booking (Farmer)
 * @access  Private (Farmer only)
 */
router.post('/', verifyToken, checkRole('farmer'), bookingController.createBooking);

/**
 * @route   GET /api/bookings
 * @desc    Get all bookings (filtered by role)
 * @access  Private
 */
router.get('/', verifyToken, bookingController.getBookings);

/**
 * @route   GET /api/bookings/:id
 * @desc    Get single booking details
 * @access  Private
 */
router.get('/:id', verifyToken, bookingController.getBookingById);

/**
 * @route   PUT /api/bookings/:id/accept
 * @desc    Accept booking (Owner)
 * @access  Private (Owner only)
 */
router.put('/:id/accept', verifyToken, checkRole('owner'), bookingController.acceptBooking);

/**
 * @route   PUT /api/bookings/:id/reject
 * @desc    Reject booking (Owner)
 * @access  Private (Owner only)
 */
router.put('/:id/reject', verifyToken, checkRole('owner'), bookingController.rejectBooking);

/**
 * @route   PUT /api/bookings/:id/start
 * @desc    Start work (Owner)
 * @access  Private (Owner only)
 */
router.put('/:id/start', verifyToken, checkRole('owner'), bookingController.startWork);

/**
 * @route   PUT /api/bookings/:id/complete
 * @desc    Complete work (Owner)
 * @access  Private (Owner only)
 */
router.put('/:id/complete', verifyToken, checkRole('owner'), bookingController.completeWork);

/**
 * @route   PUT /api/bookings/:id/cancel
 * @desc    Cancel booking (Farmer or Owner)
 * @access  Private
 */
router.put('/:id/cancel', verifyToken, bookingController.cancelBooking);

module.exports = router;