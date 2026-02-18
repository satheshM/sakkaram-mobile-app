const {
  geocodeAddress,
  reverseGeocode,
  getDrivingDistance,
  getBatchDistances,
  getDirections,
  getPlaceAutocomplete,
  getPlaceDetails,
  getStaticMapUrl,
  getStaticMapUrlMultiple
} = require('../services/mapsService');
const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Autocomplete address
 * GET /api/maps/autocomplete?input=coimbatore
 */
const autocomplete = async (req, res) => {
  try {
    const { input, sessionToken } = req.query;

    if (!input || input.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Input must be at least 3 characters'
      });
    }

    const suggestions = await getPlaceAutocomplete(input, sessionToken);

    res.status(200).json({
      success: true,
      suggestions
    });

  } catch (error) {
    logger.error('Autocomplete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get suggestions'
    });
  }
};

/**
 * Geocode address
 * GET /api/maps/geocode?address=coimbatore
 */
const geocode = async (req, res) => {
  try {
    const { address } = req.query;

    if (!address) {
      return res.status(400).json({
        success: false,
        message: 'Address is required'
      });
    }

    const result = await geocodeAddress(address);

    res.status(200).json({
      success: true,
      location: result
    });

  } catch (error) {
    logger.error('Geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to geocode address'
    });
  }
};

/**
 * Reverse geocode coordinates
 * GET /api/maps/reverse-geocode?lat=11.01&lng=76.95
 */
const reverseGeocodeController = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const result = await reverseGeocode(lat, lng);

    res.status(200).json({
      success: true,
      address: result
    });

  } catch (error) {
    logger.error('Reverse geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get address'
    });
  }
};

/**
 * Get distance between two points
 * GET /api/maps/distance?originLat=&originLng=&destLat=&destLng=
 */
const getDistance = async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng } = req.query;

    if (!originLat || !originLng || !destLat || !destLng) {
      return res.status(400).json({
        success: false,
        message: 'All coordinates are required'
      });
    }

    const result = await getDrivingDistance(
      parseFloat(originLat),
      parseFloat(originLng),
      parseFloat(destLat),
      parseFloat(destLng)
    );

    res.status(200).json({
      success: true,
      distance: result
    });

  } catch (error) {
    logger.error('Distance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate distance'
    });
  }
};

/**
 * Get vehicles near location with real distances
 * GET /api/maps/vehicles-nearby?lat=&lng=&radius=20
 */
