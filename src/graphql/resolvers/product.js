const { query } = require('../../config/database');

const mapProduct = (product) => ({
  id: product.id,
  sellerId: product.seller_id,
  categoryId: product.category_id,
  title: product.title,
  description: product.description,
  price: parseFloat(product.price),
  stockQuantity: product.stock_quantity,
  status: product.status,
  condition: product.condition,
  imageUrl: product.image_url,
  createdAt: product.created_at,
  updatedAt: product.updated_at
});

const productResolvers = {
  Query: {
    products: async (_, { categoryId, search, minPrice, maxPrice, status, limit = 20, offset = 0 }) => {
      let sql = `SELECT * FROM products WHERE deleted_at IS NULL`;
      const params = [];
      let paramCount = 1;
      
      if (categoryId) {
        sql += ` AND category_id = $${paramCount++}`;
        params.push(categoryId);
      }
      if (status) {
        sql += ` AND status = $${paramCount++}`;
        params.push(status);
      } else {
        sql += ` AND status = 'ACTIVE'`;
      }
      if (search) {
        sql += ` AND (title ILIKE $${paramCount++} OR description ILIKE $${paramCount++})`;
        params.push(`%${search}%`, `%${search}%`);
      }
      if (minPrice !== undefined) {
        sql += ` AND price >= $${paramCount++}`;
        params.push(minPrice);
      }
      if (maxPrice !== undefined) {
        sql += ` AND price <= $${paramCount++}`;
        params.push(maxPrice);
      }
      
      sql += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
      params.push(limit, offset);
      
      const result = await query(sql, params);
      return result.rows.map(mapProduct);
    },

    product: async (_, { id }) => {
      const result = await query(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (result.rows.length === 0) return null;
      return mapProduct(result.rows[0]);
    },

    myProducts: async (_, { status, limit = 20, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      let sql = `SELECT * FROM products WHERE seller_id = $1 AND deleted_at IS NULL`;
      const params = [user.userId];
      let paramCount = 2;
      
      if (status) {
        sql += ` AND status = $${paramCount++}`;
        params.push(status);
      }
      
      sql += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
      params.push(limit, offset);
      
      const result = await query(sql, params);
      return result.rows.map(mapProduct);
    }
  },

  Mutation: {
    createProduct: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { title, description, price, condition, categoryId, imageUrl, stockQuantity } = input;
      
      const result = await query(
        `INSERT INTO products (id, seller_id, title, description, price, condition, category_id, image_url, stock_quantity, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', NOW(), NOW())
         RETURNING *`,
        [user.userId, title, description, price, condition, categoryId, imageUrl, stockQuantity || 1]
      );
      
      return {
        success: true,
        message: 'Product created successfully',
        product: mapProduct(result.rows[0])
      };
    },

    updateProduct: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { title, description, price, condition, status, imageUrl, stockQuantity } = input;
      const updates = [];
      const values = [];
      let paramCount = 1;
      
      if (title !== undefined) { updates.push(`title = $${paramCount++}`); values.push(title); }
      if (description !== undefined) { updates.push(`description = $${paramCount++}`); values.push(description); }
      if (price !== undefined) { updates.push(`price = $${paramCount++}`); values.push(price); }
      if (condition !== undefined) { updates.push(`condition = $${paramCount++}`); values.push(condition); }
      if (status !== undefined) { updates.push(`status = $${paramCount++}`); values.push(status); }
      if (imageUrl !== undefined) { updates.push(`image_url = $${paramCount++}`); values.push(imageUrl); }
      if (stockQuantity !== undefined) { updates.push(`stock_quantity = $${paramCount++}`); values.push(stockQuantity); }
      
      if (updates.length === 0) throw new Error('No fields to update');
      
      updates.push(`updated_at = NOW()`);
      values.push(id);
      
      const result = await query(
        `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramCount} AND seller_id = $${paramCount + 1} RETURNING *`,
        [...values, user.userId]
      );
      
      if (result.rows.length === 0) throw new Error('Product not found or unauthorized');
      
      return {
        success: true,
        message: 'Product updated successfully',
        product: mapProduct(result.rows[0])
      };
    },

    deleteProduct: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      await query(`UPDATE products SET deleted_at = NOW() WHERE id = $1 AND seller_id = $2`, [id, user.userId]);
      return { success: true, message: 'Product deleted successfully' };
    }
  }
};

module.exports = productResolvers;