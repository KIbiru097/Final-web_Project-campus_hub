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

// Initiate payment
router.post('/initiate', verifyToken, async (req, res) => {
  const { orderId, orderType, paymentMethod } = req.body;
  
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

// Get my payments
router.get('/my-payments', verifyToken, async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  
  try {
    const payments = await paymentService.getUserPayments(req.userId, limit, offset);
    res.json({ success: true, payments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Request refund
router.post('/:id/refund', verifyToken, async (req, res) => {
  const { reason } = req.body;
  
  try {
    const result = await paymentService.processRefund(req.params.id, req.userId, reason);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mock webhook for payment simulation
router.post('/webhook', async (req, res) => {
  const { reference, status } = req.body;
  
  try {
    // Update payment status based on webhook
    await db.query(
      `UPDATE payments 
       SET payment_status = $1, paid_at = CURRENT_TIMESTAMP
       WHERE transaction_reference = $2`,
      [status, reference]
    );
    
    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
