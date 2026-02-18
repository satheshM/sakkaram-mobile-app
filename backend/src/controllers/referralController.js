const {
  getUserReferralCode,
  applyReferralCode,
  getReferralStats
} = require('../services/referralService');
const logger = require('../config/logger');

const getMyReferralCode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const code = await getUserReferralCode(userId);

    res.status(200).json({
      success: true,
      referralCode: code.code,
      totalReferrals: code.total_referrals,
      totalEarnings: code.total_earnings,
      shareMessage: `Join Sakkaram and earn ₹50! Use my referral code: ${code.code}`
    });

  } catch (error) {
    logger.error('Get referral code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get referral code'
    });
  }
};

const applyCode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Referral code is required'
      });
    }

    const result = await applyReferralCode(userId, code);

    res.status(200).json({
      success: true,
      message: result.message,
      reward: result.referredReward
    });

  } catch (error) {
    logger.error('Apply referral error:', error);

    if (error.message.includes('Invalid') ||
        error.message.includes('already') ||
        error.message.includes('own')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to apply referral code'
    });
  }
};

const getStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const stats = await getReferralStats(userId);

    res.status(200).json({
      success: true,
      stats
    });

  } catch (error) {
    logger.error('Get referral stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get referral stats'
    });
  }
};

module.exports = { getMyReferralCode, applyCode, getStats };