const { ApolloServer } = require('@apollo/server');
const typeDefs = require('./typeDefs');
const resolvers = require('./resolvers');

const createApolloServer = async () => {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    introspection: true,
  });
  
  await server.start();
  return server;
};

module.exports = { createApolloServer };