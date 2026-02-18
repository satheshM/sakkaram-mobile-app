const express = require('express');
const router = express.Router();
const favoriteController = require('../controllers/favoriteController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.use(verifyToken);

router.post('/', favoriteController.addFavorite);
router.get('/', favoriteController.getFavorites);
router.get('/check/:vehicleId', favoriteController.checkFavorite);
router.delete('/:vehicleId', favoriteController.removeFavorite);

module.exports = router;