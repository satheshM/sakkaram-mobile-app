const express = require('express');
const router  = express.Router();
const bookingController = require('../controllers/bookingController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

// ── IMPORTANT: static paths MUST come before /:id to avoid Express treating
//   "owner" as a booking ID param ──────────────────────────────────────────

// Owner: pending offline payment confirmations
router.get('/owner/pending-payments', verifyToken, checkRole('owner'), bookingController.getPendingPaymentConfirmations);

// Booking CRUD
router.post('/',   verifyToken, checkRole('farmer'), bookingController.createBooking);
router.get('/',    verifyToken, bookingController.getBookings);
router.get('/:id', verifyToken, bookingController.getBookingById);

// Owner actions
router.put('/:id/accept',   verifyToken, checkRole('owner'),  bookingController.acceptBooking);
router.put('/:id/reject',   verifyToken, checkRole('owner'),  bookingController.rejectBooking);
router.put('/:id/start',    verifyToken, checkRole('owner'),  bookingController.startWork);
router.put('/:id/complete', verifyToken, checkRole('owner'),  bookingController.completeWork);

// Shared
router.put('/:id/cancel',   verifyToken, bookingController.cancelBooking);

// Payment
router.put('/:id/payment',         verifyToken, checkRole('farmer'), bookingController.updatePayment);
router.post('/:id/offline-payment', verifyToken, checkRole('farmer'), bookingController.submitOfflinePayment);
router.put('/:id/confirm-payment',  verifyToken, checkRole('owner'),  bookingController.confirmPaymentReceived);

module.exports = router;
