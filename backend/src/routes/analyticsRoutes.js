const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.use(verifyToken);

router.get('/my-stats', analyticsController.getMyAnalytics);
router.get('/popular-vehicles', analyticsController.getPopular);
router.get('/trends', analyticsController.getTrends);

module.exports = router;