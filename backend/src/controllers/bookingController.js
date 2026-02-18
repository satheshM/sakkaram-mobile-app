require('dotenv').config();
const { query } = require('../config/db');
const logger = require('../config/logger');
const {
  notifyNewBooking,
  notifyBookingAccepted,
  notifyBookingRejected,
  notifyWorkStarted,
  notifyWorkCompleted
} = require('../services/notificationService');

/**
 * Create a new booking
 * POST /api/bookings
 */
const createBooking = async (req, res) => {
  try {
    const farmerId = req.user.userId;
    const {
      vehicleId,
      serviceType,
      farmerLocationLat,
      farmerLocationLng,
      farmerLocationAddress,
      scheduledDate,
      scheduledTime,
      landSizeAcres,
      estimatedHours,
      notes
    } = req.body;

    // Validate required fields
    if (!vehicleId || !serviceType || !scheduledDate) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle, service type, and scheduled date are required'
      });
    }

    // Get vehicle details
    const vehicleResult = await query(
      `SELECT v.*, u.id as owner_id 
       FROM vehicles v 
       JOIN users u ON u.id = v.owner_id 
       WHERE v.id = $1 AND v.deleted_at IS NULL AND v.is_available = true`,
      [vehicleId]
    );

    if (vehicleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found or not available'
      });
    }

    const vehicle = vehicleResult.rows[0];
    const ownerId = vehicle.owner_id;

    // Prevent self-booking
    if (ownerId === farmerId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot book your own vehicle'
      });
    }

    // Find matching service
    const servicesOffered = vehicle.services_offered || [];
    const selectedService = servicesOffered.find(s => s.serviceType === serviceType);

   
    if (!selectedService) {
      return res.status(400).json({
        success: false,
        message: 'This service is not offered by this vehicle'
      });
    }

    // Calculate distance
    const distanceKm = farmerLocationLat && farmerLocationLng && vehicle.location_lat && vehicle.location_lng
      ? calculateDistance(
          farmerLocationLat,
          farmerLocationLng,
          vehicle.location_lat,
          vehicle.location_lng
        )
      : 0;

    // Calculate pricing
    let baseAmount = 0;
    let hourlyRate = null;
    let perAcreRate = null;
    let fixedPrice = null;

    if (selectedService.pricingType === 'hourly') {
      hourlyRate = selectedService.hourlyRate;
      baseAmount = hourlyRate * (estimatedHours || 1);
    } else if (selectedService.pricingType === 'per_acre') {
      perAcreRate = selectedService.perAcreRate;
      baseAmount = perAcreRate * (landSizeAcres || 1);
    } else if (selectedService.pricingType === 'fixed') {
      fixedPrice = selectedService.fixedPrice;
      baseAmount = fixedPrice;
    }

    // Calculate commission (5% from farmer, 5% from owner)
    const farmerServiceFee = baseAmount * 0.05;
    const ownerCommission = baseAmount * 0.05;
    const platformEarning = farmerServiceFee + ownerCommission;
    const totalFarmerPays = baseAmount + farmerServiceFee;
    const totalOwnerReceives = baseAmount - ownerCommission;

    // Generate booking number
    const bookingNumber = `BK${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Create booking
    const bookingResult = await query(
      `INSERT INTO bookings (
        booking_number, farmer_id, vehicle_id, owner_id,
        service_type, service_category,
        farmer_location_lat, farmer_location_lng, farmer_location_address,
        distance_km, scheduled_date, scheduled_time,
        land_size_acres, estimated_hours,
        pricing_type, hourly_rate, per_acre_rate, fixed_price,
        base_amount, farmer_service_fee, owner_commission,
        platform_earning, total_farmer_pays, total_owner_receives,
        status, payment_status, notes, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
        'pending', 'pending', $25, NOW()
      ) RETURNING *`,
      [
        bookingNumber, farmerId, vehicleId, ownerId,
        serviceType, vehicle.type,
        farmerLocationLat, farmerLocationLng, farmerLocationAddress,
        distanceKm, scheduledDate, scheduledTime || '09:00',
        landSizeAcres, estimatedHours,
        selectedService.pricingType, hourlyRate, perAcreRate, fixedPrice,
        baseAmount, farmerServiceFee, ownerCommission,
        platformEarning, totalFarmerPays, totalOwnerReceives,
        notes
      ]
    );

    const booking = bookingResult.rows[0];

    // Send notification to owner (non-blocking)
    setImmediate(async () => {
      try {
        const farmerResult = await query(
          'SELECT full_name FROM users WHERE id = $1',
          [farmerId]
        );

        await notifyNewBooking(
          ownerId,
          booking.id,
          bookingNumber,
          farmerResult.rows[0]?.full_name || 'A farmer'
        );
      } catch (notifError) {
        logger.error('Failed to send notification:', notifError);
      }
    });

    logger.info('Booking created', {
      bookingId: booking.id,
      bookingNumber,
      farmerId,
      vehicleId
    });

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking
    });

  } catch (error) {
    logger.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking'
    });
  }
};

/**
 * Get bookings (farmer's or owner's bookings)
 * GET /api/bookings
 */
const getBookings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { status, page = 1, limit = 20 } = req.query;

    const offset = (page - 1) * limit;

    let queryText = `
      SELECT 
        b.*,
        v.name as vehicle_name,
        v.type as vehicle_type,
        v.model as vehicle_model,
        v.images as vehicle_images,
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

    if (userRole === 'farmer') {
      paramCount++;
      queryText += ` AND b.farmer_id = $${paramCount}`;
      params.push(userId);
    } else if (userRole === 'owner') {
      paramCount++;
      queryText += ` AND b.owner_id = $${paramCount}`;
      params.push(userId);
    }

    if (status) {
      paramCount++;
      queryText += ` AND b.status = $${paramCount}`;
      params.push(status);
    }

    queryText += ` ORDER BY b.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM bookings WHERE deleted_at IS NULL';
    const countParams = [];
    let countParamCount = 0;

    if (userRole === 'farmer') {
      countParamCount++;
      countQuery += ` AND farmer_id = $${countParamCount}`;
      countParams.push(userId);
    } else if (userRole === 'owner') {
      countParamCount++;
      countQuery += ` AND owner_id = $${countParamCount}`;
      countParams.push(userId);
    }

    if (status) {
      countParamCount++;
      countQuery += ` AND status = $${countParamCount}`;
      countParams.push(status);
    }

    const countResult = await query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    res.status(200).json({
      success: true,
      bookings: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalBookings: totalCount,
        limit: parseInt(limit)
      }
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
 * Get single booking details
 * GET /api/bookings/:id
 */
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await query(
      `SELECT 
        b.*,
        v.name as vehicle_name,
        v.type as vehicle_type,
        v.model as vehicle_model,
        v.images as vehicle_images,
        v.location_lat as vehicle_lat,
        v.location_lng as vehicle_lng,
        farmer.full_name as farmer_name,
        farmer.phone_number as farmer_phone,
        farmer.profile_image_url as farmer_image,
        owner.full_name as owner_name,
        owner.phone_number as owner_phone,
        owner.profile_image_url as owner_image
      FROM bookings b
      LEFT JOIN vehicles v ON v.id = b.vehicle_id
      LEFT JOIN users farmer ON farmer.id = b.farmer_id
      LEFT JOIN users owner ON owner.id = b.owner_id
      WHERE b.id = $1 AND b.deleted_at IS NULL
        AND (b.farmer_id = $2 OR b.owner_id = $2)`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.status(200).json({
      success: true,
      booking: result.rows[0]
    });

  } catch (error) {
    logger.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking'
    });
  }
};

/**
 * Accept a booking (Owner only)
 * PUT /api/bookings/:id/accept
 */
const acceptBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Get booking
    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookingResult.rows[0];

    // Check if user is owner
    if (booking.owner_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the vehicle owner can accept this booking'
      });
    }

    // Check if booking is in pending status
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept booking in ${booking.status} status`
      });
    }

    // Update booking status
    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'confirmed', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    const updatedBooking = updateResult.rows[0];

    // Send notification to farmer (non-blocking)
    setImmediate(async () => {
      try {
        const vehicleResult = await query(
          'SELECT name FROM vehicles WHERE id = $1',
          [booking.vehicle_id]
        );

        await notifyBookingAccepted(
          booking.farmer_id,
          booking.id,
          booking.booking_number,
          vehicleResult.rows[0]?.name || 'Vehicle'
        );
      } catch (notifError) {
        logger.error('Failed to send notification:', notifError);
      }
    });

    logger.info('Booking accepted', { bookingId: id, ownerId: userId });

    res.status(200).json({
      success: true,
      message: 'Booking accepted successfully',
      booking: updatedBooking
    });

  } catch (error) {
    logger.error('Accept booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept booking'
    });
  }
};

