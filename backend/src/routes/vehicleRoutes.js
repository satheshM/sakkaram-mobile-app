const express = require('express');
const router = express.Router();
const multer = require('multer');
const vehicleController = require('../controllers/vehicleController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

// Configure multer for image uploads (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 5 // Max 5 images
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'));
    }
  }
});

/**
 * @route   POST /api/vehicles
 * @desc    Add new vehicle
 * @access  Private (Owner only)
 */
router.post('/', verifyToken, checkRole('owner'), upload.array('images', 5), vehicleController.addVehicle);

/**
 * @route   GET /api/vehicles
 * @desc    Get all vehicles (with filters)
 * @access  Public
 */
router.get('/', vehicleController.getVehicles);

/**
 * @route   GET /api/vehicles/my-vehicles
 * @desc    Get owner's vehicles
 * @access  Private (Owner only)
 */
router.get('/my-vehicles', verifyToken, checkRole('owner'), vehicleController.getMyVehicles);

/**
 * @route   GET /api/vehicles/:id
 * @desc    Get single vehicle by ID
 * @access  Public
 */
router.get('/:id', vehicleController.getVehicleById);

/**
 * @route   PUT /api/vehicles/:id
 * @desc    Update vehicle
 * @access  Private (Owner only)
 */
router.put('/:id', verifyToken, checkRole('owner'), vehicleController.updateVehicle);

/**
 * @route   DELETE /api/vehicles/:id
 * @desc    Delete vehicle
 * @access  Private (Owner only)
 */
router.delete('/:id', verifyToken, checkRole('owner'), vehicleController.deleteVehicle);

module.exports = router;