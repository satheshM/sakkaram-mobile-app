const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.use(verifyToken);

router.post('/validate', couponController.validate);
router.post('/create', couponController.create);
router.get('/active', couponController.getActive);

module.exports = router;