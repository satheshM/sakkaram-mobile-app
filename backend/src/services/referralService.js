const { pool } = require('../config/db');
const logger = require('../config/logger');

// Generate unique referral code
const generateReferralCode = (name) => {
  const prefix = name
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .substring(0, 4)
    .padEnd(4, 'X');
  const suffix = Math.random().toString(36).toUpperCase().substring(2, 7);
  return `${prefix}${suffix}`;
};

// Get or create referral code for user
const getUserReferralCode = async (userId) => {
  try {
    // Check if already has code
    const existing = await pool.query(
      'SELECT * FROM referral_codes WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // Get user name for code generation
    const userResult = await pool.query(
      'SELECT full_name FROM users WHERE id = $1',
      [userId]
    );

    const name = userResult.rows[0]?.full_name || 'USER';
    let code = generateReferralCode(name);

    // Ensure unique
    let attempts = 0;
    while (attempts < 5) {
      const codeCheck = await pool.query(
        'SELECT id FROM referral_codes WHERE code = $1',
        [code]
      );

      if (codeCheck.rows.length === 0) break;

      code = generateReferralCode(name);
      attempts++;
    }

    // Create referral code
    const result = await pool.query(
      `INSERT INTO referral_codes (user_id, code, created_at)
       VALUES ($1, $2, NOW()) RETURNING *`,
      [userId, code]
    );

    return result.rows[0];

  } catch (error) {
    logger.error('Get referral code error:', error);
    throw error;
  }
};

// Apply referral code during signup
const applyReferralCode = async (newUserId, referralCode) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Find referral code
    const codeResult = await client.query(
      'SELECT * FROM referral_codes WHERE code = $1',
      [referralCode.toUpperCase()]
    );

    if (codeResult.rows.length === 0) {
      throw new Error('Invalid referral code');
    }

    const referralCodeRecord = codeResult.rows[0];

    // Prevent self-referral
    if (referralCodeRecord.user_id === newUserId) {
      throw new Error('Cannot use your own referral code');
    }

    // Check if already used referral
    const alreadyUsed = await client.query(
      'SELECT id FROM referral_usage WHERE referred_user_id = $1',
      [newUserId]
    );

    if (alreadyUsed.rows.length > 0) {
      throw new Error('Referral code already applied');
    }

    const REFERRER_REWARD = 50;  // ₹50 for referrer
    const REFERRED_REWARD = 50;  // ₹50 for new user

    // Record usage
    await client.query(
      `INSERT INTO referral_usage (
        referral_code_id, referred_user_id,
        referrer_reward, referred_reward,
        status, created_at
      ) VALUES ($1, $2, $3, $4, 'completed', NOW())`,
      [referralCodeRecord.id, newUserId, REFERRER_REWARD, REFERRED_REWARD]
    );

    // Credit referrer wallet
    const referrerWallet = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1',
      [referralCodeRecord.user_id]
    );

    if (referrerWallet.rows.length > 0) {
      const oldBalance = parseFloat(referrerWallet.rows[0].balance);
      const newBalance = oldBalance + REFERRER_REWARD;

      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
        [newBalance, referrerWallet.rows[0].id]
      );

      await client.query(
        `INSERT INTO wallet_transactions (
          wallet_id, transaction_type, amount,
          balance_before, balance_after,
          description, reference_type, created_at
        ) VALUES ($1, 'credit', $2, $3, $4, $5, 'referral', NOW())`,
        [
          referrerWallet.rows[0].id,
          REFERRER_REWARD,
          oldBalance,
          newBalance,
          `Referral reward - friend joined using your code`
        ]
      );
    }

    // Credit new user wallet
    const newUserWallet = await client.query(
      'SELECT id, balance FROM wallets WHERE user_id = $1',
      [newUserId]
    );

    if (newUserWallet.rows.length > 0) {
      const oldBalance = parseFloat(newUserWallet.rows[0].balance);
      const newBalance = oldBalance + REFERRED_REWARD;

      await client.query(
        'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
        [newBalance, newUserWallet.rows[0].id]
      );

      await client.query(
        `INSERT INTO wallet_transactions (
          wallet_id, transaction_type, amount,
          balance_before, balance_after,
          description, reference_type, created_at
        ) VALUES ($1, 'credit', $2, $3, $4, $5, 'referral', NOW())`,
        [
          newUserWallet.rows[0].id,
          REFERRED_REWARD,
          oldBalance,
          newBalance,
          `Welcome bonus - referral code applied`
        ]
      );
    }

    // Update referral code stats
    await client.query(
      `UPDATE referral_codes 
       SET total_referrals = total_referrals + 1,
           total_earnings = total_earnings + $1
       WHERE id = $2`,
      [REFERRER_REWARD, referralCodeRecord.id]
    );

    await client.query('COMMIT');

    logger.info('Referral applied', {
      newUserId,
      referrerId: referralCodeRecord.user_id,
      code: referralCode
    });

    return {
      success: true,
      referrerReward: REFERRER_REWARD,
      referredReward: REFERRED_REWARD,
      message: `₹${REFERRED_REWARD} added to your wallet!`
    };

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Apply referral error:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Get referral stats
const getReferralStats = async (userId) => {
  try {
    const codeResult = await pool.query(
      'SELECT * FROM referral_codes WHERE user_id = $1',
      [userId]
    );

    if (codeResult.rows.length === 0) {
      const code = await getUserReferralCode(userId);
      return {
        code: code.code,
        totalReferrals: 0,
        totalEarnings: 0,
        referrals: []
      };
    }

    const referralCode = codeResult.rows[0];

    // Get referral list
    const referrals = await pool.query(
      `SELECT 
        ru.created_at,
        ru.referrer_reward,
        ru.status,
        u.full_name as referred_name
       FROM referral_usage ru
       JOIN users u ON u.id = ru.referred_user_id
       WHERE ru.referral_code_id = $1
       ORDER BY ru.created_at DESC`,
      [referralCode.id]
    );

    return {
      code: referralCode.code,
      totalReferrals: referralCode.total_referrals,
      totalEarnings: parseFloat(referralCode.total_earnings),
      referrals: referrals.rows
    };

  } catch (error) {
    logger.error('Get referral stats error:', error);
    throw error;
  }
};

module.exports = {
  getUserReferralCode,
  applyReferralCode,
  getReferralStats
};