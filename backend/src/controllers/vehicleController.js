require('dotenv').config();
const { query } = require('../config/db');
const imageService = require('../services/imageService');
const locationService = require('../services/locationService');
const logger = require('../config/logger');

/**
 * Add Vehicle
 */
const addVehicle = async (req, res) => {
  try {
    const {
      name,
      type,
      model,
      registrationNumber,
      specifications,
      capacity,
      locationAddress,
      locationLat,
      locationLng,
      serviceRadiusKm,
      servicesOffered, // Array: [{serviceName, pricingType, hourlyRate, perAcreRate, fixedPrice}]
      availabilitySchedule
    } = req.body;

    const ownerId = req.user.userId;

    // Validate owner role
    const userResult = await query('SELECT role FROM users WHERE id = $1', [ownerId]);
    if (!userResult.rows[0] || userResult.rows[0].role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only vehicle owners can add vehicles'
      });
    }

    // Upload images if provided
    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      const uploadResults = await imageService.uploadMultipleImages(
        req.files.map(file => file.buffer)
      );
      imageUrls = uploadResults.map(result => ({
        url: result.url,
        publicId: result.publicId
      }));
    }

    // Insert vehicle
    const vehicleResult = await query(
      `INSERT INTO vehicles (
        owner_id, name, type, model, registration_number,
        specifications, capacity, location_address, location_lat, location_lng,
        service_radius_km, services_offered, images, availability_schedule,
        is_available, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, NOW())
      RETURNING *`,
      [
        ownerId, name, type, model, registrationNumber,
        JSON.stringify(specifications), capacity, locationAddress, locationLat, locationLng,
        serviceRadiusKm || 50, JSON.stringify(servicesOffered), JSON.stringify(imageUrls),
        JSON.stringify(availabilitySchedule)
      ]
    );

    logger.info(`Vehicle added: ${vehicleResult.rows[0].id}`);

    res.status(201).json({
      success: true,
      message: 'Vehicle added successfully',
      vehicle: vehicleResult.rows[0]
    });

  } catch (error) {
    logger.error('Add vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add vehicle',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get All Vehicles (with search and filters)
 */
const getVehicles = async (req, res) => {
  try {
    const {
      type,
      serviceType,
      farmerLat,
      farmerLng,
      maxDistance,
      minPrice,
      maxPrice,
      page = 1,
      limit = 20
    } = req.query;

    let queryText = `
      SELECT v.*, u.full_name as owner_name, u.phone_number as owner_phone,
             v.average_rating, v.total_bookings
      FROM vehicles v
      JOIN users u ON v.owner_id = u.id
      WHERE v.is_available = true AND v.deleted_at IS NULL
    `;
    
    const params = [];
    let paramIndex = 1;

    // Filter by type
    if (type) {
      queryText += ` AND v.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // Filter by service type (check in services_offered JSONB)
    if (serviceType) {
      queryText += ` AND v.services_offered::text ILIKE $${paramIndex}`;
      params.push(`%${serviceType}%`);
      paramIndex++;
    }

    queryText += ` ORDER BY v.created_at DESC`;

    // Pagination
    const offset = (page - 1) * limit;
    queryText += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

 // Calculate distances if farmer location provided
let vehicles = result.rows;
if (farmerLat && farmerLng) {
  
  
  // Map with async - MUST use Promise.all!
  vehicles = await Promise.all(vehicles.map(async (vehicle) => {
    if (vehicle.location_lat && vehicle.location_lng) {
      try {
       
        const distance = await locationService.calculateDistance(  // ← Added await!
          parseFloat(vehicle.location_lat),
          parseFloat(vehicle.location_lng),
          parseFloat(farmerLat),
          parseFloat(farmerLng)
        );
        
       
        
        return {
          ...vehicle,
          distance: distance ? distance.distance : 'N/A',
          distanceValue: distance ? distance.distanceValue : 999999
        };
      } catch (error) {
       
        logger.error('Distance calc error for vehicle:', vehicle.id, error.message);
        return vehicle;
      }
    }
    return vehicle;
  }));


  
  // Filter by max distance
if (maxDistance) {
  vehicles = vehicles.filter(v => {
    // Check if distanceValue exists (including 0)
    if (v.distanceValue === undefined || v.distanceValue === null) {
     return false;
    }
    const distKm = v.distanceValue / 1000;
    const keep = distKm <= parseFloat(maxDistance);
    return keep;
  });
}


  
  // Sort by distance
  vehicles.sort((a, b) => (a.distanceValue || Infinity) - (b.distanceValue || Infinity));
}

    // Get total count
    const countResult = await query('SELECT COUNT(*) FROM vehicles WHERE is_available = true AND deleted_at IS NULL');
    const totalCount = parseInt(countResult.rows[0].count);

    res.status(200).json({
      success: true,
      vehicles,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalVehicles: totalCount,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    logger.error('Get vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicles'
    });
  }
};

/**
 * Get Single Vehicle
 */
const getVehicleById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT v.*, u.full_name as owner_name, u.phone_number as owner_phone,
              u.profile_image_url as owner_image
       FROM vehicles v
       JOIN users u ON v.owner_id = u.id
       WHERE v.id = $1 AND v.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    res.status(200).json({
      success: true,
      vehicle: result.rows[0]
    });

  } catch (error) {
    logger.error('Get vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicle'
    });
  }
};

/**
 * Update Vehicle
 */
const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;
    const updates = req.body;

    // Check ownership
    const vehicleCheck = await query('SELECT owner_id FROM vehicles WHERE id = $1', [id]);
    if (vehicleCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    if (vehicleCheck.rows[0].owner_id !== ownerId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this vehicle'
      });
    }

    // Build update query dynamically
    const allowedFields = [
      'name', 'type', 'model', 'specifications', 'capacity',
      'location_address', 'location_lat', 'location_lng',
      'service_radius_km', 'services_offered', 'availability_schedule',
      'is_available'
    ];

    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(
          ['specifications', 'services_offered', 'availability_schedule'].includes(key)
            ? JSON.stringify(updates[key])
            : updates[key]
        );
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE vehicles SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    logger.info(`Vehicle updated: ${id}`);

    res.status(200).json({
      success: true,
      message: 'Vehicle updated successfully',
      vehicle: result.rows[0]
    });

  } catch (error) {
    logger.error('Update vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vehicle'
    });
  }
};

/**
 * Delete Vehicle
 */
const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;

    // Check ownership
    const vehicleCheck = await query('SELECT owner_id, images FROM vehicles WHERE id = $1', [id]);
    if (vehicleCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    if (vehicleCheck.rows[0].owner_id !== ownerId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this vehicle'
      });
    }

    // Soft delete
    await query('UPDATE vehicles SET deleted_at = NOW() WHERE id = $1', [id]);

    logger.info(`Vehicle deleted: ${id}`);

    res.status(200).json({
      success: true,
      message: 'Vehicle deleted successfully'
    });

  } catch (error) {
    logger.error('Delete vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete vehicle'
    });
  }
};

/**
 * Get Owner's Vehicles
 */
const getMyVehicles = async (req, res) => {
  try {
    const ownerId = req.user.userId;

    const result = await query(
      `SELECT * FROM vehicles 
       WHERE owner_id = $1 AND deleted_at IS NULL 
       ORDER BY created_at DESC`,
      [ownerId]
    );

    res.status(200).json({
      success: true,
      vehicles: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    logger.error('Get my vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicles'
    });
  }
};

module.exports = {
  addVehicle,
  getVehicles,
  getVehicleById,
  updateVehicle,
  deleteVehicle,
  getMyVehicles
};