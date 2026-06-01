const { redisClient } = require('../config/redis');
const { verifyToken } = require('../config/auth');

module.exports = async ({ req }) => {
  // Extract token from authorization header
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  
  let user = null;
  if (token) {
    user = verifyToken(token);
  }
  
  // Get IP address
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  return {
    user,
    ip,
    redis: redisClient,
    req,
  };
};