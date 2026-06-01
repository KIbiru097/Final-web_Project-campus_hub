const { gql } = require('graphql-tag');

const typeDefs = gql`
  type User {
    id: ID!
    firstName: String!
    lastName: String!
    email: String!
    phone: String
    accountStatus: String!
    profilePictureUrl: String
    lastLogin: String
    createdAt: String!
    updatedAt: String!
  }

  type Product {
    id: ID!
    title: String!
    description: String
    price: Float!
    condition: String!
    allowDelivery: Boolean!
    allowMeetup: Boolean!
    status: String!
    seller: User!
    createdAt: String!
    updatedAt: String!
    averageRating: Float
  }

  type Order {
    id: ID!
    buyer: User!
    seller: User!
    totalAmount: Float!
    orderStatus: String!
    shippingAddress: String
    items: [OrderItem!]!
    createdAt: String!
  }

  type OrderItem {
    id: ID!
    product: Product!
    quantity: Int!
    unitPrice: Float!
    subtotal: Float!
  }

  type Review {
    id: ID!
    rating: Int!
    reviewText: String
    reviewer: User!
    createdAt: String!
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

  input CreateOrderInput {
    productId: ID!
    quantity: Int!
    shippingAddress: String!
    fulfillmentMethod: String!
  }

  type Query {
    me: User!
    user(id: ID!): User
    products(search: String, categoryId: ID, limit: Int, offset: Int): [Product!]!
    product(id: ID!): Product
    myProducts: [Product!]!
    myOrders: [Order!]!
    mySales: [Order!]!
    order(id: ID!): Order
    productReviews(productId: ID!): [Review!]!
  }

  type Mutation {
    register(input: RegisterInput!): AuthPayload!
    login(input: LoginInput!): AuthPayload!
    createProduct(input: CreateProductInput!): Product!
    updateProduct(id: ID!, title: String, description: String, price: Float, status: String): Product!
    deleteProduct(id: ID!): Boolean!
    createOrder(input: CreateOrderInput!): Order!
    updateOrderStatus(orderId: ID!, status: String!): Order!
    cancelOrder(orderId: ID!): Boolean!
    createReview(productId: ID!, rating: Int!, reviewText: String): Review!
    deleteReview(reviewId: ID!): Boolean!
  }
`;

module.exports = typeDefs;
