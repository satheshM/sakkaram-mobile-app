require('dotenv').config();
const { query } = require('../config/db');
const locationService = require('../services/locationService');
const logger = require('../config/logger');

/**
 * Create Booking (Farmer)
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
    if (!vehicleId || !serviceType || !farmerLocationLat || !farmerLocationLng || !scheduledDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: vehicleId, serviceType, location, and scheduledDate are required'
      });
    }

    // Get vehicle details
    const vehicleResult = await query(
      `SELECT v.*, u.id as owner_id, u.full_name as owner_name 
       FROM vehicles v 
       JOIN users u ON v.owner_id = u.id 
       WHERE v.id = $1 AND v.is_available = true AND v.deleted_at IS NULL`,
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

    // Check if within service radius
    const distance = locationService.calculateDistance(
      parseFloat(vehicle.location_lat),
      parseFloat(vehicle.location_lng),
      parseFloat(farmerLocationLat),
      parseFloat(farmerLocationLng)
    );

    const distanceKm = distance.distanceValue / 1000;
    if (distanceKm > vehicle.service_radius_km) {
      return res.status(400).json({
        success: false,
        message: `Location is outside service area. Maximum distance: ${vehicle.service_radius_km} km, Your distance: ${distanceKm.toFixed(1)} km`
      });
    }

    // Find service pricing from vehicle's services_offered
    const services = vehicle.services_offered;
    const selectedService = services.find(s => s.serviceName === serviceType);

    if (!selectedService) {
      return res.status(400).json({
        success: false,
        message: 'Selected service not offered by this vehicle'
      });
    }

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

    logger.info(`Booking created: ${bookingNumber} by farmer ${farmerId}`);

    res.status(201).json({
      success: true,
      message: 'Booking request created successfully',
      booking: bookingResult.rows[0],
      pricing: {
        baseAmount,
        farmerServiceFee,
        totalFarmerPays,
        ownerReceives: totalOwnerReceives,
        platformEarning
      }
    });

  } catch (error) {
    logger.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get All Bookings (filtered by user role)
 */
