const { gql } = require('graphql-tag');

const typeDefs = gql`
  # User Types
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

  type StudentProfile {
    id: ID!
    studentId: String!
    department: String
    yearLevel: Int
    verificationStatus: String!
  }

  type Role {
    id: ID!
    roleName: String!
    description: String
  }

  # Auth Types
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

  # Product Types
  type Product {
    id: ID!
    seller: User!
    title: String!
    description: String
    price: Float!
    condition: String!
    status: String!
    stockQuantity: Int!
    images: [String!]
    createdAt: String!
    updatedAt: String!
  }

  type ProductCategory {
    id: ID!
    name: String!
    description: String
  }

  type ProductOrder {
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

  type ProductReview {
    id: ID!
    product: Product!
    reviewer: User!
    rating: Int!
    reviewText: String
    createdAt: String!
  }

  input CreateProductInput {
    title: String!
    description: String
    price: Float!
    categoryId: ID!
    condition: String!
    stockQuantity: Int
  }

  # Payment Types
  type Payment {
    id: ID!
    payer: User!
    amount: Float!
    paymentMethod: String!
    paymentStatus: String!
    transactionReference: String
    paidAt: String
    createdAt: String!
  }

  enum PaymentMethod {
    CHAPA
    TELEBIRR
    CASH
    BANK_TRANSFER
  }

  input InitiatePaymentInput {
    orderType: String!
    orderId: ID!
    paymentMethod: PaymentMethod!
  }

  type PaymentPayload {
    payment: Payment!
    reference: String
  }

  # Delivery Types
  type Delivery {
    id: ID!
    deliveryPerson: User!
    orderType: String!
    orderId: ID!
    pickupLocation: String!
    deliveryLocation: String!
    deliveryStatus: String!
    assignedAt: String
    pickedUpAt: String
    deliveredAt: String
    createdAt: String!
  }

  type DeliveryProfile {
    id: ID!
    user: User!
    vehicleType: String
    isAvailable: Boolean!
    createdAt: String!
  }

  # Food Types
  type Cafe {
    id: ID!
    name: String!
    description: String
    location: String!
    logoUrl: String
    rating: Float
    isOpen: Boolean!
    createdAt: String!
  }

  type MenuItem {
    id: ID!
    cafe: Cafe!
    name: String!
    description: String
    price: Float!
    isAvailable: Boolean!
    category: String!
    imageUrl: String
  }

  type FoodOrder {
    id: ID!
    student: User!
    cafe: Cafe!
    totalAmount: Float!
    status: String!
    items: [FoodOrderItem!]!
    createdAt: String!
  }

  type FoodOrderItem {
    id: ID!
    menuItem: MenuItem!
    quantity: Int!
    price: Float!
    subtotal: Float!
  }

  input FoodOrderItemInput {
    menuItemId: ID!
    quantity: Int!
  }

  # Service Types
  type Service {
    id: ID!
    provider: User!
    title: String!
    description: String!
    price: Float!
    priceType: String!
    category: String!
    status: String!
    rating: Float
    createdAt: String!
  }

  type ServiceBooking {
    id: ID!
    service: Service!
    customer: User!
    bookingDate: String!
    status: String!
    totalAmount: Float!
    createdAt: String!
  }

  input CreateServiceInput {
    title: String!
    description: String!
    price: Float!
    category: String!
    priceType: String
  }

  # Messaging Types
  type Conversation {
    id: ID!
    participants: [User!]!
    lastMessage: Message
    unreadCount: Int!
    createdAt: String!
  }

  type Message {
    id: ID!
    sender: User!
    content: String!
    isRead: Boolean!
    attachments: [String!]
    createdAt: String!
  }

  # =============== QUERIES ===============
  type Query {
    # User queries
    me: User!
    user(id: ID!): User
    users(limit: Int, offset: Int): [User!]!
    
    # Product queries
    products(categoryId: ID, search: String, minPrice: Float, maxPrice: Float, limit: Int, offset: Int): [Product!]!
    product(id: ID!): Product
    categories: [ProductCategory!]!
    myProducts: [Product!]!
    myOrders: [ProductOrder!]!
    mySales: [ProductOrder!]!
    
    # Payment queries
    myPayments(limit: Int, offset: Int): [Payment!]!
    payment(id: ID!): Payment
    
    # Delivery queries
    myDeliveryProfile: DeliveryProfile
    myDeliveries(status: String, limit: Int, offset: Int): [Delivery!]!
    pendingDeliveries: [Delivery!]!
    delivery(id: ID!): Delivery
    
    # Food queries
    cafes(limit: Int, offset: Int): [Cafe!]!
    cafe(id: ID!): Cafe
    menuItems(cafeId: ID, category: String, limit: Int): [MenuItem!]!
    myFoodOrders(limit: Int, offset: Int): [FoodOrder!]!
    
    # Service queries
    services(category: String, search: String, limit: Int): [Service!]!
    service(id: ID!): Service
    myServices: [Service!]!
    myServiceBookings: [ServiceBooking!]!
    
    # Messaging queries
    myConversations(limit: Int, offset: Int): [Conversation!]!
    conversation(id: ID!): Conversation
    unreadMessageCount: Int!
  }

  # =============== MUTATIONS ===============
  type Mutation {
    # Auth mutations
    register(input: RegisterInput!): AuthPayload!
    login(input: LoginInput!): AuthPayload!
    updateProfile(firstName: String, lastName: String, phone: String, profilePictureUrl: String): User!
    changePassword(oldPassword: String!, newPassword: String!): Boolean!
    
    # Product mutations
    createProduct(input: CreateProductInput!): Product!
    updateProduct(id: ID!, title: String, description: String, price: Float, status: String): Product!
    deleteProduct(id: ID!): Boolean!
    createOrder(productId: ID!, quantity: Int!, shippingAddress: String!): ProductOrder!
    cancelOrder(orderId: ID!): Boolean!
    reviewProduct(productId: ID!, rating: Int!, reviewText: String): ProductReview!
    
    # Payment mutations
    initiatePayment(input: InitiatePaymentInput!): PaymentPayload!
    verifyPayment(reference: String!): Payment!
    requestRefund(paymentId: ID!, reason: String!): Boolean!
    
    # Delivery mutations
    createDeliveryProfile(vehicleType: String, licenseNumber: String): DeliveryProfile!
    updateDeliveryStatus(deliveryId: ID!, status: String!): Delivery!
    assignDelivery(orderType: String!, orderId: ID!, deliveryPersonId: ID!): Delivery!
    acceptDelivery(deliveryId: ID!): Boolean!
    cancelDelivery(deliveryId: ID!, reason: String!): Boolean!
    
    # Food mutations
    placeFoodOrder(cafeId: ID!, items: [FoodOrderItemInput!]!, specialInstructions: String): FoodOrder!
    updateFoodOrderStatus(orderId: ID!, status: String!): FoodOrder!
    cancelFoodOrder(orderId: ID!): Boolean!
    
    # Service mutations
    createService(input: CreateServiceInput!): Service!
    updateService(id: ID!, title: String, description: String, price: Float, status: String): Service!
    deleteService(id: ID!): Boolean!
    bookService(serviceId: ID!, bookingDate: String!, notes: String): ServiceBooking!
    updateBookingStatus(bookingId: ID!, status: String!): ServiceBooking!
    cancelBooking(bookingId: ID!): Boolean!
    
    # Messaging mutations
    sendMessage(conversationId: ID!, content: String!): Message!
    createConversation(participantIds: [ID!]!): Conversation!
    markMessageRead(messageId: ID!): Boolean!
    deleteMessage(messageId: ID!): Boolean!
  }
`;

module.exports = typeDefs;
