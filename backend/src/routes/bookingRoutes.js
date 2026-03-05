const express = require('express');
const router  = express.Router();
const bookingController = require('../controllers/bookingController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

router.post('/',          verifyToken, checkRole('farmer'), bookingController.createBooking);
router.get('/',           verifyToken, bookingController.getBookings);
router.get('/:id',        verifyToken, bookingController.getBookingById);

router.put('/:id/accept',   verifyToken, checkRole('owner'),  bookingController.acceptBooking);
router.put('/:id/reject',   verifyToken, checkRole('owner'),  bookingController.rejectBooking);
router.put('/:id/start',    verifyToken, checkRole('owner'),  bookingController.startWork);
router.put('/:id/complete', verifyToken, checkRole('owner'),  bookingController.completeWork);
router.put('/:id/cancel',   verifyToken,                      bookingController.cancelBooking);
router.put('/:id/payment',  verifyToken, checkRole('farmer'), bookingController.updatePayment);

/**
 * NEW: Offline payment flow
 * Farmer submits offline payment → Owner confirms receipt → Platform deducts commission
 */
router.post('/:id/offline-payment',   verifyToken, checkRole('farmer'), bookingController.submitOfflinePayment);
router.put('/:id/confirm-payment',    verifyToken, checkRole('owner'),  bookingController.confirmPaymentReceived);
router.get('/owner/pending-payments', verifyToken, checkRole('owner'),  bookingController.getPendingPaymentConfirmations);

module.exports = router;
