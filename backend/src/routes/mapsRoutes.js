const express = require('express');
const router = express.Router();
const mapsController = require('../controllers/mapsController');
const { verifyToken } = require('../middlewares/authMiddleware');

/**
 * @route   GET /api/maps/autocomplete
 * @desc    Get address autocomplete suggestions
 * @access  Private
 */
router.get('/autocomplete', verifyToken, mapsController.autocomplete);

/**
 * @route   GET /api/maps/geocode
 * @desc    Convert address to coordinates
 * @access  Private
 */
router.get('/geocode', verifyToken, mapsController.geocode);

/**
 * @route   GET /api/maps/reverse-geocode
 * @desc    Convert coordinates to address
 * @access  Private
 */
router.get('/reverse-geocode', verifyToken, mapsController.reverseGeocodeController);

/**
 * @route   GET /api/maps/distance
 * @desc    Get driving distance between two points
 * @access  Private
 */
router.get('/distance', verifyToken, mapsController.getDistance);

/**
 * @route   GET /api/maps/vehicles-nearby
 * @desc    Get vehicles near a location with real distances
 * @access  Private
 */
router.get('/vehicles-nearby', verifyToken, mapsController.getNearbyVehicles);

/**
 * @route   GET /api/maps/directions
 * @desc    Get driving directions to vehicle
 * @access  Private
 */
router.get('/directions', verifyToken, mapsController.getDirectionsToVehicle);

/**
 * @route   GET /api/maps/place/:placeId
 * @desc    Get place details from place ID
 * @access  Private
 */
router.get('/place/:placeId', verifyToken, mapsController.getPlace);

/**
 * @route   GET /api/maps/static
 * @desc    Get static map URL for a location
 * @access  Private
 */
router.get('/static', verifyToken, mapsController.getStaticMap);

module.exports = router;