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
 * PHASE 1 FIX — Location address showing lat/lng:
 *
 * Root cause: v.location_address is NULL in the database for many vehicles
 * because the owner used GPS to set location but the app never saved the
 * reverse-geocoded address back to the DB.
 *
 * Fix here: When getNearbyVehicles finds vehicles with null location_address,
 * it reverse-geocodes them in batch and saves the result back to the DB so
 * future queries return the real place name.
 *
 * Also: The frontend receives distanceText/durationText but sometimes shows
 * undefined. Fixed: we guarantee these fields are never null.
 */

const autocomplete = async (req, res) => {
  try {
    const { input, sessionToken } = req.query;
    if (!input || input.length < 3) {
      return res.status(400).json({ success: false, message: 'Input must be at least 3 characters' });
    }
    const suggestions = await getPlaceAutocomplete(input, sessionToken);
    res.status(200).json({ success: true, suggestions });
  } catch (error) {
    logger.error('Autocomplete error:', error);
    res.status(500).json({ success: false, message: 'Failed to get suggestions' });
  }
};

const geocode = async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ success: false, message: 'Address is required' });
    const result = await geocodeAddress(address);
    res.status(200).json({ success: true, location: result });
  } catch (error) {
    logger.error('Geocode error:', error);
    res.status(500).json({ success: false, message: 'Failed to geocode address' });
  }
};

const reverseGeocodeController = async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'lat and lng required' });
    const result = await reverseGeocode(lat, lng);
    res.status(200).json({ success: true, address: result });
  } catch (error) {
    logger.error('Reverse geocode error:', error);
    res.status(500).json({ success: false, message: 'Failed to get address' });
  }
};

const getDistance = async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng } = req.query;
    if (!originLat || !originLng || !destLat || !destLng) {
      return res.status(400).json({ success: false, message: 'All coordinates required' });
    }
    const result = await getDrivingDistance(
      parseFloat(originLat), parseFloat(originLng),
      parseFloat(destLat), parseFloat(destLng)
    );
    res.status(200).json({ success: true, distance: result });
  } catch (error) {
    logger.error('Distance error:', error);
    res.status(500).json({ success: false, message: 'Failed to calculate distance' });
  }
};

/**
 * Get vehicles near location with real distances
 * GET /api/maps/vehicles-nearby?lat=&lng=&radius=20
 *
 * KEY FIXES:
 * 1. Vehicles with null location_address get reverse-geocoded and saved
 * 2. distanceText / durationText always return a non-null string
 * 3. service_count added to response for each vehicle
 */
const getNearbyVehicles = async (req, res) => {
  try {
    const { lat, lng, radius = 20, vehicleType, page = 1, limit = 20 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Location coordinates are required' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const searchRadius = parseFloat(radius);

    let vehicleQuery = `
      SELECT
        v.id, v.name, v.type, v.model,
        v.location_lat, v.location_lng, v.location_address,
        v.average_rating, v.total_reviews, v.base_price,
        v.images, v.services_offered, v.service_radius_km,
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
    if (vehicleType) { vehicleQuery += ` AND v.type = $4`; params.push(vehicleType); }
    vehicleQuery += ` ORDER BY straight_distance ASC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const vehiclesResult = await pool.query(vehicleQuery, params);
    let vehicles = vehiclesResult.rows;

    if (vehicles.length === 0) {
      return res.status(200).json({
        success: true, vehicles: [], staticMapUrl: null,
        message: `No vehicles found within ${searchRadius}km`
      });
    }

    // FIX 1: Reverse-geocode any vehicle with missing location_address and save it
    const missingAddress = vehicles.filter(v => !v.location_address);
    if (missingAddress.length > 0) {
      await Promise.allSettled(missingAddress.map(async (vehicle) => {
        try {
          const geo = await reverseGeocode(vehicle.location_lat, vehicle.location_lng);
          const addr = geo?.formatted_address || geo?.display_name || null;
          if (addr) {
            await pool.query(
              'UPDATE vehicles SET location_address = $1, updated_at = NOW() WHERE id = $2',
              [addr, vehicle.id]
            );
            vehicle.location_address = addr;  // update in-memory too
          }
        } catch (e) {
          logger.warn(`Could not reverse-geocode vehicle ${vehicle.id}:`, e.message);
        }
      }));
    }

    // Get REAL driving distances in batch
    const destinations = vehicles.map(v => ({ vehicleId: v.id, lat: v.location_lat, lng: v.location_lng }));
    const realDistances = await getBatchDistances(userLat, userLng, destinations);

    // FIX 2: Merge and guarantee distanceText/durationText are never null/undefined
    const vehiclesWithDistance = vehicles.map(vehicle => {
      const distInfo = realDistances.find(d => d.vehicleId === vehicle.id);
      const straightKm = parseFloat(vehicle.straight_distance || 0).toFixed(1);

      // FIX 3: parse services_offered and count
      let servicesArr = [];
      try {
        servicesArr = typeof vehicle.services_offered === 'string'
          ? JSON.parse(vehicle.services_offered || '[]')
          : (vehicle.services_offered || []);
      } catch { servicesArr = []; }

      return {
        ...vehicle,
        distance:       distInfo?.distance ?? vehicle.straight_distance,
        distanceText:   distInfo?.distanceText ?? `${straightKm} km`,   // NEVER null
        duration:       distInfo?.duration ?? null,
        durationText:   (distInfo?.durationText && distInfo.durationText !== 'N/A')
                          ? distInfo.durationText
                          : null,                                         // null = don't show
        isRealDistance: !distInfo?.isFallback,
        service_count:  servicesArr.length,                              // NEW: service count
        services_list:  servicesArr.map(s => s.serviceName || s.serviceType).filter(Boolean),
      };
    });

    vehiclesWithDistance.sort((a, b) => a.distance - b.distance);

    const staticMapUrl = getStaticMapUrlMultiple(vehicles, userLat, userLng);

    res.status(200).json({
      success: true,
      userLocation: { lat: userLat, lng: userLng },
      searchRadius,
      totalFound: vehicles.length,
      vehicles: vehiclesWithDistance,
      staticMapUrl,
      pagination: { currentPage: parseInt(page), limit: parseInt(limit) }
    });

  } catch (error) {
    logger.error('Nearby vehicles error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch nearby vehicles' });
  }
};

