require('dotenv').config();
const { Client } = require('@googlemaps/google-maps-services-js');
const logger = require('../config/logger');

const client = new Client({});

class LocationService {
  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.enabled = process.env.GOOGLE_MAPS_ENABLED === 'true';
  }

 calculateDistance(lat1, lng1, lat2, lng2) {  // ← Removed async
  try {
    return this.calculateStraightLineDistance(lat1, lng1, lat2, lng2);
  } catch (error) {
    logger.error('Distance calculation error:', error.message);
    return this.calculateStraightLineDistance(lat1, lng1, lat2, lng2);
  }
}

calculateStraightLineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = this.toRad(lat2 - lat1);
  const dLng = this.toRad(lng2 - lng1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return {
    distance: `${distance.toFixed(1)} km`,
    distanceValue: distance * 1000,
    duration: 'N/A',
    durationValue: 0
  };
}

toRad(degrees) {
  return degrees * (Math.PI / 180);
}

  async geocodeAddress(address) {
    try {
      if (!this.enabled) return null;

      const response = await client.geocode({
        params: {
          address: address,
          key: this.apiKey
        }
      });

      if (response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        return {
          lat: location.lat,
          lng: location.lng,
          formattedAddress: response.data.results[0].formatted_address
        };
      }

      return null;
    } catch (error) {
      logger.error('Geocoding error:', error.message);
      return null;
    }
  }

  async reverseGeocode(lat, lng) {
    try {
      if (!this.enabled) return null;

      const response = await client.reverseGeocode({
        params: {
          latlng: { lat, lng },
          key: this.apiKey
        }
      });

      if (response.data.results.length > 0) {
        return response.data.results[0].formatted_address;
      }

      return null;
    } catch (error) {
      logger.error('Reverse geocoding error:', error.message);
      return null;
    }
  }

  async isWithinServiceArea(ownerLat, ownerLng, farmerLat, farmerLng, radiusKm) {
    try {
      const distance = await this.calculateDistance(
        { lat: ownerLat, lng: ownerLng },
        { lat: farmerLat, lng: farmerLng }
      );

      if (!distance) return false;

      const distanceInKm = distance.distanceValue / 1000;
      return distanceInKm <= radiusKm;
    } catch (error) {
      logger.error('Service area check error:', error.message);
      return false;
    }
  }

  calculateStraightLineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return {
      distance: `${distance.toFixed(1)} km`,
      distanceValue: distance * 1000,
      duration: 'N/A',
      durationValue: 0
    };
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  isValidCoordinates(lat, lng) {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }
}

module.exports = new LocationService();