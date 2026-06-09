const { query } = require('../../config/database');

const mapPayment = (payment) => ({
  id: payment.id,
  payerId: payment.payer_id,
  amount: parseFloat(payment.amount),
  paymentMethod: payment.payment_method,
  paymentStatus: payment.payment_status,
  transactionReference: payment.transaction_reference,
  foodOrderId: payment.food_order_id,
  productOrderId: payment.product_order_id,
  paidAt: payment.paid_at,
  createdAt: payment.created_at
});

const paymentResolvers = {
  Query: {
    myPayments: async (_, { limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await query(
        `SELECT * FROM payments WHERE payer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [user.userId, limit, offset]
      );
      return result.rows.map(mapPayment);
    },

    payment: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await query(
        `SELECT * FROM payments WHERE id = $1 AND payer_id = $2`,
        [id, user.userId]
      );
      if (result.rows.length === 0) return null;
      return mapPayment(result.rows[0]);
    }
  },

  Mutation: {
    initiatePayment: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { orderType, orderId, paymentMethod } = input;
      let amount = 0;
      let foodOrderId = null;
      let productOrderId = null;
      
      if (orderType === 'FOOD') {
        const order = await query(`SELECT total_amount FROM food_orders WHERE id = $1`, [orderId]);
        if (order.rows.length === 0) throw new Error('Food order not found');
        amount = parseFloat(order.rows[0].total_amount);
        foodOrderId = orderId;
      } else if (orderType === 'PRODUCT') {
        const order = await query(`SELECT total_amount FROM product_orders WHERE id = $1`, [orderId]);
        if (order.rows.length === 0) throw new Error('Product order not found');
        amount = parseFloat(order.rows[0].total_amount);
        productOrderId = orderId;
      }
      
      const transactionRef = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const result = await query(
        `INSERT INTO payments (id, payer_id, amount, payment_method, payment_status, transaction_reference, food_order_id, product_order_id, paid_at, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'COMPLETED', $4, $5, $6, NOW(), NOW())
         RETURNING *`,
        [user.userId, amount, paymentMethod, transactionRef, foodOrderId, productOrderId]
      );
      
      // Update order status
      if (foodOrderId) {
        await query(`UPDATE food_orders SET order_status = 'CONFIRMED' WHERE id = $1`, [foodOrderId]);
      }
      if (productOrderId) {
        await query(`UPDATE product_orders SET order_status = 'CONFIRMED' WHERE id = $1`, [productOrderId]);
      }
      
      return mapPayment(result.rows[0]);
    },

    verifyPayment: async (_, { transactionRef }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await query(
        `SELECT * FROM payments WHERE transaction_reference = $1 AND payer_id = $2`,
        [transactionRef, user.userId]
      );
      if (result.rows.length === 0) throw new Error('Payment not found');
      return mapPayment(result.rows[0]);
    }
  }
};

module.exports = paymentResolvers;