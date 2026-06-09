const { verifyToken } = require('../config/auth');

const createContext = ({ req }) => {
  let user = null;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    user = verifyToken(token);
  }
  
  return { user, req };
};

module.exports = createContext;