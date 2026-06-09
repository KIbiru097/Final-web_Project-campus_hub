const express = require('express');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

const { testConnection } = require('./src/config/database');
const { createApolloServer } = require('./src/graphql/apollo-server');

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 4000;

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (optional - keep for monitoring)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    server: 'CampusHub GraphQL API'
  });
});

// Start server with only GraphQL
const startServer = async () => {
  // Setup GraphQL
  const apolloServer = await createApolloServer();
  
  const { expressMiddleware } = require('@apollo/server/express4');
  
  app.use('/graphql', express.json(), expressMiddleware(apolloServer, {
    context: async ({ req }) => {
      const authHeader = req.headers.authorization || '';
      let user = null;
      
      if (authHeader.startsWith('Bearer ')) {
        try {
          const jwt = require('jsonwebtoken');
          const token = authHeader.substring(7);
          user = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
          console.log('Invalid token:', error.message);
        }
      }
      
      return { user };
    },
  }));
  
  httpServer.listen(PORT, async () => {
    console.log(`\n=================================`);
    console.log(`🚀 CampusHub GraphQL Server`);
    console.log(`=================================`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🎯 GraphQL: http://localhost:${PORT}/graphql`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log(`=================================\n`);
    
    await testConnection();
  });
};

startServer();