const getDirectionsToVehicle = async (req, res) => {
  try {
    const { originLat, originLng, vehicleId } = req.query;
    if (!originLat || !originLng || !vehicleId) {
      return res.status(400).json({ success: false, message: 'Origin coordinates and vehicle ID required' });
    }

    const vehicleResult = await pool.query(
      'SELECT id, name, location_lat, location_lng, location_address FROM vehicles WHERE id = $1',
      [vehicleId]
    );
    if (!vehicleResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }
    const vehicle = vehicleResult.rows[0];
    if (!vehicle.location_lat || !vehicle.location_lng) {
      return res.status(400).json({ success: false, message: 'Vehicle location not available' });
    }

    const directions = await getDirections(
      parseFloat(originLat), parseFloat(originLng),
      vehicle.location_lat, vehicle.location_lng
    );

    const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?` +
      `size=600x400&` +
      `markers=color:blue|label:You|${originLat},${originLng}&` +
      `markers=color:red|label:V|${vehicle.location_lat},${vehicle.location_lng}&` +
      `path=enc:${directions.overviewPolyline}&` +
      `key=${process.env.GOOGLE_MAPS_BACKEND_KEY}`;

    res.status(200).json({
      success: true,
      vehicle: {
        id: vehicle.id, name: vehicle.name,
        address: vehicle.location_address,
        lat: vehicle.location_lat, lng: vehicle.location_lng
      },
      directions,
      staticMapUrl
    });
  } catch (error) {
    logger.error('Directions error:', error);
    res.status(500).json({ success: false, message: 'Failed to get directions' });
  }
};

const getPlace = async (req, res) => {
  try {
    const { placeId } = req.params;
    if (!placeId) return res.status(400).json({ success: false, message: 'Place ID required' });
    const result = await getPlaceDetails(placeId);
    res.status(200).json({ success: true, place: result });
  } catch (error) {
    logger.error('Place details error:', error);
    res.status(500).json({ success: false, message: 'Failed to get place details' });
  }
};

const getStaticMap = async (req, res) => {
  try {
    const { lat, lng, zoom = 14, width = 400, height = 300 } = req.query;
    if (!lat || !lng) return res.status(400).json({ success: false, message: 'Coordinates required' });
    const mapUrl = getStaticMapUrl(parseFloat(lat), parseFloat(lng), {
      zoom: parseInt(zoom), width: parseInt(width), height: parseInt(height)
    });
    res.status(200).json({ success: true, mapUrl });
  } catch (error) {
    logger.error('Static map error:', error);
    res.status(500).json({ success: false, message: 'Failed to get map URL' });
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
