const { query } = require('../../config/database');

const mapFoodItem = (dbItem) => ({
  id: dbItem.id,
  restaurantId: dbItem.restaurant_id,
  name: dbItem.name,
  description: dbItem.description,
  price: parseFloat(dbItem.price),
  discountPrice: dbItem.discount_price ? parseFloat(dbItem.discount_price) : null,
  isAvailable: dbItem.is_available,
  category: dbItem.category,
  imageUrl: dbItem.image_url,
  preparationTime: dbItem.preparation_time,
  createdAt: dbItem.created_at,
  updatedAt: dbItem.updated_at
});

const foodResolvers = {
  Query: {
    foodItems: async (_, { restaurantId, category, isAvailable }) => {
      let sql = 'SELECT * FROM food_items WHERE 1=1';
      const params = [];
      let paramCount = 1;
      
      if (restaurantId) {
        sql += ` AND restaurant_id = $${paramCount++}`;
        params.push(restaurantId);
      }
      if (category) {
        sql += ` AND category = $${paramCount++}`;
        params.push(category);
      }
      if (isAvailable !== undefined) {
        sql += ` AND is_available = $${paramCount++}`;
        params.push(isAvailable);
      }
      
      sql += ' ORDER BY created_at DESC';
      const result = await query(sql, params);
      return result.rows.map(mapFoodItem);
    },
    foodItem: async (_, { id }) => {
      const result = await query('SELECT * FROM food_items WHERE id = $1', [id]);
      return result.rows[0] ? mapFoodItem(result.rows[0]) : null;
    }
  },
  Mutation: {
    createFoodItem: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const { restaurantId, name, description, price, discountPrice, category, imageUrl, preparationTime } = input;
      const result = await query(
        `INSERT INTO food_items (id, restaurant_id, name, description, price, discount_price, category, image_url, preparation_time, is_available, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())
         RETURNING *`,
        [restaurantId, name, description, price, discountPrice, category, imageUrl, preparationTime || 15]
      );
      return { success: true, message: 'Food item created', foodItem: mapFoodItem(result.rows[0]) };
    },
    updateFoodItem: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const { name, description, price, discountPrice, isAvailable, category, imageUrl, preparationTime } = input;
      const result = await query(
        `UPDATE food_items SET 
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          price = COALESCE($3, price),
          discount_price = COALESCE($4, discount_price),
          is_available = COALESCE($5, is_available),
          category = COALESCE($6, category),
          image_url = COALESCE($7, image_url),
          preparation_time = COALESCE($8, preparation_time),
          updated_at = NOW()
         WHERE id = $9 RETURNING *`,
        [name, description, price, discountPrice, isAvailable, category, imageUrl, preparationTime, id]
      );
      return { success: true, message: 'Food item updated', foodItem: mapFoodItem(result.rows[0]) };
    },
    deleteFoodItem: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      await query('DELETE FROM food_items WHERE id = $1', [id]);
      return { success: true, message: 'Food item deleted' };
    }
  }
};

module.exports = foodResolvers;