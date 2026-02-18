const {
  validateCoupon,
  createCoupon,
  getActiveCoupons
} = require('../services/couponService');
const logger = require('../config/logger');

const validate = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { code, bookingAmount } = req.body;

    if (!code || !bookingAmount) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code and booking amount are required'
      });
    }

    const result = await validateCoupon(code, userId, parseFloat(bookingAmount));

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Validate coupon error:', error);

    if (error.message.includes('Invalid') ||
        error.message.includes('expired') ||
        error.message.includes('limit') ||
        error.message.includes('already used') ||
        error.message.includes('Minimum')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to validate coupon'
    });
  }
};

const create = async (req, res) => {
  try {
    const adminId = req.user.userId;

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const coupon = await createCoupon(req.body, adminId);

    res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      coupon
    });

  } catch (error) {
    logger.error('Create coupon error:', error);

    if (error.message.includes('already exists')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create coupon'
    });
  }
};

const getActive = async (req, res) => {
  try {
    const coupons = await getActiveCoupons();

    res.status(200).json({
      success: true,
      coupons
    });

  } catch (error) {
    logger.error('Get coupons error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get coupons'
    });
  }
};

module.exports = { validate, create, getActive };