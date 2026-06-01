const express = require('express');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

const { testConnection } = require('./src/config/database');
const { createApolloServer } = require('./src/graphql/apollo-server');

// Routes
const userRoutes = require('./src/routes/users');
const productRoutes = require('./src/routes/products');
const orderRoutes = require('./src/routes/orders');
const crudRoutes = require('./src/routes/crud');
const paymentRoutes = require('./src/routes/payments');

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// REST Routes
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/crud', crudRoutes);
app.use('/api/payments', paymentRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// Test database endpoint
app.get('/api/test-db', async (req, res) => {
  try {
    const { query } = require('./src/config/database');
    const result = await query('SELECT NOW() as time, current_database() as database');
    res.json({
      success: true,
      timestamp: result.rows[0].time,
      database: result.rows[0].database,
      message: 'Database connected successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'CampusHub API is running!',
    endpoints: {
      rest: [
        '/health',
        '/api/test', 
        '/api/test-db',
        '/api/users/register',
        '/api/users/login',
        '/api/users/profile',
        '/api/products',
        '/api/orders/my-orders',
        '/api/crud/users',
        '/api/crud/products',
        '/api/payments/initiate',
        '/api/payments/my-payments'
      ],
      graphql: ['/graphql']
    }
  });
});

// Start server with GraphQL
const startServer = async () => {
  // Setup GraphQL
  const apolloServer = await createApolloServer();
  
  // Import expressMiddleware
  const { expressMiddleware } = require('@apollo/server/express4');
  
  app.use('/graphql', express.json(), expressMiddleware(apolloServer, {
    context: async ({ req }) => {
      const token = req.headers.authorization || '';
      let user = null;
      
      if (token.startsWith('Bearer ')) {
        try {
          const jwt = require('jsonwebtoken');
          const actualToken = token.substring(7);
          user = jwt.verify(actualToken, process.env.JWT_SECRET);
        } catch (error) {
          console.log('Invalid token:', error.message);
        }
      }
      
      return { user };
    },
  }));
  
  httpServer.listen(PORT, async () => {
    console.log(`\n=================================`);
    console.log(`🚀 CampusHub Backend Server`);
    console.log(`=================================`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log(`🧪 Test: http://localhost:${PORT}/api/test`);
    console.log(`🗄️  DB: http://localhost:${PORT}/api/test-db`);
    console.log(`👤 Users: http://localhost:${PORT}/api/users`);
    console.log(`📦 Products: http://localhost:${PORT}/api/products`);
    console.log(`🛒 Orders: http://localhost:${PORT}/api/orders`);
    console.log(`🔧 CRUD: http://localhost:${PORT}/api/crud`);
    console.log(`💳 Payments: http://localhost:${PORT}/api/payments`);
    console.log(`🎯 GraphQL: http://localhost:${PORT}/graphql`);
    console.log(`=================================\n`);
    
    await testConnection();
  });
};

startServer();
