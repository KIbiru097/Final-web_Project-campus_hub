const { query } = require('../../config/database');

const mapRestaurant = (dbRestaurant) => ({
  id: dbRestaurant.id,
  name: dbRestaurant.name,
  description: dbRestaurant.description,
  address: dbRestaurant.address,
  phone: dbRestaurant.phone,
  deliveryFee: parseFloat(dbRestaurant.delivery_fee),
  minOrderAmount: parseFloat(dbRestaurant.min_order_amount),
  isActive: dbRestaurant.is_active,
  rating: parseFloat(dbRestaurant.rating),
  logoUrl: dbRestaurant.logo_url,
  createdAt: dbRestaurant.created_at,
  updatedAt: dbRestaurant.updated_at
});

const restaurantResolvers = {
  Query: {
    restaurants: async () => {
      const result = await query('SELECT * FROM restaurants WHERE is_active = true ORDER BY created_at DESC');
      return result.rows.map(mapRestaurant);
    },
    restaurant: async (_, { id }) => {
      const result = await query('SELECT * FROM restaurants WHERE id = $1', [id]);
      return result.rows[0] ? mapRestaurant(result.rows[0]) : null;
    }
  },
  Mutation: {
    createRestaurant: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const { name, description, address, phone, deliveryFee, minOrderAmount, logoUrl } = input;
      const result = await query(
        `INSERT INTO restaurants (id, name, description, address, phone, delivery_fee, min_order_amount, logo_url, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
         RETURNING *`,
        [name, description, address, phone, deliveryFee || 0, minOrderAmount || 0, logoUrl]
      );
      return { success: true, message: 'Restaurant created', restaurant: mapRestaurant(result.rows[0]) };
    },
    updateRestaurant: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const { name, description, address, phone, deliveryFee, minOrderAmount, isActive, logoUrl } = input;
      const result = await query(
        `UPDATE restaurants SET 
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          address = COALESCE($3, address),
          phone = COALESCE($4, phone),
          delivery_fee = COALESCE($5, delivery_fee),
          min_order_amount = COALESCE($6, min_order_amount),
          is_active = COALESCE($7, is_active),
          logo_url = COALESCE($8, logo_url),
          updated_at = NOW()
         WHERE id = $9 RETURNING *`,
        [name, description, address, phone, deliveryFee, minOrderAmount, isActive, logoUrl, id]
      );
      return { success: true, message: 'Restaurant updated', restaurant: mapRestaurant(result.rows[0]) };
    },
    deleteRestaurant: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      await query('UPDATE restaurants SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
      return { success: true, message: 'Restaurant deleted' };
    }
  }
};

module.exports = restaurantResolvers;