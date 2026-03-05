require('dotenv').config();
const { query, pool } = require('../config/db');
const logger = require('../config/logger');
const {
  notifyNewBooking,
  notifyBookingAccepted,
  notifyBookingRejected,
  notifyWorkStarted,
  notifyWorkCompleted
} = require('../services/notificationService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const safeParseJSON = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
};

const findService = (servicesOffered, serviceType) => {
  const arr = safeParseJSON(servicesOffered);
  const target = (serviceType || '').trim().toLowerCase();
  return arr.find((s) =>
    (s.serviceType || '').trim().toLowerCase() === target ||
    (s.serviceName || '').trim().toLowerCase() === target
  ) || null;
};

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

// ─── Create Booking ───────────────────────────────────────────────────────────

const createBooking = async (req, res) => {
  try {
    const farmerId = req.user.userId;
    const {
      vehicleId, serviceType,
      farmerLocationLat, farmerLocationLng, farmerLocationAddress,
      scheduledDate, scheduledTime,
      landSizeAcres, estimatedHours, notes, couponCode,
    } = req.body;

    if (!vehicleId || !serviceType || !scheduledDate) {
      return res.status(400).json({ success: false, message: 'Vehicle, service type, and scheduled date are required' });
    }

    const bookingDate = new Date(scheduledDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      return res.status(400).json({ success: false, message: 'Scheduled date cannot be in the past' });
    }

    const vehicleResult = await query(
      `SELECT v.*, u.id as owner_id FROM vehicles v
       JOIN users u ON u.id = v.owner_id
       WHERE v.id = $1 AND v.deleted_at IS NULL AND v.is_available = true`,
      [vehicleId]
    );
    if (vehicleResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Vehicle not found or not available' });
    }

    const vehicle = vehicleResult.rows[0];
    const ownerId = vehicle.owner_id;

    if (ownerId === farmerId) {
      return res.status(400).json({ success: false, message: 'You cannot book your own vehicle' });
    }

    const selectedService = findService(vehicle.services_offered, serviceType);
    if (!selectedService) {
      const available = safeParseJSON(vehicle.services_offered)
        .map(s => s.serviceName || s.serviceType).filter(Boolean).join(', ');
      return res.status(400).json({
        success: false,
        message: `Service "${serviceType}" not offered. Available: ${available || 'none'}`
      });
    }

    const distanceKm = farmerLocationLat && farmerLocationLng && vehicle.location_lat && vehicle.location_lng
      ? calculateDistance(
          parseFloat(farmerLocationLat), parseFloat(farmerLocationLng),
          parseFloat(vehicle.location_lat), parseFloat(vehicle.location_lng))
      : 0;

    let baseAmount = 0, hourlyRate = null, perAcreRate = null, fixedPrice = null;
    if (selectedService.pricingType === 'hourly') {
      hourlyRate  = parseFloat(selectedService.hourlyRate);
      baseAmount  = hourlyRate * (parseFloat(estimatedHours) || 1);
    } else if (selectedService.pricingType === 'per_acre') {
      perAcreRate = parseFloat(selectedService.perAcreRate);
      baseAmount  = perAcreRate * (parseFloat(landSizeAcres) || 1);
    } else {
      fixedPrice  = parseFloat(selectedService.fixedPrice);
      baseAmount  = fixedPrice;
    }

    let discountAmount = 0;
    if (couponCode) {
      try {
        const couponResult = await query(
          `SELECT * FROM coupons WHERE code = $1 AND is_active = true
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (max_uses IS NULL OR uses_count < max_uses)`,
          [couponCode.toUpperCase()]
        );
        if (couponResult.rows.length > 0) {
          const c = couponResult.rows[0];
          discountAmount = c.discount_type === 'percentage'
            ? Math.min(baseAmount * c.discount_value / 100, c.max_discount_amount || Infinity)
            : Math.min(c.discount_value, baseAmount);
          await query('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = $1', [c.id]);
        }
      } catch (e) { logger.warn('Coupon error:', e.message); }
    }

    const discountedBase     = baseAmount - discountAmount;
    const farmerServiceFee   = discountedBase * 0.05;   // 5% platform fee on farmer
    const ownerCommission    = discountedBase * 0.05;   // 5% platform commission from owner
    const platformEarning    = farmerServiceFee + ownerCommission;
    const totalFarmerPays    = discountedBase + farmerServiceFee;
    const totalOwnerReceives = discountedBase - ownerCommission;

    const bookingNumber     = `BK${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const resolvedService   = selectedService.serviceName || selectedService.serviceType || serviceType;

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
         coupon_code, status, payment_status, notes, created_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
         'pending','pending',$27,NOW()
       ) RETURNING *`,
      [
        bookingNumber, farmerId, vehicleId, ownerId,
        resolvedService, vehicle.type,
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

    setImmediate(async () => {
      try {
        const farmerRow = await query('SELECT full_name FROM users WHERE id = $1', [farmerId]);
        await notifyNewBooking(ownerId, booking.id, bookingNumber, farmerRow.rows[0]?.full_name || 'A farmer');
      } catch (e) { logger.error('Notification error:', e); }
    });

    logger.info('Booking created', { bookingId: booking.id, farmerId, vehicleId });
    res.status(201).json({ success: true, message: 'Booking created successfully', booking });

  } catch (error) {
    logger.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: error.code === '23502' ? `Missing required field: ${error.column}` : 'Failed to create booking'
    });
  }
};

