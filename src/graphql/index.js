const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer');
const jwt = require('jsonwebtoken');

const typeDefs = require('./schemas/index');
const resolvers = require('./resolvers/index');

const createGraphQLServer = async (httpServer) => {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
    formatError: (error) => {
      console.error('GraphQL Error:', error);
      return {
        message: error.message,
        code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
      };
    },
  });

  await server.start();

  const middleware = expressMiddleware(server, {
    context: async ({ req }) => {
      const token = req.headers.authorization || '';
      let user = null;
      
      if (token.startsWith('Bearer ')) {
        try {
          const actualToken = token.substring(7);
          user = jwt.verify(actualToken, process.env.JWT_SECRET);
        } catch (error) {
          console.log('Invalid token:', error.message);
        }
      }
      
      return { user };
    },
  });

  return { server, middleware };
};

module.exports = createGraphQLServer;
