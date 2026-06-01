const db = require('../../config/database');
const { paymentService } = require('../../services/payment.service');
const { notificationService } = require('../../services/notification.service');

module.exports = {
  Query: {
    myPayments: async (_, { status, limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      let query = `
        SELECT * FROM payments 
        WHERE payer_id = $1
      `;
      const params = [user.userId];
      let paramIndex = 2;
      
      if (status) {
        query += ` AND payment_status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
      
      const result = await db.query(query, params);
      return result.rows;
    },
    
    payment: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'SELECT * FROM payments WHERE id = $1 AND payer_id = $2',
        [id, user.userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Payment not found');
      }
      
      return result.rows[0];
    },
    
    paymentByReference: async (_, { reference }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'SELECT * FROM payments WHERE transaction_reference = $1 AND payer_id = $2',
        [reference, user.userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Payment not found');
      }
      
      return result.rows[0];
    },
    
    mySavedPaymentMethods: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'SELECT * FROM saved_payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
        [user.userId]
      );
      
      return result.rows;
    },
    
    paymentSummary: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN amount ELSE 0 END), 0) as total_paid,
          COALESCE(SUM(CASE WHEN payment_status = 'REFUNDED' THEN refund_amount ELSE 0 END), 0) as total_refunded,
          COALESCE(SUM(CASE WHEN payment_status = 'PENDING' THEN amount ELSE 0 END), 0) as pending_payments,
          COUNT(CASE WHEN payment_status = 'PAID' THEN 1 END) as successful_payments,
          COUNT(CASE WHEN payment_status = 'FAILED' THEN 1 END) as failed_payments
        FROM payments 
        WHERE payer_id = $1
      `, [user.userId]);
      
      const recentResult = await db.query(
        `SELECT * FROM payments 
         WHERE payer_id = $1 
         ORDER BY created_at DESC 
         LIMIT 5`,
        [user.userId]
      );
      
      const summary = result.rows[0];
      
      return {
        totalPaid: parseFloat(summary.total_paid),
        totalRefunded: parseFloat(summary.total_refunded),
        pendingPayments: parseFloat(summary.pending_payments),
        successfulPayments: parseInt(summary.successful_payments),
        failedPayments: parseInt(summary.failed_payments),
        recentPayments: recentResult.rows,
      };
    },
    
    transactionHistory: async (_, { limit = 50, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(`
        SELECT 
          p.*,
          COALESCE(po.id, fo.id, sr.id) as order_id,
          CASE 
            WHEN po.id IS NOT NULL THEN 'PRODUCT'
            WHEN fo.id IS NOT NULL THEN 'FOOD'
            WHEN sr.id IS NOT NULL THEN 'SERVICE'
          END as order_type
        FROM payments p
        LEFT JOIN product_orders po ON p.product_order_id = po.id
        LEFT JOIN food_orders fo ON p.food_order_id = fo.id
        LEFT JOIN service_requests sr ON p.service_request_id = sr.id
        WHERE p.payer_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
      `, [user.userId, limit, offset]);
      
      return result.rows;
    },
  },
  
  Mutation: {
    initiatePayment: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { orderType, orderId, paymentMethod, savePaymentMethod } = input;
      
      const result = await paymentService.initiatePayment(
        orderType,
        orderId,
        paymentMethod,
        user.userId
      );
      
      // Save payment method if requested
      if (savePaymentMethod && paymentMethod !== 'CASH') {
        await db.query(
          `INSERT INTO saved_payment_methods (user_id, payment_method, is_default)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [user.userId, paymentMethod, false]
        );
      }
      
      return {
        payment: result.payment,
        redirectUrl: result.checkoutUrl,
        checkoutUrl: result.checkoutUrl,
        reference: result.reference,
      };
    },
    
    verifyPayment: async (_, { reference }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const payment = await paymentService.verifyPayment(reference);
      
      // Send notification
      await notificationService.createNotification(
        user.userId,
        'Payment Verified',
        `Your payment of ${payment.amount} has been verified.`,
        'PAYMENT',
        { paymentId: payment.id, reference }
      );
      
      return payment;
    },
    
    cancelPayment: async (_, { paymentId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `UPDATE payments 
         SET payment_status = 'CANCELLED' 
         WHERE id = $1 AND payer_id = $2 AND payment_status = 'PENDING'
         RETURNING id`,
        [paymentId, user.userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Payment not found or cannot be cancelled');
      }
      
      return true;
    },
    
    savePaymentMethod: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { paymentMethod, maskedCardNumber, cardType, expiryMonth, expiryYear, isDefault } = input;
      
      // If this is default, unset other defaults
      if (isDefault) {
        await db.query(
          'UPDATE saved_payment_methods SET is_default = false WHERE user_id = $1',
          [user.userId]
        );
      }
      
      const result = await db.query(
        `INSERT INTO saved_payment_methods 
         (user_id, payment_method, masked_card_number, card_type, expiry_month, expiry_year, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [user.userId, paymentMethod, maskedCardNumber, cardType, expiryMonth, expiryYear, isDefault || false]
      );
      
      return result.rows[0];
    },
    
    deletePaymentMethod: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'DELETE FROM saved_payment_methods WHERE id = $1 AND user_id = $2',
        [id, user.userId]
      );
      
      return result.rowCount > 0;
    },
    
    setDefaultPaymentMethod: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      await db.query('BEGIN');
      
      // Unset all defaults
      await db.query(
        'UPDATE saved_payment_methods SET is_default = false WHERE user_id = $1',
        [user.userId]
      );
      
      // Set new default
      const result = await db.query(
        'UPDATE saved_payment_methods SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING *',
        [id, user.userId]
      );
      
      await db.query('COMMIT');
      
      if (result.rows.length === 0) {
        throw new Error('Payment method not found');
      }
      
      return result.rows[0];
    },
    
    requestRefund: async (_, { paymentId, reason, amount }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await paymentService.processRefund(paymentId, amount, reason);
      
      await notificationService.createNotification(
        user.userId,
        'Refund Requested',
        `Your refund request for ${result.refundAmount} has been submitted.`,
        'REFUND',
        { paymentId, refundAmount: result.refundAmount }
      );
      
      return result;
    },
    
    processRefund: async (_, { refundId, approved, adminNotes }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      // Check if admin
      const roleCheck = await db.query(
        `SELECT EXISTS(SELECT 1 FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1 AND r.role_name = 'ADMIN') as is_admin`,
        [user.userId]
      );
      
      if (!roleCheck.rows[0].is_admin) throw new Error('Unauthorized');
      
      if (approved) {
        const result = await db.query(
          `UPDATE payments 
           SET payment_status = 'REFUNDED', refunded_at = CURRENT_TIMESTAMP, admin_notes = $1
           WHERE id = $2 AND payment_status = 'PAID'
           RETURNING *`,
          [adminNotes, refundId]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Payment not found or cannot be refunded');
        }
        
        return result.rows[0];
      } else {
        const result = await db.query(
          `UPDATE payments 
           SET admin_notes = $1
           WHERE id = $2
           RETURNING *`,
          [adminNotes, refundId]
        );
        
        return result.rows[0];
      }
    },
    
    webhookPayment: async (_, { provider, payload }, { user }) => {
      // For testing webhooks - no auth required
      console.log(`Webhook received from ${provider}:`, payload);
      
      const { reference, status } = payload;
      
      if (reference && status) {
        const result = await paymentService.simulateWebhook(reference, status);
        return result;
      }
      
      return { success: true, message: 'Webhook received' };
    },
  },
  
  Payment: {
    payer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.payer_id]);
      return result.rows[0];
    },
    
    productOrder: async (parent) => {
      if (!parent.product_order_id) return null;
      const result = await db.query('SELECT * FROM product_orders WHERE id = $1', [parent.product_order_id]);
      return result.rows[0];
    },
    
    foodOrder: async (parent) => {
      if (!parent.food_order_id) return null;
      const result = await db.query('SELECT * FROM food_orders WHERE id = $1', [parent.food_order_id]);
      return result.rows[0];
    },
    
    serviceRequest: async (parent) => {
      if (!parent.service_request_id) return null;
      const result = await db.query('SELECT * FROM service_requests WHERE id = $1', [parent.service_request_id]);
      return result.rows[0];
    },
  },
  
  SavedPaymentMethod: {
    user: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.user_id]);
      return result.rows[0];
    },
  },
};