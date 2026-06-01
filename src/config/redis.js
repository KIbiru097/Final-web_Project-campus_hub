const Redis = require('ioredis');
require('dotenv').config();

let redisClient = null;

if (process.env.REDIS_HOST) {
  redisClient = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3,
  });

  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });

  redisClient.on('error', (err) => {
    console.error('❌ Redis error:', err);
  });
} else {
  console.log('⚠️ Redis not configured, skipping...');
}

module.exports = { redisClient };