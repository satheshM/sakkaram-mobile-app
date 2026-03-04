require('dotenv').config();
const axios  = require('axios');
const logger = require('../config/logger');

/**
 * FIXES applied:
 *
 * 1. constructor() printed MOCK_OTP_CODE via console.log on every server start.
 *    In production this floods stdout with the fallback OTP value.
 *    → Replaced with logger.debug (only visible in non-production).
 *
 * 2. Mock OTP path printed phone number AND OTP code to stdout via console.log.
 *    If log aggregation is enabled, that's PII + auth bypass data in plain text.
 *    → Replaced with logger.debug; only active when NODE_ENV !== 'production'.
 */
class SMSService {
  constructor() {
    this.provider    = process.env.SMS_PROVIDER  || 'msg91';
    this.useMockOTP  = process.env.USE_MOCK_OTP  === 'true';
    this.mockOTPCode = process.env.MOCK_OTP_CODE || '123456';

    logger.debug('SMSService initialised', { mock: this.useMockOTP });
  }

  generateOTP() {
    if (this.useMockOTP) return this.mockOTPCode;
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendOTP(phoneNumber, otp) {
    try {
      if (this.useMockOTP) {
        // FIX: Only log mock OTP in development; never in production.
        if (process.env.NODE_ENV !== 'production') {
          logger.debug('MOCK OTP (dev only)', {
            phone: `****${phoneNumber.slice(-4)}`,
            otp,
          });
        }
        return { success: true, mock: true };
      }

      if (this.provider === 'msg91') {
        return await this.sendViaMSG91(phoneNumber, otp);
      }

      throw new Error('Invalid SMS provider configured');
    } catch (error) {
      logger.error('SMS sending failed', { message: error.message });
      throw error;
    }
  }

  async sendViaMSG91(phoneNumber, otp) {
    try {
      const mobile = phoneNumber.replace('+', '');
      const response = await axios.post(
        'https://api.msg91.com/api/v5/otp',
        {
          template_id: process.env.MSG91_TEMPLATE_ID,
          mobile,
          authkey:     process.env.MSG91_AUTH_KEY,
          otp,
        },
        { timeout: 10_000 }
      );

      if (response.data.type === 'success') {
        logger.info('SMS sent via MSG91', { phone: `****${phoneNumber.slice(-4)}` });
        return { success: true, provider: 'msg91' };
      }

      throw new Error(`MSG91 error: ${response.data.message}`);
    } catch (error) {
      logger.error('MSG91 send failed', { message: error.message });
      throw error;
    }
  }
}

module.exports = new SMSService();