// ─── Get Bookings List ────────────────────────────────────────────────────────

const getBookings = async (req, res) => {
  try {
    const userId = req.user.userId, userRole = req.user.role;
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let q = `SELECT b.*,
        v.name as vehicle_name, v.type as vehicle_type, v.model as vehicle_model, v.images as vehicle_images,
        farmer.full_name as farmer_name, farmer.phone_number as farmer_phone,
        owner.full_name as owner_name, owner.phone_number as owner_phone
      FROM bookings b
      LEFT JOIN vehicles v ON v.id = b.vehicle_id
      LEFT JOIN users farmer ON farmer.id = b.farmer_id
      LEFT JOIN users owner ON owner.id = b.owner_id
      WHERE b.deleted_at IS NULL`;

    const params = [];
    if (userRole === 'farmer') { params.push(userId); q += ` AND b.farmer_id = $${params.length}`; }
    else if (userRole === 'owner') { params.push(userId); q += ` AND b.owner_id = $${params.length}`; }
    if (status) { params.push(status); q += ` AND b.status = $${params.length}`; }
    q += ` ORDER BY b.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(parseInt(limit), offset);

    const result = await query(q, params);

    let cq = 'SELECT COUNT(*) FROM bookings WHERE deleted_at IS NULL';
    const cp = [];
    if (userRole === 'farmer') { cp.push(userId); cq += ` AND farmer_id = $${cp.length}`; }
    else if (userRole === 'owner') { cp.push(userId); cq += ` AND owner_id = $${cp.length}`; }
    if (status) { cp.push(status); cq += ` AND status = $${cp.length}`; }
    const countResult = await query(cq, cp);

    res.status(200).json({
      success: true,
      bookings: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit)),
        totalBookings: parseInt(countResult.rows[0].count),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    logger.error('Get bookings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
};

// ─── Get Booking By ID ────────────────────────────────────────────────────────
// FIX: Added vehicle_address (v.location_address) to the SELECT

const getBookingById = async (req, res) => {
  try {
    const { id } = req.params, userId = req.user.userId;

    const result = await query(
      `SELECT b.*,
          v.name as vehicle_name, v.type as vehicle_type, v.model as vehicle_model,
          v.images as vehicle_images,
          v.location_lat as vehicle_lat,
          v.location_lng as vehicle_lng,
          v.location_address as vehicle_address,
          v.service_radius_km as vehicle_service_radius,
          v.services_offered as vehicle_services_offered,
          farmer.full_name as farmer_name, farmer.phone_number as farmer_phone,
          farmer.profile_image_url as farmer_image,
          owner.full_name as owner_name, owner.phone_number as owner_phone,
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

// ─── Accept ───────────────────────────────────────────────────────────────────

const acceptBooking = async (req, res) => {
  try {
    const { id } = req.params, userId = req.user.userId;
    const row = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row.rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const b = row.rows[0];
    if (b.owner_id !== userId) return res.status(403).json({ success: false, message: 'Only the vehicle owner can accept' });
    if (b.status !== 'pending') return res.status(400).json({ success: false, message: `Cannot accept in ${b.status} status` });

    const upd = await query(`UPDATE bookings SET status='confirmed', updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);
    setImmediate(async () => {
      try {
        const v = await query('SELECT name FROM vehicles WHERE id = $1', [b.vehicle_id]);
        await notifyBookingAccepted(b.farmer_id, b.id, b.booking_number, v.rows[0]?.name || 'Vehicle');
      } catch(e) { logger.error('Notify error:', e); }
    });
    res.status(200).json({ success: true, message: 'Booking accepted', booking: upd.rows[0] });
  } catch(e) { logger.error('Accept error:', e); res.status(500).json({ success: false, message: 'Failed to accept' }); }
};

// ─── Reject ───────────────────────────────────────────────────────────────────

const rejectBooking = async (req, res) => {
  try {
    const { id } = req.params, userId = req.user.userId;
    const { reason, rejectionReason } = req.body;
    const rejectReason = reason || rejectionReason || 'Rejected by owner';
    const row = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row.rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const b = row.rows[0];
    if (b.owner_id !== userId) return res.status(403).json({ success: false, message: 'Only the vehicle owner can reject' });
    if (b.status !== 'pending') return res.status(400).json({ success: false, message: `Cannot reject in ${b.status} status` });

    const upd = await query(
      `UPDATE bookings SET status='rejected', cancellation_reason=$1, cancelled_at=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *`,
      [rejectReason, id]
    );
    setImmediate(async () => {
      try {
        const v = await query('SELECT name FROM vehicles WHERE id = $1', [b.vehicle_id]);
        await notifyBookingRejected(b.farmer_id, b.id, b.booking_number, v.rows[0]?.name || 'Vehicle');
      } catch(e) { logger.error('Notify error:', e); }
    });
    res.status(200).json({ success: true, message: 'Booking rejected', booking: upd.rows[0] });
  } catch(e) { logger.error('Reject error:', e); res.status(500).json({ success: false, message: 'Failed to reject' }); }
};

// ─── Start Work ───────────────────────────────────────────────────────────────

const startWork = async (req, res) => {
  try {
    const { id } = req.params, userId = req.user.userId;
    const row = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row.rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const b = row.rows[0];
    if (b.owner_id !== userId) return res.status(403).json({ success: false, message: 'Only the vehicle owner can start work' });
    if (b.status !== 'confirmed') return res.status(400).json({ success: false, message: `Cannot start in ${b.status} status` });

    const upd = await query(
      `UPDATE bookings SET status='in_progress', work_started_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`, [id]
    );
    setImmediate(async () => {
      try { await notifyWorkStarted(b.farmer_id, b.id, b.booking_number); } catch(e) {}
    });
    res.status(200).json({ success: true, message: 'Work started', booking: upd.rows[0] });
  } catch(e) { logger.error('Start work error:', e); res.status(500).json({ success: false, message: 'Failed to start work' }); }
};

// ─── Complete Work ────────────────────────────────────────────────────────────
// FIX: Recalculates total_farmer_pays when actual_hours given for hourly pricing

const completeWork = async (req, res) => {
  try {
    const { id } = req.params, userId = req.user.userId;
    const { actualHours, completionNotes } = req.body;

    const row = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row.rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const b = row.rows[0];
    if (b.owner_id !== userId) return res.status(403).json({ success: false, message: 'Only the vehicle owner can complete' });
    if (b.status !== 'in_progress') return res.status(400).json({ success: false, message: `Cannot complete in ${b.status} status` });

    const finalHours = actualHours ? parseFloat(actualHours) : (parseFloat(b.estimated_hours) || 1);
    let finalBase = parseFloat(b.base_amount) || 0;
    let finalTotal = parseFloat(b.total_farmer_pays) || 0;
    let finalOwnerReceives = parseFloat(b.total_owner_receives) || 0;

    if (actualHours && b.pricing_type === 'hourly' && b.hourly_rate) {
      finalBase          = parseFloat(b.hourly_rate) * finalHours;
      const discount     = parseFloat(b.discount_amount) || 0;
      const discBase     = finalBase - discount;
      const farmerFee    = discBase * 0.05;
      const ownerComm    = discBase * 0.05;
      finalTotal         = discBase + farmerFee;
      finalOwnerReceives = discBase - ownerComm;
    }

    const upd = await query(
      `UPDATE bookings
         SET status='completed', work_completed_at=NOW(),
             actual_hours=$1, completion_notes=$2,
             base_amount=$3, total_farmer_pays=$4, total_owner_receives=$5,
             updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [finalHours, completionNotes || null, finalBase, finalTotal, finalOwnerReceives, id]
    );

    setImmediate(async () => {
      try { await notifyWorkCompleted(b.farmer_id, b.id, b.booking_number, finalTotal); } catch(e) {}
    });

    res.status(200).json({ success: true, message: 'Work completed', booking: upd.rows[0] });
  } catch(e) { logger.error('Complete work error:', e); res.status(500).json({ success: false, message: 'Failed to complete work' }); }
};

// ─── Cancel Booking ───────────────────────────────────────────────────────────

const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params, userId = req.user.userId;
    const { reason, cancellationReason } = req.body;
    const cancelReason = reason || cancellationReason || 'Cancelled by user';

    const row = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row.rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const b = row.rows[0];
    if (b.farmer_id !== userId && b.owner_id !== userId) return res.status(403).json({ success: false, message: 'Not authorized' });
    if (['completed','cancelled','rejected'].includes(b.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel in ${b.status} status` });
    }

    const cancelledBy = b.farmer_id === userId ? 'farmer' : 'owner';
    const upd = await query(
      `UPDATE bookings SET status='cancelled', cancelled_by=$1, cancellation_reason=$2,
         cancelled_at=NOW(), updated_at=NOW() WHERE id=$3 RETURNING *`,
      [cancelledBy, cancelReason, id]
    );
    res.status(200).json({ success: true, message: 'Booking cancelled', booking: upd.rows[0] });
  } catch(e) { logger.error('Cancel error:', e); res.status(500).json({ success: false, message: 'Failed to cancel' }); }
};

// ─── Submit Offline Payment (Farmer → sets pending_confirmation) ──────────────
/**
 * NEW FLOW for offline payments:
 * 1. Farmer selects Cash or UPI  → POST /api/bookings/:id/offline-payment
 *    → booking.payment_status = 'payment_pending_confirmation'
 *    → Owner gets a notification to confirm
 * 2. Owner confirms → PUT /api/bookings/:id/confirm-payment
 *    → booking.payment_status = 'paid'
 *    → Platform deducts owner commission (owner_commission) from owner's wallet
 */
const submitOfflinePayment = async (req, res) => {
  try {
    const { id } = req.params, userId = req.user.userId;
    const { paymentMethod, note } = req.body;

    if (!['cash', 'upi'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Payment method must be cash or upi' });
    }

    const row = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row.rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const b = row.rows[0];

    if (b.farmer_id !== userId) return res.status(403).json({ success: false, message: 'Only the farmer can submit payment' });
    if (b.status !== 'completed') return res.status(400).json({ success: false, message: 'Booking must be completed first' });
    if (['paid'].includes(b.payment_status)) return res.status(400).json({ success: false, message: 'Already paid' });

    const upd = await query(
      `UPDATE bookings
         SET payment_method = $1,
             offline_payment_method = $1,
             offline_payment_note = $2,
             payment_status = 'payment_pending_confirmation',
             updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [paymentMethod, note || null, id]
    );

    // Notify owner
    setImmediate(async () => {
      try {
        const { notifyPaymentPendingConfirmation } = require('../services/notificationService');
        if (notifyPaymentPendingConfirmation) {
          await notifyPaymentPendingConfirmation(b.owner_id, b.id, b.booking_number, paymentMethod);
        }
      } catch (e) { logger.warn('Notify payment pending:', e.message); }
    });

    logger.info('Offline payment submitted', { bookingId: id, paymentMethod, userId });
    res.status(200).json({
      success: true,
      message: `${paymentMethod === 'cash' ? 'Cash' : 'UPI'} payment submitted. Waiting for owner to confirm.`,
      booking: upd.rows[0]
    });
  } catch(e) {
    logger.error('Submit offline payment error:', e);
    res.status(500).json({ success: false, message: 'Failed to submit payment' });
  }
};

// ─── Confirm Payment Received (Owner) ─────────────────────────────────────────
/**
 * Owner confirms they received the offline payment.
 * Platform commission (owner_commission) is then deducted from owner's wallet.
 */
const confirmPaymentReceived = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params, userId = req.user.userId;

    const row = await client.query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    const b = row.rows[0];

    if (b.owner_id !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Only the vehicle owner can confirm payment' });
    }
    if (b.payment_status !== 'payment_pending_confirmation') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Payment is not pending confirmation. Current status: ${b.payment_status}`
      });
    }

    // Deduct owner commission from owner's wallet
    const ownerCommission = parseFloat(b.owner_commission) || 0;
    let platformFeeDeducted = false;

    if (ownerCommission > 0) {
      // Get or create owner wallet
      let walletRes = await client.query(
        'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]
      );

      if (walletRes.rows.length === 0) {
        // Create wallet with 0 balance
        await client.query(
          'INSERT INTO wallets (user_id, balance) VALUES ($1, 0.00) ON CONFLICT DO NOTHING', [userId]
        );
        walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
      }

      const wallet = walletRes.rows[0];
      const currentBalance = parseFloat(wallet.balance) || 0;

      if (currentBalance >= ownerCommission) {
        // Enough balance — deduct immediately
        await client.query(
          'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
          [ownerCommission, userId]
        );
        await client.query(
          `INSERT INTO wallet_transactions
             (wallet_id, transaction_type, amount, description, reference_id, created_at)
           VALUES ($1, 'debit', $2, $3, $4, NOW())`,
          [wallet.id, ownerCommission,
           `Platform commission for booking #${b.booking_number}`, b.id]
        );
        platformFeeDeducted = true;
        logger.info('Owner commission deducted from wallet', { bookingId: id, amount: ownerCommission, ownerId: userId });
      } else {
        // Insufficient wallet — mark as negative/owing (still allow confirm, deduct later)
        await client.query(
          'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
          [ownerCommission, userId]
        );
        await client.query(
          `INSERT INTO wallet_transactions
             (wallet_id, transaction_type, amount, description, reference_id, created_at)
           VALUES ($1, 'debit', $2, $3, $4, NOW())`,
          [wallet.id, ownerCommission,
           `Platform commission (booking #${b.booking_number}) - balance went negative`, b.id]
        );
        platformFeeDeducted = true;
        logger.warn('Owner wallet went negative after commission deduction', { bookingId: id, ownerId: userId });
      }
    }

    // Mark booking as paid
    const upd = await client.query(
      `UPDATE bookings
         SET payment_status = 'paid',
             payment_confirmed_at = NOW(),
             platform_fee_deducted = $1,
             owner_commission_deducted = $1,
             updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [platformFeeDeducted, id]
    );

    await client.query('COMMIT');

    logger.info('Payment confirmed by owner', { bookingId: id, ownerId: userId, commissionDeducted: ownerCommission });
    res.status(200).json({
      success: true,
      message: `Payment confirmed. Platform commission of ₹${ownerCommission.toFixed(2)} deducted from your wallet.`,
      booking: upd.rows[0],
      commissionDeducted: ownerCommission,
      platformFeeDeducted
    });

  } catch(e) {
    await client.query('ROLLBACK');
    logger.error('Confirm payment error:', e);
    res.status(500).json({ success: false, message: 'Failed to confirm payment' });
  } finally {
    client.release();
  }
};

// ─── Update Payment (online/wallet – legacy) ──────────────────────────────────

const updatePayment = async (req, res) => {
  try {
    const { id } = req.params, userId = req.user.userId;
    const { paymentMethod, paymentStatus } = req.body;

    if (!paymentMethod) return res.status(400).json({ success: false, message: 'Payment method is required' });

    const row = await query('SELECT * FROM bookings WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!row.rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const b = row.rows[0];

    if (b.farmer_id !== userId) return res.status(403).json({ success: false, message: 'Only the farmer can update payment' });
    if (b.status !== 'completed') return res.status(400).json({ success: false, message: 'Booking must be completed' });
    if (b.payment_status === 'paid') return res.status(400).json({ success: false, message: 'Already paid' });

    const upd = await query(
      `UPDATE bookings SET payment_method=$1, payment_status=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
      [paymentMethod, paymentStatus || 'paid', id]
    );
    res.status(200).json({ success: true, message: 'Payment updated', booking: upd.rows[0] });
  } catch(e) { logger.error('Update payment error:', e); res.status(500).json({ success: false, message: 'Failed to update payment' }); }
};

// ─── Get Owner's Pending Payment Confirmations ────────────────────────────────

const getPendingPaymentConfirmations = async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await query(
      `SELECT b.*,
          v.name as vehicle_name, v.type as vehicle_type,
          farmer.full_name as farmer_name, farmer.phone_number as farmer_phone
        FROM bookings b
        LEFT JOIN vehicles v ON v.id = b.vehicle_id
        LEFT JOIN users farmer ON farmer.id = b.farmer_id
        WHERE b.owner_id = $1
          AND b.payment_status = 'payment_pending_confirmation'
          AND b.deleted_at IS NULL
        ORDER BY b.updated_at DESC`,
      [userId]
    );
    res.status(200).json({ success: true, bookings: result.rows, count: result.rows.length });
  } catch(e) {
    logger.error('Get pending confirmations error:', e);
    res.status(500).json({ success: false, message: 'Failed to fetch pending confirmations' });
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
  cancelBooking,
  updatePayment,
  submitOfflinePayment,
  confirmPaymentReceived,
  getPendingPaymentConfirmations,
};
