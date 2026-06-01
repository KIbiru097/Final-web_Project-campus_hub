const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/database');

// Middleware to verify token
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

// Get all products
router.get('/', async (req, res) => {
  const { search, limit = 20, offset = 0 } = req.query;
  
  try {
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

    query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    
    res.json({
      success: true,
      products: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, u.first_name, u.last_name, u.email
       FROM products p
       JOIN users u ON p.seller_id = u.id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create product (protected)
router.post('/', verifyToken, async (req, res) => {
  const { title, description, price, categoryId, condition, allowDelivery, allowMeetup } = req.body;
  
  try {
    const result = await db.query(
      `INSERT INTO products (seller_id, title, description, price, category_id, condition, allow_delivery, allow_meetup, stock_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
       RETURNING *`,
      [req.userId, title, description, price, categoryId, condition, allowDelivery, allowMeetup]
    );
    
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update product
router.put('/:id', verifyToken, async (req, res) => {
  const { title, description, price, status } = req.body;
  
  try {
    // Check ownership
    const check = await db.query(
      'SELECT seller_id FROM products WHERE id = $1',
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
           status = COALESCE($4, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [title, description, price, status, req.params.id]
    );
    
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete product
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const check = await db.query(
      'SELECT seller_id FROM products WHERE id = $1',
      [req.params.id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (check.rows[0].seller_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await db.query(
      'UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );
    
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
