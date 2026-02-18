const { pool } = require('../config/db');
const logger = require('../config/logger');

// Validate and apply coupon
const validateCoupon = async (code, userId, bookingAmount) => {
  try {
    // Get coupon
    const couponResult = await pool.query(
      `SELECT * FROM coupons 
       WHERE code = $1 AND is_active = true`,
      [code.toUpperCase()]
    );

    if (couponResult.rows.length === 0) {
      throw new Error('Invalid or expired coupon code');
    }

    const coupon = couponResult.rows[0];

    // Check validity period
    const now = new Date();
    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      throw new Error('Coupon has expired');
    }

    if (new Date(coupon.valid_from) > now) {
      throw new Error('Coupon is not yet active');
    }

    // Check max uses
    if (coupon.max_uses && coupon.total_uses >= coupon.max_uses) {
      throw new Error('Coupon usage limit reached');
    }

    // Check per user usage
    const userUsage = await pool.query(
      `SELECT COUNT(*) FROM coupon_usage 
       WHERE coupon_id = $1 AND user_id = $2`,
      [coupon.id, userId]
    );

    if (parseInt(userUsage.rows[0].count) >= (coupon.max_uses_per_user || 1)) {
      throw new Error('You have already used this coupon');
    }

    // Check minimum booking amount
    if (coupon.min_booking_amount && bookingAmount < coupon.min_booking_amount) {
      throw new Error(`Minimum booking amount of ₹${coupon.min_booking_amount} required`);
    }

    // Calculate discount
    let discountAmount = 0;

    if (coupon.discount_type === 'percentage') {
      discountAmount = (bookingAmount * coupon.discount_value) / 100;
      if (coupon.max_discount_amount) {
        discountAmount = Math.min(discountAmount, coupon.max_discount_amount);
      }
    } else if (coupon.discount_type === 'fixed') {
      discountAmount = Math.min(coupon.discount_value, bookingAmount);
    }

    discountAmount = parseFloat(discountAmount.toFixed(2));
    const finalAmount = parseFloat((bookingAmount - discountAmount).toFixed(2));

    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discount_type,
        discountValue: coupon.discount_value
      },
      discountAmount,
      originalAmount: bookingAmount,
      finalAmount
    };

  } catch (error) {
    logger.error('Validate coupon error:', error);
    throw error;
  }
};

// Record coupon usage
const recordCouponUsage = async (couponId, userId, bookingId, discountAmount) => {
  try {
    await pool.query(
      `INSERT INTO coupon_usage (coupon_id, user_id, booking_id, discount_applied, used_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [couponId, userId, bookingId, discountAmount]
    );

    // Increment usage count
    await pool.query(
      'UPDATE coupons SET total_uses = total_uses + 1 WHERE id = $1',
      [couponId]
    );

  } catch (error) {
    logger.error('Record coupon usage error:', error);
    throw error;
  }
};

// Create coupon (admin only)
const createCoupon = async (couponData, adminId) => {
  try {
    const {
      code,
      description,
      discountType,
      discountValue,
      minBookingAmount,
      maxDiscountAmount,
      maxUses,
      maxUsesPerUser,
      validFrom,
      validUntil
    } = couponData;

    const result = await pool.query(
      `INSERT INTO coupons (
        code, description, discount_type, discount_value,
        min_booking_amount, max_discount_amount,
        max_uses, max_uses_per_user,
        valid_from, valid_until,
        is_active, created_by, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,NOW())
      RETURNING *`,
      [
        code.toUpperCase(),
        description,
        discountType,
        discountValue,
        minBookingAmount || 0,
        maxDiscountAmount,
        maxUses,
        maxUsesPerUser || 1,
        validFrom || new Date(),
        validUntil,
        adminId
      ]
    );

    return result.rows[0];

  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Coupon code already exists');
    }
    logger.error('Create coupon error:', error);
    throw error;
  }
};

// Get all active coupons
const getActiveCoupons = async () => {
  try {
    const result = await pool.query(
      `SELECT * FROM coupons 
       WHERE is_active = true 
         AND (valid_until IS NULL OR valid_until > NOW())
         AND (max_uses IS NULL OR total_uses < max_uses)
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (error) {
    logger.error('Get coupons error:', error);
    throw error;
  }
};

module.exports = {
  validateCoupon,
  recordCouponUsage,
  createCoupon,
  getActiveCoupons
};