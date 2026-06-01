const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/database');
const paymentService = require('../services/payment.service');

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

// Root endpoint - list available payment endpoints
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Payment API endpoints',
    endpoints: {
      'GET /my-payments': 'Get your payment history',
      'GET /:id': 'Get specific payment by ID',
      'POST /initiate': 'Initiate a new payment',
      'POST /:id/refund': 'Request a refund',
      'POST /webhook': 'Webhook for payment providers'
    },
    example: {
      initiate: {
        method: 'POST',
        url: '/api/payments/initiate',
        body: {
          orderId: 'uuid',
          orderType: 'PRODUCT|FOOD|SERVICE',
          paymentMethod: 'CHAPA|TELEBIRR|CASH|BANK_TRANSFER'
        }
      }
    }
  });
});

// Get my payments
router.get('/my-payments', verifyToken, async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  
  try {
    const payments = await paymentService.getUserPayments(req.userId, limit, offset);
    res.json({ success: true, payments, count: payments.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment by ID
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const payment = await paymentService.getPayment(req.params.id);
    
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    if (payment.payer_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    res.json({ success: true, payment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initiate payment
router.post('/initiate', verifyToken, async (req, res) => {
  const { orderId, orderType, paymentMethod } = req.body;
  
  if (!orderId || !orderType || !paymentMethod) {
    return res.status(400).json({ 
      error: 'Missing required fields: orderId, orderType, paymentMethod' 
    });
  }
  
  try {
    const result = await paymentService.initiatePayment(
      orderId,
      orderType,
      paymentMethod,
      req.userId
    );
    
    res.json({
      success: true,
      payment: result.payment,
      message: result.mockResult.message,
      reference: result.reference
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Request refund
router.post('/:id/refund', verifyToken, async (req, res) => {
  const { reason } = req.body;
  
  if (!reason) {
    return res.status(400).json({ error: 'Refund reason is required' });
  }
  
  try {
    const result = await paymentService.processRefund(req.params.id, req.userId, reason);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mock webhook for payment simulation
router.post('/webhook', async (req, res) => {
  const { reference, status, transactionId } = req.body;
  
  try {
    // Update payment status based on webhook
    const result = await db.query(
      `UPDATE payments 
       SET payment_status = $1, paid_at = CURRENT_TIMESTAMP, transaction_reference = COALESCE($2, transaction_reference)
       WHERE transaction_reference = $3 AND payment_status = 'PENDING'
       RETURNING *`,
      [status, transactionId, reference]
    );
    
    res.json({ 
      success: true, 
      message: 'Webhook processed',
      payment: result.rows[0] || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment statistics
router.get('/stats/summary', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
         COUNT(*) as total_transactions,
         SUM(amount) as total_amount,
         COUNT(CASE WHEN payment_status = 'PAID' THEN 1 END) as successful_payments,
         COUNT(CASE WHEN payment_status = 'FAILED' THEN 1 END) as failed_payments,
         COUNT(CASE WHEN payment_status = 'REFUNDED' THEN 1 END) as refunded_payments
       FROM payments
       WHERE payer_id = $1`,
      [req.userId]
    );
    
    res.json({ success: true, stats: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
