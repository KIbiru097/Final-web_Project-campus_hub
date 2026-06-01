// src/graphql/resolvers/delivery.js
const db = require('../../config/database');

module.exports = {
  Query: {
    // Get delivery profile for current user
    myDeliveryProfile: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          'SELECT * FROM delivery_profiles WHERE user_id = $1',
          [user.userId]
        );
        
        return result.rows[0] || null;
      } catch (error) {
        throw new Error(`Failed to fetch delivery profile: ${error.message}`);
      }
    },

    // Get deliveries assigned to current user
    myDeliveries: async (_, { status, limit = 50, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        let query = `
          SELECT d.*, 
                 CASE 
                   WHEN d.food_order_id IS NOT NULL THEN 'FOOD'
                   WHEN d.product_order_id IS NOT NULL THEN 'PRODUCT'
                 END as order_type,
                 COALESCE(fo.id, po.id) as order_id,
                 COALESCE(fo.total_amount, po.total_amount) as order_amount
          FROM deliveries d
          LEFT JOIN food_orders fo ON d.food_order_id = fo.id
          LEFT JOIN product_orders po ON d.product_order_id = po.id
          WHERE d.delivery_person_id = $1
        `;
        const params = [user.userId];
        let paramIndex = 2;
        
        if (status) {
          query += ` AND d.delivery_status = $${paramIndex++}`;
          params.push(status);
        }
        
        query += ` ORDER BY d.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch deliveries: ${error.message}`);
      }
    },

    // Get pending deliveries for assignment
    pendingDeliveries: async (_, { radius, location }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        let query = `
          SELECT d.*, 
                 CASE 
                   WHEN d.food_order_id IS NOT NULL THEN 'FOOD'
                   WHEN d.product_order_id IS NOT NULL THEN 'PRODUCT'
                 END as order_type,
                 COALESCE(fo.id, po.id) as order_id,
                 COALESCE(fo.total_amount, po.total_amount) as order_amount
          FROM deliveries d
          LEFT JOIN food_orders fo ON d.food_order_id = fo.id
          LEFT JOIN product_orders po ON d.product_order_id = po.id
          WHERE d.delivery_status = 'PENDING'
        `;
        const params = [];
        
        query += ` ORDER BY d.created_at ASC LIMIT 20`;
        
        const result = await db.query(query, params);
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch pending deliveries: ${error.message}`);
      }
    },

    // Get active deliveries
    activeDeliveries: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT d.*, 
                  CASE 
                    WHEN d.food_order_id IS NOT NULL THEN 'FOOD'
                    WHEN d.product_order_id IS NOT NULL THEN 'PRODUCT'
                  END as order_type
           FROM deliveries d
           WHERE d.delivery_status IN ('ASSIGNED', 'PICKED_UP', 'IN_TRANSIT')
           ORDER BY d.created_at ASC`
        );
        
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch active deliveries: ${error.message}`);
      }
    },

    // Get single delivery
    delivery: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT d.*, 
                  CASE 
                    WHEN d.food_order_id IS NOT NULL THEN 'FOOD'
                    WHEN d.product_order_id IS NOT NULL THEN 'PRODUCT'
                  END as order_type,
                  COALESCE(fo.id, po.id) as order_id,
                  COALESCE(fo.total_amount, po.total_amount) as order_amount,
                  COALESCE(fo.student_id, po.buyer_id) as customer_id
           FROM deliveries d
           LEFT JOIN food_orders fo ON d.food_order_id = fo.id
           LEFT JOIN product_orders po ON d.product_order_id = po.id
           WHERE d.id = $1`,
          [id]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Delivery not found');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(error.message);
      }
    },

    // Get available delivery personnel
    availableDeliveryPersonnel: async (_, { location, radius = 10 }) => {
      try {
        const result = await db.query(
          `SELECT dp.*, u.first_name, u.last_name, u.email, u.phone
           FROM delivery_profiles dp
           JOIN users u ON dp.user_id = u.id
           WHERE dp.is_available = true
           ORDER BY dp.total_deliveries ASC
           LIMIT 20`
        );
        
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch available personnel: ${error.message}`);
      }
    },

    // Get delivery statistics
    deliveryStats: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT 
             COUNT(*) as total_deliveries,
             COUNT(CASE WHEN delivery_status = 'DELIVERED' THEN 1 END) as completed_deliveries,
             COUNT(CASE WHEN delivery_status = 'CANCELLED' THEN 1 END) as cancelled_deliveries,
             AVG(CASE WHEN delivered_at IS NOT NULL AND picked_up_at IS NOT NULL 
                 THEN EXTRACT(EPOCH FROM (delivered_at - picked_up_at)) / 60 END) as avg_delivery_time
           FROM deliveries
           WHERE delivery_person_id = $1`,
          [user.userId]
        );
        
        const earnings = await db.query(
          `SELECT COALESCE(SUM(total_amount * 0.1), 0) as total_earnings
           FROM deliveries d
           LEFT JOIN food_orders fo ON d.food_order_id = fo.id
           LEFT JOIN product_orders po ON d.product_order_id = po.id
           WHERE d.delivery_person_id = $1 AND d.delivery_status = 'DELIVERED'`,
          [user.userId]
        );
        
        const stats = result.rows[0];
        return {
          totalDeliveries: parseInt(stats.total_deliveries || 0),
          completedDeliveries: parseInt(stats.completed_deliveries || 0),
          cancelledDeliveries: parseInt(stats.cancelled_deliveries || 0),
          averageDeliveryTime: Math.round(stats.avg_delivery_time || 0),
          averageRating: 4.5, // Would need separate query
          totalEarnings: parseFloat(earnings.rows[0].total_earnings || 0)
        };
      } catch (error) {
        throw new Error(`Failed to fetch delivery stats: ${error.message}`);
      }
    },

    // Get delivery tracking history
    deliveryTracking: async (_, { deliveryId }) => {
      try {
        const result = await db.query(
          `SELECT * FROM delivery_tracking 
           WHERE delivery_id = $1 
           ORDER BY timestamp ASC`,
          [deliveryId]
        );
        
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch tracking history: ${error.message}`);
      }
    }
  },

  Mutation: {
    // Create or update delivery profile
    createDeliveryProfile: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const { vehicleType, licenseNumber, isAvailable } = input;
        
        const result = await db.query(
          `INSERT INTO delivery_profiles (user_id, vehicle_type, license_number, is_available)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) 
           DO UPDATE SET 
             vehicle_type = EXCLUDED.vehicle_type,
             license_number = EXCLUDED.license_number,
             is_available = EXCLUDED.is_available
           RETURNING *`,
          [user.userId, vehicleType, licenseNumber, isAvailable !== false]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to create delivery profile: ${error.message}`);
      }
    },

    // Update delivery profile
    updateDeliveryProfile: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        if (input.vehicleType !== undefined) {
          updates.push(`vehicle_type = $${paramIndex++}`);
          values.push(input.vehicleType);
        }
        if (input.licenseNumber !== undefined) {
          updates.push(`license_number = $${paramIndex++}`);
          values.push(input.licenseNumber);
        }
        if (input.isAvailable !== undefined) {
          updates.push(`is_available = $${paramIndex++}`);
          values.push(input.isAvailable);
        }
        
        if (updates.length === 0) {
          throw new Error('No fields to update');
        }
        
        values.push(user.userId);
        
        const result = await db.query(
          `UPDATE delivery_profiles 
           SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $${paramIndex}
           RETURNING *`,
          values
        );
        
        if (result.rows.length === 0) {
          throw new Error('Delivery profile not found');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to update delivery profile: ${error.message}`);
      }
    },

    // Assign delivery to a person (admin only)
    assignDelivery: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const { orderType, orderId, deliveryPersonId } = input;
        
        // Get order details
        let order = null;
        let pickupLocation = '';
        let deliveryLocation = '';
        
        if (orderType === 'FOOD') {
          const result = await db.query(
            `SELECT fo.*, c.location as cafe_location
             FROM food_orders fo
             JOIN cafes c ON fo.cafe_id = c.id
             WHERE fo.id = $1`,
            [orderId]
          );
          order = result.rows[0];
          pickupLocation = order?.cafe_location;
          deliveryLocation = order?.delivery_address;
        } else if (orderType === 'PRODUCT') {
          const result = await db.query(
            `SELECT po.*, u.address as user_address
             FROM product_orders po
             JOIN users u ON po.buyer_id = u.id
             WHERE po.id = $1`,
            [orderId]
          );
          order = result.rows[0];
          pickupLocation = 'Seller Location'; // Would come from seller profile
          deliveryLocation = order?.shipping_address;
        }
        
        if (!order) {
          throw new Error('Order not found');
        }
        
        const result = await db.query(
          `INSERT INTO deliveries (delivery_person_id, ${orderType === 'FOOD' ? 'food_order_id' : 'product_order_id'},
                                    pickup_location, delivery_location, delivery_status, assigned_at)
           VALUES ($1, $2, $3, $4, 'ASSIGNED', CURRENT_TIMESTAMP)
           RETURNING *`,
          [deliveryPersonId, orderId, pickupLocation, deliveryLocation]
        );
        
        // Update order status if needed
        if (orderType === 'FOOD') {
          await db.query(
            'UPDATE food_orders SET order_status = $1 WHERE id = $2',
            ['PREPARING', orderId]
          );
        } else {
          await db.query(
            'UPDATE product_orders SET order_status = $1 WHERE id = $2',
            ['PROCESSING', orderId]
          );
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to assign delivery: ${error.message}`);
      }
    },

    // Accept delivery (by delivery person)
    acceptDelivery: async (_, { deliveryId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE deliveries 
           SET delivery_status = 'ACCEPTED', accepted_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND delivery_person_id = $2 AND delivery_status = 'ASSIGNED'
           RETURNING id`,
          [deliveryId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to accept delivery: ${error.message}`);
      }
    },

    // Reject delivery
    rejectDelivery: async (_, { deliveryId, reason }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE deliveries 
           SET delivery_status = 'PENDING', assigned_at = NULL
           WHERE id = $1 AND delivery_person_id = $2 AND delivery_status = 'ASSIGNED'
           RETURNING id`,
          [deliveryId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to reject delivery: ${error.message}`);
      }
    },

    // Start pickup
    startPickup: async (_, { deliveryId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE deliveries 
           SET delivery_status = 'PICKING_UP'
           WHERE id = $1 AND delivery_person_id = $2 AND delivery_status = 'ACCEPTED'
           RETURNING id`,
          [deliveryId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to start pickup: ${error.message}`);
      }
    },

    // Confirm pickup
    confirmPickup: async (_, { deliveryId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE deliveries 
           SET delivery_status = 'PICKED_UP', picked_up_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND delivery_person_id = $2 AND delivery_status = 'PICKING_UP'
           RETURNING id`,
          [deliveryId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to confirm pickup: ${error.message}`);
      }
    },

    // Update delivery status
    updateDeliveryStatus: async (_, { deliveryId, status, location, notes }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        let updateQuery = 'UPDATE deliveries SET delivery_status = $1';
        const params = [status];
        
        if (status === 'IN_TRANSIT') {
          updateQuery += `, in_transit_at = CURRENT_TIMESTAMP`;
        } else if (status === 'ARRIVED') {
          updateQuery += `, arrived_at = CURRENT_TIMESTAMP`;
        } else if (status === 'DELIVERED') {
          updateQuery += `, delivered_at = CURRENT_TIMESTAMP`;
        }
        
        if (notes) {
          updateQuery += `, notes = $${params.length + 1}`;
          params.push(notes);
        }
        
        updateQuery += ` WHERE id = $${params.length + 1} AND delivery_person_id = $${params.length + 2} RETURNING *`;
        params.push(deliveryId, user.userId);
        
        const result = await db.query(updateQuery, params);
        
        if (result.rows.length === 0) {
          throw new Error('Delivery not found or not authorized');
        }
        
        // Add tracking entry
        await db.query(
          `INSERT INTO delivery_tracking (delivery_id, status, location, notes)
           VALUES ($1, $2, $3, $4)`,
          [deliveryId, status, JSON.stringify(location), notes]
        );
        
        // If delivered, update order status
        if (status === 'DELIVERED') {
          const delivery = result.rows[0];
          if (delivery.food_order_id) {
            await db.query(
              'UPDATE food_orders SET order_status = $1 WHERE id = $2',
              ['COMPLETED', delivery.food_order_id]
            );
          } else if (delivery.product_order_id) {
            await db.query(
              'UPDATE product_orders SET order_status = $1 WHERE id = $2',
              ['DELIVERED', delivery.product_order_id]
            );
          }
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to update delivery status: ${error.message}`);
      }
    },

    // Add tracking update
    addTrackingUpdate: async (_, { deliveryId, input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const { status, location, notes } = input;
        
        const result = await db.query(
          `INSERT INTO delivery_tracking (delivery_id, status, location, notes)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [deliveryId, status, JSON.stringify(location), notes]
        );
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to add tracking update: ${error.message}`);
      }
    },

    // Cancel delivery
    cancelDelivery: async (_, { deliveryId, reason }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE deliveries 
           SET delivery_status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = $1
           WHERE id = $2 AND (delivery_person_id = $3 OR delivery_status = 'PENDING')
           RETURNING id`,
          [reason, deliveryId, user.userId]
        );
        
        if (result.rowCount > 0) {
          // Update order status back to pending
          const delivery = await db.query('SELECT * FROM deliveries WHERE id = $1', [deliveryId]);
          if (delivery.rows[0]) {
            const del = delivery.rows[0];
            if (del.food_order_id) {
              await db.query(
                'UPDATE food_orders SET order_status = $1 WHERE id = $2',
                ['PENDING', del.food_order_id]
              );
            } else if (del.product_order_id) {
              await db.query(
                'UPDATE product_orders SET order_status = $1 WHERE id = $2',
                ['CONFIRMED', del.product_order_id]
              );
            }
          }
        }
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to cancel delivery: ${error.message}`);
      }
    },

    // Rate delivery
    rateDelivery: async (_, { deliveryId, rating, feedback }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE deliveries 
           SET customer_rating = $1, customer_feedback = $2
           WHERE id = $3 AND delivery_status = 'DELIVERED'
           RETURNING id`,
          [rating, feedback, deliveryId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to rate delivery: ${error.message}`);
      }
    },

    // Optimize route (mock implementation)
    optimizeRoute: async (_, { deliveryIds }) => {
      // In production, this would integrate with Google Maps API or similar
      // For now, return the same locations
      try {
        const result = await db.query(
          `SELECT pickup_location, delivery_location FROM deliveries WHERE id = ANY($1::uuid[])`,
          [deliveryIds]
        );
        
        return result.rows.map(r => ({
          latitude: 0,
          longitude: 0,
          address: r.pickup_location || r.delivery_location
        }));
      } catch (error) {
        throw new Error(`Failed to optimize route: ${error.message}`);
      }
    }
  },

  // Field resolvers
  DeliveryProfile: {
    user: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.user_id]);
      return result.rows[0];
    }
  },

  Delivery: {
    deliveryPerson: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.delivery_person_id]);
      return result.rows[0];
    },
    foodOrder: async (parent) => {
      if (!parent.food_order_id) return null;
      const result = await db.query('SELECT * FROM food_orders WHERE id = $1', [parent.food_order_id]);
      return result.rows[0];
    },
    productOrder: async (parent) => {
      if (!parent.product_order_id) return null;
      const result = await db.query('SELECT * FROM product_orders WHERE id = $1', [parent.product_order_id]);
      return result.rows[0];
    },
    trackingHistory: async (parent) => {
      const result = await db.query(
        'SELECT * FROM delivery_tracking WHERE delivery_id = $1 ORDER BY timestamp ASC',
        [parent.id]
      );
      return result.rows;
    }
  },

  DeliveryTracking: {
    location: async (parent) => {
      return typeof parent.location === 'string' ? JSON.parse(parent.location) : parent.location;
    }
  }
};