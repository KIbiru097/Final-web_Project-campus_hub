const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../../config/database');

// Helper function to map database fields to GraphQL fields
const mapUser = (user) => {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    phone: user.phone,
    accountStatus: user.account_status,
    profilePictureUrl: user.profile_picture_url,
    lastLogin: user.last_login,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
};

const userResolvers = {
  Query: {
    me: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [user.userId]
      );
      
      if (result.rows.length === 0) throw new Error('User not found');
      
      return mapUser(result.rows[0]);
    },

    getUser: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      
      if (result.rows.length === 0) return null;
      
      return mapUser(result.rows[0]);
    },

    users: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC`
      );
      
      return result.rows.map(mapUser);
    }
  },

  Mutation: {
    register: async (_, { input }) => {
      const {
        email,
        password,
        firstName,
        lastName,
        phone,
        university,
        department,
        role
      } = input;
      
      const existingUser = await db.query(
        `SELECT id FROM users WHERE email = $1`,
        [email]
      );
      
      if (existingUser.rows.length > 0) {
        throw new Error('User already exists with this email');
      }
      
      const existingPhone = await db.query(
        `SELECT id FROM users WHERE phone = $1`,
        [phone]
      );
      
      if (existingPhone.rows.length > 0) {
        throw new Error('Phone number already registered');
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const result = await db.query(
        `INSERT INTO users (
          id, email, password_hash, first_name, last_name, phone, 
          university, department, role, account_status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW(), NOW()
        ) RETURNING *`,
        [email, hashedPassword, firstName, lastName, phone, university, department, role || 'student']
      );
      
      const dbUser = result.rows[0];
      
      const token = jwt.sign(
        { 
          userId: dbUser.id, 
          email: dbUser.email,
          role: dbUser.role 
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return {
        token,
        user: mapUser(dbUser)
      };
    },

    login: async (_, { input }) => {
      const { email, password } = input;
      
      const result = await db.query(
        `SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [email]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Invalid email or password');
      }
      
      const dbUser = result.rows[0];
      
      if (dbUser.account_status === 'suspended') {
        throw new Error('Account has been suspended');
      }
      
      const validPassword = await bcrypt.compare(password, dbUser.password_hash);
      
      if (!validPassword) {
        throw new Error('Invalid email or password');
      }
      
      await db.query(
        `UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1`,
        [dbUser.id]
      );
      
      const token = jwt.sign(
        { 
          userId: dbUser.id, 
          email: dbUser.email,
          role: dbUser.role 
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return {
        token,
        user: mapUser(dbUser)
      };
    },

    updateUser: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { firstName, lastName, phone, profilePictureUrl } = input;
      
      const updates = [];
      const values = [];
      let paramCount = 1;
      
      if (firstName !== undefined) {
        updates.push(`first_name = $${paramCount++}`);
        values.push(firstName);
      }
      if (lastName !== undefined) {
        updates.push(`last_name = $${paramCount++}`);
        values.push(lastName);
      }
      if (phone !== undefined) {
        updates.push(`phone = $${paramCount++}`);
        values.push(phone);
      }
      if (profilePictureUrl !== undefined) {
        updates.push(`profile_picture_url = $${paramCount++}`);
        values.push(profilePictureUrl);
      }
      
      if (updates.length === 0) {
        throw new Error('No fields to update');
      }
      
      updates.push(`updated_at = NOW()`);
      values.push(user.userId);
      
      const result = await db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );
      
      if (result.rows.length === 0) throw new Error('User not found');
      
      return {
        success: true,
        message: 'Profile updated successfully',
        user: mapUser(result.rows[0])
      };
    },

    changePassword: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { currentPassword, newPassword } = input;
      
      const result = await db.query(
        `SELECT password_hash FROM users WHERE id = $1`,
        [user.userId]
      );
      
      if (result.rows.length === 0) throw new Error('User not found');
      
      const validPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
      
      if (!validPassword) throw new Error('Current password is incorrect');
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      await db.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [hashedPassword, user.userId]
      );
      
      return {
        success: true,
        message: 'Password changed successfully'
      };
    }
  }
};

module.exports = userResolvers;