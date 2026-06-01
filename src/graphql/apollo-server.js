const { ApolloServer } = require('@apollo/server');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const bcrypt = require('bcrypt');

// Type definitions
const typeDefs = `#graphql
  type User {
    id: ID!
    firstName: String!
    lastName: String!
    email: String!
    phone: String
    accountStatus: String!
    createdAt: String!
  }

  type Product {
    id: ID!
    title: String!
    description: String
    price: Float!
    condition: String!
    status: String!
    seller: User!
    createdAt: String!
    averageRating: Float
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  input RegisterInput {
    firstName: String!
    lastName: String!
    email: String!
    phone: String!
    password: String!
  }

  input LoginInput {
    email: String!
    password: String!
  }

  input CreateProductInput {
    title: String!
    description: String
    price: Float!
    categoryId: ID!
    condition: String!
    allowDelivery: Boolean
    allowMeetup: Boolean
  }

  type Query {
    me: User
    products(limit: Int): [Product]
    product(id: ID!): Product
  }

  type Mutation {
    register(input: RegisterInput!): AuthPayload
    login(input: LoginInput!): AuthPayload
    createProduct(input: CreateProductInput!): Product
  }
`;

// Resolvers
const resolvers = {
  Query: {
    me: async (_, __, { user }) => {
      if (!user) return null;
      const result = await db.query(
        'SELECT id, first_name, last_name, email, phone, account_status, created_at FROM users WHERE id = $1',
        [user.userId]
      );
      if (result.rows.length === 0) return null;
      const userData = result.rows[0];
      return {
        id: userData.id,
        firstName: userData.first_name,
        lastName: userData.last_name,
        email: userData.email,
        phone: userData.phone,
        accountStatus: userData.account_status,
        createdAt: userData.created_at
      };
    },
    
    products: async (_, { limit = 20 }) => {
      const result = await db.query(
        `SELECT p.*, u.id as seller_id, u.first_name, u.last_name, u.email, u.phone
         FROM products p
         JOIN users u ON p.seller_id = u.id
         WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
         LIMIT $1`,
        [limit]
      );
      
      return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        price: parseFloat(row.price),
        condition: row.condition,
        status: row.status,
        createdAt: row.created_at,
        seller: {
          id: row.seller_id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
          accountStatus: 'ACTIVE',
          createdAt: new Date().toISOString()
        }
      }));
    },
    
    product: async (_, { id }) => {
      const result = await db.query(
        `SELECT p.*, u.id as seller_id, u.first_name, u.last_name, u.email, u.phone
         FROM products p
         JOIN users u ON p.seller_id = u.id
         WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [id]
      );
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        price: parseFloat(row.price),
        condition: row.condition,
        status: row.status,
        createdAt: row.created_at,
        seller: {
          id: row.seller_id,
          firstName: row.first_name,
          lastName: row.last_name,
          email: row.email,
          phone: row.phone,
          accountStatus: 'ACTIVE',
          createdAt: new Date().toISOString()
        }
      };
    },
  },
  
  Mutation: {
    register: async (_, { input }) => {
      const { firstName, lastName, email, phone, password } = input;
      
      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        throw new Error('Email already registered');
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const result = await db.query(
        `INSERT INTO users (first_name, last_name, email, phone, password_hash, account_status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
         RETURNING id, first_name, last_name, email, phone, account_status, created_at`,
        [firstName, lastName, email, phone, hashedPassword]
      );
      
      const user = result.rows[0];
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return {
        token,
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          phone: user.phone,
          accountStatus: user.account_status,
          createdAt: user.created_at
        }
      };
    },
    
    login: async (_, { input }) => {
      const { email, password } = input;
      
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Invalid credentials');
      }
      
      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      
      if (!valid) {
        throw new Error('Invalid credentials');
      }
      
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return {
        token,
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          phone: user.phone,
          accountStatus: user.account_status,
          createdAt: user.created_at
        }
      };
    },
    
    createProduct: async (_, { input }, { user }) => {
      if (!user) {
        throw new Error('Authentication required');
      }
      
      const { title, description, price, categoryId, condition, allowDelivery, allowMeetup } = input;
      
      const result = await db.query(
        `INSERT INTO products (seller_id, title, description, price, category_id, condition, 
                               allow_delivery, allow_meetup, stock_quantity, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'ACTIVE')
         RETURNING *`,
        [user.userId, title, description, price, categoryId, condition, allowDelivery || true, allowMeetup || true]
      );
      
      const product = result.rows[0];
      
      // Get seller info
      const sellerResult = await db.query(
        'SELECT id, first_name, last_name, email, phone FROM users WHERE id = $1',
        [user.userId]
      );
      const seller = sellerResult.rows[0];
      
      return {
        id: product.id,
        title: product.title,
        description: product.description,
        price: parseFloat(product.price),
        condition: product.condition,
        status: product.status,
        createdAt: product.created_at,
        seller: {
          id: seller.id,
          firstName: seller.first_name,
          lastName: seller.last_name,
          email: seller.email,
          phone: seller.phone,
          accountStatus: 'ACTIVE',
          createdAt: new Date().toISOString()
        }
      };
    },
  },
};

// Create and export the Apollo Server setup
async function createApolloServer() {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });
  
  await server.start();
  
  return server;
}

module.exports = { createApolloServer };
