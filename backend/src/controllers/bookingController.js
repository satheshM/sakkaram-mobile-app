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
 * CRITICAL FIX — serviceName vs serviceType mismatch:
 *
 * The mobile AddVehicle screen stores services as:
 *   { serviceName: 'Ploughing', pricingType: 'hourly', hourlyRate: 500 }
 *
 * The old BookingCreate screen sent: serviceType = service.serviceName (the label)
 * The old controller looked for: s.serviceType === serviceType  <-- always failed!
 *
 * FIX: Service lookup now checks BOTH s.serviceType AND s.serviceName so it
 * works regardless of which key the owner used when adding the vehicle.
 */

const safeParseJSON = (value, fallback = []) => {
  if (Array.isArray(value))   return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
};


const findService = (servicesOffered, serviceType) => {
  const arr    = safeParseJSON(servicesOffered);
  const target = (serviceType || '').trim().toLowerCase();
  return arr.find((s) =>
    (s.serviceType || '').trim().toLowerCase() === target ||
    (s.serviceName || '').trim().toLowerCase() === target
  ) || null;
};

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
      notes,
      couponCode,
    } = req.body;

    // Validate required fields
    if (!vehicleId || !serviceType || !scheduledDate) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle, service type, and scheduled date are required'
      });
    }

    // Validate date is not in the past
    const bookingDate = new Date(scheduledDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Scheduled date cannot be in the past'
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

    // ✅ FIXED: Dual-key service lookup (serviceName OR serviceType)
    const servicesOffered = safeParseJSON(vehicle.services_offered);
    const selectedService = findService(servicesOffered, serviceType);

    if (!selectedService) {
      // Debug: log what we have to help diagnose
      logger.warn('Service not found', {
        serviceTypeRequested: serviceType,
        servicesAvailable: servicesOffered.map((s) => ({
          serviceName: s.serviceName,
          serviceType: s.serviceType,
        })),
      });

      const availableServices = servicesOffered
        .map((s) => s.serviceName || s.serviceType)
        .filter(Boolean)
        .join(', ');

      return res.status(400).json({
        success: false,
        message: `Service "${serviceType}" not offered by this vehicle. Available: ${availableServices || 'none listed'}`
      });
    }

    // Calculate distance
    const distanceKm = farmerLocationLat && farmerLocationLng && vehicle.location_lat && vehicle.location_lng
      ? calculateDistance(
          parseFloat(farmerLocationLat),
          parseFloat(farmerLocationLng),
          parseFloat(vehicle.location_lat),
          parseFloat(vehicle.location_lng)
        )
      : 0;

    // Calculate pricing
    let baseAmount = 0;
    let hourlyRate = null;
    let perAcreRate = null;
    let fixedPrice = null;

    if (selectedService.pricingType === 'hourly') {
      hourlyRate = parseFloat(selectedService.hourlyRate);
      baseAmount = hourlyRate * (parseFloat(estimatedHours) || 1);
    } else if (selectedService.pricingType === 'per_acre') {
      perAcreRate = parseFloat(selectedService.perAcreRate);
      baseAmount = perAcreRate * (parseFloat(landSizeAcres) || 1);
    } else if (selectedService.pricingType === 'fixed') {
      fixedPrice = parseFloat(selectedService.fixedPrice);
      baseAmount = fixedPrice;
    }

    // Apply coupon discount if provided
    let discountAmount = 0;
    if (couponCode) {
      try {
        const couponResult = await query(
          `SELECT * FROM coupons 
           WHERE code = $1 AND is_active = true 
             AND (expires_at IS NULL OR expires_at > NOW())
             AND (max_uses IS NULL OR uses_count < max_uses)`,
          [couponCode.toUpperCase()]
        );
        if (couponResult.rows.length > 0) {
          const coupon = couponResult.rows[0];
          if (coupon.discount_type === 'percentage') {
            discountAmount = baseAmount * (coupon.discount_value / 100);
            if (coupon.max_discount_amount) {
              discountAmount = Math.min(discountAmount, coupon.max_discount_amount);
            }
          } else {
            discountAmount = Math.min(coupon.discount_value, baseAmount);
          }
          // Increment coupon use count
          await query('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = $1', [coupon.id]);
        }
      } catch (couponErr) {
        logger.warn('Coupon apply error:', couponErr.message);
      }
    }

    const discountedBase = baseAmount - discountAmount;

    // Calculate commission (5% from farmer, 5% from owner)
    const farmerServiceFee = discountedBase * 0.05;
    const ownerCommission  = discountedBase * 0.05;
    const platformEarning  = farmerServiceFee + ownerCommission;
    const totalFarmerPays  = discountedBase + farmerServiceFee;
    const totalOwnerReceives = discountedBase - ownerCommission;

    // Generate booking number
    const bookingNumber = `BK${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Normalize service name for storage
    const resolvedServiceName = selectedService.serviceName || selectedService.serviceType || serviceType;

    // Create booking
    const bookingResult = await query(
      `INSERT INTO bookings (
        booking_number, farmer_id, vehicle_id, owner_id,
        service_type, service_category,
        farmer_location_lat, farmer_location_lng, farmer_location_address,
        distance_km, scheduled_date, scheduled_time,
        land_size_acres, estimated_hours,
        pricing_type, hourly_rate, per_acre_rate, fixed_price,
        base_amount, discount_amount, farmer_service_fee, owner_commission,
        platform_earning, total_farmer_pays, total_owner_receives,
        coupon_code,
        status, payment_status, notes, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
        'pending', 'pending', $27, NOW()
      ) RETURNING *`,
      [
        bookingNumber, farmerId, vehicleId, ownerId,
        resolvedServiceName, vehicle.type,
        farmerLocationLat || null, farmerLocationLng || null, farmerLocationAddress || null,
        distanceKm, scheduledDate, scheduledTime || '09:00',
        landSizeAcres || null, estimatedHours || null,
        selectedService.pricingType, hourlyRate, perAcreRate, fixedPrice,
        baseAmount, discountAmount, farmerServiceFee, ownerCommission,
        platformEarning, totalFarmerPays, totalOwnerReceives,
        couponCode || null,
        notes || null
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

    logger.info('Booking created', { bookingId: booking.id, bookingNumber, farmerId, vehicleId });

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking
    });

  } catch (error) {
    logger.error('Create booking error:', error);
    // Surface DB errors for debugging in staging
    res.status(500).json({
      success: false,
      message: error.code === '23502'
        ? 'Missing required booking field: ' + error.column
        : 'Failed to create booking'
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

    const offset = (parseInt(page) - 1) * parseInt(limit);

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
    params.push(parseInt(limit), offset);

    const result = await query(queryText, params);

    // Count
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
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalBookings: totalCount,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    logger.error('Get bookings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
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
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    res.status(200).json({ success: true, booking: result.rows[0] });

  } catch (error) {
    logger.error('Get booking error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch booking' });
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

    const bookingResult = await query(
      'SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]
    );
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    if (booking.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Only the vehicle owner can accept this booking' });
    }
    if (booking.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot accept booking in ${booking.status} status` });
    }

    const updateResult = await query(
      `UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    setImmediate(async () => {
      try {
        const vehicleResult = await query('SELECT name FROM vehicles WHERE id = $1', [booking.vehicle_id]);
        await notifyBookingAccepted(booking.farmer_id, booking.id, booking.booking_number, vehicleResult.rows[0]?.name || 'Vehicle');
      } catch (e) { logger.error('Notification error:', e); }
    });

    res.status(200).json({ success: true, message: 'Booking accepted successfully', booking: updateResult.rows[0] });

  } catch (error) {
    logger.error('Accept booking error:', error);
    res.status(500).json({ success: false, message: 'Failed to accept booking' });
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
    const { reason, rejectionReason } = req.body;
    const rejectReason = reason || rejectionReason || 'Rejected by owner';

    const bookingResult = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    if (booking.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Only the vehicle owner can reject this booking' });
    }
    if (booking.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot reject booking in ${booking.status} status` });
    }

    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'rejected', cancellation_reason = $1, cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [rejectReason, id]
    );

    setImmediate(async () => {
      try {
        const vehicleResult = await query('SELECT name FROM vehicles WHERE id = $1', [booking.vehicle_id]);
        await notifyBookingRejected(booking.farmer_id, booking.id, booking.booking_number, vehicleResult.rows[0]?.name || 'Vehicle');
      } catch (e) { logger.error('Notification error:', e); }
    });

    res.status(200).json({ success: true, message: 'Booking rejected', booking: updateResult.rows[0] });

  } catch (error) {
    logger.error('Reject booking error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject booking' });
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

    const bookingResult = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    if (booking.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Only the vehicle owner can start work' });
    }
    if (booking.status !== 'confirmed') {
      return res.status(400).json({ success: false, message: `Cannot start work for booking in ${booking.status} status` });
    }

    const updateResult = await query(
      `UPDATE bookings SET status = 'in_progress', work_started_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    setImmediate(async () => {
      try {
        await notifyWorkStarted(booking.farmer_id, booking.id, booking.booking_number);
      } catch (e) { logger.error('Notification error:', e); }
    });

    res.status(200).json({ success: true, message: 'Work started successfully', booking: updateResult.rows[0] });

  } catch (error) {
    logger.error('Start work error:', error);
    res.status(500).json({ success: false, message: 'Failed to start work' });
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

    const bookingResult = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    if (booking.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'Only the vehicle owner can complete work' });
    }
    if (booking.status !== 'in_progress') {
      return res.status(400).json({ success: false, message: `Cannot complete work for booking in ${booking.status} status` });
    }

    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'completed', work_completed_at = NOW(), 
           actual_hours = $1, completion_notes = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [actualHours || booking.estimated_hours, completionNotes || null, id]
    );

    setImmediate(async () => {
      try {
        await notifyWorkCompleted(booking.farmer_id, booking.id, booking.booking_number, booking.total_farmer_pays);
      } catch (e) { logger.error('Notification error:', e); }
    });

    res.status(200).json({ success: true, message: 'Work completed successfully', booking: updateResult.rows[0] });

  } catch (error) {
    logger.error('Complete work error:', error);
    res.status(500).json({ success: false, message: 'Failed to complete work' });
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
    const { reason, cancellationReason } = req.body;
    const cancelReason = reason || cancellationReason || 'Cancelled by user';

    const bookingResult = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    if (booking.farmer_id !== userId && booking.owner_id !== userId) {
      return res.status(403).json({ success: false, message: 'You are not authorized to cancel this booking' });
    }
    if (['completed', 'cancelled', 'rejected'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel booking in ${booking.status} status` });
    }

    const cancelledBy = booking.farmer_id === userId ? 'farmer' : 'owner';

    const updateResult = await query(
      `UPDATE bookings 
       SET status = 'cancelled', cancelled_by = $1, cancellation_reason = $2,
           cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [cancelledBy, cancelReason, id]
    );

    res.status(200).json({ success: true, message: 'Booking cancelled successfully', booking: updateResult.rows[0] });

  } catch (error) {
    logger.error('Cancel booking error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel booking' });
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
