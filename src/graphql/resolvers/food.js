// src/graphql/resolvers/food.js
const db = require('../../config/database');

module.exports = {
  Query: {
    // Get all cafes
    cafes: async (_, { status, search, limit = 20, offset = 0 }) => {
      try {
        let query = `
          SELECT c.*, 
                 AVG(cr.rating) as average_rating,
                 COUNT(DISTINCT cr.id) as review_count
          FROM cafes c
          LEFT JOIN cafe_reviews cr ON c.id = cr.cafe_id
          WHERE c.deleted_at IS NULL
        `;
        const params = [];
        let paramIndex = 1;
        
        if (status) {
          query += ` AND c.status = $${paramIndex++}`;
          params.push(status);
        }
        
        if (search) {
          query += ` AND (c.name ILIKE $${paramIndex++} OR c.description ILIKE $${paramIndex++})`;
          params.push(`%${search}%`, `%${search}%`);
        }
        
        query += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        
        // Get total count
        const countResult = await db.query(
          'SELECT COUNT(*) as total FROM cafes WHERE deleted_at IS NULL'
        );
        
        return {
          cafes: result.rows,
          total: parseInt(countResult.rows[0].total),
          hasMore: offset + limit < parseInt(countResult.rows[0].total)
        };
      } catch (error) {
        throw new Error(`Failed to fetch cafes: ${error.message}`);
      }
    },

    // Get single cafe
    cafe: async (_, { id }) => {
      try {
        const result = await db.query(
          `SELECT c.*, 
                  AVG(cr.rating) as average_rating,
                  COUNT(DISTINCT cr.id) as review_count
           FROM cafes c
           LEFT JOIN cafe_reviews cr ON c.id = cr.cafe_id
           WHERE c.id = $1 AND c.deleted_at IS NULL
           GROUP BY c.id`,
          [id]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Cafe not found');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(error.message);
      }
    },

    // Get all menu categories
    menuCategories: async () => {
      try {
        const result = await db.query(
          'SELECT * FROM menu_categories ORDER BY name'
        );
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch menu categories: ${error.message}`);
      }
    },

    // Get menu items with filters
    menuItems: async (_, { filter, sortBy, limit = 20, offset = 0 }) => {
      try {
        let query = `
          SELECT mi.*, c.name as cafe_name, mc.name as category_name,
                 AVG(fr.rating) as average_rating,
                 COUNT(DISTINCT fr.id) as review_count
          FROM menu_items mi
          JOIN cafes c ON mi.cafe_id = c.id
          JOIN menu_categories mc ON mi.category_id = mc.id
          LEFT JOIN food_reviews fr ON mi.id = fr.menu_item_id
          WHERE mi.deleted_at IS NULL AND mi.is_available = true
        `;
        const params = [];
        let paramIndex = 1;
        
        if (filter) {
          if (filter.cafeId) {
            query += ` AND mi.cafe_id = $${paramIndex++}`;
            params.push(filter.cafeId);
          }
          if (filter.categoryId) {
            query += ` AND mi.category_id = $${paramIndex++}`;
            params.push(filter.categoryId);
          }
          if (filter.minPrice) {
            query += ` AND mi.price >= $${paramIndex++}`;
            params.push(filter.minPrice);
          }
          if (filter.maxPrice) {
            query += ` AND mi.price <= $${paramIndex++}`;
            params.push(filter.maxPrice);
          }
          if (filter.search) {
            query += ` AND (mi.name ILIKE $${paramIndex++} OR mi.description ILIKE $${paramIndex++})`;
            params.push(`%${filter.search}%`, `%${filter.search}%`);
          }
          if (filter.isAvailable !== undefined) {
            query += ` AND mi.is_available = $${paramIndex++}`;
            params.push(filter.isAvailable);
          }
          if (filter.isPopular) {
            query += ` AND mi.is_popular = true`;
          }
        }
        
        query += ` GROUP BY mi.id, c.name, mc.name`;
        
        if (sortBy === 'price_asc') {
          query += ` ORDER BY mi.price ASC`;
        } else if (sortBy === 'price_desc') {
          query += ` ORDER BY mi.price DESC`;
        } else if (sortBy === 'rating') {
          query += ` ORDER BY average_rating DESC NULLS LAST`;
        } else if (sortBy === 'popular') {
          query += ` ORDER BY mi.total_orders DESC`;
        } else {
          query += ` ORDER BY mi.created_at DESC`;
        }
        
        query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        
        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM (${query.split('GROUP BY')[0]}) as sub`;
        const countResult = await db.query(countQuery, params.slice(0, -2));
        
        return {
          menuItems: result.rows,
          total: parseInt(countResult.rows[0].total),
          hasMore: offset + limit < parseInt(countResult.rows[0].total)
        };
      } catch (error) {
        throw new Error(`Failed to fetch menu items: ${error.message}`);
      }
    },

    // Get single menu item
    menuItem: async (_, { id }) => {
      try {
        const result = await db.query(
          `SELECT mi.*, c.name as cafe_name, mc.name as category_name,
                  AVG(fr.rating) as average_rating
           FROM menu_items mi
           JOIN cafes c ON mi.cafe_id = c.id
           JOIN menu_categories mc ON mi.category_id = mc.id
           LEFT JOIN food_reviews fr ON mi.id = fr.menu_item_id
           WHERE mi.id = $1 AND mi.deleted_at IS NULL
           GROUP BY mi.id, c.name, mc.name`,
          [id]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Menu item not found');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(error.message);
      }
    },

    // Get current user's food orders
    myFoodOrders: async (_, { status, limit = 50, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        let query = `
          SELECT fo.*, c.name as cafe_name,
                 json_agg(json_build_object(
                   'id', foi.id,
                   'menu_item_id', foi.menu_item_id,
                   'quantity', foi.quantity,
                   'unit_price', foi.unit_price,
                   'subtotal', foi.subtotal,
                   'name', mi.name
                 )) as items
          FROM food_orders fo
          JOIN cafes c ON fo.cafe_id = c.id
          JOIN food_order_items foi ON fo.id = foi.order_id
          JOIN menu_items mi ON foi.menu_item_id = mi.id
          WHERE fo.student_id = $1
        `;
        const params = [user.userId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND fo.order_status = $${paramIndex++}`;
          params.push(status);
        }
        
        query += ` GROUP BY fo.id, c.name ORDER BY fo.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch orders: ${error.message}`);
      }
    },

    // Get cafe orders (for cafe owner/staff)
    cafeOrders: async (_, { cafeId, status, limit = 50, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        // Check if user owns the cafe
        const check = await db.query(
          'SELECT owner_id FROM cafes WHERE id = $1',
          [cafeId]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Cafe not found');
        }
        
        if (check.rows[0].owner_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        let query = `
          SELECT fo.*, u.first_name, u.last_name, u.email, u.phone,
                 json_agg(json_build_object(
                   'id', foi.id,
                   'menu_item_id', foi.menu_item_id,
                   'quantity', foi.quantity,
                   'unit_price', foi.unit_price,
                   'subtotal', foi.subtotal,
                   'name', mi.name
                 )) as items
          FROM food_orders fo
          JOIN users u ON fo.student_id = u.id
          JOIN food_order_items foi ON fo.id = foi.order_id
          JOIN menu_items mi ON foi.menu_item_id = mi.id
          WHERE fo.cafe_id = $1
        `;
        const params = [cafeId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND fo.order_status = $${paramIndex++}`;
          params.push(status);
        }
        
        query += ` GROUP BY fo.id, u.first_name, u.last_name, u.email, u.phone ORDER BY fo.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch cafe orders: ${error.message}`);
      }
    },

    // Get popular menu items
    popularMenuItems: async (_, { cafeId, limit = 10 }) => {
      try {
        let query = `
          SELECT mi.*, c.name as cafe_name,
                 COUNT(foi.id) as order_count
          FROM menu_items mi
          JOIN cafes c ON mi.cafe_id = c.id
          LEFT JOIN food_order_items foi ON mi.id = foi.menu_item_id
          WHERE mi.deleted_at IS NULL
        `;
        const params = [];
        
        if (cafeId) {
          query += ` AND mi.cafe_id = $1`;
          params.push(cafeId);
        }
        
        query += ` GROUP BY mi.id, c.name ORDER BY order_count DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch popular items: ${error.message}`);
      }
    },

    // Get today's specials
    todaySpecials: async (_, { cafeId }) => {
      try {
        let query = `
          SELECT mi.*, c.name as cafe_name
          FROM menu_items mi
          JOIN cafes c ON mi.cafe_id = c.id
          WHERE mi.is_available = true AND mi.is_popular = true
        `;
        const params = [];
        
        if (cafeId) {
          query += ` AND mi.cafe_id = $1`;
          params.push(cafeId);
        }
        
        query += ` LIMIT 10`;
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch today's specials: ${error.message}`);
      }
    }
  },

  Mutation: {
    // Create cafe
    createCafe: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const { name, description, location, logoUrl, phone, email, openingTime, closingTime } = input;
        
        const result = await db.query(
          `INSERT INTO cafes (owner_id, name, description, location, logo_url, phone, email, 
                              opening_time, closing_time, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
           RETURNING *`,
          [user.userId, name, description, location, logoUrl, phone, email, openingTime, closingTime]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to create cafe: ${error.message}`);
      }
    },

    // Update cafe
    updateCafe: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const check = await db.query(
          'SELECT owner_id FROM cafes WHERE id = $1',
          [id]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Cafe not found');
        }
        
        if (check.rows[0].owner_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        const fields = ['name', 'description', 'location', 'logo_url', 'phone', 'email', 
                        'opening_time', 'closing_time', 'status'];
        
        for (const field of fields) {
          if (input[field] !== undefined) {
            updates.push(`${field} = $${paramIndex++}`);
            values.push(input[field]);
          }
        }
        
        if (updates.length === 0) {
          throw new Error('No fields to update');
        }
        
        values.push(id);
        
        const result = await db.query(
          `UPDATE cafes SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $${paramIndex} RETURNING *`,
          values
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to update cafe: ${error.message}`);
      }
    },

    // Delete cafe
    deleteCafe: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const check = await db.query(
          'SELECT owner_id FROM cafes WHERE id = $1',
          [id]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Cafe not found');
        }
        
        if (check.rows[0].owner_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        await db.query('UPDATE cafes SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
        return true;
      } catch (error) {
        throw new Error(`Failed to delete cafe: ${error.message}`);
      }
    },

    // Add cafe staff
    addCafeStaff: async (_, { cafeId, userId, position }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const check = await db.query(
          'SELECT owner_id FROM cafes WHERE id = $1',
          [cafeId]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Cafe not found');
        }
        
        if (check.rows[0].owner_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        const result = await db.query(
          `INSERT INTO cafe_staff (cafe_id, user_id, position)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [cafeId, userId, position]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to add staff: ${error.message}`);
      }
    },

    // Remove cafe staff
    removeCafeStaff: async (_, { staffId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          'DELETE FROM cafe_staff WHERE id = $1 RETURNING cafe_id',
          [staffId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to remove staff: ${error.message}`);
      }
    },

    // Create menu item
    createMenuItem: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const { cafeId, categoryId, name, description, price, imageUrl, isAvailable } = input;
        
        // Check if user owns the cafe
        const check = await db.query(
          'SELECT owner_id FROM cafes WHERE id = $1',
          [cafeId]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Cafe not found');
        }
        
        if (check.rows[0].owner_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        const result = await db.query(
          `INSERT INTO menu_items (cafe_id, category_id, name, description, price, image_url, is_available)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [cafeId, categoryId, name, description, price, imageUrl, isAvailable !== false]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to create menu item: ${error.message}`);
      }
    },

    // Update menu item
    updateMenuItem: async (_, { id, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        // Check if user owns the cafe
        const check = await db.query(
          `SELECT c.owner_id 
           FROM menu_items mi
           JOIN cafes c ON mi.cafe_id = c.id
           WHERE mi.id = $1`,
          [id]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Menu item not found');
        }
        
        if (check.rows[0].owner_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        const fields = ['name', 'description', 'price', 'category_id', 'image_url', 'is_available'];
        
        for (const field of fields) {
          if (input[field] !== undefined) {
            updates.push(`${field} = $${paramIndex++}`);
            values.push(input[field]);
          }
        }
        
        if (updates.length === 0) {
          throw new Error('No fields to update');
        }
        
        values.push(id);
        
        const result = await db.query(
          `UPDATE menu_items SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP 
           WHERE id = $${paramIndex} RETURNING *`,
          values
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to update menu item: ${error.message}`);
      }
    },

    // Delete menu item
    deleteMenuItem: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const check = await db.query(
          `SELECT c.owner_id 
           FROM menu_items mi
           JOIN cafes c ON mi.cafe_id = c.id
           WHERE mi.id = $1`,
          [id]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Menu item not found');
        }
        
        if (check.rows[0].owner_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        await db.query('UPDATE menu_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
        return true;
      } catch (error) {
        throw new Error(`Failed to delete menu item: ${error.message}`);
      }
    },

    // Place food order
    placeFoodOrder: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const client = await db.pool.connect();
      
      try {
        await client.query('BEGIN');
        
        const { cafeId, items, fulfillmentMethod, specialInstructions, paymentMethod, deliveryAddress } = input;
        
        let totalAmount = 0;
        const orderItems = [];
        
        // Calculate total and validate items
        for (const item of items) {
          const menuItem = await client.query(
            'SELECT * FROM menu_items WHERE id = $1 AND deleted_at IS NULL AND is_available = true',
            [item.menuItemId]
          );
          
          if (menuItem.rows.length === 0) {
            throw new Error(`Menu item ${item.menuItemId} not found or unavailable`);
          }
          
          const menuData = menuItem.rows[0];
          const subtotal = parseFloat(menuData.price) * item.quantity;
          totalAmount += subtotal;
          
          orderItems.push({
            menuItem: menuData,
            quantity: item.quantity,
            unitPrice: menuData.price,
            subtotal,
            specialInstructions: item.specialInstructions
          });
        }
        
        // Create order
        const order = await client.query(
          `INSERT INTO food_orders (student_id, cafe_id, total_amount, fulfillment_method, 
                                     special_instructions, order_status)
           VALUES ($1, $2, $3, $4, $5, 'PENDING')
           RETURNING *`,
          [user.userId, cafeId, totalAmount, fulfillmentMethod, specialInstructions]
        );
        
        // Create order items
        for (const item of orderItems) {
          await client.query(
            `INSERT INTO food_order_items (order_id, menu_item_id, quantity, unit_price, subtotal, special_instructions)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [order.rows[0].id, item.menuItem.id, item.quantity, item.unitPrice, item.subtotal, item.specialInstructions]
          );
        }
        
        await client.query('COMMIT');
        return order.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to place order: ${error.message}`);
      } finally {
        client.release();
      }
    },

    // Update food order status
    updateFoodOrderStatus: async (_, { orderId, status }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        // Check if user owns the cafe
        const check = await db.query(
          `SELECT c.owner_id 
           FROM food_orders fo
           JOIN cafes c ON fo.cafe_id = c.id
           WHERE fo.id = $1`,
          [orderId]
        );
        
        if (check.rows.length === 0) {
          throw new Error('Order not found');
        }
        
        if (check.rows[0].owner_id !== user.userId) {
          throw new Error('Not authorized');
        }
        
        const result = await db.query(
          `UPDATE food_orders 
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

    // Cancel food order
    cancelFoodOrder: async (_, { orderId, reason }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE food_orders 
           SET order_status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND student_id = $2 AND order_status = 'PENDING'
           RETURNING id`,
          [orderId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to cancel order: ${error.message}`);
      }
    },

    // Review menu item
    reviewMenuItem: async (_, { menuItemId, rating, reviewText }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `INSERT INTO food_reviews (menu_item_id, reviewer_id, rating, review_text)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (menu_item_id, reviewer_id) 
           DO UPDATE SET rating = $3, review_text = $4
           RETURNING *`,
          [menuItemId, user.userId, rating, reviewText]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to submit review: ${error.message}`);
      }
    },

    // Review cafe
    reviewCafe: async (_, { cafeId, rating, reviewText }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `INSERT INTO cafe_reviews (cafe_id, reviewer_id, rating, review_text)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (cafe_id, reviewer_id) 
           DO UPDATE SET rating = $3, review_text = $4
           RETURNING *`,
          [cafeId, user.userId, rating, reviewText]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to submit review: ${error.message}`);
      }
    },

    // Delete food review
    deleteFoodReview: async (_, { reviewId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          'DELETE FROM food_reviews WHERE id = $1 AND reviewer_id = $2',
          [reviewId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to delete review: ${error.message}`);
      }
    },

    // Report cafe
    reportCafe: async (_, { cafeId, reason, details }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `INSERT INTO food_reports (reporter_id, cafe_id, reason, details, status)
           VALUES ($1, $2, $3, $4, 'PENDING')`,
          [user.userId, cafeId, reason, details]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to report cafe: ${error.message}`);
      }
    },

    // Report menu item
    reportMenuItem: async (_, { menuItemId, reason, details }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `INSERT INTO food_reports (reporter_id, menu_item_id, reason, details, status)
           VALUES ($1, $2, $3, $4, 'PENDING')`,
          [user.userId, menuItemId, reason, details]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to report menu item: ${error.message}`);
      }
    }
  },

  // Field resolvers
  Cafe: {
    owner: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.owner_id]);
      return result.rows[0];
    },
    menuItems: async (parent, { filter, limit = 20, offset = 0 }) => {
      let query = `
        SELECT * FROM menu_items 
        WHERE cafe_id = $1 AND deleted_at IS NULL
      `;
      const params = [parent.id];
      
      if (filter?.isAvailable !== undefined) {
        query += ` AND is_available = $2`;
        params.push(filter.isAvailable);
      }
      
      if (filter?.categoryId) {
        query += ` AND category_id = $${params.length + 1}`;
        params.push(filter.categoryId);
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      
      const result = await db.query(query, params);
      return result.rows;
    },
    staff: async (parent) => {
      const result = await db.query(
        `SELECT cs.*, u.first_name, u.last_name, u.email
         FROM cafe_staff cs
         JOIN users u ON cs.user_id = u.id
         WHERE cs.cafe_id = $1`,
        [parent.id]
      );
      return result.rows;
    },
    averageRating: async (parent) => {
      const result = await db.query(
        'SELECT AVG(rating)::float as avg FROM cafe_reviews WHERE cafe_id = $1',
        [parent.id]
      );
      return result.rows[0].avg;
    },
    reviewCount: async (parent) => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM cafe_reviews WHERE cafe_id = $1',
        [parent.id]
      );
      return parseInt(result.rows[0].count);
    },
    isOpen: async (parent) => {
      // Simple check - in production, compare with current time
      return parent.status === 'ACTIVE';
    }
  },

  MenuItem: {
    cafe: async (parent) => {
      const result = await db.query('SELECT * FROM cafes WHERE id = $1', [parent.cafe_id]);
      return result.rows[0];
    },
    category: async (parent) => {
      const result = await db.query('SELECT * FROM menu_categories WHERE id = $1', [parent.category_id]);
      return result.rows[0];
    },
    reviews: async (parent) => {
      const result = await db.query(
        `SELECT fr.*, u.first_name, u.last_name
         FROM food_reviews fr
         JOIN users u ON fr.reviewer_id = u.id
         WHERE fr.menu_item_id = $1
         ORDER BY fr.created_at DESC`,
        [parent.id]
      );
      return result.rows;
    },
    averageRating: async (parent) => {
      const result = await db.query(
        'SELECT AVG(rating)::float as avg FROM food_reviews WHERE menu_item_id = $1',
        [parent.id]
      );
      return result.rows[0].avg;
    },
    reviewCount: async (parent) => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM food_reviews WHERE menu_item_id = $1',
        [parent.id]
      );
      return parseInt(result.rows[0].count);
    }
  },

  FoodOrder: {
    student: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.student_id]);
      return result.rows[0];
    },
    cafe: async (parent) => {
      const result = await db.query('SELECT * FROM cafes WHERE id = $1', [parent.cafe_id]);
      return result.rows[0];
    },
    items: async (parent) => {
      const result = await db.query(
        `SELECT foi.*, mi.name, mi.price, mi.image_url
         FROM food_order_items foi
         JOIN menu_items mi ON foi.menu_item_id = mi.id
         WHERE foi.order_id = $1`,
        [parent.id]
      );
      return result.rows;
    }
  },

  FoodOrderItem: {
    menuItem: async (parent) => {
      const result = await db.query('SELECT * FROM menu_items WHERE id = $1', [parent.menu_item_id]);
      return result.rows[0];
    }
  },

  FoodReview: {
    reviewer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.reviewer_id]);
      return result.rows[0];
    },
    menuItem: async (parent) => {
      const result = await db.query('SELECT * FROM menu_items WHERE id = $1', [parent.menu_item_id]);
      return result.rows[0];
    }
  },

  CafeReview: {
    reviewer: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.reviewer_id]);
      return result.rows[0];
    },
    cafe: async (parent) => {
      const result = await db.query('SELECT * FROM cafes WHERE id = $1', [parent.cafe_id]);
      return result.rows[0];
    }
  }
};