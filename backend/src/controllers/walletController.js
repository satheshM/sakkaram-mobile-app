require('dotenv').config();
const { query } = require('../config/db');
const logger = require('../config/logger');

/**
 * Get Wallet Balance
 */
const getWalletBalance = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Create wallet if doesn't exist
      const newWallet = await query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) RETURNING *',
        [userId]
      );
      return res.status(200).json({
        success: true,
        wallet: newWallet.rows[0]
      });
    }

    res.status(200).json({
      success: true,
      wallet: result.rows[0]
    });

  } catch (error) {
    logger.error('Get wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet'
    });
  }
};

/**
 * Add Money to Wallet (Top-up)
 */
const addMoney = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount, paymentScreenshot, transactionId, paymentMethod } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Get or create wallet
    let walletResult = await query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId]
    );

    let walletId;
    if (walletResult.rows.length === 0) {
      const newWallet = await query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, 0) RETURNING *',
        [userId]
      );
      walletId = newWallet.rows[0].id;
    } else {
      walletId = walletResult.rows[0].id;
    }

    // Update wallet balance
    const updateResult = await query(
      'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [amount, walletId]
    );

    const newBalance = updateResult.rows[0].balance;

    // Record transaction
    await query(
      `INSERT INTO wallet_transactions (
        wallet_id, type, amount, balance_after, description, created_at
      ) VALUES ($1, 'credit', $2, $3, $4, NOW())`,
      [
        walletId,
        amount,
        newBalance,
        `Wallet top-up via ${paymentMethod || 'UPI'}`
      ]
    );

    logger.info(`Wallet top-up: ${userId} added ₹${amount}`);

    res.status(200).json({
      success: true,
      message: 'Money added successfully',
      wallet: updateResult.rows[0]
    });

  } catch (error) {
    logger.error('Add money error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add money'
    });
  }
};

/**
 * Deduct Commission (Internal - called by booking system)
 */
const deductCommission = async (req, res) => {
  try {
    const { userId, amount, bookingId, description } = req.body;

  if (!userId || !amount || parseFloat(amount) <= 0) {
  return res.status(400).json({
    success: false,
    message: 'Invalid request'
  });
}
const deductAmount = parseFloat(amount);

    // Get wallet
    const walletResult = await query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (walletResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    const wallet = walletResult.rows[0];

// Check sufficient balance
if (wallet.balance < deductAmount) {  // ← FIXED
  return res.status(400).json({
    success: false,
    message: 'Insufficient wallet balance',
    required: deductAmount,  // ← Also fix this
    available: wallet.balance
  });
}

    // Deduct amount
    const updateResult = await query(
      'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [deductAmount, wallet.id]
    );

    const newBalance = updateResult.rows[0].balance;

    // Record transaction
   // Only include reference_id if it's a valid UUID
const values = [
  wallet.id,
  deductAmount,
  newBalance,
  description || 'Commission deducted'
];

let queryText = `INSERT INTO wallet_transactions (
  wallet_id, type, amount, balance_after, description, created_at
) VALUES ($1, 'debit', $2, $3, $4, NOW())`;

// Add reference fields only if bookingId is provided and valid UUID format
if (bookingId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
  queryText = `INSERT INTO wallet_transactions (
    wallet_id, type, amount, balance_after, reference_type, reference_id, description, created_at
  ) VALUES ($1, 'debit', $2, $3, 'booking', $4, $5, NOW())`;
  values.splice(3, 0, bookingId); // Insert bookingId before description
}

await query(queryText, values);

    logger.info(`Commission deducted: ${userId} - ₹${amount}`);

    res.status(200).json({
      success: true,
      message: 'Commission deducted',
      wallet: updateResult.rows[0]
    });

  } catch (error) {
    logger.error('Deduct commission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deduct commission'
    });
  }
};

/**
 * Get Wallet Transactions
 */
const getTransactions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    // Get wallet
    const walletResult = await query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (walletResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        transactions: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalTransactions: 0
        }
      });
    }

    const walletId = walletResult.rows[0].id;
    const offset = (page - 1) * limit;

    // Get transactions
    const transactionsResult = await query(
      `SELECT * FROM wallet_transactions 
       WHERE wallet_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [walletId, limit, offset]
    );

    // Get total count
    const countResult = await query(
      'SELECT COUNT(*) FROM wallet_transactions WHERE wallet_id = $1',
      [walletId]
    );

    const totalCount = parseInt(countResult.rows[0].count);

    res.status(200).json({
      success: true,
      transactions: transactionsResult.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalTransactions: totalCount,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    logger.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions'
    });
  }
};

/**
 * Withdraw Money (to bank account)
 */
/**
 * Withdraw Money (to bank account)
 */
const withdrawMoney = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount, bankDetails } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    const withdrawAmount = parseFloat(amount);

    // Get wallet
    const walletResult = await query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId]
    );

    if (walletResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    const wallet = walletResult.rows[0];

    // Check minimum withdrawal
    if (withdrawAmount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal amount is ₹100'
      });
    }

    // Check sufficient balance
    if (wallet.balance < withdrawAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        available: wallet.balance
      });
    }

    // Deduct amount
    const updateResult = await query(
      'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [withdrawAmount, wallet.id]
    );

    const newBalance = updateResult.rows[0].balance;

    // Record transaction
    await query(
      `INSERT INTO wallet_transactions (
        wallet_id, type, amount, balance_after, description, created_at
      ) VALUES ($1, 'debit', $2, $3, $4, NOW())`,
      [
        wallet.id,
        withdrawAmount,
        newBalance,
        'Withdrawal to bank account'
      ]
    );

    logger.info(`Withdrawal: ${userId} - ₹${withdrawAmount}`);

    res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted. Amount will be transferred within 1-2 business days.',
      wallet: updateResult.rows[0]
    });

  } catch (error) {
    logger.error('Withdraw error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal'
    });
  }
};

module.exports = {
  getWalletBalance,
  addMoney,
  deductCommission,
  getTransactions,
  withdrawMoney
};