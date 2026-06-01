const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const resolvers = {
  Query: {
    // User queries
    me: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
        [user.userId]
      );
      if (result.rows.length === 0) throw new Error('User not found');
      return result.rows[0];
    },

    user: async (_, { id }) => {
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (result.rows.length === 0) throw new Error('User not found');
      return result.rows[0];
    },

    // Product queries
    products: async (_, { search, categoryId, limit = 20, offset = 0 }) => {
      let query = `
        SELECT p.*, u.first_name, u.last_name, u.email
        FROM products p
        JOIN users u ON p.seller_id = u.id
        WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
      `;
      const params = [];
      let paramIndex = 1;

      if (search) {
        query += ` AND (p.title ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex + 1})`;
        params.push(`%${search}%`, `%${search}%`);
        paramIndex += 2;
      }

      if (categoryId) {
        query += ` AND p.category_id = $${paramIndex}`;
        params.push(categoryId);
        paramIndex++;
      }

      query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await db.query(query, params);
      return result.rows;
    },

    product: async (_, { id }) => {
      const result = await db.query(
        `SELECT p.*, u.first_name, u.last_name, u.email
         FROM products p
         JOIN users u ON p.seller_id = u.id
         WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [id]
      );
      if (result.rows.length === 0) throw new Error('Product not found');
      return result.rows[0];
    },

    myProducts: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM products WHERE seller_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
        [user.userId]
      );
      return result.rows;
    },

    // Order queries
    myOrders: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        `SELECT o.*, 
                json_agg(json_build_object('id', oi.id, 'quantity', oi.quantity, 
                                           'unit_price', oi.unit_price, 'product_id', oi.product_id)) as items
         FROM product_orders o
         JOIN product_order_items oi ON o.id = oi.order_id
         WHERE o.buyer_id = $1
         GROUP BY o.id
         ORDER BY o.created_at DESC`,
        [user.userId]
      );
      return result.rows;
    },

    mySales: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        `SELECT o.*, u.email, u.first_name, u.last_name,
                json_agg(json_build_object('id', oi.id, 'quantity', oi.quantity, 
                                           'unit_price', oi.unit_price, 'product_id', oi.product_id)) as items
         FROM product_orders o
         JOIN product_order_items oi ON o.id = oi.order_id
         JOIN users u ON o.buyer_id = u.id
         WHERE o.seller_id = $1
         GROUP BY o.id, u.email, u.first_name, u.last_name
         ORDER BY o.created_at DESC`,
        [user.userId]
      );
      return result.rows;
    },

    order: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await db.query(
        'SELECT * FROM product_orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)',
        [id, user.userId]
      );
      if (result.rows.length === 0) throw new Error('Order not found');
      return result.rows[0];
    },

    productReviews: async (_, { productId }) => {
      const result = await db.query(
        `SELECT r.*, u.first_name, u.last_name, u.email
         FROM product_reviews r
         JOIN users u ON r.reviewer_id = u.id
         WHERE r.product_id = $1
         ORDER BY r.created_at DESC`,
        [productId]
      );
      return result.rows;
    },
  },

  Mutation: {
    // Auth mutations
    register: async (_, { input }) => {
      const { firstName, lastName, email, phone, password } = input;
      
      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        throw new Error('Email already registered');
      }
      
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
      
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
        [email]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Invalid credentials');
      }
      
      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      
      if (!valid) {
        throw new Error('Invalid credentials');
      }
      
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return { token, user };
    },

    // Product mutations
    createProduct: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { title, description, price, categoryId, condition, allowDelivery, allowMeetup } = input;
      
      const result = await db.query(
        `INSERT INTO products (seller_id, title, description, price, category_id, condition, 
                               allow_delivery, allow_meetup, stock_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
         RETURNING *`,
        [user.userId, title, description, price, categoryId, condition, allowDelivery, allowMeetup]
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

    // Order mutations
    createOrder: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { productId, quantity, shippingAddress, fulfillmentMethod } = input;
      const client = await db.pool.connect();
      
      try {
        await client.query('BEGIN');
        
        const product = await client.query(
          'SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL',
          [productId]
        );
        
        if (product.rows.length === 0) throw new Error('Product not found');
        
        const productData = product.rows[0];
        const totalAmount = productData.price * quantity;
        
        const order = await client.query(
          `INSERT INTO product_orders (buyer_id, seller_id, total_amount, shipping_address)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [user.userId, productData.seller_id, totalAmount, shippingAddress]
        );
        
        await client.query(
          `INSERT INTO product_order_items (order_id, product_id, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5)`,
          [order.rows[0].id, productId, quantity, productData.price, totalAmount]
        );
        
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
          [quantity, productId]
        );
        
        await client.query('COMMIT');
        return order.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    updateOrderStatus: async (_, { orderId, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const check = await db.query('SELECT seller_id FROM product_orders WHERE id = $1', [orderId]);
      if (check.rows.length === 0) throw new Error('Order not found');
      if (check.rows[0].seller_id !== user.userId) throw new Error('Not authorized');
      
      const result = await db.query(
        'UPDATE product_orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [status, orderId]
      );
      
      return result.rows[0];
    },

    cancelOrder: async (_, { orderId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'UPDATE product_orders SET order_status = $1 WHERE id = $2 AND buyer_id = $3 RETURNING id',
        ['CANCELLED', orderId, user.userId]
      );
      
      return result.rows.length > 0;
    },

    // Review mutations
    createReview: async (_, { productId, rating, reviewText }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `INSERT INTO product_reviews (product_id, reviewer_id, rating, review_text)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, reviewer_id) DO UPDATE 
         SET rating = $3, review_text = $4
         RETURNING *`,
        [productId, user.userId, rating, reviewText]
      );
      
      return result.rows[0];
    },

    deleteReview: async (_, { reviewId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'DELETE FROM product_reviews WHERE id = $1 AND reviewer_id = $2 RETURNING id',
        [reviewId, user.userId]
      );
      
      return result.rows.length > 0;
    },
  },

  // Field resolvers
  Product: {
    seller: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.seller_id]);
      return result.rows[0];
    },
    averageRating: async (parent) => {
      const result = await db.query(
        'SELECT AVG(rating)::float as avg FROM product_reviews WHERE product_id = $1',
        [parent.id]
      );
      return result.rows[0].avg;
    },
  },

  Order: {
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
    },
  },

  OrderItem: {
    product: async (parent) => {
      const result = await db.query('SELECT * FROM products WHERE id = $1', [parent.product_id]);
      return result.rows[0];
    },
  },

  Review: {
    reviewer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.reviewer_id]);
      return result.rows[0];
    },
  },
};

module.exports = resolvers;
