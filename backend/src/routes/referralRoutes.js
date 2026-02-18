const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.use(verifyToken);

router.get('/my-code', referralController.getMyReferralCode);
router.post('/apply', referralController.applyCode);
router.get('/stats', referralController.getStats);

module.exports = router;