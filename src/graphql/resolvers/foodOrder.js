const { query } = require('../../config/database');

const mapFoodOrder = (order) => ({
  id: order.id,
  studentId: order.student_id,
  cafeId: order.cafe_id,
  orderStatus: order.order_status,
  fulfillmentMethod: order.fulfillment_method,
  totalAmount: parseFloat(order.total_amount),
  specialInstructions: order.special_instructions,
  createdAt: order.created_at,
  updatedAt: order.updated_at
});

const mapOrderItem = (item) => ({
  id: item.id,
  orderId: item.order_id,
  menuItemId: item.menu_item_id,
  quantity: item.quantity,
  unitPrice: parseFloat(item.unit_price),
  subtotal: parseFloat(item.subtotal)
});

const foodOrderResolvers = {
  Query: {
    foodOrders: async (_, { status, limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      let sql = `SELECT * FROM food_orders WHERE student_id = $1 AND deleted_at IS NULL`;
      const params = [user.userId];
      let paramCount = 2;
      
      if (status) {
        sql += ` AND order_status = $${paramCount++}`;
        params.push(status);
      }
      
      sql += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
      params.push(limit, offset);
      
      const result = await query(sql, params);
      return result.rows.map(mapFoodOrder);
    },

    foodOrder: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await query(
        `SELECT * FROM food_orders WHERE id = $1 AND student_id = $2 AND deleted_at IS NULL`,
        [id, user.userId]
      );
      if (result.rows.length === 0) return null;
      return mapFoodOrder(result.rows[0]);
    },

    foodOrderItems: async (_, { orderId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await query(
        `SELECT * FROM food_order_items WHERE order_id = $1`,
        [orderId]
      );
      return result.rows.map(mapOrderItem);
    }
  },

  Mutation: {
    createFoodOrder: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { cafeId, items, specialInstructions, fulfillmentMethod } = input;
      
      // Calculate total amount
      let totalAmount = 0;
      for (const item of items) {
        const menuItem = await query(`SELECT price FROM menu_items WHERE id = $1`, [item.menuItemId]);
        if (menuItem.rows.length === 0) throw new Error(`Menu item ${item.menuItemId} not found`);
        totalAmount += parseFloat(menuItem.rows[0].price) * item.quantity;
      }
      
      // Create order
      const orderResult = await query(
        `INSERT INTO food_orders (id, student_id, cafe_id, order_status, fulfillment_method, total_amount, special_instructions, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'PENDING', $3, $4, $5, NOW(), NOW())
         RETURNING *`,
        [user.userId, cafeId, fulfillmentMethod || 'DELIVERY', totalAmount, specialInstructions || '']
      );
      
      const order = orderResult.rows[0];
      
      // Create order items
      for (const item of items) {
        const menuItem = await query(`SELECT price, name FROM menu_items WHERE id = $1`, [item.menuItemId]);
        const unitPrice = parseFloat(menuItem.rows[0].price);
        const subtotal = unitPrice * item.quantity;
        
        await query(
          `INSERT INTO food_order_items (id, order_id, menu_item_id, quantity, unit_price, subtotal, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
          [order.id, item.menuItemId, item.quantity, unitPrice, subtotal]
        );
      }
      
      return {
        success: true,
        message: 'Food order created successfully',
        order: mapFoodOrder(order)
      };
    },

    updateFoodOrderStatus: async (_, { id, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await query(
        `UPDATE food_orders SET order_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [status, id]
      );
      
      if (result.rows.length === 0) throw new Error('Order not found');
      return {
        success: true,
        message: 'Order status updated',
        order: mapFoodOrder(result.rows[0])
      };
    },

    cancelFoodOrder: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      await query(
        `UPDATE food_orders SET order_status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND student_id = $2`,
        [id, user.userId]
      );
      return { success: true, message: 'Order cancelled successfully' };
    }
  }
};

module.exports = foodOrderResolvers;