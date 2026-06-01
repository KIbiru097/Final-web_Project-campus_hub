const db = require('../config/database');
const { redisClient } = require('../config/redis');

class NotificationService {
  async createNotification(userId, title, message, type, metadata = {}) {
    const result = await db.query(
      `INSERT INTO notifications (user_id, title, message, notification_type, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, title, message, type, JSON.stringify(metadata)]
    );
    
    // Publish to Redis for real-time notifications
    if (redisClient) {
      await redisClient.publish(`notifications:${userId}`, JSON.stringify(result.rows[0]));
    }
    
    return result.rows[0];
  }
  
  async markAsRead(notificationId, userId) {
    await db.query(
      `UPDATE notifications SET is_read = TRUE 
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
    return true;
  }
  
  async markAllAsRead(userId) {
    await db.query(
      `UPDATE notifications SET is_read = TRUE 
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
    return true;
  }
  
  async getUnreadCount(userId) {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM notifications 
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
    return parseInt(result.rows[0].count);
  }
  
  async getUserNotifications(userId, limit = 50, offset = 0) {
    const result = await db.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }
  
  async sendOrderStatusNotification(orderId, userId, status, orderType) {
    const title = `Order ${status}`;
    const message = `Your ${orderType} order #${orderId} is now ${status}.`;
    await this.createNotification(userId, title, message, 'ORDER_UPDATE', { orderId, orderType, status });
  }
  
  async sendDeliveryUpdateNotification(deliveryId, userId, status) {
    const title = `Delivery Update`;
    const message = `Your delivery #${deliveryId} is now ${status}.`;
    await this.createNotification(userId, title, message, 'DELIVERY_UPDATE', { deliveryId, status });
  }
  
  async sendMessageNotification(conversationId, userId, senderName, messagePreview) {
    const title = `New message from ${senderName}`;
    const message = messagePreview.length > 100 ? messagePreview.substring(0, 97) + '...' : messagePreview;
    await this.createNotification(userId, title, message, 'MESSAGE', { conversationId });
  }
}

module.exports.notificationService = new NotificationService();