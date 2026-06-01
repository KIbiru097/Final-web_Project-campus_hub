const rateLimit = require('express-rate-limit');
const { redisClient } = require('../config/redis');

const createRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => req.ip,
  } = options;
  
  if (redisClient) {
    // Use Redis store for production
    const RedisStore = require('rate-limit-redis');
    return rateLimit({
      store: new RedisStore({
        client: redisClient,
        prefix: 'rl:',
      }),
      windowMs,
      max,
      message,
      keyGenerator,
    });
  }
  
  // Use memory store for development
  return rateLimit({
    windowMs,
    max,
    message,
    keyGenerator,
  });
};

module.exports = { createRateLimiter };