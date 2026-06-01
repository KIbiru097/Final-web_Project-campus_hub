const { ApolloServer } = require('@apollo/server');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const bcrypt = require('bcrypt');
const typeDefs = require('./typeDefs');

// Basic resolvers
const resolvers = {
  Query: {
    // User queries
    me: async (_, __, { user }) => {
      if (!user) return null;
      const result = await db.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [user.userId]);
      return result.rows[0];
    },
    user: async (_, { id }) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
      return result.rows[0];
    },
    users: async (_, { limit = 20, offset = 0 }) => {
      const result = await db.query(
        'SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      return result.rows;
    },
    
    // Product queries
    products: async (_, { categoryId, search, minPrice, maxPrice, limit = 20, offset = 0 }) => {
      let query = `
        SELECT p.*, u.first_name, u.last_name, u.email 
        FROM products p
        JOIN users u ON p.seller_id = u.id
        WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
      `;
      const params = [];
      let paramIndex = 1;
      
      if (categoryId) {
        query += ` AND p.category_id = $${paramIndex++}`;
        params.push(categoryId);
      }
      if (search) {
        query += ` AND (p.title ILIKE $${paramIndex++} OR p.description ILIKE $${paramIndex++})`;
        params.push(`%${search}%`, `%${search}%`);
      }
      if (minPrice) {
        query += ` AND p.price >= $${paramIndex++}`;
        params.push(minPrice);
      }
      if (maxPrice) {
        query += ` AND p.price <= $${paramIndex++}`;
        params.push(maxPrice);
      }
      
      query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);
      
      const result = await db.query(query, params);
      return result.rows;
    },
    
    product: async (_, { id }) => {
      const result = await db.query(
        'SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      return result.rows[0];
    },
    
    categories: async () => {
      const result = await db.query('SELECT * FROM product_categories ORDER BY name');
      return result.rows;
    },
    
    myProducts: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM products WHERE seller_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
        [user.userId]
      );
      return result.rows;
    },
    
    myOrders: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM product_orders WHERE buyer_id = $1 ORDER BY created_at DESC',
        [user.userId]
      );
      return result.rows;
    },
    
    mySales: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM product_orders WHERE seller_id = $1 ORDER BY created_at DESC',
        [user.userId]
      );
      return result.rows;
    },
    
    // Payment queries
    myPayments: async (_, { limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM payments WHERE payer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [user.userId, limit, offset]
      );
      return result.rows;
    },
    
    payment: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM payments WHERE id = $1 AND payer_id = $2',
        [id, user.userId]
      );
      return result.rows[0];
    },
    
    // Delivery queries
    myDeliveryProfile: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query('SELECT * FROM delivery_profiles WHERE user_id = $1', [user.userId]);
      return result.rows[0];
    },
    
    myDeliveries: async (_, { status, limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      let query = 'SELECT * FROM deliveries WHERE delivery_person_id = $1';
      const params = [user.userId];
      if (status) {
        query += ' AND delivery_status = $2';
        params.push(status);
      }
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      const result = await db.query(query, params);
      return result.rows;
    },
    
    pendingDeliveries: async () => {
      const result = await db.query(
        'SELECT * FROM deliveries WHERE delivery_status = $1 ORDER BY created_at ASC',
        ['PENDING']
      );
      return result.rows;
    },
    
    delivery: async (_, { id }) => {
      const result = await db.query('SELECT * FROM deliveries WHERE id = $1', [id]);
      return result.rows[0];
    },
    
    // Food queries
    cafes: async (_, { limit = 20, offset = 0 }) => {
      const result = await db.query(
        'SELECT * FROM cafes WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      return result.rows;
    },
    
    cafe: async (_, { id }) => {
      const result = await db.query('SELECT * FROM cafes WHERE id = $1 AND deleted_at IS NULL', [id]);
      return result.rows[0];
    },
    
    menuItems: async (_, { cafeId, category, limit = 50 }) => {
      let query = 'SELECT * FROM menu_items WHERE deleted_at IS NULL';
      const params = [];
      if (cafeId) {
        query += ' AND cafe_id = $1';
        params.push(cafeId);
      }
      if (category) {
        query += ` AND category = $${params.length + 1}`;
        params.push(category);
      }
      query += ` LIMIT $${params.length + 1}`;
      params.push(limit);
      const result = await db.query(query, params);
      return result.rows;
    },
    
    myFoodOrders: async (_, { limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM food_orders WHERE student_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [user.userId, limit, offset]
      );
      return result.rows;
    },
    
    // Service queries
    services: async (_, { category, search, limit = 20 }) => {
      let query = 'SELECT * FROM services WHERE deleted_at IS NULL AND status = $1';
      const params = ['ACTIVE'];
      if (category) {
        query += ' AND category = $2';
        params.push(category);
      }
      if (search) {
        query += ` AND (title ILIKE $${params.length + 1} OR description ILIKE $${params.length + 2})`;
        params.push(`%${search}%`, `%${search}%`);
      }
      query += ` LIMIT $${params.length + 1}`;
      params.push(limit);
      const result = await db.query(query, params);
      return result.rows;
    },
    
    service: async (_, { id }) => {
      const result = await db.query('SELECT * FROM services WHERE id = $1 AND deleted_at IS NULL', [id]);
      return result.rows[0];
    },
    
    myServices: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM services WHERE provider_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
        [user.userId]
      );
      return result.rows;
    },
    
    myServiceBookings: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM service_requests WHERE requester_id = $1 OR provider_id = $1 ORDER BY created_at DESC',
        [user.userId]
      );
      return result.rows;
    },
    
    // Messaging queries
    myConversations: async (_, { limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        `SELECT c.* FROM conversations c
         JOIN conversation_participants cp ON c.id = cp.conversation_id
         WHERE cp.user_id = $1
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`,
        [user.userId, limit, offset]
      );
      return result.rows;
    },
    
    conversation: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        `SELECT c.* FROM conversations c
         JOIN conversation_participants cp ON c.id = cp.conversation_id
         WHERE c.id = $1 AND cp.user_id = $2`,
        [id, user.userId]
      );
      return result.rows[0];
    },
    
    unreadMessageCount: async (_, __, { user }) => {
      if (!user) return 0;
      const result = await db.query(
        `SELECT COUNT(*) FROM messages m
         WHERE m.conversation_id IN (
           SELECT conversation_id FROM conversation_participants WHERE user_id = $1
         ) AND m.sender_id != $1
         AND NOT EXISTS (SELECT 1 FROM message_reads WHERE message_id = m.id AND user_id = $1)`,
        [user.userId]
      );
      return parseInt(result.rows[0].count);
    }
  },
  
  Mutation: {
    // Auth mutations
    register: async (_, { input }) => {
      const { firstName, lastName, email, phone, password } = input;
      
      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) throw new Error('Email already registered');
      
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await db.query(
        `INSERT INTO users (first_name, last_name, email, phone, password_hash, account_status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
         RETURNING *`,
        [firstName, lastName, email, phone, hashedPassword]
      );
      
      const user = result.rows[0];
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return { token, user };
    },
    
    login: async (_, { input }) => {
      const { email, password } = input;
      
      const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      if (result.rows.length === 0) throw new Error('Invalid credentials');
      
      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) throw new Error('Invalid credentials');
      
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return { token, user };
    },
    
    updateProfile: async (_, { firstName, lastName, phone, profilePictureUrl }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `UPDATE users 
         SET first_name = COALESCE($1, first_name),
             last_name = COALESCE($2, last_name),
             phone = COALESCE($3, phone),
             profile_picture_url = COALESCE($4, profile_picture_url),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [firstName, lastName, phone, profilePictureUrl, user.userId]
      );
      
      return result.rows[0];
    },
    
    changePassword: async (_, { oldPassword, newPassword }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.userId]);
      const valid = await bcrypt.compare(oldPassword, result.rows[0].password_hash);
      if (!valid) throw new Error('Invalid old password');
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, user.userId]);
      
      return true;
    },
    
    // Product mutations
    createProduct: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { title, description, price, categoryId, condition, stockQuantity } = input;
      const result = await db.query(
        `INSERT INTO products (seller_id, title, description, price, category_id, condition, stock_quantity, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         RETURNING *`,
        [user.userId, title, description, price, categoryId, condition, stockQuantity || 1]
      );
      
      return result.rows[0];
    },
    
    updateProduct: async (_, { id, title, description, price, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const check = await db.query('SELECT seller_id FROM products WHERE id = $1', [id]);
      if (check.rows.length === 0) throw new Error('Product not found');
      if (check.rows[0].seller_id !== user.userId) throw new Error('Not authorized');
      
      const result = await db.query(
        `UPDATE products 
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             price = COALESCE($3, price),
             status = COALESCE($4, status),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [title, description, price, status, id]
      );
      
      return result.rows[0];
    },
    
    deleteProduct: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const check = await db.query('SELECT seller_id FROM products WHERE id = $1', [id]);
      if (check.rows.length === 0) throw new Error('Product not found');
      if (check.rows[0].seller_id !== user.userId) throw new Error('Not authorized');
      
      await db.query('UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
      return true;
    },
    
    createOrder: async (_, { productId, quantity, shippingAddress }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const product = await db.query('SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL', [productId]);
      if (product.rows.length === 0) throw new Error('Product not found');
      
      const totalAmount = parseFloat(product.rows[0].price) * quantity;
      const result = await db.query(
        `INSERT INTO product_orders (buyer_id, seller_id, total_amount, shipping_address, order_status)
         VALUES ($1, $2, $3, $4, 'PENDING')
         RETURNING *`,
        [user.userId, product.rows[0].seller_id, totalAmount, shippingAddress]
      );
      
      await db.query(
        `INSERT INTO product_order_items (order_id, product_id, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.rows[0].id, productId, quantity, product.rows[0].price, totalAmount]
      );
      
      return result.rows[0];
    },
    
    cancelOrder: async (_, { orderId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE product_orders SET order_status = $1 WHERE id = $2 AND buyer_id = $3 RETURNING id',
        ['CANCELLED', orderId, user.userId]
      );
      
      return result.rowCount > 0;
    },
    
    reviewProduct: async (_, { productId, rating, reviewText }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `INSERT INTO product_reviews (product_id, reviewer_id, rating, review_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, reviewer_id) 
         DO UPDATE SET rating = $3, review_text = $4
         RETURNING *`,
        [productId, user.userId, rating, reviewText]
      );
      
      return result.rows[0];
    },
    
    // Payment mutations
    initiatePayment: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { orderType, orderId, paymentMethod } = input;
      let amount = 0;
      
      if (orderType === 'PRODUCT') {
        const order = await db.query('SELECT total_amount FROM product_orders WHERE id = $1', [orderId]);
        if (order.rows.length === 0) throw new Error('Order not found');
        amount = parseFloat(order.rows[0].total_amount);
      }
      
      const reference = `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const result = await db.query(
        `INSERT INTO payments (payer_id, amount, payment_method, payment_status, transaction_reference, product_order_id)
         VALUES ($1, $2, $3, 'PAID', $4, $5)
         RETURNING *`,
        [user.userId, amount, paymentMethod, reference, orderId]
      );
      
      await db.query('UPDATE product_orders SET order_status = $1 WHERE id = $2', ['CONFIRMED', orderId]);
      
      return { payment: result.rows[0], reference };
    },
    
    verifyPayment: async (_, { reference }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query('SELECT * FROM payments WHERE transaction_reference = $1', [reference]);
      if (result.rows.length === 0) throw new Error('Payment not found');
      return result.rows[0];
    },
    
    requestRefund: async (_, { paymentId, reason }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE payments SET payment_status = $1 WHERE id = $2 AND payer_id = $3 RETURNING id',
        ['REFUNDED', paymentId, user.userId]
      );
      
      return result.rowCount > 0;
    },
    
    // Delivery mutations
    createDeliveryProfile: async (_, { vehicleType, licenseNumber }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `INSERT INTO delivery_profiles (user_id, vehicle_type, license_number, is_available)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (user_id) 
         DO UPDATE SET vehicle_type = $2, license_number = $3
         RETURNING *`,
        [user.userId, vehicleType, licenseNumber]
      );
      
      return result.rows[0];
    },
    
    updateDeliveryStatus: async (_, { deliveryId, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      let updateQuery = 'UPDATE deliveries SET delivery_status = $1';
      if (status === 'PICKED_UP') updateQuery += ', picked_up_at = CURRENT_TIMESTAMP';
      if (status === 'DELIVERED') updateQuery += ', delivered_at = CURRENT_TIMESTAMP';
      updateQuery += ' WHERE id = $2 AND delivery_person_id = $3 RETURNING *';
      
      const result = await db.query(updateQuery, [status, deliveryId, user.userId]);
      return result.rows[0];
    },
    
    assignDelivery: async (_, { orderType, orderId, deliveryPersonId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      let pickupLocation = '';
      let deliveryLocation = '';
      
      if (orderType === 'PRODUCT') {
        const order = await db.query('SELECT shipping_address FROM product_orders WHERE id = $1', [orderId]);
        deliveryLocation = order.rows[0]?.shipping_address;
        pickupLocation = 'Seller Location';
      }
      
      const result = await db.query(
        `INSERT INTO deliveries (delivery_person_id, order_type, order_id, pickup_location, delivery_location, delivery_status)
         VALUES ($1, $2, $3, $4, $5, 'ASSIGNED')
         RETURNING *`,
        [deliveryPersonId, orderType, orderId, pickupLocation, deliveryLocation]
      );
      
      return result.rows[0];
    },
    
    acceptDelivery: async (_, { deliveryId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE deliveries SET delivery_status = $1 WHERE id = $2 AND delivery_person_id = $3 RETURNING id',
        ['ACCEPTED', deliveryId, user.userId]
      );
      
      return result.rowCount > 0;
    },
    
    cancelDelivery: async (_, { deliveryId, reason }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE deliveries SET delivery_status = $1 WHERE id = $2 AND delivery_person_id = $3 RETURNING id',
        ['CANCELLED', deliveryId, user.userId]
      );
      
      return result.rowCount > 0;
    },
    
    // Food mutations
    placeFoodOrder: async (_, { cafeId, items, specialInstructions }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      let totalAmount = 0;
      for (const item of items) {
        const menuItem = await db.query('SELECT price FROM menu_items WHERE id = $1', [item.menuItemId]);
        totalAmount += parseFloat(menuItem.rows[0].price) * item.quantity;
      }
      
      const result = await db.query(
        `INSERT INTO food_orders (student_id, cafe_id, total_amount, special_instructions, order_status)
         VALUES ($1, $2, $3, $4, 'PENDING')
         RETURNING *`,
        [user.userId, cafeId, totalAmount, specialInstructions]
      );
      
      for (const item of items) {
        const menuItem = await db.query('SELECT price, name FROM menu_items WHERE id = $1', [item.menuItemId]);
        await db.query(
          `INSERT INTO food_order_items (order_id, menu_item_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [result.rows[0].id, item.menuItemId, item.quantity, menuItem.rows[0].price, 
           parseFloat(menuItem.rows[0].price) * item.quantity]
        );
      }
      
      return result.rows[0];
    },
    
    updateFoodOrderStatus: async (_, { orderId, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE food_orders SET order_status = $1 WHERE id = $2 RETURNING *',
        [status, orderId]
      );
      
      return result.rows[0];
    },
    
    cancelFoodOrder: async (_, { orderId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE food_orders SET order_status = $1 WHERE id = $2 AND student_id = $3 RETURNING id',
        ['CANCELLED', orderId, user.userId]
      );
      
      return result.rowCount > 0;
    },
    
    // Service mutations
    createService: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { title, description, price, category, priceType } = input;
      const result = await db.query(
        `INSERT INTO services (provider_id, title, description, base_price, category, price_type, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         RETURNING *`,
        [user.userId, title, description, price, category, priceType || 'FIXED']
      );
      
      return result.rows[0];
    },
    
    updateService: async (_, { id, title, description, price, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const check = await db.query('SELECT provider_id FROM services WHERE id = $1', [id]);
      if (check.rows.length === 0) throw new Error('Service not found');
      if (check.rows[0].provider_id !== user.userId) throw new Error('Not authorized');
      
      const result = await db.query(
        `UPDATE services 
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             base_price = COALESCE($3, base_price),
             status = COALESCE($4, status),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [title, description, price, status, id]
      );
      
      return result.rows[0];
    },
    
    deleteService: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const check = await db.query('SELECT provider_id FROM services WHERE id = $1', [id]);
      if (check.rows.length === 0) throw new Error('Service not found');
      if (check.rows[0].provider_id !== user.userId) throw new Error('Not authorized');
      
      await db.query('UPDATE services SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
      return true;
    },
    
    bookService: async (_, { serviceId, bookingDate, notes }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const service = await db.query('SELECT * FROM services WHERE id = $1 AND status = $2', [serviceId, 'ACTIVE']);
      if (service.rows.length === 0) throw new Error('Service not available');
      
      const result = await db.query(
        `INSERT INTO service_requests (service_id, requester_id, provider_id, booking_date, notes, request_status, total_amount)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
         RETURNING *`,
        [serviceId, user.userId, service.rows[0].provider_id, bookingDate, notes, service.rows[0].base_price]
      );
      
      return result.rows[0];
    },
    
    updateBookingStatus: async (_, { bookingId, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE service_requests SET request_status = $1 WHERE id = $2 RETURNING *',
        [status, bookingId]
      );
      
      return result.rows[0];
    },
    
    cancelBooking: async (_, { bookingId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE service_requests SET request_status = $1 WHERE id = $2 AND requester_id = $3 RETURNING id',
        ['CANCELLED', bookingId, user.userId]
      );
      
      return result.rowCount > 0;
    },
    
    // Messaging mutations
    sendMessage: async (_, { conversationId, content }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `INSERT INTO messages (conversation_id, sender_id, message_text, message_status)
         VALUES ($1, $2, $3, 'SENT')
         RETURNING *`,
        [conversationId, user.userId, content]
      );
      
      return result.rows[0];
    },
    
    createConversation: async (_, { participantIds }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `INSERT INTO conversations (conversation_type)
         VALUES ('DIRECT')
         RETURNING *`,
        []
      );
      
      const allParticipants = [user.userId, ...participantIds];
      for (const participantId of allParticipants) {
        await db.query(
          `INSERT INTO conversation_participants (conversation_id, user_id)
           VALUES ($1, $2)`,
          [result.rows[0].id, participantId]
        );
      }
      
      return result.rows[0];
    },
    
    markMessageRead: async (_, { messageId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      await db.query(
        `INSERT INTO message_reads (message_id, user_id, read_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT DO NOTHING`,
        [messageId, user.userId]
      );
      
      return true;
    },
    
    deleteMessage: async (_, { messageId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE messages SET is_deleted = true WHERE id = $1 AND sender_id = $2 RETURNING id',
        [messageId, user.userId]
      );
      
      return result.rowCount > 0;
    }
  },
  
  // Field resolvers
  Product: {
    seller: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.seller_id]);
      return result.rows[0];
    }
  },
  
  ProductOrder: {
    buyer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.buyer_id]);
      return result.rows[0];
    },
    seller: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.seller_id]);
      return result.rows[0];
    },
    items: async (parent) => {
      const result = await db.query(
        `SELECT oi.*, p.title, p.price
         FROM product_order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = $1`,
        [parent.id]
      );
      return result.rows;
    }
  },
  
  OrderItem: {
    product: async (parent) => {
      const result = await db.query('SELECT * FROM products WHERE id = $1', [parent.product_id]);
      return result.rows[0];
    }
  },
  
  Payment: {
    payer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.payer_id]);
      return result.rows[0];
    }
  },
  
  Delivery: {
    deliveryPerson: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.delivery_person_id]);
      return result.rows[0];
    }
  },
  
  MenuItem: {
    cafe: async (parent) => {
      const result = await db.query('SELECT * FROM cafes WHERE id = $1', [parent.cafe_id]);
      return result.rows[0];
    }
  },
  
  FoodOrder: {
    student: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.student_id]);
      return result.rows[0];
    },
    cafe: async (parent) => {
      const result = await db.query('SELECT * FROM cafes WHERE id = $1', [parent.cafe_id]);
      return result.rows[0];
    },
    items: async (parent) => {
      const result = await db.query(
        `SELECT foi.*, mi.name, mi.price
         FROM food_order_items foi
         JOIN menu_items mi ON foi.menu_item_id = mi.id
         WHERE foi.order_id = $1`,
        [parent.id]
      );
      return result.rows;
    }
  },
  
  FoodOrderItem: {
    menuItem: async (parent) => {
      const result = await db.query('SELECT * FROM menu_items WHERE id = $1', [parent.menu_item_id]);
      return result.rows[0];
    }
  },
  
  Service: {
    provider: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.provider_id]);
      return result.rows[0];
    }
  },
  
  ServiceBooking: {
    service: async (parent) => {
      const result = await db.query('SELECT * FROM services WHERE id = $1', [parent.service_id]);
      return result.rows[0];
    },
    customer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.requester_id]);
      return result.rows[0];
    }
  },
  
  Conversation: {
    participants: async (parent) => {
      const result = await db.query(
        `SELECT u.* FROM users u
         JOIN conversation_participants cp ON u.id = cp.user_id
         WHERE cp.conversation_id = $1`,
        [parent.id]
      );
      return result.rows;
    },
    lastMessage: async (parent) => {
      const result = await db.query(
        'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY sent_at DESC LIMIT 1',
        [parent.id]
      );
      return result.rows[0];
    },
    unreadCount: async (parent, _, { user }) => {
      if (!user) return 0;
      const result = await db.query(
        `SELECT COUNT(*) FROM messages m
         WHERE m.conversation_id = $1 AND m.sender_id != $2
         AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = $2)`,
        [parent.id, user.userId]
      );
      return parseInt(result.rows[0].count);
    }
  },
  
  Message: {
    sender: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.sender_id]);
      return result.rows[0];
    }
  }
};

async function createApolloServer() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    introspection: true,
    formatError: (error) => {
      console.error('GraphQL Error:', error.message);
      return {
        message: error.message,
        code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
      };
    },
  });
  
  await server.start();
  return server;
}

module.exports = { createApolloServer };
