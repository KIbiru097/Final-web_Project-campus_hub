const jwt = require('jsonwebtoken');

module.exports = async ({ req }) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  let user = null;
  
  if (authHeader) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.log('Auth error:', error.message);
    }
  }
  
  return { user };
};
