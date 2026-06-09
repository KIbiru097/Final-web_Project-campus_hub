const { query } = require('../../config/database');

const mapMenuItem = (item) => ({
  id: item.id,
  cafeId: item.cafe_id,
  categoryId: item.category_id,
  name: item.name,
  description: item.description,
  price: parseFloat(item.price),
  imageUrl: item.image_url,
  isAvailable: item.is_available,
  createdAt: item.created_at,
  updatedAt: item.updated_at
});

const menuItemResolvers = {
  Query: {
    menuItems: async (_, { cafeId, categoryId, isAvailable }) => {
      let sql = `SELECT * FROM menu_items WHERE deleted_at IS NULL`;
      const params = [];
      let paramCount = 1;
      
      if (cafeId) {
        sql += ` AND cafe_id = $${paramCount++}`;
        params.push(cafeId);
      }
      if (categoryId) {
        sql += ` AND category_id = $${paramCount++}`;
        params.push(categoryId);
      }
      if (isAvailable !== undefined) {
        sql += ` AND is_available = $${paramCount++}`;
        params.push(isAvailable);
      }
      
      sql += ` ORDER BY created_at DESC`;
      const result = await query(sql, params);
      return result.rows.map(mapMenuItem);
    },

    menuItem: async (_, { id }) => {
      const result = await query(`SELECT * FROM menu_items WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (result.rows.length === 0) return null;
      return mapMenuItem(result.rows[0]);
    }
  },

  Mutation: {
    createMenuItem: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { cafeId, categoryId, name, description, price, imageUrl, isAvailable } = input;
      
      const result = await query(
        `INSERT INTO menu_items (id, cafe_id, category_id, name, description, price, image_url, is_available, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING *`,
        [cafeId, categoryId, name, description, price, imageUrl, isAvailable !== undefined ? isAvailable : true]
      );
      
      return {
        success: true,
        message: 'Menu item created successfully',
        menuItem: mapMenuItem(result.rows[0])
      };
    },

    updateMenuItem: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const { name, description, price, imageUrl, isAvailable } = input;
      const updates = [];
      const values = [];
      let paramCount = 1;
      
      if (name !== undefined) { updates.push(`name = $${paramCount++}`); values.push(name); }
      if (description !== undefined) { updates.push(`description = $${paramCount++}`); values.push(description); }
      if (price !== undefined) { updates.push(`price = $${paramCount++}`); values.push(price); }
      if (imageUrl !== undefined) { updates.push(`image_url = $${paramCount++}`); values.push(imageUrl); }
      if (isAvailable !== undefined) { updates.push(`is_available = $${paramCount++}`); values.push(isAvailable); }
      
      if (updates.length === 0) throw new Error('No fields to update');
      
      updates.push(`updated_at = NOW()`);
      values.push(id);
      
      const result = await query(
        `UPDATE menu_items SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );
      
      if (result.rows.length === 0) throw new Error('Menu item not found');
      
      return {
        success: true,
        message: 'Menu item updated successfully',
        menuItem: mapMenuItem(result.rows[0])
      };
    },

    deleteMenuItem: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      await query(`UPDATE menu_items SET deleted_at = NOW() WHERE id = $1`, [id]);
      return { success: true, message: 'Menu item deleted successfully' };
    }
  }
};

module.exports = menuItemResolvers;