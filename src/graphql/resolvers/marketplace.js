const { query } = require('../../config/database');

const mapProduct = (dbProduct) => ({
  id: dbProduct.id,
  sellerId: dbProduct.seller_id,
  title: dbProduct.title,
  description: dbProduct.description,
  price: parseFloat(dbProduct.price),
  condition: dbProduct.condition,
  status: dbProduct.status,
  imageUrl: dbProduct.image_url,
  createdAt: dbProduct.created_at,
  updatedAt: dbProduct.updated_at
});

const marketplaceResolvers = {
  Query: {
    products: async () => {
      const result = await query('SELECT * FROM products WHERE status = $1 ORDER BY created_at DESC', ['ACTIVE']);
      return result.rows.map(mapProduct);
    },
    product: async (_, { id }) => {
      const result = await query('SELECT * FROM products WHERE id = $1', [id]);
      return result.rows[0] ? mapProduct(result.rows[0]) : null;
    },
    myProducts: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const result = await query('SELECT * FROM products WHERE seller_id = $1 ORDER BY created_at DESC', [user.userId]);
      return result.rows.map(mapProduct);
    }
  },
  Mutation: {
    createProduct: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const { title, description, price, condition, imageUrl } = input;
      const result = await query(
        `INSERT INTO products (id, seller_id, title, description, price, condition, status, image_url, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE', $6, NOW(), NOW())
         RETURNING *`,
        [user.userId, title, description, price, condition, imageUrl]
      );
      return { success: true, message: 'Product created', product: mapProduct(result.rows[0]) };
    },
    updateProduct: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const { title, description, price, condition, status, imageUrl } = input;
      const result = await query(
        `UPDATE products SET 
          title = COALESCE($1, title),
          description = COALESCE($2, description),
          price = COALESCE($3, price),
          condition = COALESCE($4, condition),
          status = COALESCE($5, status),
          image_url = COALESCE($6, image_url),
          updated_at = NOW()
         WHERE id = $7 AND seller_id = $8 RETURNING *`,
        [title, description, price, condition, status, imageUrl, id, user.userId]
      );
      return { success: true, message: 'Product updated', product: mapProduct(result.rows[0]) };
    },
    deleteProduct: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      await query('UPDATE products SET status = $1, updated_at = NOW() WHERE id = $2 AND seller_id = $3', ['DELETED', id, user.userId]);
      return { success: true, message: 'Product deleted' };
    }
  }
};

module.exports = marketplaceResolvers;