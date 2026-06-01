const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/database');

// Middleware to verify token and get user
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ==================== USER CRUD ====================

// Get all users (admin only)
router.get('/users', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.account_status, 
             u.created_at, array_agg(r.role_name) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ success: true, users: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user by ID
router.get('/users/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.*, 
             json_agg(DISTINCT r.role_name) as roles,
             json_build_object(
               'id', sp.id, 'student_id', sp.student_id, 'department', sp.department,
               'year_level', sp.year_level, 'verification_status', sp.verification_status
             ) as student_profile
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN student_profiles sp ON u.id = sp.user_id
      WHERE u.id = $1 AND u.deleted_at IS NULL
      GROUP BY u.id, sp.id
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user
router.put('/users/:id', verifyToken, async (req, res) => {
  const { first_name, last_name, phone } = req.body;
  
  try {
    const result = await db.query(
      `UPDATE users 
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           phone = COALESCE($3, phone),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND deleted_at IS NULL
       RETURNING id, first_name, last_name, email, phone, account_status`,
      [first_name, last_name, phone, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete user (soft delete)
router.delete('/users/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PRODUCT CRUD ====================

// Get all products with filters
router.get('/products', async (req, res) => {
  const { category, search, minPrice, maxPrice, status, limit = 50, offset = 0 } = req.query;
  
  try {
    let query = `
      SELECT p.*, u.first_name as seller_first_name, u.last_name as seller_last_name,
             c.name as category_name,
             (SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id) as avg_rating
      FROM products p
      JOIN users u ON p.seller_id = u.id
      JOIN product_categories c ON p.category_id = c.id
      WHERE p.deleted_at IS NULL
    `;
    const params = [];
    let paramIndex = 1;

    if (category) {
      query += ` AND p.category_id = $${paramIndex++}`;
      params.push(category);
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
    
    if (status) {
      query += ` AND p.status = $${paramIndex++}`;
      params.push(status);
    }
    
    query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    const countResult = await db.query('SELECT COUNT(*) FROM products WHERE deleted_at IS NULL');
    
    res.json({
      success: true,
      products: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single product with details
router.get('/products/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, u.first_name as seller_first_name, u.last_name as seller_last_name,
             u.email as seller_email, u.phone as seller_phone,
             c.name as category_name,
             (SELECT json_agg(json_build_object('id', pi.id, 'url', pi.image_url, 'is_primary', pi.is_primary))
              FROM product_images pi WHERE pi.product_id = p.id) as images,
             (SELECT json_agg(json_build_object('id', pr.id, 'rating', pr.rating, 'review', pr.review_text,
                                                'reviewer', json_build_object('name', ru.first_name || ' ' || ru.last_name)))
              FROM product_reviews pr JOIN users ru ON pr.reviewer_id = ru.id
              WHERE pr.product_id = p.id) as reviews,
             (SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id) as avg_rating
      FROM products p
      JOIN users u ON p.seller_id = u.id
      JOIN product_categories c ON p.category_id = c.id
      WHERE p.id = $1 AND p.deleted_at IS NULL
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create product
router.post('/products', verifyToken, async (req, res) => {
  const { title, description, price, category_id, condition, stock_quantity, allow_delivery, allow_meetup } = req.body;
  
  try {
    const result = await db.query(
      `INSERT INTO products (seller_id, title, description, price, category_id, condition, 
                             stock_quantity, allow_delivery, allow_meetup, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
       RETURNING *`,
      [req.userId, title, description, price, category_id, condition, stock_quantity || 1, 
       allow_delivery !== false, allow_meetup !== false]
    );
    
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update product
router.put('/products/:id', verifyToken, async (req, res) => {
  const { title, description, price, condition, stock_quantity, status, allow_delivery, allow_meetup } = req.body;
  
  try {
    // Check ownership
    const check = await db.query(
      'SELECT seller_id FROM products WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (check.rows[0].seller_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await db.query(
      `UPDATE products 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           price = COALESCE($3, price),
           condition = COALESCE($4, condition),
           stock_quantity = COALESCE($5, stock_quantity),
           status = COALESCE($6, status),
           allow_delivery = COALESCE($7, allow_delivery),
           allow_meetup = COALESCE($8, allow_meetup),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [title, description, price, condition, stock_quantity, status, allow_delivery, allow_meetup, req.params.id]
    );
    
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete product
router.delete('/products/:id', verifyToken, async (req, res) => {
  try {
    const check = await db.query(
      'SELECT seller_id FROM products WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (check.rows[0].seller_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await db.query('UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ORDER CRUD ====================

// Get all orders (with filters)
router.get('/orders', verifyToken, async (req, res) => {
  const { status, role, limit = 50, offset = 0 } = req.query;
  
  try {
    let query = `
      SELECT o.*, 
             buyer.first_name as buyer_first_name, buyer.last_name as buyer_last_name, buyer.email as buyer_email,
             seller.first_name as seller_first_name, seller.last_name as seller_last_name, seller.email as seller_email,
             (SELECT json_agg(json_build_object('id', oi.id, 'product_title', p.title, 'quantity', oi.quantity,
                                                'unit_price', oi.unit_price, 'subtotal', oi.subtotal))
              FROM product_order_items oi
              JOIN products p ON oi.product_id = p.id
              WHERE oi.order_id = o.id) as items
      FROM product_orders o
      JOIN users buyer ON o.buyer_id = buyer.id
      JOIN users seller ON o.seller_id = seller.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` AND o.order_status = $${paramIndex++}`;
      params.push(status);
    }
    
    if (role === 'buyer') {
      query += ` AND o.buyer_id = $${paramIndex++}`;
      params.push(req.userId);
    } else if (role === 'seller') {
      query += ` AND o.seller_id = $${paramIndex++}`;
      params.push(req.userId);
    }
    
    query += ` ORDER BY o.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    res.json({ success: true, orders: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get order by ID
router.get('/orders/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT o.*, 
             buyer.first_name as buyer_first_name, buyer.last_name as buyer_last_name, buyer.email as buyer_email, buyer.phone as buyer_phone,
             seller.first_name as seller_first_name, seller.last_name as seller_last_name, seller.email as seller_email,
             (SELECT json_agg(json_build_object('id', oi.id, 'product_id', oi.product_id, 'product_title', p.title,
                                                'quantity', oi.quantity, 'unit_price', oi.unit_price, 'subtotal', oi.subtotal))
              FROM product_order_items oi
              JOIN products p ON oi.product_id = p.id
              WHERE oi.order_id = o.id) as items
      FROM product_orders o
      JOIN users buyer ON o.buyer_id = buyer.id
      JOIN users seller ON o.seller_id = seller.id
      WHERE o.id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = result.rows[0];
    if (order.buyer_id !== req.userId && order.seller_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update order status
router.put('/orders/:id/status', verifyToken, async (req, res) => {
  const { status } = req.body;
  
  try {
    const check = await db.query(
      'SELECT seller_id, buyer_id FROM product_orders WHERE id = $1',
      [req.params.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (check.rows[0].seller_id !== req.userId) {
      return res.status(403).json({ error: 'Only seller can update order status' });
    }
    
    const result = await db.query(
      'UPDATE product_orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    
    res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel order
router.delete('/orders/:id', verifyToken, async (req, res) => {
  try {
    const check = await db.query(
      'SELECT buyer_id FROM product_orders WHERE id = $1 AND order_status = $2',
      [req.params.id, 'PENDING']
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found or cannot be cancelled' });
    }
    
    if (check.rows[0].buyer_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await db.query(
      'UPDATE product_orders SET order_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['CANCELLED', req.params.id]
    );
    
    res.json({ success: true, message: 'Order cancelled successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REVIEW CRUD ====================

// Get reviews for a product
router.get('/products/:productId/reviews', async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  
  try {
    const result = await db.query(`
      SELECT r.*, u.first_name, u.last_name
      FROM product_reviews r
      JOIN users u ON r.reviewer_id = u.id
      WHERE r.product_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.params.productId, limit, offset]);
    
    const stats = await db.query(`
      SELECT AVG(rating)::float as avg_rating, COUNT(*) as total_reviews
      FROM product_reviews
      WHERE product_id = $1
    `, [req.params.productId]);
    
    res.json({
      success: true,
      reviews: result.rows,
      stats: stats.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create review
router.post('/products/:productId/reviews', verifyToken, async (req, res) => {
  const { rating, review_text } = req.body;
  
  try {
    // Check if user already reviewed
    const existing = await db.query(
      'SELECT id FROM product_reviews WHERE product_id = $1 AND reviewer_id = $2',
      [req.params.productId, req.userId]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You already reviewed this product' });
    }
    
    const result = await db.query(
      `INSERT INTO product_reviews (product_id, reviewer_id, rating, review_text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.params.productId, req.userId, rating, review_text]
    );
    
    res.json({ success: true, review: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update review
router.put('/reviews/:reviewId', verifyToken, async (req, res) => {
  const { rating, review_text } = req.body;
  
  try {
    const check = await db.query(
      'SELECT reviewer_id FROM product_reviews WHERE id = $1',
      [req.params.reviewId]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    if (check.rows[0].reviewer_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await db.query(
      `UPDATE product_reviews 
       SET rating = COALESCE($1, rating),
           review_text = COALESCE($2, review_text)
       WHERE id = $3
       RETURNING *`,
      [rating, review_text, req.params.reviewId]
    );
    
    res.json({ success: true, review: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete review
router.delete('/reviews/:reviewId', verifyToken, async (req, res) => {
  try {
    const check = await db.query(
      'SELECT reviewer_id FROM product_reviews WHERE id = $1',
      [req.params.reviewId]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    if (check.rows[0].reviewer_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await db.query('DELETE FROM product_reviews WHERE id = $1', [req.params.reviewId]);
    res.json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SERVICE CRUD ====================

// Get all services
router.get('/services', async (req, res) => {
  const { category, search, minPrice, maxPrice, limit = 50, offset = 0 } = req.query;
  
  try {
    let query = `
      SELECT s.*, u.first_name as provider_first_name, u.last_name as provider_last_name,
             c.name as category_name,
             (SELECT AVG(rating) FROM service_reviews WHERE service_id = s.id) as avg_rating
      FROM services s
      JOIN users u ON s.provider_id = u.id
      JOIN service_categories c ON s.category_id = c.id
      WHERE s.deleted_at IS NULL AND s.status = 'ACTIVE'
    `;
    const params = [];
    let paramIndex = 1;

    if (category) {
      query += ` AND s.category_id = $${paramIndex++}`;
      params.push(category);
    }
    
    if (search) {
      query += ` AND (s.title ILIKE $${paramIndex++} OR s.description ILIKE $${paramIndex++})`;
      params.push(`%${search}%`, `%${search}%`);
    }
    
    if (minPrice) {
      query += ` AND s.base_price >= $${paramIndex++}`;
      params.push(minPrice);
    }
    
    if (maxPrice) {
      query += ` AND s.base_price <= $${paramIndex++}`;
      params.push(maxPrice);
    }
    
    query += ` ORDER BY s.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await db.query(query, params);
    res.json({ success: true, services: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get service by ID
router.get('/services/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.*, u.first_name as provider_first_name, u.last_name as provider_last_name,
             u.email as provider_email, u.phone as provider_phone,
             c.name as category_name,
             (SELECT json_agg(json_build_object('id', sa.id, 'day', sa.day_of_week, 
                                                'start', sa.start_time, 'end', sa.end_time))
              FROM service_availability sa WHERE sa.service_id = s.id) as availability,
             (SELECT AVG(rating) FROM service_reviews WHERE service_id = s.id) as avg_rating
      FROM services s
      JOIN users u ON s.provider_id = u.id
      JOIN service_categories c ON s.category_id = c.id
      WHERE s.id = $1 AND s.deleted_at IS NULL
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json({ success: true, service: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create service
router.post('/services', verifyToken, async (req, res) => {
  const { title, description, category_id, price_type, base_price } = req.body;
  
  try {
    const result = await db.query(
      `INSERT INTO services (provider_id, title, description, category_id, price_type, base_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
       RETURNING *`,
      [req.userId, title, description, category_id, price_type, base_price]
    );
    
    res.json({ success: true, service: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update service
router.put('/services/:id', verifyToken, async (req, res) => {
  const { title, description, price_type, base_price, status } = req.body;
  
  try {
    const check = await db.query(
      'SELECT provider_id FROM services WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    if (check.rows[0].provider_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await db.query(
      `UPDATE services 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           price_type = COALESCE($3, price_type),
           base_price = COALESCE($4, base_price),
           status = COALESCE($5, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [title, description, price_type, base_price, status, req.params.id]
    );
    
    res.json({ success: true, service: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete service
router.delete('/services/:id', verifyToken, async (req, res) => {
  try {
    const check = await db.query(
      'SELECT provider_id FROM services WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    if (check.rows[0].provider_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await db.query('UPDATE services SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== STATISTICS ====================

// Get dashboard statistics
router.get('/stats/dashboard', verifyToken, async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) as total_users,
        (SELECT COUNT(*) FROM users WHERE account_status = 'ACTIVE') as active_users,
        (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL) as total_products,
        (SELECT COUNT(*) FROM products WHERE status = 'ACTIVE') as active_products,
        (SELECT COUNT(*) FROM product_orders) as total_orders,
        (SELECT COALESCE(SUM(total_amount), 0) FROM product_orders WHERE order_status = 'DELIVERED') as total_revenue,
        (SELECT COUNT(*) FROM services WHERE deleted_at IS NULL AND status = 'ACTIVE') as active_services,
        (SELECT COUNT(*) FROM cafes WHERE deleted_at IS NULL AND status = 'ACTIVE') as active_cafes
    `);
    
    res.json({ success: true, stats: stats.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
