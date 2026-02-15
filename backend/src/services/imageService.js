require('dotenv').config();
const { cloudinary } = require('../config/cloudinary');
const logger = require('../config/logger');

class ImageService {
  /**
   * Upload image to Cloudinary
   */
  async uploadImage(imageBuffer, folder = 'sakkaram_vehicles') {
    try {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: folder,
            resource_type: 'image',
            transformation: [
              { width: 800, height: 600, crop: 'limit' },
              { quality: 'auto' }
            ]
          },
          (error, result) => {
            if (error) {
              logger.error('Image upload error:', error);
              reject(error);
            } else {
              resolve({
                url: result.secure_url,
                publicId: result.public_id
              });
            }
          }
        );

        uploadStream.end(imageBuffer);
      });
    } catch (error) {
      logger.error('Upload service error:', error);
      throw error;
    }
  }

  /**
   * Upload multiple images
   */
  async uploadMultipleImages(imageBuffers, folder = 'sakkaram_vehicles') {
    try {
      const uploadPromises = imageBuffers.map(buffer => 
        this.uploadImage(buffer, folder)
      );
      
      return await Promise.all(uploadPromises);
    } catch (error) {
      logger.error('Multiple upload error:', error);
      throw error;
    }
  }

  /**
   * Delete image from Cloudinary
   */
  async deleteImage(publicId) {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      logger.info('Image deleted:', publicId);
      return result;
    } catch (error) {
      logger.error('Delete image error:', error);
      throw error;
    }
  }

  /**
   * Delete multiple images
   */
  async deleteMultipleImages(publicIds) {
    try {
      const deletePromises = publicIds.map(id => this.deleteImage(id));
      return await Promise.all(deletePromises);
    } catch (error) {
      logger.error('Multiple delete error:', error);
      throw error;
    }
  }
}

module.exports = new ImageService();