const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { verifyToken } = require('../middlewares/authMiddleware');

/**
 * @route   POST /api/reviews
 * @desc    Submit a review for a booking
 * @access  Private (Farmer only)
 */
router.post('/', verifyToken, reviewController.createReview);

/**
 * @route   GET /api/reviews/vehicle/:vehicleId
 * @desc    Get all reviews for a vehicle
 * @access  Public
 */
router.get('/vehicle/:vehicleId', reviewController.getVehicleReviewsController);

/**
 * @route   GET /api/reviews/booking/:bookingId
 * @desc    Get review for a specific booking
 * @access  Private
 */
router.get('/booking/:bookingId', verifyToken, reviewController.getBookingReviewController);

/**
 * @route   GET /api/reviews/my-reviews
 * @desc    Get all reviews submitted by current user
 * @access  Private (Farmer)
 */
router.get('/my-reviews', verifyToken, reviewController.getMyReviews);

/**
 * @route   DELETE /api/reviews/:reviewId
 * @desc    Delete a review
 * @access  Private (Admin only)
 */
router.delete('/:reviewId', verifyToken, reviewController.deleteReviewController);

module.exports = router;