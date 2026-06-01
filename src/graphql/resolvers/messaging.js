// src/graphql/resolvers/messaging.js
const db = require('../../config/database');
const { PubSub } = require('graphql-subscriptions');

const pubsub = new PubSub();

module.exports = {
  Query: {
    // Get current user's conversations
    myConversations: async (_, { search, limit = 50, offset = 0 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        let query = `
          SELECT c.*, 
                 json_agg(json_build_object('id', u.id, 'first_name', u.first_name, 
                                           'last_name', u.last_name, 'email', u.email)) as participants,
                 (SELECT json_build_object('id', m.id, 'message_text', m.message_text, 
                                          'sent_at', m.sent_at, 'sender_id', m.sender_id)
                  FROM messages m 
                  WHERE m.conversation_id = c.id 
                  ORDER BY m.sent_at DESC 
                  LIMIT 1) as last_message
          FROM conversations c
          JOIN conversation_participants cp ON c.id = cp.conversation_id
          JOIN users u ON cp.user_id = u.id
          WHERE cp.user_id = $1
        `;
        const params = [user.userId];
        let paramIndex = 2;
        
        if (search) {
          query += ` AND (c.id::text ILIKE $${paramIndex} OR u.first_name ILIKE $${paramIndex + 1})`;
          params.push(`%${search}%`, `%${search}%`);
          paramIndex += 2;
        }
        
        query += ` GROUP BY c.id ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        
        // Add unread count for each conversation
        for (const conv of result.rows) {
          const unreadResult = await db.query(
            `SELECT COUNT(*) as count FROM messages m
             LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = $1
             WHERE m.conversation_id = $2 AND m.sender_id != $1 AND mr.id IS NULL`,
            [user.userId, conv.id]
          );
          conv.unreadCount = parseInt(unreadResult.rows[0].count);
        }
        
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch conversations: ${error.message}`);
      }
    },

    // Get single conversation
    conversation: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT c.*, 
                  json_agg(json_build_object('id', u.id, 'first_name', u.first_name, 
                                            'last_name', u.last_name, 'email', u.email)) as participants
           FROM conversations c
           JOIN conversation_participants cp ON c.id = cp.conversation_id
           JOIN users u ON cp.user_id = u.id
           WHERE c.id = $1 AND cp.user_id = $2
           GROUP BY c.id`,
          [id, user.userId]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Conversation not found');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(error.message);
      }
    },

    // Get unread message count
    unreadMessageCount: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT COUNT(*) as count 
           FROM messages m
           JOIN conversations c ON m.conversation_id = c.id
           JOIN conversation_participants cp ON c.id = cp.conversation_id
           LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = cp.user_id
           WHERE cp.user_id = $1 AND m.sender_id != $1 AND mr.id IS NULL`,
          [user.userId]
        );
        
        return parseInt(result.rows[0].count);
      } catch (error) {
        throw new Error(`Failed to get unread count: ${error.message}`);
      }
    },

    // Search messages in conversation
    searchMessages: async (_, { conversationId, search, limit = 50 }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT m.*, u.first_name, u.last_name
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.conversation_id = $1 AND m.message_text ILIKE $2
           ORDER BY m.sent_at DESC
           LIMIT $3`,
          [conversationId, `%${search}%`, limit]
        );
        
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to search messages: ${error.message}`);
      }
    },

    // Get pinned conversations
    pinnedConversations: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT c.*, 
                  json_agg(json_build_object('id', u.id, 'first_name', u.first_name, 
                                            'last_name', u.last_name)) as participants
           FROM conversations c
           JOIN conversation_participants cp ON c.id = cp.conversation_id
           JOIN users u ON cp.user_id = u.id
           WHERE cp.user_id = $1 AND cp.is_pinned = true
           GROUP BY c.id
           ORDER BY cp.pinned_at DESC`,
          [user.userId]
        );
        
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch pinned conversations: ${error.message}`);
      }
    },

    // Get blocked users
    blockedUsers: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `SELECT u.id, u.first_name, u.last_name, u.email
           FROM blocked_users bu
           JOIN users u ON bu.blocked_user_id = u.id
           WHERE bu.user_id = $1`,
          [user.userId]
        );
        
        return result.rows;
      } catch (error) {
        throw new Error(`Failed to fetch blocked users: ${error.message}`);
      }
    }
  },

  Mutation: {
    // Create new conversation
    createConversation: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      const client = await db.pool.connect();
      
      try {
        await client.query('BEGIN');
        
        const { conversationType, participantIds, relatedOrderId, relatedOrderType, initialMessage } = input;
        
        // Check if conversation already exists between these participants
        const existing = await client.query(
          `SELECT c.id 
           FROM conversations c
           JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
           JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
           WHERE cp1.user_id = $1 AND cp2.user_id = $2 AND c.conversation_type = $3`,
          [user.userId, participantIds[0], conversationType]
        );
        
        if (existing.rows.length > 0) {
          await client.query('COMMIT');
          const result = await db.query(
            `SELECT c.*, 
                    json_agg(json_build_object('id', u.id, 'first_name', u.first_name, 
                                              'last_name', u.last_name)) as participants
             FROM conversations c
             JOIN conversation_participants cp ON c.id = cp.conversation_id
             JOIN users u ON cp.user_id = u.id
             WHERE c.id = $1
             GROUP BY c.id`,
            [existing.rows[0].id]
          );
          return result.rows[0];
        }
        
        // Create conversation
        let conversationResult;
        if (relatedOrderId && relatedOrderType) {
          let orderField = '';
          if (relatedOrderType === 'PRODUCT') orderField = 'product_order_id';
          else if (relatedOrderType === 'SERVICE') orderField = 'service_request_id';
          else if (relatedOrderType === 'FOOD') orderField = 'food_order_id';
          else if (relatedOrderType === 'DELIVERY') orderField = 'delivery_id';
          
          conversationResult = await client.query(
            `INSERT INTO conversations (conversation_type, ${orderField})
             VALUES ($1, $2)
             RETURNING *`,
            [conversationType, relatedOrderId]
          );
        } else {
          conversationResult = await client.query(
            `INSERT INTO conversations (conversation_type)
             VALUES ($1)
             RETURNING *`,
            [conversationType]
          );
        }
        
        const conversation = conversationResult.rows[0];
        
        // Add participants (including current user)
        const allParticipants = [user.userId, ...participantIds];
        for (const participantId of allParticipants) {
          await client.query(
            `INSERT INTO conversation_participants (conversation_id, user_id)
             VALUES ($1, $2)`,
            [conversation.id, participantId]
          );
        }
        
        // Send initial message if provided
        if (initialMessage) {
          const messageResult = await client.query(
            `INSERT INTO messages (conversation_id, sender_id, message_text, message_status)
             VALUES ($1, $2, $3, 'SENT')
             RETURNING *`,
            [conversation.id, user.userId, initialMessage]
          );
          
          // Publish new message
          pubsub.publish(`MESSAGE_${conversation.id}`, {
            messageReceived: messageResult.rows[0]
          });
        }
        
        await client.query('COMMIT');
        
        const result = await db.query(
          `SELECT c.*, 
                  json_agg(json_build_object('id', u.id, 'first_name', u.first_name, 
                                            'last_name', u.last_name, 'email', u.email)) as participants
           FROM conversations c
           JOIN conversation_participants cp ON c.id = cp.conversation_id
           JOIN users u ON cp.user_id = u.id
           WHERE c.id = $1
           GROUP BY c.id`,
          [conversation.id]
        );
        
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to create conversation: ${error.message}`);
      } finally {
        client.release();
      }
    },

    // Send message
    sendMessage: async (_, { input }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const { conversationId, recipientId, messageText, attachments, replyToMessageId } = input;
        
        let convId = conversationId;
        
        // If no conversation ID, create one with recipient
        if (!convId && recipientId) {
          const existing = await db.query(
            `SELECT c.id 
             FROM conversations c
             JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
             JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
             WHERE cp1.user_id = $1 AND cp2.user_id = $2 AND c.conversation_type = 'GENERAL'`,
            [user.userId, recipientId]
          );
          
          if (existing.rows.length > 0) {
            convId = existing.rows[0].id;
          } else {
            // Create new conversation
            const newConv = await db.query(
              `INSERT INTO conversations (conversation_type) VALUES ('GENERAL') RETURNING id`
            );
            convId = newConv.rows[0].id;
            
            await db.query(
              `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
              [convId, user.userId, recipientId]
            );
          }
        }
        
        // Insert message
        const result = await db.query(
          `INSERT INTO messages (conversation_id, sender_id, message_text, message_status, reply_to_message_id)
           VALUES ($1, $2, $3, 'SENT', $4)
           RETURNING *`,
          [convId, user.userId, messageText, replyToMessageId]
        );
        
        const message = result.rows[0];
        
        // Add attachments if any
        if (attachments && attachments.length > 0) {
          for (const attachment of attachments) {
            await db.query(
              `INSERT INTO message_attachments (message_id, file_url, file_name, file_type)
               VALUES ($1, $2, $3, $4)`,
              [message.id, attachment.url, attachment.name, attachment.type]
            );
          }
        }
        
        // Publish message for real-time updates
        pubsub.publish(`MESSAGE_${convId}`, {
          messageReceived: message
        });
        
        // Notify other participants
        const participants = await db.query(
          `SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2`,
          [convId, user.userId]
        );
        
        for (const participant of participants.rows) {
          pubsub.publish(`NOTIFICATION_${participant.user_id}`, {
            notificationReceived: {
              type: 'MESSAGE',
              conversationId: convId,
              senderId: user.userId,
              message: messageText
            }
          });
        }
        
        return message;
      } catch (error) {
        throw new Error(`Failed to send message: ${error.message}`);
      }
    },

    // Edit message
    editMessage: async (_, { messageId, messageText }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE messages 
           SET message_text = $1, edited_at = CURRENT_TIMESTAMP, is_edited = true
           WHERE id = $2 AND sender_id = $3
           RETURNING *`,
          [messageText, messageId, user.userId]
        );
        
        if (result.rows.length === 0) {
          throw new Error('Message not found or not authorized');
        }
        
        return result.rows[0];
      } catch (error) {
        throw new Error(`Failed to edit message: ${error.message}`);
      }
    },

    // Delete message (soft delete)
    deleteMessage: async (_, { messageId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        const result = await db.query(
          `UPDATE messages 
           SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND sender_id = $2
           RETURNING id`,
          [messageId, user.userId]
        );
        
        return result.rowCount > 0;
      } catch (error) {
        throw new Error(`Failed to delete message: ${error.message}`);
      }
    },

    // Mark message as read
    markMessageRead: async (_, { messageId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `INSERT INTO message_reads (message_id, user_id, read_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (message_id, user_id) DO NOTHING`,
          [messageId, user.userId]
        );
        
        // Publish read receipt
        pubsub.publish(`READ_${messageId}`, {
          messageRead: {
            messageId,
            userId: user.userId,
            readAt: new Date().toISOString()
          }
        });
        
        return true;
      } catch (error) {
        throw new Error(`Failed to mark message as read: ${error.message}`);
      }
    },

    // Mark entire conversation as read
    markConversationRead: async (_, { conversationId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `INSERT INTO message_reads (message_id, user_id, read_at)
           SELECT m.id, $1, CURRENT_TIMESTAMP
           FROM messages m
           WHERE m.conversation_id = $2 AND m.sender_id != $1
           ON CONFLICT (message_id, user_id) DO NOTHING`,
          [user.userId, conversationId]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to mark conversation as read: ${error.message}`);
      }
    },

    // Start typing indicator
    startTyping: async (_, { conversationId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `INSERT INTO typing_indicators (conversation_id, user_id, is_typing, updated_at)
           VALUES ($1, $2, true, CURRENT_TIMESTAMP)
           ON CONFLICT (conversation_id, user_id) 
           DO UPDATE SET is_typing = true, updated_at = CURRENT_TIMESTAMP`,
          [conversationId, user.userId]
        );
        
        // Publish typing status
        pubsub.publish(`TYPING_${conversationId}`, {
          typingStatus: {
            conversationId,
            userId: user.userId,
            isTyping: true,
            timestamp: new Date().toISOString()
          }
        });
        
        return true;
      } catch (error) {
        throw new Error(`Failed to start typing: ${error.message}`);
      }
    },

    // Stop typing indicator
    stopTyping: async (_, { conversationId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `UPDATE typing_indicators 
           SET is_typing = false, updated_at = CURRENT_TIMESTAMP
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, user.userId]
        );
        
        // Publish typing status
        pubsub.publish(`TYPING_${conversationId}`, {
          typingStatus: {
            conversationId,
            userId: user.userId,
            isTyping: false,
            timestamp: new Date().toISOString()
          }
        });
        
        return true;
      } catch (error) {
        throw new Error(`Failed to stop typing: ${error.message}`);
      }
    },

    // Delete conversation
    deleteConversation: async (_, { conversationId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        // Remove participant from conversation (soft delete)
        await db.query(
          `DELETE FROM conversation_participants 
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, user.userId]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to delete conversation: ${error.message}`);
      }
    },

    // Archive conversation
    archiveConversation: async (_, { conversationId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `UPDATE conversation_participants 
           SET is_archived = true, archived_at = CURRENT_TIMESTAMP
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, user.userId]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to archive conversation: ${error.message}`);
      }
    },

    // Pin conversation
    pinConversation: async (_, { conversationId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `UPDATE conversation_participants 
           SET is_pinned = true, pinned_at = CURRENT_TIMESTAMP
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, user.userId]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to pin conversation: ${error.message}`);
      }
    },

    // Block user
    blockUser: async (_, { userId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `INSERT INTO blocked_users (user_id, blocked_user_id, blocked_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT DO NOTHING`,
          [user.userId, userId]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to block user: ${error.message}`);
      }
    },

    // Unblock user
    unblockUser: async (_, { userId }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `DELETE FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2`,
          [user.userId, userId]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to unblock user: ${error.message}`);
      }
    },

    // Report message
    reportMessage: async (_, { messageId, reason }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      
      try {
        await db.query(
          `INSERT INTO message_reports (message_id, reporter_id, reason, status, created_at)
           VALUES ($1, $2, $3, 'PENDING', CURRENT_TIMESTAMP)`,
          [messageId, user.userId, reason]
        );
        
        return true;
      } catch (error) {
        throw new Error(`Failed to report message: ${error.message}`);
      }
    }
  },

  Subscription: {
    // Subscribe to new messages in a conversation
    messageReceived: {
      subscribe: (_, { conversationId }) => {
        return pubsub.asyncIterator(`MESSAGE_${conversationId}`);
      }
    },
    
    // Subscribe to typing status updates
    typingStatus: {
      subscribe: (_, { conversationId }) => {
        return pubsub.asyncIterator(`TYPING_${conversationId}`);
      }
    },
    
    // Subscribe to message read receipts
    messageRead: {
      subscribe: (_, { conversationId }) => {
        return pubsub.asyncIterator(`READ_${conversationId}`);
      }
    },
    
    // Subscribe to conversation updates
    conversationUpdated: {
      subscribe: (_, { conversationId }) => {
        return pubsub.asyncIterator(`CONVERSATION_${conversationId}`);
      }
    },
    
    // Subscribe to user presence
    userPresence: {
      subscribe: (_, { userId }) => {
        return pubsub.asyncIterator(`PRESENCE_${userId}`);
      }
    }
  },

  // Field resolvers
  Conversation: {
    participants: async (parent) => {
      const result = await db.query(
        `SELECT u.* FROM users u
         JOIN conversation_participants cp ON u.id = cp.user_id
         WHERE cp.conversation_id = $1`,
        [parent.id]
      );
      return result.rows;
    },
    
    messages: async (parent, { limit = 50, offset = 0 }) => {
      const result = await db.query(
        `SELECT m.*, u.first_name, u.last_name
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.conversation_id = $1 AND m.is_deleted = false
         ORDER BY m.sent_at DESC
         LIMIT $2 OFFSET $3`,
        [parent.id, limit, offset]
      );
      return result.rows.reverse(); // Return in chronological order
    },
    
    lastMessage: async (parent) => {
      const result = await db.query(
        `SELECT m.*, u.first_name, u.last_name
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.conversation_id = $1 AND m.is_deleted = false
         ORDER BY m.sent_at DESC
         LIMIT 1`,
        [parent.id]
      );
      return result.rows[0];
    },
    
    unreadCount: async (parent, _, { user }) => {
      if (!user) return 0;
      
      const result = await db.query(
        `SELECT COUNT(*) as count FROM messages m
         LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = $1
         WHERE m.conversation_id = $2 AND m.sender_id != $1 AND mr.id IS NULL`,
        [user.userId, parent.id]
      );
      return parseInt(result.rows[0].count);
    },
    
    productOrder: async (parent) => {
      if (!parent.product_order_id) return null;
      const result = await db.query('SELECT * FROM product_orders WHERE id = $1', [parent.product_order_id]);
      return result.rows[0];
    },
    
    serviceRequest: async (parent) => {
      if (!parent.service_request_id) return null;
      const result = await db.query('SELECT * FROM service_requests WHERE id = $1', [parent.service_request_id]);
      return result.rows[0];
    },
    
    foodOrder: async (parent) => {
      if (!parent.food_order_id) return null;
      const result = await db.query('SELECT * FROM food_orders WHERE id = $1', [parent.food_order_id]);
      return result.rows[0];
    },
    
    delivery: async (parent) => {
      if (!parent.delivery_id) return null;
      const result = await db.query('SELECT * FROM deliveries WHERE id = $1', [parent.delivery_id]);
      return result.rows[0];
    }
  },

  Message: {
    sender: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.sender_id]);
      return result.rows[0];
    },
    
    attachments: async (parent) => {
      const result = await db.query(
        'SELECT * FROM message_attachments WHERE message_id = $1',
        [parent.id]
      );
      return result.rows;
    },
    
    readBy: async (parent) => {
      const result = await db.query(
        `SELECT u.id, u.first_name, u.last_name, mr.read_at
         FROM message_reads mr
         JOIN users u ON mr.user_id = u.id
         WHERE mr.message_id = $1`,
        [parent.id]
      );
      return result.rows;
    },
    
    isRead: async (parent, _, { user }) => {
      if (!user) return false;
      const result = await db.query(
        'SELECT id FROM message_reads WHERE message_id = $1 AND user_id = $2',
        [parent.id, user.userId]
      );
      return result.rowCount > 0;
    }
  },

  MessageAttachment: {
    fileUrl: async (parent) => {
      // Could add CDN URL transformation here
      return parent.file_url;
    }
  },

  TypingIndicator: {
    user: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.user_id]);
      return result.rows[0];
    }
  },

  MessageReadReceipt: {
    user: async (parent) => {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [parent.userId]);
      return result.rows[0];
    }
  }
};