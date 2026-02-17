const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { verifyToken } = require('../middlewares/authMiddleware');

/**
 * @route   GET /api/search/vehicles
 * @desc    Advanced vehicle search with filters
 * @access  Public
 */
router.get('/vehicles', searchController.searchVehicles);

/**
 * @route   GET /api/search/map
 * @desc    Get vehicles within map bounds
 * @access  Public
 */
router.get('/map', searchController.getMapVehicles);

/**
 * @route   GET /api/search/suggestions
 * @desc    Get search suggestions
 * @access  Public
 */
router.get('/suggestions', searchController.getSearchSuggestions);

/**
 * @route   GET /api/search/trending
 * @desc    Get trending vehicles
 * @access  Public
 */
router.get('/trending', searchController.getTrendingVehicles);

/**
 * @route   GET /api/search/favorites
 * @desc    Get user's favorites
 * @access  Private
 */
router.get('/favorites', verifyToken, searchController.getFavorites);

/**
 * @route   POST /api/search/favorites/:vehicleId
 * @desc    Add vehicle to favorites
 * @access  Private
 */
router.post('/favorites/:vehicleId', verifyToken, searchController.addFavorite);

/**
 * @route   DELETE /api/search/favorites/:vehicleId
 * @desc    Remove vehicle from favorites
 * @access  Private
 */
router.delete('/favorites/:vehicleId', verifyToken, searchController.removeFavorite);

/**
 * @route   GET /api/search/favorites/:vehicleId/check
 * @desc    Check if vehicle is favorited
 * @access  Private
 */
router.get('/favorites/:vehicleId/check', verifyToken, searchController.checkFavorite);

/**
 * @route   GET /api/search/analytics
 * @desc    Get booking analytics for current user
 * @access  Private
 */
router.get('/analytics', verifyToken, searchController.getBookingAnalytics);

module.exports = router;