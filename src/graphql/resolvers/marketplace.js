// src/graphql/resolvers/marketplace.js
const db = require('../../config/database');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  Query: {
    // Get all products with filters
    products: async (_, { filter, limit = 20, offset = 0 }) => {
      try {
        let query = `
          SELECT p.*, u.first_name, u.last_name, u.email,
                 c.name as category_name,
                 (SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id) as avg_rating,
                 (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id) as review_count
          FROM products p
          JOIN users u ON p.seller_id = u.id
          JOIN product_categories c ON p.category_id = c.id
          WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
        `;
        const params = [];
        let paramIndex = 1;

        if (filter) {
          if (filter.categoryId) {
            query += ` AND p.category_id = $${paramIndex++}`;
            params.push(filter.categoryId);
          }
          if (filter.minPrice) {
            query += ` AND p.price >= $${paramIndex++}`;
            params.push(filter.minPrice);
          }
          if (filter.maxPrice) {
            query += ` AND p.price <= $${paramIndex++}`;
            params.push(filter.maxPrice);
          }
          if (filter.condition) {
            query += ` AND p.condition = $${paramIndex++}`;
            params.push(filter.condition);
          }
          if (filter.search) {
            query += ` AND (p.title ILIKE $${paramIndex++} OR p.description ILIKE $${paramIndex++})`;
            params.push(`%${filter.search}%`, `%${filter.search}%`);
          }
          if (filter.sellerId) {
            query += ` AND p.seller_id = $${paramIndex++}`;
            params.push(filter.sellerId);
          }
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM (${query}) as sub`;
        const countResult = await db.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);

        // Add sorting
        if (filter?.sortBy) {
          const sortOrder = filter.sortOrder === 'DESC' ? 'DESC' : 'ASC';
          query += ` ORDER BY p.${filter.sortBy} ${sortOrder}`;
        } else {
          query += ` ORDER BY p.created_at DESC`;
        }

        query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);

        const result = await db.query(query, params);

        return {
          products: result.rows,
          total,
          hasMore: offset + limit < total,
          facets: null // Can add faceted search later
        };
      } catch (error) {
        throw new Error(`Failed to fetch products: ${error.message}`);
      }
    },

    // Get single product by ID
    product: async (_, { id }) => {
      try {
        const result = await db.query(
          `SELECT p.*, u.first_name, u.last_name, u.email, u.phone,
                  c.name as category_name,
                  (SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id) as avg_rating,
                  (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id) as review_count
           FROM products p
           JOIN users u ON p.seller_id = u.id
           JOIN product_categories c ON p.category_id = c.id
           WHERE p.id = $1 AND p.deleted_at IS NULL`,
          [id]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Product not found');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(error.message);
      }
    },

    // Get all product categories
    categories: async () => {
      try {
        const result = await db.query(
          `SELECT c.*, COUNT(p.id) as product_count
           FROM product_categories c
           LEFT JOIN products p ON p.category_id = c.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
           GROUP BY c.id
           ORDER BY c.name`
        );
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch categories: ${error.message}`);
      }
    },

    // Get single category
    category: async (_, { id }) => {
      try {
        const result = await db.query(
          'SELECT * FROM product_categories WHERE id = $1',
          [id]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Category not found');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(error.message);
      }
    },

    // Get current user's products
    myProducts: async (_, { status, limit = 50, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        let query = `
          SELECT * FROM products 
          WHERE seller_id = $1 AND deleted_at IS NULL
        `;
        const params = [user.userId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND status = $${paramIndex++}`;
          params.push(status);
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch your products: ${error.message}`);
      }
    },

    // Get current user's orders (as buyer)
    myOrders: async (_, { status, limit = 50, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        let query = `
          SELECT o.*, 
                 json_agg(json_build_object(
                   'id', oi.id,
                   'product_id', oi.product_id,
                   'quantity', oi.quantity,
                   'unit_price', oi.unit_price,
                   'subtotal', oi.subtotal,
                   'title', p.title,
                   'image_url', p.image_url
                 )) as items
          FROM product_orders o
          JOIN product_order_items oi ON o.id = oi.order_id
          JOIN products p ON oi.product_id = p.id
          WHERE o.buyer_id = $1
        `;
        const params = [user.userId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND o.order_status = $${paramIndex++}`;
          params.push(status);
        }
        
        query += ` GROUP BY o.id ORDER BY o.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch orders: ${error.message}`);
      }
    },

    // Get current user's sales (as seller)
    mySales: async (_, { status, limit = 50, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        let query = `
          SELECT o.*, u.email, u.first_name, u.last_name,
                 json_agg(json_build_object(
                   'id', oi.id,
                   'product_id', oi.product_id,
                   'quantity', oi.quantity,
                   'unit_price', oi.unit_price,
                   'subtotal', oi.subtotal,
                   'title', p.title
                 )) as items
          FROM product_orders o
          JOIN product_order_items oi ON o.id = oi.order_id
          JOIN products p ON oi.product_id = p.id
          JOIN users u ON o.buyer_id = u.id
          WHERE o.seller_id = $1
        `;
        const params = [user.userId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND o.order_status = $${paramIndex++}`;
          params.push(status);
        }
        
        query += ` GROUP BY o.id, u.email, u.first_name, u.last_name ORDER BY o.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch sales: ${error.message}`);
      }
    },

    // Get user's wishlist
    wishlist: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT w.*, 
                  json_agg(json_build_object(
                    'id', wi.id,
                    'product_id', wi.product_id,
                    'added_at', wi.added_at,
                    'title', p.title,
                    'price', p.price,
                    'image_url', p.image_url
                  )) as items
           FROM wishlists w
           LEFT JOIN wishlist_items wi ON w.id = wi.wishlist_id
           LEFT JOIN products p ON wi.product_id = p.id
           WHERE w.user_id = $1
           GROUP BY w.id`,
          [user.userId]
        );
        
        return result.rows[0] || { id: null, name: 'Default', items: [] };
      } catch (error) {
        throw new Error(`Failed to fetch wishlist: ${error.message}`);
      }
    },

    // Get featured products
    featuredProducts: async (_, { limit = 10 }) => {
      try {
        const result = await db.query(
          `SELECT p.*, u.first_name, u.last_name,
                  AVG(pr.rating) as avg_rating
           FROM products p
           JOIN users u ON p.seller_id = u.id
           LEFT JOIN product_reviews pr ON p.id = pr.product_id
           WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
           GROUP BY p.id, u.first_name, u.last_name
           ORDER BY avg_rating DESC NULLS LAST
           LIMIT $1`,
          [limit]
        );
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch featured products: ${error.message}`);
      }
    },

    // Get popular products
    popularProducts: async (_, { limit = 10 }) => {
      try {
        const result = await db.query(
          `SELECT p.*, u.first_name, u.last_name,
                  COUNT(oi.id) as order_count
           FROM products p
           JOIN users u ON p.seller_id = u.id
           LEFT JOIN product_order_items oi ON p.id = oi.product_id
           WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
           GROUP BY p.id, u.first_name, u.last_name
           ORDER BY order_count DESC
           LIMIT $1`,
          [limit]
        );
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch popular products: ${error.message}`);
      }
    },

    // Get related products
    relatedProducts: async (_, { productId, limit = 5 }) => {
      try {
        const product = await db.query(
          'SELECT category_id FROM products WHERE id = $1',
          [productId]
        );
        
        if (product.rows.length === 0) return [];
        
        const result = await db.query(
          `SELECT p.*, u.first_name, u.last_name
           FROM products p
           JOIN users u ON p.seller_id = u.id
           WHERE p.category_id = $1 AND p.id != $2 
           AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
           LIMIT $3`,
          [product.rows[0].category_id, productId, limit]
        );
        
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch related products: ${error.message}`);
      }
    }
  },

  Mutation: {
    // Create new product
    createProduct: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const client = await db.pool.connect();
      
      try {
        await client.query('BEGIN');
        
        const { title, description, price, categoryId, condition, 
                allowDelivery, allowMeetup, stockQuantity, images } = input;
        
        const result = await client.query(
          `INSERT INTO products (seller_id, title, description, price, category_id, 
                                 condition, allow_delivery, allow_meetup, stock_quantity, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
           RETURNING *`,
          [user.userId, title, description, price, categoryId, 
           condition, allowDelivery !== false, allowMeetup !== false, stockQuantity || 1]
        );
        
        const product = result.rows[0];
        
        // Add images if provided
        if (images && images.length > 0) {
          for (let i = 0; i < images.length; i++) {
            await client.query(
              `INSERT INTO product_images (product_id, image_url, is_primary)
               VALUES ($1, $2, $3)`,
              [product.id, images[i], i === 0]
            );
          }
        }
        
        await client.query('COMMIT');
        return product;
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to create product: ${error.message}`);
      } finally {
        client.release();
      }
    },

    // Update product
    updateProduct: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        // Check ownership
        const check = await db.query(
          'SELECT seller_id FROM products WHERE id = $1 AND deleted_at IS NULL',
          [id]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Product not found');
        }
        
        if (check.rows[0].seller_id !== user.userId) {
          throw new Error('Not authorized to update this product');
        }
        
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        if (input.title) {
          updates.push(`title = $${paramIndex++}`);
          values.push(input.title);
        }
        if (input.description) {
          updates.push(`description = $${paramIndex++}`);
          values.push(input.description);
        }
        if (input.price) {
          updates.push(`price = $${paramIndex++}`);
          values.push(input.price);
        }
        if (input.stockQuantity !== undefined) {
          updates.push(`stock_quantity = $${paramIndex++}`);
          values.push(input.stockQuantity);
        }
        if (input.status) {
          updates.push(`status = $${paramIndex++}`);
          values.push(input.status);
        }
        if (input.condition) {
          updates.push(`condition = $${paramIndex++}`);
          values.push(input.condition);
        }
        if (input.allowDelivery !== undefined) {
          updates.push(`allow_delivery = $${paramIndex++}`);
          values.push(input.allowDelivery);
        }
        if (input.allowMeetup !== undefined) {
          updates.push(`allow_meetup = $${paramIndex++}`);
          values.push(input.allowMeetup);
        }
        
        if (updates.length === 0) {
          throw new Error('No fields to update');
        }
        
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        
        values.push(id);
        
        const result = await db.query(
          `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
          values
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to update product: ${error.message}`);
      }
    },

    // Delete product (soft delete)
    deleteProduct: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const check = await db.query(
          'SELECT seller_id FROM products WHERE id = $1 AND deleted_at IS NULL',
          [id]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Product not found');
        }
        
        if (check.rows[0].seller_id !== user.userId) {
          throw new Error('Not authorized to delete this product');
        }
        
        await db.query(
          'UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
          [id]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to delete product: ${error.message}`);
      }
    },

    // Add product image
    addProductImage: async (_, { productId, imageUrl, isPrimary }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const check = await db.query(
          'SELECT seller_id FROM products WHERE id = $1',
          [productId]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Product not found');
        }
        
        if (check.rows[0].seller_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        if (isPrimary) {
          await db.query(
            'UPDATE product_images SET is_primary = false WHERE product_id = $1',
            [productId]
          );
        }
        
        const result = await db.query(
          `INSERT INTO product_images (product_id, image_url, is_primary)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [productId, imageUrl, isPrimary || false]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to add image: ${error.message}`);
      }
    },

    // Delete product image
    deleteProductImage: async (_, { imageId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          'DELETE FROM product_images WHERE id = $1 RETURNING product_id',
          [imageId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to delete image: ${error.message}`);
      }
    },

    // Add to wishlist
    addToWishlist: async (_, { productId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        // Get or create wishlist
        let wishlist = await db.query(
          'SELECT id FROM wishlists WHERE user_id = $1',
          [user.userId]
        );
        
        let wishlistId;
        if (wishlist.rows.length === 0) {
          const newWishlist = await db.query(
            'INSERT INTO wishlists (user_id, name) VALUES ($1, $2) RETURNING id',
            [user.userId, 'Default']
          );
          wishlistId = newWishlist.rows[0].id;
        } else {
          wishlistId = wishlist.rows[0].id;
        }
        
        // Add to wishlist items
        const result = await db.query(
          `INSERT INTO wishlist_items (wishlist_id, product_id)
           VALUES ($1, $2)
           ON CONFLICT (wishlist_id, product_id) DO NOTHING
           RETURNING *`,
          [wishlistId, productId]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Product already in wishlist');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to add to wishlist: ${error.message}`);
      }
    },

    // Remove from wishlist
    removeFromWishlist: async (_, { productId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `DELETE FROM wishlist_items 
           WHERE wishlist_id IN (SELECT id FROM wishlists WHERE user_id = $1) 
           AND product_id = $2`,
          [user.userId, productId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to remove from wishlist: ${error.message}`);
      }
    },

    // Create order
    createOrder: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const client = await db.pool.connect();
      
      try {
        await client.query('BEGIN');
        
        const { productIds, quantities, shippingAddress, fulfillmentMethod, notes } = input;
        
        if (productIds.length !== quantities.length) {
          throw new Error('Products and quantities length mismatch');
        }
        
        let totalAmount = 0;
        const orderItems = [];
        
        // Calculate total and validate products
        for (let i = 0; i < productIds.length; i++) {
          const product = await client.query(
            'SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL AND status = $2',
            [productIds[i], 'ACTIVE']
          );
          
          if (product.rows.length === 0) {
            throw new Error(`Product ${productIds[i]} not found or not active`);
          }
          
          const productData = product.rows[0];
          const quantity = quantities[i];
          
          if (productData.stock_quantity < quantity) {
            throw new Error(`Insufficient stock for product: ${productData.title}`);
          }
          
          const subtotal = parseFloat(productData.price) * quantity;
          totalAmount += subtotal;
          
          orderItems.push({
            product: productData,
            quantity,
            unitPrice: productData.price,
            subtotal
          });
        }
        
        // Get seller ID (assuming all products from same seller for simplicity)
        const firstProduct = await client.query(
          'SELECT seller_id FROM products WHERE id = $1',
          [productIds[0]]
        );
        const sellerId = firstProduct.rows[0].seller_id;
        
        // Create order
        const order = await client.query(
          `INSERT INTO product_orders (buyer_id, seller_id, total_amount, shipping_address, notes, order_status)
           VALUES ($1, $2, $3, $4, $5, 'PENDING')
           RETURNING *`,
          [user.userId, sellerId, totalAmount, shippingAddress, notes]
        );
        
        // Create order items and update stock
        for (const item of orderItems) {
          await client.query(
            `INSERT INTO product_order_items (order_id, product_id, quantity, unit_price, subtotal)
             VALUES ($1, $2, $3, $4, $5)`,
            [order.rows[0].id, item.product.id, item.quantity, item.unitPrice, item.subtotal]
          );
          
          await client.query(
            'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [item.quantity, item.product.id]
          );
        }
        
        await client.query('COMMIT');
        return order.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to create order: ${error.message}`);
      } finally {
        client.release();
      }
    },

    // Cancel order
    cancelOrder: async (_, { orderId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE product_orders 
           SET order_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND buyer_id = $2 AND order_status = 'PENDING'
           RETURNING id`,
          [orderId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to cancel order: ${error.message}`);
      }
    },

    // Update order status (seller only)
    updateOrderStatus: async (_, { orderId, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const check = await db.query(
          'SELECT seller_id FROM product_orders WHERE id = $1',
          [orderId]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Order not found');
        }
        
        if (check.rows[0].seller_id !== user.userId) {
          throw new Error('Not authorized to update this order');
        }
        
        const result = await db.query(
          `UPDATE product_orders 
           SET order_status = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2
           RETURNING *`,
          [status, orderId]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to update order status: ${error.message}`);
      }
    },

    // Review product
    reviewProduct: async (_, { productId, rating, reviewText }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        // Check if user purchased this product
        const purchaseCheck = await db.query(
          `SELECT id FROM product_orders 
           WHERE buyer_id = $1 AND order_status = 'DELIVERED'
           AND id IN (SELECT order_id FROM product_order_items WHERE product_id = $2)`,
          [user.userId, productId]
        );
        
        if (purchaseCheck.rows.length === 0 && user.userId !== 'admin') {
          throw new Error('You can only review products you have purchased');
        }
        
        const result = await db.query(
          `INSERT INTO product_reviews (product_id, reviewer_id, rating, review_text)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (product_id, reviewer_id) 
           DO UPDATE SET rating = $3, review_text = $4
           RETURNING *`,
          [productId, user.userId, rating, reviewText]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to submit review: ${error.message}`);
      }
    },

    // Update review
    updateReview: async (_, { reviewId, rating, reviewText }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE product_reviews 
           SET rating = COALESCE($1, rating),
               review_text = COALESCE($2, review_text)
           WHERE id = $3 AND reviewer_id = $4
           RETURNING *`,
          [rating, reviewText, reviewId, user.userId]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Review not found or not authorized');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to update review: ${error.message}`);
      }
    },

    // Delete review
    deleteReview: async (_, { reviewId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          'DELETE FROM product_reviews WHERE id = $1 AND reviewer_id = $2',
          [reviewId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to delete review: ${error.message}`);
      }
    },

    // Mark review as helpful
    markReviewHelpful: async (_, { reviewId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          'UPDATE product_reviews SET helpful = helpful + 1 WHERE id = $1',
          [reviewId]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to mark review as helpful: ${error.message}`);
      }
    },

    // Report product
    reportProduct: async (_, { productId, reason, details }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `INSERT INTO marketplace_reports (reporter_id, product_id, reason, details, status)
           VALUES ($1, $2, $3, $4, 'PENDING')`,
          [user.userId, productId, reason, details]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to report product: ${error.message}`);
      }
    }
  },

  // Field resolvers
  Product: {
    seller: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.seller_id]);
      return result.rows[0];
    },
    category: async (parent) => {
      const result = await db.query('SELECT * FROM product_categories WHERE id = $1', [parent.category_id]);
      return result.rows[0];
    },
    images: async (parent) => {
      const result = await db.query(
        'SELECT * FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC',
        [parent.id]
      );
      return result.rows;
    },
    reviews: async (parent) => {
      const result = await db.query(
        `SELECT pr.*, u.first_name, u.last_name
         FROM product_reviews pr
         JOIN users u ON pr.reviewer_id = u.id
         WHERE pr.product_id = $1
         ORDER BY pr.created_at DESC`,
        [parent.id]
      );
      return result.rows;
    },
    averageRating: async (parent) => {
      const result = await db.query(
        'SELECT AVG(rating)::float as avg FROM product_reviews WHERE product_id = $1',
        [parent.id]
      );
      return result.rows[0].avg;
    },
    reviewCount: async (parent) => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM product_reviews WHERE product_id = $1',
        [parent.id]
      );
      return parseInt(result.rows[0].count);
    }
  },

  ProductCategory: {
    products: async (parent, { filter, limit = 20, offset = 0 }) => {
      let query = `
        SELECT * FROM products 
        WHERE category_id = $1 AND deleted_at IS NULL AND status = 'ACTIVE'
      `;
      const params = [parent.id];
      
      if (filter?.search) {
        query += ` AND (title ILIKE $2 OR description ILIKE $3)`;
        params.push(`%${filter.search}%`, `%${filter.search}%`);
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      
      const result = await db.query(query, params);
      return result.rows;
    },
    productCount: async (parent) => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM products WHERE category_id = $1 AND deleted_at IS NULL',
        [parent.id]
      );
      return parseInt(result.rows[0].count);
    }
  },

  ProductOrder: {
    buyer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.buyer_id]);
      return result.rows[0];
    },
    seller: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.seller_id]);
      return result.rows[0];
    },
    items: async (parent) => {
      const result = await db.query(
        `SELECT oi.*, p.title, p.price, p.image_url
         FROM product_order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = $1`,
        [parent.id]
      );
      return result.rows;
    }
  },

  ProductOrderItem: {
    product: async (parent) => {
      const result = await db.query('SELECT * FROM products WHERE id = $1', [parent.product_id]);
      return result.rows[0];
    }
  },

  ProductReview: {
    reviewer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.reviewer_id]);
      return result.rows[0];
    }
  },

  Wishlist: {
    user: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.user_id]);
      return result.rows[0];
    },
    items: async (parent) => {
      const result = await db.query(
        `SELECT wi.*, p.title, p.price, p.image_url
         FROM wishlist_items wi
         JOIN products p ON wi.product_id = p.id
         WHERE wi.wishlist_id = $1
         ORDER BY wi.added_at DESC`,
        [parent.id]
      );
      return result.rows;
    }
  },

  WishlistItem: {
    product: async (parent) => {
      const result = await db.query('SELECT * FROM products WHERE id = $1', [parent.product_id]);
      return result.rows[0];
    }
  }
};