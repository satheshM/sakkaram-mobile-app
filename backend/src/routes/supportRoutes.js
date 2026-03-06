const express    = require('express');
const router     = express.Router();
const support    = require('../controllers/supportController');
const { verifyToken, requireActive } = require('../middlewares/authMiddleware');
const { isAdmin } = require('../middlewares/adminMiddleware');

// ── User routes — verifyToken only, NO requireActive ─────────────────────────
// Blocked users can still send/receive support messages

router.post('/message',  verifyToken, support.sendMessage);
router.get('/messages',  verifyToken, support.getMyMessages);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin/unread-count',
  verifyToken, requireActive, isAdmin, support.getUnreadCount);

router.get('/admin/conversations',
  verifyToken, requireActive, isAdmin, support.getConversations);

router.get('/admin/conversations/:userId',
  verifyToken, requireActive, isAdmin, support.getConversation);

router.post('/admin/conversations/:userId/reply',
  verifyToken, requireActive, isAdmin, support.replyToUser);

router.put('/admin/conversations/:userId/unblock',
  verifyToken, requireActive, isAdmin, support.unblockFromSupport);

module.exports = router;
