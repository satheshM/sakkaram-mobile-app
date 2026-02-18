const axios = require('axios');
const logger = require('../config/logger');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_BACKEND_KEY;
const MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api';

/**
 * Geocode an address to coordinates
 * Converts: "Coimbatore, Tamil Nadu" → { lat: 11.0168, lng: 76.9558 }
 */
const geocodeAddress = async (address) => {
  try {
    const response = await axios.get(`${MAPS_BASE_URL}/geocode/json`, {
      params: {
        address: address,
        region: 'in', // India
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status !== 'OK') {
      throw new Error(`Geocoding failed: ${response.data.status}`);
    }

    const result = response.data.results[0];
    const location = result.geometry.location;

    return {
      lat: location.lat,
      lng: location.lng,
      formattedAddress: result.formatted_address,
      placeId: result.place_id,
      components: parseAddressComponents(result.address_components)
    };

  } catch (error) {
    logger.error('Geocode error:', error);
    throw error;
  }
};

/**
 * Reverse geocode coordinates to address
 * Converts: { lat: 11.0168, lng: 76.9558 } → "Coimbatore, Tamil Nadu"
 */
const reverseGeocode = async (lat, lng) => {
  try {
    const response = await axios.get(`${MAPS_BASE_URL}/geocode/json`, {
      params: {
        latlng: `${lat},${lng}`,
        region: 'in',
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status !== 'OK') {
      throw new Error(`Reverse geocoding failed: ${response.data.status}`);
    }

    const result = response.data.results[0];

    return {
      formattedAddress: result.formatted_address,
      placeId: result.place_id,
      components: parseAddressComponents(result.address_components)
    };

  } catch (error) {
    logger.error('Reverse geocode error:', error);
    throw error;
  }
};

/**
 * Get driving distance and duration between two points
 * Much more accurate than straight-line distance!
 */
const getDrivingDistance = async (originLat, originLng, destLat, destLng) => {
  try {
    const response = await axios.get(`${MAPS_BASE_URL}/distancematrix/json`, {
      params: {
        origins: `${originLat},${originLng}`,
        destinations: `${destLat},${destLng}`,
        mode: 'driving',
        units: 'metric',
        region: 'in',
        departure_time: 'now',  // ← ADD THIS for traffic data
        traffic_model: 'best_guess',  // ← ADD THIS
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status !== 'OK') {
      throw new Error(`Distance matrix failed: ${response.data.status}`);
    }

    const element = response.data.rows[0].elements[0];

    if (element.status !== 'OK') {
      return {
        distance: calculateStraightLineDistance(originLat, originLng, destLat, destLng),
        duration: null,
        durationText: 'N/A',
        distanceText: 'Approximate',
        durationInTraffic: null,  // ← ADD THIS
        durationInTrafficText: null,  // ← ADD THIS
        isFallback: true
      };
    }

    return {
      distance: element.distance.value / 1000,
      distanceText: element.distance.text,
      duration: element.duration.value,
      durationText: element.duration.text,
      durationInTraffic: element.duration_in_traffic?.value || element.duration.value,  // ← ADD THIS
      durationInTrafficText: element.duration_in_traffic?.text || element.duration.text,  // ← ADD THIS
      isFallback: false
    };

  } catch (error) {
    logger.error('Distance matrix error:', error);
    return {
      distance: calculateStraightLineDistance(originLat, originLng, destLat, destLng),
      duration: null,
      durationText: 'N/A',
      distanceText: 'Approximate',
      durationInTraffic: null,
      durationInTrafficText: null,
      isFallback: true
    };
  }
};

/**
 * Get multiple distances at once (cost-optimized!)
 * Instead of calling API for each vehicle, batch them all!
 */
const getBatchDistances = async (originLat, originLng, destinations) => {
  try {
    if (destinations.length === 0) return [];

    // Google allows max 25 destinations per request
    const batches = [];
    for (let i = 0; i < destinations.length; i += 25) {
      batches.push(destinations.slice(i, i + 25));
    }

    const results = [];

    for (const batch of batches) {
      const destString = batch
        .map(d => `${d.lat},${d.lng}`)
        .join('|');

      const response = await axios.get(`${MAPS_BASE_URL}/distancematrix/json`, {
        params: {
          origins: `${originLat},${originLng}`,
          destinations: destString,
          mode: 'driving',
          units: 'metric',
          region: 'in',
          key: GOOGLE_MAPS_API_KEY
        }
      });

      if (response.data.status === 'OK') {
        const elements = response.data.rows[0].elements;
        
        batch.forEach((dest, index) => {
          const element = elements[index];
          
          if (element.status === 'OK') {
            results.push({
              vehicleId: dest.vehicleId,
              distance: element.distance.value / 1000,
              distanceText: element.distance.text,
              duration: element.duration.value,
              durationText: element.duration.text,
              isFallback: false
            });
          } else {
            results.push({
              vehicleId: dest.vehicleId,
              distance: calculateStraightLineDistance(
                originLat, originLng, dest.lat, dest.lng
              ),
              distanceText: 'Approximate',
              duration: null,
              durationText: 'N/A',
              isFallback: true
            });
          }
        });
      }
    }

    return results;

  } catch (error) {
    logger.error('Batch distances error:', error);
    // Fallback to straight-line for all
    return destinations.map(dest => ({
      vehicleId: dest.vehicleId,
      distance: calculateStraightLineDistance(originLat, originLng, dest.lat, dest.lng),
      distanceText: 'Approximate',
      duration: null,
      durationText: 'N/A',
      isFallback: true
    }));
  }
};

/**
 * Get driving directions between two points
 */
const getDirections = async (originLat, originLng, destLat, destLng) => {
  try {
    const response = await axios.get(`${MAPS_BASE_URL}/directions/json`, {
      params: {
        origin: `${originLat},${originLng}`,
        destination: `${destLat},${destLng}`,
        mode: 'driving',
        region: 'in',
        departure_time: 'now',  // ← ADD THIS
        traffic_model: 'best_guess',  // ← ADD THIS
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status !== 'OK') {
      throw new Error(`Directions failed: ${response.data.status}`);
    }

    const route = response.data.routes[0];
    const leg = route.legs[0];

    return {
      distance: leg.distance.text,
      duration: leg.duration.text,
      durationInTraffic: leg.duration_in_traffic?.text || leg.duration.text,  // ← ADD THIS
      startAddress: leg.start_address,
      endAddress: leg.end_address,
      steps: leg.steps.map(step => ({
        instruction: step.html_instructions.replace(/<[^>]*>/g, ''),
        distance: step.distance.text,
        duration: step.duration.text,
        travelMode: step.travel_mode
      })),
      overviewPolyline: route.overview_polyline.points
    };

  } catch (error) {
    logger.error('Directions error:', error);
    throw error;
  }
};

/**
 * Autocomplete address suggestions
 * Called as user types - shows suggestions
 */
const getPlaceAutocomplete = async (input, sessionToken = null) => {
  try {
    const params = {
      input: input,
      components: 'country:in', // India only
      types: 'geocode', // Address types
      key: GOOGLE_MAPS_API_KEY
    };

    if (sessionToken) {
      params.sessiontoken = sessionToken;
    }

    const response = await axios.get(`${MAPS_BASE_URL}/place/autocomplete/json`, {
      params
    });

    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      throw new Error(`Autocomplete failed: ${response.data.status}`);
    }

    return response.data.predictions.map(prediction => ({
      placeId: prediction.place_id,
      description: prediction.description,
      mainText: prediction.structured_formatting.main_text,
      secondaryText: prediction.structured_formatting.secondary_text
    }));

  } catch (error) {
    logger.error('Autocomplete error:', error);
    throw error;
  }
};

/**
 * Get place details from place ID
 */
const getPlaceDetails = async (placeId) => {
  try {
    const response = await axios.get(`${MAPS_BASE_URL}/place/details/json`, {
      params: {
        place_id: placeId,
        fields: 'geometry,formatted_address,name,address_components',
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status !== 'OK') {
      throw new Error(`Place details failed: ${response.data.status}`);
    }

    const result = response.data.result;

    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
      name: result.name,
      components: parseAddressComponents(result.address_components)
    };

  } catch (error) {
    logger.error('Place details error:', error);
    throw error;
  }
};

/**
 * Generate static map URL (NO API CALL NEEDED - just URL!)
 * Use this for map previews in the app - very cost effective!
 */
const getStaticMapUrl = (lat, lng, options = {}) => {
  const {
    zoom = 14,
    width = 400,
    height = 300,
    markerColor = 'red',
    markerLabel = 'V'
  } = options;

  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: zoom,
    size: `${width}x${height}`,
    markers: `color:${markerColor}|label:${markerLabel}|${lat},${lng}`,
    key: GOOGLE_MAPS_API_KEY
  });

  return `${MAPS_BASE_URL}/staticmap?${params.toString()}`;
};

/**
 * Generate static map URL with multiple markers
 */
const getStaticMapUrlMultiple = (vehicles, userLat, userLng) => {
  let url = `${MAPS_BASE_URL}/staticmap?`;
  url += `size=600x400&`;
  url += `key=${GOOGLE_MAPS_API_KEY}&`;

  // Add user location marker (blue)
  if (userLat && userLng) {
    url += `markers=color:blue|label:You|${userLat},${userLng}&`;
  }

  // Add vehicle markers (red)
  vehicles.slice(0, 10).forEach((vehicle, index) => {
    if (vehicle.location_lat && vehicle.location_lng) {
      url += `markers=color:red|label:${index + 1}|${vehicle.location_lat},${vehicle.location_lng}&`;
    }
  });

  return url;
};

/**
 * Helper: Parse Google address components
 */
const parseAddressComponents = (components) => {
  const result = {};

  components.forEach(component => {
    const types = component.types;

    if (types.includes('street_number')) {
      result.streetNumber = component.long_name;
    } else if (types.includes('route')) {
      result.street = component.long_name;
    } else if (types.includes('locality')) {
      result.city = component.long_name;
    } else if (types.includes('administrative_area_level_1')) {
      result.state = component.long_name;
      result.stateShort = component.short_name;
    } else if (types.includes('country')) {
      result.country = component.long_name;
    } else if (types.includes('postal_code')) {
      result.pincode = component.long_name;
    } else if (types.includes('sublocality_level_1')) {
      result.area = component.long_name;
    }
  });

  return result;
};

/**
 * Helper: Straight-line distance (Haversine formula)
 * Used as fallback when Google API fails
 */
const calculateStraightLineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
};

module.exports = {
  geocodeAddress,
  reverseGeocode,
  getDrivingDistance,
  getBatchDistances,
  getDirections,
  getPlaceAutocomplete,
  getPlaceDetails,
  getStaticMapUrl,
  getStaticMapUrlMultiple,
  calculateStraightLineDistance
};