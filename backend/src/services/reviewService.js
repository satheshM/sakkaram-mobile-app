const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Submit a review for a booking
 */
const submitReview = async (bookingId, userId, rating, comment) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Verify booking exists and belongs to farmer
    const bookingResult = await client.query(
      `SELECT id, farmer_id, owner_id, vehicle_id, status, payment_status
       FROM bookings 
       WHERE id = $1 AND deleted_at IS NULL`,
      [bookingId]
    );

    if (bookingResult.rows.length === 0) {
      throw new Error('Booking not found');
    }

    const booking = bookingResult.rows[0];

    // 2. Verify user is the farmer
    if (booking.farmer_id !== userId) {
      throw new Error('Only the farmer can review this booking');
    }

    // 3. Verify booking is completed
    if (booking.status !== 'completed') {
      throw new Error('Can only review completed bookings');
    }

    // 4. Check if review already exists
    const existingReview = await client.query(
      'SELECT id FROM reviews WHERE booking_id = $1',
      [bookingId]
    );

    if (existingReview.rows.length > 0) {
      throw new Error('Review already submitted for this booking');
    }

    // 5. Validate rating
    if (!rating || rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    // 6. Create review
    const reviewResult = await client.query(
      `INSERT INTO reviews (
        booking_id,
        vehicle_id,
        farmer_id,
        owner_id,
        rating,
        comment,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *`,
      [
        bookingId,
        booking.vehicle_id,
        booking.farmer_id,
        booking.owner_id,
        rating,
        comment || null
      ]
    );

    const review = reviewResult.rows[0];

    // 7. Update vehicle average rating
    await updateVehicleRating(client, booking.vehicle_id);

    await client.query('COMMIT');

    logger.info('Review submitted', {
      reviewId: review.id,
      bookingId,
      vehicleId: booking.vehicle_id,
      rating
    });

    return review;

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Submit review error:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Update vehicle average rating and review count
 */
const updateVehicleRating = async (client, vehicleId) => {
  try {
    // Calculate average rating and count
    const statsResult = await client.query(
      `SELECT 
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating
       FROM reviews 
       WHERE vehicle_id = $1`,
      [vehicleId]
    );

    const stats = statsResult.rows[0];
    const avgRating = parseFloat(stats.average_rating) || 0;
    const totalReviews = parseInt(stats.total_reviews) || 0;

    // Update vehicle
    await client.query(
      `UPDATE vehicles 
       SET average_rating = $1,
           total_reviews = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [avgRating.toFixed(2), totalReviews, vehicleId]
    );

    logger.info('Vehicle rating updated', {
      vehicleId,
      averageRating: avgRating.toFixed(2),
      totalReviews
    });

  } catch (error) {
    logger.error('Update vehicle rating error:', error);
    throw error;
  }
};

/**
 * Get reviews for a vehicle
 */
const getVehicleReviews = async (vehicleId, page = 1, limit = 10) => {
  try {
    const offset = (page - 1) * limit;

    // Get reviews with farmer details
    const reviewsResult = await pool.query(
      `SELECT 
        r.*,
        u.full_name as farmer_name,
        u.profile_image_url as farmer_image
       FROM reviews r
       LEFT JOIN users u ON u.id = r.farmer_id
       WHERE r.vehicle_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [vehicleId, limit, offset]
    );

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM reviews WHERE vehicle_id = $1',
      [vehicleId]
    );

    const totalCount = parseInt(countResult.rows[0].count);

    // Get rating distribution
    const distributionResult = await pool.query(
      `SELECT 
        rating,
        COUNT(*) as count
       FROM reviews 
       WHERE vehicle_id = $1
       GROUP BY rating
       ORDER BY rating DESC`,
      [vehicleId]
    );

    const distribution = {
      5: 0, 4: 0, 3: 0, 2: 0, 1: 0
    };

    distributionResult.rows.forEach(row => {
      distribution[row.rating] = parseInt(row.count);
    });

    return {
      reviews: reviewsResult.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalReviews: totalCount,
        limit: parseInt(limit)
      },
      ratingDistribution: distribution
    };

  } catch (error) {
    logger.error('Get vehicle reviews error:', error);
    throw error;
  }
};

/**
 * Get review for a specific booking
 */
const getBookingReview = async (bookingId, userId) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.full_name as farmer_name
       FROM reviews r
       LEFT JOIN users u ON u.id = r.farmer_id
       WHERE r.booking_id = $1`,
      [bookingId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];

  } catch (error) {
    logger.error('Get booking review error:', error);
    throw error;
  }
};

/**
 * Get all reviews by a farmer
 */
const getFarmerReviews = async (userId, page = 1, limit = 10) => {
  try {
    const offset = (page - 1) * limit;

    const reviewsResult = await pool.query(
      `SELECT 
        r.*,
        v.name as vehicle_name,
        v.type as vehicle_type,
        b.booking_number
       FROM reviews r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN bookings b ON b.id = r.booking_id
       WHERE r.farmer_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM reviews WHERE farmer_id = $1',
      [userId]
    );

    const totalCount = parseInt(countResult.rows[0].count);

    return {
      reviews: reviewsResult.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalReviews: totalCount,
        limit: parseInt(limit)
      }
    };

  } catch (error) {
    logger.error('Get farmer reviews error:', error);
    throw error;
  }
};

/**
 * Delete review (admin only)
 */
const deleteReview = async (reviewId) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Get review details
    const reviewResult = await client.query(
      'SELECT * FROM reviews WHERE id = $1',
      [reviewId]
    );

    if (reviewResult.rows.length === 0) {
      throw new Error('Review not found');
    }

    const review = reviewResult.rows[0];

    // Delete review
    await client.query(
      'DELETE FROM reviews WHERE id = $1',
      [reviewId]
    );

    // Update vehicle rating
    await updateVehicleRating(client, review.vehicle_id);

    await client.query('COMMIT');

    logger.info('Review deleted', { reviewId, vehicleId: review.vehicle_id });

    return true;

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Delete review error:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  submitReview,
  getVehicleReviews,
  getBookingReview,
  getFarmerReviews,
  deleteReview,
  updateVehicleRating
};