/**
 * Reject a booking (Owner only)
 * PUT /api/bookings/:id/reject
 */
const rejectBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { rejectionReason } = req.body;

    // Get booking
    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookingResult.rows[0];

    // Check if user is owner
    if (booking.owner_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the vehicle owner can reject this booking'
      });
    }

    // Check if booking is in pending status
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject booking in ${booking.status} status`
      });
    }

    // Update booking status
    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'rejected',
           cancellation_reason = $1,
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [rejectionReason || 'Rejected by owner', id]
    );

    const updatedBooking = updateResult.rows[0];

    // Send notification to farmer (non-blocking)
    setImmediate(async () => {
      try {
        const vehicleResult = await query(
          'SELECT name FROM vehicles WHERE id = $1',
          [booking.vehicle_id]
        );

        await notifyBookingRejected(
          booking.farmer_id,
          booking.id,
          booking.booking_number,
          vehicleResult.rows[0]?.name || 'Vehicle'
        );
      } catch (notifError) {
        logger.error('Failed to send notification:', notifError);
      }
    });

    logger.info('Booking rejected', { bookingId: id, ownerId: userId });

    res.status(200).json({
      success: true,
      message: 'Booking rejected',
      booking: updatedBooking
    });

  } catch (error) {
    logger.error('Reject booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject booking'
    });
  }
};

/**
 * Start work (Owner only)
 * PUT /api/bookings/:id/start
 */
const startWork = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Get booking
    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookingResult.rows[0];

    // Check if user is owner
    if (booking.owner_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the vehicle owner can start work'
      });
    }

    // Check if booking is confirmed
    if (booking.status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot start work for booking in ${booking.status} status`
      });
    }

    // Update booking status
    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'in_progress',
           work_started_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    const updatedBooking = updateResult.rows[0];

    // Send notification to farmer (non-blocking)
    setImmediate(async () => {
      try {
        await notifyWorkStarted(
          booking.farmer_id,
          booking.id,
          booking.booking_number
        );
      } catch (notifError) {
        logger.error('Failed to send notification:', notifError);
      }
    });

    logger.info('Work started', { bookingId: id, ownerId: userId });

    res.status(200).json({
      success: true,
      message: 'Work started successfully',
      booking: updatedBooking
    });

  } catch (error) {
    logger.error('Start work error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start work'
    });
  }
};

