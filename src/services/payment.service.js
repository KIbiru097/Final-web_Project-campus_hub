const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class PaymentService {
  // Initialize a new payment
  async initiatePayment(orderId, orderType, paymentMethod, userId) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get order details
      let order = null;
      let amount = 0;
      
      if (orderType === 'PRODUCT') {
        const result = await client.query(
          'SELECT total_amount FROM product_orders WHERE id = $1 AND buyer_id = $2',
          [orderId, userId]
        );
        order = result.rows[0];
        amount = order?.total_amount;
      } else if (orderType === 'FOOD') {
        const result = await client.query(
          'SELECT total_amount FROM food_orders WHERE id = $1 AND student_id = $2',
          [orderId, userId]
        );
        order = result.rows[0];
        amount = order?.total_amount;
      }
      
      if (!order) {
        throw new Error('Order not found');
      }
      
      // Generate unique reference
      const reference = `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create payment record
      const paymentResult = await client.query(
        `INSERT INTO payments (id, payer_id, amount, payment_method, payment_status, transaction_reference, product_order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [uuidv4(), userId, amount, paymentMethod, 'PENDING', reference, orderId]
      );
      
      const payment = paymentResult.rows[0];
      
      // Mock payment processing
      const mockResult = await this.processMockPayment(amount, paymentMethod);
      
      // Update payment status
      await client.query(
        `UPDATE payments 
         SET payment_status = $1, paid_at = $2
         WHERE id = $3`,
        [mockResult.status, mockResult.paidAt, payment.id]
      );
      
      // Update order status if payment is successful
      if (mockResult.status === 'PAID') {
        await client.query(
          `UPDATE product_orders SET order_status = 'CONFIRMED' WHERE id = $1`,
          [orderId]
        );
      }
      
      await client.query('COMMIT');
      
      return {
        success: true,
        payment,
        mockResult,
        reference
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  // Mock payment processor
  async processMockPayment(amount, method) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // 95% success rate for mock
    const isSuccessful = Math.random() < 0.95;
    
    if (isSuccessful) {
      return {
        status: 'PAID',
        paidAt: new Date().toISOString(),
        message: `Payment of $${amount} via ${method} was successful`,
        transactionId: `MOCK_${Date.now()}`
      };
    } else {
      return {
        status: 'FAILED',
        paidAt: null,
        message: `Payment failed. Please try again.`,
        transactionId: null
      };
    }
  }
  
  // Get payment by ID
  async getPayment(paymentId) {
    const result = await db.query(
      `SELECT p.*, u.email, u.first_name, u.last_name
       FROM payments p
       JOIN users u ON p.payer_id = u.id
       WHERE p.id = $1`,
      [paymentId]
    );
    return result.rows[0];
  }
  
  // Get user payments
  async getUserPayments(userId, limit = 50, offset = 0) {
    const result = await db.query(
      `SELECT p.*, 
              CASE 
                WHEN p.product_order_id IS NOT NULL THEN 'PRODUCT'
                WHEN p.food_order_id IS NOT NULL THEN 'FOOD'
              END as order_type
       FROM payments p
       WHERE p.payer_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }
  
  // Process refund
  async processRefund(paymentId, userId, reason) {
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const payment = await client.query(
        'SELECT * FROM payments WHERE id = $1 AND payer_id = $2',
        [paymentId, userId]
      );
      
      if (payment.rows.length === 0) {
        throw new Error('Payment not found');
      }
      
      if (payment.rows[0].payment_status !== 'PAID') {
        throw new Error('Only paid payments can be refunded');
      }
      
      await client.query(
        `UPDATE payments 
         SET payment_status = 'REFUNDED', 
             refunded_at = CURRENT_TIMESTAMP,
             refund_reason = $1
         WHERE id = $2`,
        [reason, paymentId]
      );
      
      await client.query('COMMIT');
      
      return { success: true, message: 'Refund processed successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new PaymentService();