const getNearbyVehicles = async (req, res) => {
  try {
    const {
      lat,
      lng,
      radius = 20,
      vehicleType,
      page = 1,
      limit = 20
    } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Location coordinates are required'
      });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const searchRadius = parseFloat(radius);

    // Get vehicles within radius using Haversine
    let vehicleQuery = `
      SELECT 
        v.id,
        v.name,
        v.type,
        v.model,
        v.location_lat,
        v.location_lng,
        v.location_address,
        v.average_rating,
        v.total_reviews,
        v.base_price,
        v.images,
        v.services_offered,
        u.full_name as owner_name,
        (
          6371 * acos(
            cos(radians($1)) * cos(radians(v.location_lat)) *
            cos(radians(v.location_lng) - radians($2)) +
            sin(radians($1)) * sin(radians(v.location_lat))
          )
        ) as straight_distance
      FROM vehicles v
      LEFT JOIN users u ON u.id = v.owner_id
      WHERE v.deleted_at IS NULL
        AND v.is_available = true
        AND v.location_lat IS NOT NULL
        AND v.location_lng IS NOT NULL
        AND (
          6371 * acos(
            cos(radians($1)) * cos(radians(v.location_lat)) *
            cos(radians(v.location_lng) - radians($2)) +
            sin(radians($1)) * sin(radians(v.location_lat))
          )
        ) <= $3
    `;

    const params = [userLat, userLng, searchRadius];

    if (vehicleType) {
      vehicleQuery += ` AND v.type = $4`;
      params.push(vehicleType);
    }

    vehicleQuery += ` ORDER BY straight_distance ASC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const vehiclesResult = await pool.query(vehicleQuery, params);
    const vehicles = vehiclesResult.rows;

    if (vehicles.length === 0) {
      return res.status(200).json({
        success: true,
        vehicles: [],
        staticMapUrl: null,
        message: `No vehicles found within ${searchRadius}km`
      });
    }

    // Get REAL driving distances in batch (cost optimized!)
    const destinations = vehicles.map(v => ({
      vehicleId: v.id,
      lat: v.location_lat,
      lng: v.location_lng
    }));

    const realDistances = await getBatchDistances(userLat, userLng, destinations);

    // Merge real distances with vehicle data
    const vehiclesWithDistance = vehicles.map(vehicle => {
      const distanceInfo = realDistances.find(d => d.vehicleId === vehicle.id);
      
      return {
        ...vehicle,
        distance: distanceInfo?.distance || vehicle.straight_distance,
        distanceText: distanceInfo?.distanceText || `${vehicle.straight_distance?.toFixed(1)} km`,
        duration: distanceInfo?.duration,
        durationText: distanceInfo?.durationText || 'N/A',
        isRealDistance: !distanceInfo?.isFallback
      };
    });

    // Sort by real distance
    vehiclesWithDistance.sort((a, b) => a.distance - b.distance);

    // Generate static map URL (no API call - just URL string!)
    const staticMapUrl = getStaticMapUrlMultiple(vehicles, userLat, userLng);

    res.status(200).json({
      success: true,
      userLocation: { lat: userLat, lng: userLng },
      searchRadius: searchRadius,
      totalFound: vehicles.length,
      vehicles: vehiclesWithDistance,
      staticMapUrl,
      pagination: {
        currentPage: parseInt(page),
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    logger.error('Nearby vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch nearby vehicles'
    });
  }
};

/**
 * Get directions to vehicle
 * GET /api/maps/directions?originLat=&originLng=&vehicleId=
 */
const getDirectionsToVehicle = async (req, res) => {
  try {
    const { originLat, originLng, vehicleId } = req.query;

    if (!originLat || !originLng || !vehicleId) {
      return res.status(400).json({
        success: false,
        message: 'Origin coordinates and vehicle ID are required'
      });
    }

    // Get vehicle location
    const vehicleResult = await pool.query(
      'SELECT id, name, location_lat, location_lng, location_address FROM vehicles WHERE id = $1',
      [vehicleId]
    );

    if (vehicleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    const vehicle = vehicleResult.rows[0];

    if (!vehicle.location_lat || !vehicle.location_lng) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle location not available'
      });
    }

    const directions = await getDirections(
      parseFloat(originLat),
      parseFloat(originLng),
      vehicle.location_lat,
      vehicle.location_lng
    );

    // Generate static map showing route
    const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?` +
      `size=600x400&` +
      `markers=color:blue|label:You|${originLat},${originLng}&` +
      `markers=color:red|label:V|${vehicle.location_lat},${vehicle.location_lng}&` +
      `path=enc:${directions.overviewPolyline}&` +
      `key=${process.env.GOOGLE_MAPS_BACKEND_KEY}`;

    res.status(200).json({
      success: true,
      vehicle: {
        id: vehicle.id,
        name: vehicle.name,
        address: vehicle.location_address,
        lat: vehicle.location_lat,
        lng: vehicle.location_lng
      },
      directions,
      staticMapUrl
    });

  } catch (error) {
    logger.error('Directions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get directions'
    });
  }
};

/**
 * Get place details from place ID
 * GET /api/maps/place/:placeId
 */
const getPlace = async (req, res) => {
  try {
    const { placeId } = req.params;

    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: 'Place ID is required'
      });
    }

    const result = await getPlaceDetails(placeId);

    res.status(200).json({
      success: true,
      place: result
    });

  } catch (error) {
    logger.error('Place details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get place details'
    });
  }
};

/**
 * Get static map URL for a location
 * GET /api/maps/static?lat=&lng=&zoom=14
 */
const getStaticMap = async (req, res) => {
  try {
    const { lat, lng, zoom = 14, width = 400, height = 300 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates are required'
      });
    }

    const mapUrl = getStaticMapUrl(
      parseFloat(lat),
      parseFloat(lng),
      {
        zoom: parseInt(zoom),
        width: parseInt(width),
        height: parseInt(height)
      }
    );

    res.status(200).json({
      success: true,
      mapUrl
    });

  } catch (error) {
    logger.error('Static map error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get map URL'
    });
  }
};

module.exports = {
  autocomplete,
  geocode,
  reverseGeocodeController,
  getDistance,
  getNearbyVehicles,
  getDirectionsToVehicle,
  getPlace,
  getStaticMap
};