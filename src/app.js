const express = require('express');
const { createServer } = require('http');
const { createYoga } = require('graphql-yoga');
const { useServer } = require('graphql-ws/lib/use/ws');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const typeDefs = require('./graphql/typeDefs');
const resolvers = require('./graphql/resolvers');
const context = require('./graphql/context');
const { redisClient } = require('./config/redis');
const errorHandler = require('./middleware/errorHandler');
const { testConnection } = require('./config/database');

const app = express();

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP',
});
app.use('/graphql', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files for uploads
app.use('/uploads', express.static('uploads'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Create GraphQL Yoga server
const yoga = createYoga({
  schema: {
    typeDefs,
    resolvers,
  },
  context,
  graphqlEndpoint: '/graphql',
  graphiql: process.env.NODE_ENV === 'development',
  multipart: true,
});

app.use('/graphql', yoga);

// Error handling middleware
app.use(errorHandler);

// Create HTTP server
const httpServer = createServer(app);

// WebSocket server for subscriptions
const wsServer = new WebSocketServer({
  server: httpServer,
  path: '/graphql',
});

useServer(
  {
    schema: {
      typeDefs,
      resolvers,
    },
    context,
  },
  wsServer
);

// Test database connection on startup
testConnection().catch(console.error);

module.exports = { app, httpServer };