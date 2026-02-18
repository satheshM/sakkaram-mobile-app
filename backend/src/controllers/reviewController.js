const {
  submitReview,
  getVehicleReviews,
  getBookingReview,
  getFarmerReviews,
  deleteReview
} = require('../services/reviewService');
const logger = require('../config/logger');

/**
 * Submit a review for a booking
 * POST /api/reviews
 */
const createReview = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { bookingId, rating, comment } = req.body;

    // Validate input
    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    const review = await submitReview(bookingId, userId, rating, comment);

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      review
    });

  } catch (error) {
    logger.error('Create review error:', error);
    
    // Handle specific errors
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    if (error.message.includes('already submitted') || 
        error.message.includes('Only the farmer') ||
        error.message.includes('completed bookings')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to submit review'
    });
  }
};

/**
 * Get reviews for a vehicle
 * GET /api/reviews/vehicle/:vehicleId
 */
const getVehicleReviewsController = async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!vehicleId) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle ID is required'
      });
    }

    const result = await getVehicleReviews(vehicleId, page, limit);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Get vehicle reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
};

/**
 * Get review for a specific booking
 * GET /api/reviews/booking/:bookingId
 */
const getBookingReviewController = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.userId;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    const review = await getBookingReview(bookingId, userId);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'No review found for this booking'
      });
    }

    res.status(200).json({
      success: true,
      review
    });

  } catch (error) {
    logger.error('Get booking review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch review'
    });
  }
};

/**
 * Get all reviews submitted by the current farmer
 * GET /api/reviews/my-reviews
 */
const getMyReviews = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;

    const result = await getFarmerReviews(userId, page, limit);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Get my reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your reviews'
    });
  }
};

/**
 * Delete a review (Admin only)
 * DELETE /api/reviews/:reviewId
 */
const deleteReviewController = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userRole = req.user.role;

    // Check if user is admin
    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete reviews'
      });
    }

    if (!reviewId) {
      return res.status(400).json({
        success: false,
        message: 'Review ID is required'
      });
    }

    await deleteReview(reviewId);

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully'
    });

  } catch (error) {
    logger.error('Delete review error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to delete review'
    });
  }
};



module.exports = {
  createReview,
  getVehicleReviewsController,
  getBookingReviewController,
  getMyReviews,
  deleteReviewController
};