const getBookings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { status, page = 1, limit = 20 } = req.query;

    let queryText = `
      SELECT b.*, 
             v.name as vehicle_name, v.type as vehicle_type, v.model as vehicle_model,
             f.full_name as farmer_name, f.phone_number as farmer_phone,
             o.full_name as owner_name, o.phone_number as owner_phone
      FROM bookings b
      JOIN vehicles v ON b.vehicle_id = v.id
      JOIN users f ON b.farmer_id = f.id
      JOIN users o ON b.owner_id = o.id
      WHERE b.deleted_at IS NULL
    `;

    const params = [];
    let paramIndex = 1;

    // Filter by user role
    if (userRole === 'farmer') {
      queryText += ` AND b.farmer_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    } else if (userRole === 'owner') {
      queryText += ` AND b.owner_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    // Filter by status
    if (status) {
      queryText += ` AND b.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    queryText += ` ORDER BY b.created_at DESC`;

    // Pagination
    const offset = (page - 1) * limit;
    queryText += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM bookings b WHERE b.deleted_at IS NULL`;
    const countParams = [];
    
    if (userRole === 'farmer') {
      countQuery += ` AND b.farmer_id = $1`;
      countParams.push(userId);
    } else if (userRole === 'owner') {
      countQuery += ` AND b.owner_id = $1`;
      countParams.push(userId);
    }

    if (status) {
      countQuery += ` AND b.status = $${countParams.length + 1}`;
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
 * Get Single Booking
 */
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await query(
      `SELECT b.*, 
              v.name as vehicle_name, v.type as vehicle_type, v.model as vehicle_model,
              v.images as vehicle_images, v.registration_number,
              f.full_name as farmer_name, f.phone_number as farmer_phone,
              o.full_name as owner_name, o.phone_number as owner_phone
       FROM bookings b
       JOIN vehicles v ON b.vehicle_id = v.id
       JOIN users f ON b.farmer_id = f.id
       JOIN users o ON b.owner_id = o.id
       WHERE b.id = $1 AND b.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const booking = result.rows[0];

    // Check access permission
    if (booking.farmer_id !== userId && booking.owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.status(200).json({
      success: true,
      booking
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
 * Accept Booking (Owner)
 */
const acceptBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;

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

    if (booking.owner_id !== ownerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept booking. Current status: ${booking.status}`
      });
    }

    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'confirmed', updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    logger.info(`Booking ${id} accepted by owner ${ownerId}`);

    res.status(200).json({
      success: true,
      message: 'Booking accepted successfully',
      booking: updateResult.rows[0]
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
 * Reject Booking (Owner)
 */
const rejectBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;
    const { reason } = req.body;

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

    if (booking.owner_id !== ownerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject booking. Current status: ${booking.status}`
      });
    }

    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'rejected', 
           cancellation_reason = $1,
           updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [reason || 'Rejected by owner', id]
    );

    logger.info(`Booking ${id} rejected by owner ${ownerId}`);

    res.status(200).json({
      success: true,
      message: 'Booking rejected',
      booking: updateResult.rows[0]
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
 * Start Work (Owner)
 */
const startWork = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;

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

    if (booking.owner_id !== ownerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (booking.status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot start work. Current status: ${booking.status}`
      });
    }

    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'in_progress', 
           work_started_at = NOW(),
           updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    logger.info(`Work started for booking ${id} by owner ${ownerId}`);

    res.status(200).json({
      success: true,
      message: 'Work started successfully',
      booking: updateResult.rows[0]
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
 * Complete Work (Owner)
 */
const completeWork = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;
    const { actualHours, actualArea, completionNotes } = req.body;

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

    if (booking.owner_id !== ownerId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (booking.status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        message: `Cannot complete work. Current status: ${booking.status}`
      });
    }

    // Recalculate amount if actual hours/area provided
    let finalAmount = booking.base_amount;
    
    if (actualHours && booking.pricing_type === 'hourly') {
      finalAmount = booking.hourly_rate * actualHours;
    } else if (actualArea && booking.pricing_type === 'per_acre') {
      finalAmount = booking.per_acre_rate * actualArea;
    }

    // Recalculate commission
    const farmerServiceFee = finalAmount * 0.05;
    const ownerCommission = finalAmount * 0.05;
    const platformEarning = farmerServiceFee + ownerCommission;
    const totalFarmerPays = finalAmount + farmerServiceFee;
    const totalOwnerReceives = finalAmount - ownerCommission;

    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'completed', 
           work_completed_at = NOW(),
           actual_hours = $1,
           base_amount = $2,
           farmer_service_fee = $3,
           owner_commission = $4,
           platform_earning = $5,
           total_farmer_pays = $6,
           total_owner_receives = $7,
           completion_notes = $8,
           updated_at = NOW() 
       WHERE id = $9 
       RETURNING *`,
      [
        actualHours || booking.estimated_hours,
        finalAmount,
        farmerServiceFee,
        ownerCommission,
        platformEarning,
        totalFarmerPays,
        totalOwnerReceives,
        completionNotes,
        id
      ]
    );

    logger.info(`Work completed for booking ${id} by owner ${ownerId}`);

    res.status(200).json({
      success: true,
      message: 'Work completed successfully. Awaiting payment from farmer.',
      booking: updateResult.rows[0],
      payment: {
        farmerMustPay: totalFarmerPays,
        ownerWillReceive: totalOwnerReceives,
        platformEarning
      }
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
 * Cancel Booking (Farmer or Owner)
 */
const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { reason } = req.body;

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

    if (booking.farmer_id !== userId && booking.owner_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (['completed', 'cancelled'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel booking. Current status: ${booking.status}`
      });
    }

    const cancelledBy = booking.farmer_id === userId ? 'farmer' : 'owner';

    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'cancelled', 
           cancelled_by = $1,
           cancellation_reason = $2,
           updated_at = NOW() 
       WHERE id = $3 
       RETURNING *`,
      [cancelledBy, reason || 'No reason provided', id]
    );

    logger.info(`Booking ${id} cancelled by ${cancelledBy} (${userId})`);

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