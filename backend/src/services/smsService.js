require('dotenv').config(); // Add this line at the top!
const axios = require('axios');
const logger = require('../config/logger');

class SMSService {
  constructor() {
    this.provider = process.env.SMS_PROVIDER || 'msg91';
    this.useMockOTP = process.env.USE_MOCK_OTP === 'true';
    this.mockOTPCode = process.env.MOCK_OTP_CODE || '123456';
    
    // Debug log
    console.log('SMS Service initialized:');
    console.log('  USE_MOCK_OTP:', this.useMockOTP);
    console.log('  MOCK_OTP_CODE:', this.mockOTPCode);
  }

  /**
   * Generate 6-digit OTP
   */
  generateOTP() {
    if (this.useMockOTP) {
      return this.mockOTPCode;
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Send OTP via SMS
   */
  async sendOTP(phoneNumber, otp) {
    try {
      // In development, use mock OTP (no actual SMS sent)
      if (this.useMockOTP) {
        logger.info(`📱 MOCK OTP: ${otp} for ${phoneNumber}`);
        console.log('═══════════════════════════════════');
        console.log(`📱 DEVELOPMENT MODE - MOCK OTP`);
        console.log(`Phone: ${phoneNumber}`);
        console.log(`OTP: ${otp}`);
        console.log(`Use this OTP in your app!`);
        console.log('═══════════════════════════════════');
        return { success: true, mock: true };
      }

      // Production: Send actual SMS via MSG91
      if (this.provider === 'msg91') {
        return await this.sendViaMSG91(phoneNumber, otp);
      }

      throw new Error('Invalid SMS provider');
    } catch (error) {
      logger.error('SMS sending failed:', error.message);
      throw error;
    }
  }

  /**
   * Send SMS via MSG91 (for production)
   */
  async sendViaMSG91(phoneNumber, otp) {
    try {
      const authKey = process.env.MSG91_AUTH_KEY;
      const senderId = process.env.MSG91_SENDER_ID;
      const templateId = process.env.MSG91_TEMPLATE_ID;

      if (!authKey) {
        throw new Error('MSG91_AUTH_KEY not configured');
      }

      // Remove +91 if present
      const cleanPhone = phoneNumber.replace('+91', '').replace(/\s/g, '');

      const url = `https://api.msg91.com/api/v5/otp`;
      
      const response = await axios.post(
        url,
        {
          template_id: templateId,
          mobile: cleanPhone,
          authkey: authKey,
          otp: otp,
          sender: senderId || 'SAKKRM'
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`✅ OTP sent to ${phoneNumber}`);
      return { success: true, response: response.data };
    } catch (error) {
      logger.error('MSG91 error:', error.message);
      throw error;
    }
  }

  /**
   * Verify OTP (simple comparison)
   */
  verifyOTP(providedOTP, storedOTP) {
    return providedOTP === storedOTP;
  }
}

module.exports = new SMSService();