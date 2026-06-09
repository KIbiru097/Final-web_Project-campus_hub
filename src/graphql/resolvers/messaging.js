const { query } = require('../../config/database');

// Map database conversation to GraphQL format
const mapConversation = (dbConversation) => ({
  id: dbConversation.id,
  createdAt: dbConversation.created_at,
  updatedAt: dbConversation.updated_at
});

// Map database message to GraphQL format
const mapMessage = (dbMessage) => ({
  id: dbMessage.id,
  conversationId: dbMessage.conversation_id,
  senderId: dbMessage.sender_id,
  content: dbMessage.content,
  isRead: dbMessage.is_read,
  readAt: dbMessage.read_at,
  createdAt: dbMessage.created_at
});

const messagingResolvers = {
  Query: {
    // Get all conversations for the current user
    myConversations: async (_, __, { user }) => {
      if (!user || !user.userId) {
        throw new Error('Not authenticated');
      }
      
      const result = await query(
        `SELECT DISTINCT c.* FROM conversations c
         JOIN conversation_participants cp ON c.id = cp.conversation_id
         WHERE cp.user_id = $1
         ORDER BY c.updated_at DESC`,
        [user.userId]
      );
      
      return result.rows.map(mapConversation);
    },

    // Get single conversation by ID
    conversation: async (_, { id }, { user }) => {
      if (!user || !user.userId) {
        throw new Error('Not authenticated');
      }
      
      const result = await query(
        `SELECT c.* FROM conversations c
         JOIN conversation_participants cp ON c.id = cp.conversation_id
         WHERE c.id = $1 AND cp.user_id = $2`,
        [id, user.userId]
      );
      
      return result.rows[0] ? mapConversation(result.rows[0]) : null;
    },

    // Get all messages in a conversation
    conversationMessages: async (_, { conversationId, limit = 50, offset = 0 }, { user }) => {
      if (!user || !user.userId) {
        throw new Error('Not authenticated');
      }
      
      // Check if user is part of conversation
      const check = await query(
        `SELECT id FROM conversation_participants 
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, user.userId]
      );
      
      if (check.rows.length === 0) {
        throw new Error('Not authorized to view this conversation');
      }
      
      const result = await query(
        `SELECT * FROM messages 
         WHERE conversation_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2 OFFSET $3`,
        [conversationId, limit, offset]
      );
      
      return result.rows.map(mapMessage);
    },

    // Get unread message count for current user
    unreadMessageCount: async (_, __, { user }) => {
      if (!user || !user.userId) {
        return 0;
      }
      
      const result = await query(
        `SELECT COUNT(*) FROM messages m
         JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
         WHERE cp.user_id = $1 
         AND m.sender_id != $1 
         AND m.is_read = false`,
        [user.userId]
      );
      
      return parseInt(result.rows[0].count);
    }
  },

  Mutation: {
    // Create a new conversation
    createConversation: async (_, { participantIds }, { user }) => {
      if (!user || !user.userId) {
        throw new Error('Not authenticated');
      }
      
      // Start transaction
      const client = await query('BEGIN');
      
      try {
        // Create conversation
        const convResult = await query(
          `INSERT INTO conversations (id, created_at, updated_at)
           VALUES (gen_random_uuid(), NOW(), NOW())
           RETURNING *`,
          []
        );
        
        const conversation = convResult.rows[0];
        
        // Add all participants (including current user)
        const allParticipants = [user.userId, ...participantIds];
        
        for (const participantId of allParticipants) {
          await query(
            `INSERT INTO conversation_participants (id, conversation_id, user_id, joined_at)
             VALUES (gen_random_uuid(), $1, $2, NOW())`,
            [conversation.id, participantId]
          );
        }
        
        await query('COMMIT');
        
        return mapConversation(conversation);
        
      } catch (error) {
        await query('ROLLBACK');
        throw new Error('Failed to create conversation: ' + error.message);
      }
    },

    // Send a message
    sendMessage: async (_, { conversationId, content }, { user }) => {
      if (!user || !user.userId) {
        throw new Error('Not authenticated');
      }
      
      // Check if user is part of conversation
      const check = await query(
        `SELECT id FROM conversation_participants 
         WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, user.userId]
      );
      
      if (check.rows.length === 0) {
        throw new Error('Not authorized to send message in this conversation');
      }
      
      // Insert message
      const result = await query(
        `INSERT INTO messages (id, conversation_id, sender_id, content, is_read, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())
         RETURNING *`,
        [conversationId, user.userId, content]
      );
      
      // Update conversation updated_at
      await query(
        `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
        [conversationId]
      );
      
      return mapMessage(result.rows[0]);
    },

    // Mark a message as read
    markMessageRead: async (_, { messageId }, { user }) => {
      if (!user || !user.userId) {
        throw new Error('Not authenticated');
      }
      
      const result = await query(
        `UPDATE messages 
         SET is_read = true, read_at = NOW() 
         WHERE id = $1 AND sender_id != $2
         RETURNING *`,
        [messageId, user.userId]
      );
      
      return result.rowCount > 0;
    },

    // Mark all messages in conversation as read
    markConversationRead: async (_, { conversationId }, { user }) => {
      if (!user || !user.userId) {
        throw new Error('Not authenticated');
      }
      
      const result = await query(
        `UPDATE messages 
         SET is_read = true, read_at = NOW() 
         WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false`,
        [conversationId, user.userId]
      );
      
      return true;
    },

    // Delete a message (soft delete - only for sender)
    deleteMessage: async (_, { messageId }, { user }) => {
      if (!user || !user.userId) {
        throw new Error('Not authenticated');
      }
      
      const result = await query(
        `DELETE FROM messages 
         WHERE id = $1 AND sender_id = $2
         RETURNING id`,
        [messageId, user.userId]
      );
      
      return result.rowCount > 0;
    }
  }
};

module.exports = messagingResolvers;