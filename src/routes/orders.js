const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/database');

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

// Get my orders
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT o.*, 
              json_agg(json_build_object('id', oi.id, 'product_id', oi.product_id, 
                                         'quantity', oi.quantity, 'unit_price', oi.unit_price)) as items
       FROM product_orders o
       JOIN product_order_items oi ON o.id = oi.order_id
       WHERE o.buyer_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [req.userId]
    );
    
    res.json({ success: true, orders: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get my sales
router.get('/my-sales', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT o.*, u.email, u.first_name, u.last_name,
              json_agg(json_build_object('id', oi.id, 'product_id', oi.product_id, 
                                         'quantity', oi.quantity, 'unit_price', oi.unit_price)) as items
       FROM product_orders o
       JOIN product_order_items oi ON o.id = oi.order_id
       JOIN users u ON o.buyer_id = u.id
       WHERE o.seller_id = $1
       GROUP BY o.id, u.email, u.first_name, u.last_name
       ORDER BY o.created_at DESC`,
      [req.userId]
    );
    
    res.json({ success: true, orders: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create order
router.post('/', verifyToken, async (req, res) => {
  const { productId, quantity, shippingAddress } = req.body;
  const client = await db.pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get product details
    const product = await client.query(
      'SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL',
      [productId]
    );
    
    if (product.rows.length === 0) {
      throw new Error('Product not found');
    }
    
    const productData = product.rows[0];
    const totalAmount = productData.price * quantity;
    
    // Create order
    const order = await client.query(
      `INSERT INTO product_orders (buyer_id, seller_id, total_amount, shipping_address)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.userId, productData.seller_id, totalAmount, shippingAddress]
    );
    
    // Create order item
    await client.query(
      `INSERT INTO product_order_items (order_id, product_id, quantity, unit_price, subtotal)
       VALUES ($1, $2, $3, $4, $5)`,
      [order.rows[0].id, productId, quantity, productData.price, totalAmount]
    );
    
    // Update product stock
    await client.query(
      'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
      [quantity, productId]
    );
    
    await client.query('COMMIT');
    
    res.json({ success: true, order: order.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