/**
 * Complete work (Owner only)
 * PUT /api/bookings/:id/complete
 */
const completeWork = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { actualHours, completionNotes } = req.body;

    // Get booking
    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookingResult.rows[0];

    // Check if user is owner
    if (booking.owner_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the vehicle owner can complete work'
      });
    }

    // Check if booking is in progress
    if (booking.status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete work for booking in ${booking.status} status`
      });
    }

    // Update booking status
    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'completed',
           work_completed_at = NOW(),
           actual_hours = $1,
           completion_notes = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [actualHours || booking.estimated_hours, completionNotes, id]
    );

    const updatedBooking = updateResult.rows[0];

    // Send notification to farmer (non-blocking)
    setImmediate(async () => {
      try {
        await notifyWorkCompleted(
          booking.farmer_id,
          booking.id,
          booking.booking_number,
          booking.total_farmer_pays
        );
      } catch (notifError) {
        logger.error('Failed to send notification:', notifError);
      }
    });

    logger.info('Work completed', { bookingId: id, ownerId: userId });

    res.status(200).json({
      success: true,
      message: 'Work completed successfully',
      booking: updatedBooking
    });

  } catch (error) {
    logger.error('Complete work error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete work'
    });
  }
};

/**
 * Cancel booking
 * PUT /api/bookings/:id/cancel
 */
const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { cancellationReason } = req.body;

    // Get booking
    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = bookingResult.rows[0];

    // Check if user is farmer or owner
    if (booking.farmer_id !== userId && booking.owner_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to cancel this booking'
      });
    }

    // Check if booking can be cancelled
    if (booking.status === 'completed' || booking.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel booking in ${booking.status} status`
      });
    }

    // Determine who cancelled
    const cancelledBy = booking.farmer_id === userId ? 'farmer' : 'owner';

    // Update booking status
    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'cancelled',
           cancelled_by = $1,
           cancellation_reason = $2,
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [cancelledBy, cancellationReason || 'Cancelled by user', id]
    );

    logger.info('Booking cancelled', { bookingId: id, cancelledBy, userId });

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      booking: updateResult.rows[0]
    });

  } catch (error) {
    logger.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
};

// Helper: Calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = {
  createBooking,
  getBookings,
  getBookingById,
  acceptBooking,
  rejectBooking,
  startWork,
  completeWork,
  cancelBooking
};