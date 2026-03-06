const { query, pool } = require('../config/db');
const logger          = require('../config/logger');

// ── User: send a support message ──────────────────────────────────────────────
// POST /api/support/message
const sendMessage = async (req, res) => {
  try {
    const userId  = req.user.userId;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }
    if (message.trim().length > 1000) {
      return res.status(400).json({ success: false, message: 'Message too long (max 1000 chars)' });
    }

    const result = await query(
      `INSERT INTO support_messages (user_id, message, is_from_user, is_read, created_at)
       VALUES ($1, $2, true, false, NOW()) RETURNING *`,
      [userId, message.trim()]
    );

    logger.info('Support message sent', { userId, messageId: result.rows[0].id });

    res.status(200).json({ success: true, message: result.rows[0] });
  } catch (error) {
    logger.error('sendMessage error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
};

// ── User: get own conversation ─────────────────────────────────────────────────
// GET /api/support/messages
const getMyMessages = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT * FROM support_messages
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    // Mark admin replies as read
    await query(
      `UPDATE support_messages SET is_read = true
       WHERE user_id = $1 AND is_from_user = false AND is_read = false`,
      [userId]
    );

    res.status(200).json({ success: true, messages: result.rows });
  } catch (error) {
    logger.error('getMyMessages error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch messages' });
  }
};

// ── Admin: get all support conversations (one row per user, latest message) ───
// GET /api/admin/support/conversations
const getConversations = async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT ON (sm.user_id)
         sm.user_id,
         sm.message       AS last_message,
         sm.is_from_user  AS last_from_user,
         sm.created_at    AS last_at,
         u.full_name, u.phone_number, u.is_active,
         (SELECT COUNT(*) FROM support_messages s2
          WHERE s2.user_id = sm.user_id
            AND s2.is_from_user = true
            AND s2.is_read = false) AS unread_count
       FROM support_messages sm
       JOIN users u ON u.id = sm.user_id
       ORDER BY sm.user_id, sm.created_at DESC`
    );

    // Sort: blocked users first, then by latest message
    const sorted = result.rows.sort((a, b) => {
      if (a.is_active === false && b.is_active !== false) return -1;
      if (b.is_active === false && a.is_active !== false) return 1;
      return new Date(b.last_at) - new Date(a.last_at);
    });

    res.status(200).json({ success: true, conversations: sorted });
  } catch (error) {
    logger.error('getConversations error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch conversations' });
  }
};

// ── Admin: get full conversation with one user ────────────────────────────────
// GET /api/admin/support/conversations/:userId
const getConversation = async (req, res) => {
  try {
    const { userId } = req.params;

    const [msgResult, userResult] = await Promise.all([
      query(
        `SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC`,
        [userId]
      ),
      query(
        `SELECT id, full_name, phone_number, role, is_active FROM users WHERE id = $1`,
        [userId]
      ),
    ]);

    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Mark user messages as read
    await query(
      `UPDATE support_messages SET is_read = true
       WHERE user_id = $1 AND is_from_user = true AND is_read = false`,
      [userId]
    );

    res.status(200).json({
      success:  true,
      user:     userResult.rows[0],
      messages: msgResult.rows,
    });
  } catch (error) {
    logger.error('getConversation error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch conversation' });
  }
};

// ── Admin: reply to a user ────────────────────────────────────────────────────
// POST /api/admin/support/conversations/:userId/reply
const replyToUser = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const { userId } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Reply cannot be empty' });
    }

    const result = await query(
      `INSERT INTO support_messages (user_id, message, is_from_user, is_read, created_at)
       VALUES ($1, $2, false, false, NOW()) RETURNING *`,
      [userId, message.trim()]
    );

    // In-app notification to user
    await query(
      `INSERT INTO notifications (user_id, type, title, message, is_read, created_at)
       VALUES ($1, 'system_announcement', '📬 Support Reply', $2, false, NOW())`,
      [userId, `Support team replied: "${message.trim().slice(0, 80)}${message.length > 80 ? '…' : ''}"`]
    ).catch(() => {});

    logger.info('Admin replied to support', { adminId, userId });

    res.status(200).json({ success: true, message: result.rows[0] });
  } catch (error) {
    logger.error('replyToUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to send reply' });
  }
};

// ── Admin: unblock user directly from support chat ────────────────────────────
// PUT /api/admin/support/conversations/:userId/unblock
const unblockFromSupport = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const { userId } = req.params;
    const { note = 'Account unblocked by support' } = req.body;

    const userRes = await query(
      `UPDATE users SET is_active = true, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL RETURNING full_name, phone_number`,
      [userId]
    );

    if (!userRes.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Auto-send an unblock message in the support chat
    await query(
      `INSERT INTO support_messages (user_id, message, is_from_user, is_read, created_at)
       VALUES ($1, $2, false, false, NOW())`,
      [userId, `✅ Your account has been unblocked! ${note}. You can now login and use the app normally.`]
    );

    // In-app notification
    await query(
      `INSERT INTO notifications (user_id, type, title, message, is_read, created_at)
       VALUES ($1, 'system_announcement', '✅ Account Unblocked',
         'Your account has been unblocked. You can now use Sakkaram normally.', false, NOW())`,
      [userId]
    ).catch(() => {});

    logger.info('User unblocked via support', { adminId, userId });

    res.status(200).json({
      success: true,
      message: `${userRes.rows[0].full_name} has been unblocked`,
    });
  } catch (error) {
    logger.error('unblockFromSupport error:', error);
    res.status(500).json({ success: false, message: 'Failed to unblock user' });
  }
};

// ── Admin: unread count for dashboard badge ───────────────────────────────────
// GET /api/admin/support/unread-count
const getUnreadCount = async (req, res) => {
  try {
    const result = await query(
      `SELECT COUNT(*) FROM support_messages
       WHERE is_from_user = true AND is_read = false`
    );
    res.status(200).json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ success: false, count: 0 });
  }
};

module.exports = {
  sendMessage,
  getMyMessages,
  getConversations,
  getConversation,
  replyToUser,
  unblockFromSupport,
  getUnreadCount,
};
