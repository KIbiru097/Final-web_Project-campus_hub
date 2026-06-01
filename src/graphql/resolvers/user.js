const bcrypt = require('bcrypt');
const db = require('../../config/database');
const { generateTokens, verifyRefreshToken } = require('../../config/auth');
const { ocrService } = require('../../services/ocr.service');
const { emailService } = require('../../services/email.service');

module.exports = {
  Query: {
    me: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [user.userId]
      );
      
      if (result.rows.length === 0) throw new Error('User not found');
      return result.rows[0];
    },
    
    user: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [id]
      );
      
      return result.rows[0];
    },
    
    users: async (_, { role, status, limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      let query = `
        SELECT u.* FROM users u
        WHERE u.deleted_at IS NULL
      `;
      const params = [];
      let paramIndex = 1;
      
      if (role) {
        query += ` AND EXISTS (
          SELECT 1 FROM user_roles ur 
          JOIN roles r ON ur.role_id = r.id 
          WHERE ur.user_id = u.id AND r.role_name = $${paramIndex}
        )`;
        params.push(role);
        paramIndex++;
      }
      
      if (status) {
        query += ` AND u.account_status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }
      
      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM (${query}) as sub`;
      const countResult = await db.query(countQuery, params);
      const total = parseInt(countResult.rows[0].total);
      
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
      
      const result = await db.query(query, params);
      
      return {
        users: result.rows,
        total,
        hasMore: offset + limit < total
      };
    },
    
    pendingVerifications: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      // Check if admin
      const roleCheck = await db.query(
        `SELECT EXISTS(SELECT 1 FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1 AND r.role_name = 'ADMIN') as is_admin`,
        [user.userId]
      );
      
      if (!roleCheck.rows[0].is_admin) throw new Error('Unauthorized');
      
      const result = await db.query(
        `SELECT sp.*, u.email, u.first_name, u.last_name 
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.verification_status = 'PENDING' AND sp.deleted_at IS NULL`
      );
      
      return result.rows;
    },
    
    userStats: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN account_status = 'ACTIVE' THEN 1 END) as active_users,
          COUNT(CASE WHEN account_status = 'PENDING' THEN 1 END) as pending_users
        FROM users WHERE deleted_at IS NULL
      `);
      
      const verifiedResult = await db.query(
        `SELECT COUNT(*) as verified FROM student_profiles WHERE verification_status = 'VERIFIED' AND deleted_at IS NULL`
      );
      
      const pendingVerifications = await db.query(
        `SELECT COUNT(*) as pending FROM student_profiles WHERE verification_status = 'PENDING' AND deleted_at IS NULL`
      );
      
      return {
        totalUsers: parseInt(result.rows[0].total_users),
        activeUsers: parseInt(result.rows[0].active_users),
        pendingVerifications: parseInt(pendingVerifications.rows[0].pending),
        verifiedStudents: parseInt(verifiedResult.rows[0].verified)
      };
    }
  },
  
  Mutation: {
    register: async (_, { input }) => {
      const client = await db.getClient();
      
      try {
        await client.query('BEGIN');
        
        // Check if email exists
        const existingUser = await client.query(
          'SELECT id FROM users WHERE email = $1',
          [input.email]
        );
        
        if (existingUser.rows.length > 0) {
          throw new Error('Email already registered');
        }
        
        // OCR Verification
        const ocrResult = await ocrService.verifyStudentId(input.idCardImage);
        
        // Hash password
        const hashedPassword = await bcrypt.hash(input.password, 10);
        
        // Create user
        const userResult = await client.query(
          `INSERT INTO users (first_name, last_name, email, phone, password_hash, account_status)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [input.firstName, input.lastName, input.email, input.phone, hashedPassword, 'PENDING']
        );
        
        const user = userResult.rows[0];
        
        // Assign STUDENT role
        const roleResult = await client.query(
          'SELECT id FROM roles WHERE role_name = $1',
          ['STUDENT']
        );
        
        await client.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [user.id, roleResult.rows[0].id]
        );
        
        // Create student profile
        const verificationStatus = ocrResult.isValid ? 'VERIFIED' : 'PENDING';
        await client.query(
          `INSERT INTO student_profiles 
           (user_id, student_id, department, year_level, gender, id_card_image_url, 
            verification_status, ocr_extracted_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            user.id,
            input.studentId,
            input.department,
            input.yearLevel,
            input.gender,
            input.idCardImage,
            verificationStatus,
            ocrResult.extractedText
          ]
        );
        
        await client.query('COMMIT');
        
        // Get user roles
        const rolesResult = await client.query(
          `SELECT r.role_name FROM user_roles ur 
           JOIN roles r ON ur.role_id = r.id 
           WHERE ur.user_id = $1`,
          [user.id]
        );
        
        user.roles = rolesResult.rows.map(r => r.role_name);
        
        // Generate tokens
        const tokens = generateTokens({ ...user, roles: user.roles });
        
        // Send welcome email
        await emailService.sendWelcomeEmail(user.email, user.first_name);
        
        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          user,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    
    login: async (_, { input }) => {
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',
        [input.email]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Invalid credentials');
      }
      
      const user = result.rows[0];
      
      const isValidPassword = await bcrypt.compare(input.password, user.password_hash);
      if (!isValidPassword) {
        throw new Error('Invalid credentials');
      }
      
      if (user.account_status !== 'ACTIVE') {
        throw new Error('Account is not active. Please contact support.');
      }
      
      // Update last login
      await db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );
      
      // Get user roles
      const rolesResult = await db.query(
        `SELECT r.role_name FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1`,
        [user.id]
      );
      
      const roles = rolesResult.rows.map(r => r.role_name);
      user.roles = roles;
      
      const tokens = generateTokens({ ...user, roles });
      
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user,
      };
    },
    
    refreshToken: async (_, { refreshToken }) => {
      const decoded = verifyRefreshToken(refreshToken);
      if (!decoded) {
        throw new Error('Invalid refresh token');
      }
      
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
        [decoded.userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('User not found');
      }
      
      const user = result.rows[0];
      
      const rolesResult = await db.query(
        `SELECT r.role_name FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1`,
        [user.id]
      );
      
      const roles = rolesResult.rows.map(r => r.role_name);
      user.roles = roles;
      
      const tokens = generateTokens({ ...user, roles });
      
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user,
      };
    },
    
    logout: async (_, __, { user }) => {
      // In production, add token to blacklist in Redis
      return true;
    },
    
    updateProfile: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const updates = [];
      const values = [];
      let paramIndex = 1;
      
      if (input.firstName) {
        updates.push(`first_name = $${paramIndex++}`);
        values.push(input.firstName);
      }
      if (input.lastName) {
        updates.push(`last_name = $${paramIndex++}`);
        values.push(input.lastName);
      }
      if (input.phone) {
        updates.push(`phone = $${paramIndex++}`);
        values.push(input.phone);
      }
      if (input.profilePictureUrl) {
        updates.push(`profile_picture_url = $${paramIndex++}`);
        values.push(input.profilePictureUrl);
      }
      
      if (updates.length === 0) {
        throw new Error('No fields to update');
      }
      
      values.push(user.userId);
      
      const result = await db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );
      
      return result.rows[0];
    },
    
    changePassword: async (_, { oldPassword, newPassword }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [user.userId]
      );
      
      const isValid = await bcrypt.compare(oldPassword, result.rows[0].password_hash);
      if (!isValid) {
        throw new Error('Invalid old password');
      }
      
      const newHash = await bcrypt.hash(newPassword, 10);
      
      await db.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [newHash, user.userId]
      );
      
      return true;
    },
    
    requestPasswordReset: async (_, { email }) => {
      const result = await db.query(
        'SELECT id, first_name FROM users WHERE email = $1 AND deleted_at IS NULL',
        [email]
      );
      
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const token = require('jsonwebtoken').sign(
          { userId: user.id },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );
        
        await emailService.sendPasswordResetEmail(email, user.first_name, token);
      }
      
      // Always return true to prevent email enumeration
      return true;
    },
    
    resetPassword: async (_, { token, newPassword }) => {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await db.query(
          'UPDATE users SET password_hash = $1 WHERE id = $2',
          [hashedPassword, decoded.userId]
        );
        
        return true;
      } catch (error) {
        throw new Error('Invalid or expired token');
      }
    },
    
    addAddress: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      // If this is default, unset other defaults
      if (input.isDefault) {
        await db.query(
          'UPDATE user_addresses SET is_default = false WHERE user_id = $1',
          [user.userId]
        );
      }
      
      const result = await db.query(
        `INSERT INTO user_addresses 
         (user_id, address_line1, address_line2, city, state, postal_code, country, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          user.userId,
          input.addressLine1,
          input.addressLine2,
          input.city,
          input.state,
          input.postalCode,
          input.country || 'Ethiopia',
          input.isDefault || false
        ]
      );
      
      return result.rows[0];
    },
    
    updateAddress: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      // If this is default, unset other defaults
      if (input.isDefault) {
        await db.query(
          'UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND id != $2',
          [user.userId, id]
        );
      }
      
      const result = await db.query(
        `UPDATE user_addresses 
         SET address_line1 = COALESCE($1, address_line1),
             address_line2 = COALESCE($2, address_line2),
             city = COALESCE($3, city),
             state = COALESCE($4, state),
             postal_code = COALESCE($5, postal_code),
             country = COALESCE($6, country),
             is_default = COALESCE($7, is_default)
         WHERE id = $8 AND user_id = $9
         RETURNING *`,
        [
          input.addressLine1,
          input.addressLine2,
          input.city,
          input.state,
          input.postalCode,
          input.country,
          input.isDefault,
          id,
          user.userId
        ]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Address not found');
      }
      
      return result.rows[0];
    },
    
    deleteAddress: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const result = await db.query(
        'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2',
        [id, user.userId]
      );
      
      return result.rowCount > 0;
    },
    
    verifyStudent: async (_, { studentProfileId, approved, rejectionReason }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      // Check if admin
      const roleCheck = await db.query(
        `SELECT EXISTS(SELECT 1 FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1 AND r.role_name = 'ADMIN') as is_admin`,
        [user.userId]
      );
      
      if (!roleCheck.rows[0].is_admin) throw new Error('Unauthorized');
      
      if (approved) {
        const result = await db.query(
          `UPDATE student_profiles 
           SET verification_status = 'VERIFIED', verification_date = CURRENT_TIMESTAMP
           WHERE id = $1 AND verification_status = 'PENDING'
           RETURNING *`,
          [studentProfileId]
        );
        
        if (result.rows.length > 0) {
          // Update user account status to ACTIVE
          await db.query(
            `UPDATE users SET account_status = 'ACTIVE' 
             WHERE id = (SELECT user_id FROM student_profiles WHERE id = $1)`,
            [studentProfileId]
          );
        }
        
        return result.rows[0];
      } else {
        const result = await db.query(
          `UPDATE student_profiles 
           SET verification_status = 'REJECTED', verification_date = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [studentProfileId]
        );
        
        return result.rows[0];
      }
    },
    
    updateUserStatus: async (_, { userId, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      // Check if admin
      const roleCheck = await db.query(
        `SELECT EXISTS(SELECT 1 FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1 AND r.role_name = 'ADMIN') as is_admin`,
        [user.userId]
      );
      
      if (!roleCheck.rows[0].is_admin) throw new Error('Unauthorized');
      
      const result = await db.query(
        `UPDATE users SET account_status = $1 WHERE id = $2 RETURNING *`,
        [status, userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('User not found');
      }
      
      return result.rows[0];
    },
    
    assignRole: async (_, { userId, roleName }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      // Check if admin
      const roleCheck = await db.query(
        `SELECT EXISTS(SELECT 1 FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1 AND r.role_name = 'ADMIN') as is_admin`,
        [user.userId]
      );
      
      if (!roleCheck.rows[0].is_admin) throw new Error('Unauthorized');
      
      const roleResult = await db.query(
        'SELECT id FROM roles WHERE role_name = $1',
        [roleName]
      );
      
      if (roleResult.rows.length === 0) {
        throw new Error('Role not found');
      }
      
      await db.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, roleResult.rows[0].id]
      );
      
      const userResult = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      
      return userResult.rows[0];
    },
    
    removeRole: async (_, { userId, roleName }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      // Check if admin
      const roleCheck = await db.query(
        `SELECT EXISTS(SELECT 1 FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1 AND r.role_name = 'ADMIN') as is_admin`,
        [user.userId]
      );
      
      if (!roleCheck.rows[0].is_admin) throw new Error('Unauthorized');
      
      const roleResult = await db.query(
        'SELECT id FROM roles WHERE role_name = $1',
        [roleName]
      );
      
      if (roleResult.rows.length === 0) {
        throw new Error('Role not found');
      }
      
      await db.query(
        'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2',
        [userId, roleResult.rows[0].id]
      );
      
      const userResult = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      
      return userResult.rows[0];
    }
  },
  
  User: {
    roles: async (parent) => {
      const result = await db.query(
        `SELECT r.role_name, r.description, r.id 
         FROM user_roles ur 
         JOIN roles r ON ur.role_id = r.id 
         WHERE ur.user_id = $1`,
        [parent.id]
      );
      return result.rows;
    },
    
    studentProfile: async (parent) => {
      const result = await db.query(
        'SELECT * FROM student_profiles WHERE user_id = $1 AND deleted_at IS NULL',
        [parent.id]
      );
      return result.rows[0];
    },
    
    addresses: async (parent) => {
      const result = await db.query(
        'SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC',
        [parent.id]
      );
      return result.rows;
    },
    
    averageRating: async (parent) => {
      const result = await db.query(
        `SELECT AVG(rating)::float as avg_rating 
         FROM seller_reviews WHERE seller_id = $1`,
        [parent.id]
      );
      return result.rows[0].avg_rating;
    },
    
    totalReviews: async (parent) => {
      const result = await db.query(
        `SELECT COUNT(*) as count FROM seller_reviews WHERE seller_id = $1`,
        [parent.id]
      );
      return parseInt(result.rows[0].count);
    }
  },
  
  StudentProfile: {
    user: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.user_id]);
      return result.rows[0];
    }
  }
};