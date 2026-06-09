const { query } = require('../../config/database');

const generateOrderNumber = () => {
  return `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

const mapOrder = (dbOrder) => ({
  id: dbOrder.id,
  orderNumber: dbOrder.order_number,
  userId: dbOrder.user_id,
  restaurantId: dbOrder.restaurant_id,
  items: dbOrder.items,
  totalAmount: parseFloat(dbOrder.total_amount),
  deliveryAddress: dbOrder.delivery_address,
  status: dbOrder.status,
  createdAt: dbOrder.created_at,
  updatedAt: dbOrder.updated_at
});

const orderResolvers = {
  Query: {
    myOrders: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
        [user.userId]
      );
      return result.rows.map(mapOrder);
    },
    order: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, user.userId]);
      return result.rows[0] ? mapOrder(result.rows[0]) : null;
    }
  },
  Mutation: {
    createOrder: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const { restaurantId, items, deliveryAddress } = input;
      const orderNumber = generateOrderNumber();
      
      // Calculate total amount
      let totalAmount = 0;
      for (const item of items) {
        totalAmount += item.price * item.quantity;
      }
      
      const result = await query(
        `INSERT INTO orders (id, order_number, user_id, restaurant_id, items, total_amount, delivery_address, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'PENDING', NOW(), NOW())
         RETURNING *`,
        [orderNumber, user.userId, restaurantId, JSON.stringify(items), totalAmount, deliveryAddress]
      );
      return { success: true, message: 'Order created', order: mapOrder(result.rows[0]) };
    },
    updateOrderStatus: async (_, { id, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await query(
        'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [status, id]
      );
      return { success: true, message: 'Order status updated', order: mapOrder(result.rows[0]) };
    },
    cancelOrder: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', ['CANCELLED', id, user.userId]);
      return { success: true, message: 'Order cancelled' };
    }
  }
};

module.exports = orderResolvers;