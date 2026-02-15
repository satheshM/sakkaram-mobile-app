const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { verifyToken } = require('../middlewares/authMiddleware');

/**
 * @route   GET /api/wallet/balance
 * @desc    Get wallet balance
 * @access  Private
 */
router.get('/balance', verifyToken, walletController.getWalletBalance);

/**
 * @route   POST /api/wallet/add-money
 * @desc    Add money to wallet (top-up)
 * @access  Private
 */
router.post('/add-money', verifyToken, walletController.addMoney);

/**
 * @route   POST /api/wallet/deduct
 * @desc    Deduct commission (internal use)
 * @access  Private
 */
router.post('/deduct', verifyToken, walletController.deductCommission);

/**
 * @route   GET /api/wallet/transactions
 * @desc    Get wallet transactions
 * @access  Private
 */
router.get('/transactions', verifyToken, walletController.getTransactions);

/**
 * @route   POST /api/wallet/withdraw
 * @desc    Withdraw money to bank
 * @access  Private
 */
router.post('/withdraw', verifyToken, walletController.withdrawMoney);

module.exports = router;