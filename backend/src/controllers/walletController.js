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
 * Add Money to Wallet (Phase 4 — creates a PENDING topup request for admin approval)
 * POST /api/wallet/add-money
 * Body: { amount, transactionId (UTR), paymentMethod }
 */
const addMoney = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount, transactionId, paymentMethod } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }
    if (!transactionId || transactionId.trim().length < 6) {
      return res.status(400).json({ success: false, message: 'Valid UTR / transaction ID is required' });
    }

    const topupAmount = parseFloat(amount);
    const utr = transactionId.trim().toUpperCase();

    // Check for duplicate UTR from same user to prevent double-submission
    const dupCheck = await query(
      `SELECT id FROM wallet_topup_requests WHERE user_id = $1 AND utr_number = $2 LIMIT 1`,
      [userId, utr]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This UTR has already been submitted. Please wait for admin review.'
      });
    }

    // Create pending topup request — wallet is NOT credited yet
    const result = await query(
      `INSERT INTO wallet_topup_requests (user_id, amount, utr_number, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', NOW(), NOW()) RETURNING *`,
      [userId, topupAmount, utr]
    );

    logger.info('Topup request submitted', { userId, amount: topupAmount, utr });

    // Return current wallet balance (unchanged — not credited yet)
    const walletResult = await query(
      'SELECT * FROM wallets WHERE user_id = $1', [userId]
    );

    res.status(200).json({
      success: true,
      message: 'Top-up request submitted. Your wallet will be credited after admin verification (usually within 30 minutes).',
      request: result.rows[0],
      wallet: walletResult.rows[0] || null,
    });

  } catch (error) {
    logger.error('Add money (topup request) error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit top-up request' });
  }
};

/**
 * Get my topup requests (user sees their own pending/approved/rejected requests)
 * GET /api/wallet/topup-requests
 */
const getMyTopupRequests = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT id, amount, utr_number, status, admin_note, created_at, reviewed_at
       FROM wallet_topup_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.status(200).json({ success: true, requests: result.rows });
  } catch (error) {
    logger.error('getMyTopupRequests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch requests' });
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
    const oldBalance = parseFloat(wallet.balance);

    // Check sufficient balance
    if (oldBalance < deductAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance',
        required: deductAmount,
        available: oldBalance
      });
    }

    const newBalance = oldBalance - deductAmount;

    // Deduct amount
    const updateResult = await query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newBalance, wallet.id]
    );

    // Record transaction with all new fields
    await query(
      `INSERT INTO wallet_transactions (
        wallet_id, 
        transaction_type, 
        amount, 
        balance_before,
        balance_after,
        description,
        reference_type,
        reference_id,
        booking_id,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        wallet.id,
        'debit',
        deductAmount,
        oldBalance,
        newBalance,
        description || 'Commission deducted',
        'commission',
        bookingId,
        bookingId
      ]
    );

    logger.info(`Commission deducted: ${userId} - ₹${deductAmount}`, {
      oldBalance,
      newBalance,
      bookingId
    });

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
    const oldBalance = parseFloat(wallet.balance);

    // Check minimum withdrawal
    if (withdrawAmount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal amount is ₹100'
      });
    }

    // Check sufficient balance
    if (oldBalance < withdrawAmount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        available: oldBalance
      });
    }

    const newBalance = oldBalance - withdrawAmount;

    // Deduct amount
    const updateResult = await query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newBalance, wallet.id]
    );

    // Record transaction with balance tracking
    await query(
      `INSERT INTO wallet_transactions (
        wallet_id, 
        transaction_type, 
        amount, 
        balance_before,
        balance_after,
        description, 
        reference_type,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        wallet.id,
        'debit',
        withdrawAmount,
        oldBalance,
        newBalance,
        `Withdrawal to bank account (${bankDetails?.accountNumber || 'N/A'})`,
        'withdrawal'
      ]
    );

    logger.info(`Withdrawal: ${userId} - ₹${withdrawAmount}`, {
      oldBalance,
      newBalance
    });

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
  getMyTopupRequests,
  deductCommission,
  getTransactions,
  withdrawMoney
};