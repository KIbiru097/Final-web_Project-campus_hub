const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../../config/database');

const mapUser = (dbUser) => {
  if (!dbUser) return null;
  return {
    id: dbUser.id,
    firstName: dbUser.first_name,
    lastName: dbUser.last_name,
    email: dbUser.email,
    phone: dbUser.phone,
    accountStatus: dbUser.account_status,
    profilePictureUrl: dbUser.profile_picture_url,
    lastLogin: dbUser.last_login,
    createdAt: dbUser.created_at,
    updatedAt: dbUser.updated_at
  };
};

const generateToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const userResolvers = {
  Query: {
    me: async (_, __, { user }) => {
      if (!user || !user.userId) throw new Error('Not authenticated');
      const result = await query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [user.userId]);
      if (result.rows.length === 0) throw new Error('User not found');
      return mapUser(result.rows[0]);
    },
    users: async (_, __, { user }) => {
      if (!user || !user.userId) throw new Error('Not authenticated');
      const result = await query(`SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC`);
      return result.rows.map(mapUser);
    }
  },
  Mutation: {
   register: async (_, { input }) => {
  const { email, password, firstName, lastName, phone } = input;
  
  const existingUser = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existingUser.rows.length > 0) throw new Error('User already exists');
  
  const existingPhone = await query(`SELECT id FROM users WHERE phone = $1`, [phone]);
  if (existingPhone.rows.length > 0) throw new Error('Phone already registered');
  
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const result = await query(
    `INSERT INTO users (
      id, email, password_hash, first_name, last_name, phone, account_status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE', NOW(), NOW()
    ) RETURNING *`,
    [email, hashedPassword, firstName, lastName, phone]
  );
  
  const dbUser = result.rows[0];
  const token = generateToken(dbUser);
  
  return { token, user: mapUser(dbUser) };
},

    login: async (_, { input }) => {
      const { email, password } = input;
      
      const result = await query(`SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`, [email]);
      if (result.rows.length === 0) throw new Error('Invalid credentials');
      
      const dbUser = result.rows[0];
      if (dbUser.account_status === 'suspended') throw new Error('Account suspended');
      
      const valid = await bcrypt.compare(password, dbUser.password_hash);
      if (!valid) throw new Error('Invalid credentials');
      
      await query(`UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1`, [dbUser.id]);
      
      const token = generateToken(dbUser);
      return { token, user: mapUser(dbUser) };
    },
    updateUser: async (_, { input }, { user }) => {
      if (!user || !user.userId) throw new Error('Not authenticated');
      
      const { firstName, lastName, phone, profilePictureUrl } = input;
      const updates = [];
      const values = [];
      let paramCount = 1;
      
      if (firstName !== undefined) { updates.push(`first_name = $${paramCount++}`); values.push(firstName); }
      if (lastName !== undefined) { updates.push(`last_name = $${paramCount++}`); values.push(lastName); }
      if (phone !== undefined) { updates.push(`phone = $${paramCount++}`); values.push(phone); }
      if (profilePictureUrl !== undefined) { updates.push(`profile_picture_url = $${paramCount++}`); values.push(profilePictureUrl); }
      
      if (updates.length === 0) throw new Error('No fields to update');
      
      updates.push(`updated_at = NOW()`);
      values.push(user.userId);
      
      const result = await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );
      
      if (result.rows.length === 0) throw new Error('User not found');
      return { success: true, message: 'Profile updated', user: mapUser(result.rows[0]) };
    },
    changePassword: async (_, { input }, { user }) => {
      if (!user || !user.userId) throw new Error('Not authenticated');
      
      const { currentPassword, newPassword } = input;
      const result = await query(`SELECT password_hash FROM users WHERE id = $1`, [user.userId]);
      if (result.rows.length === 0) throw new Error('User not found');
      
      const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
      if (!valid) throw new Error('Current password is incorrect');
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hashedPassword, user.userId]);
      
      return { success: true, message: 'Password changed' };
    }
  }
};

module.exports = userResolvers;