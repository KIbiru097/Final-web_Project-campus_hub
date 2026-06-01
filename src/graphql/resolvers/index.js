// src/graphql/resolvers/index.js
const userResolvers = require('./user');
const marketplaceResolvers = require('./marketplace');
const servicesResolvers = require('./services');
const foodResolvers = require('./food');
const paymentResolvers = require('./payment');
const deliveryResolvers = require('./delivery');
const messagingResolvers = require('./messaging');

module.exports = {
  Query: {
    ...userResolvers.Query,
    ...marketplaceResolvers.Query,
    ...servicesResolvers.Query,
    ...foodResolvers.Query,
    ...paymentResolvers.Query,
    ...deliveryResolvers.Query,
    ...messagingResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...marketplaceResolvers.Mutation,
    ...servicesResolvers.Mutation,
    ...foodResolvers.Mutation,
    ...paymentResolvers.Mutation,
    ...deliveryResolvers.Mutation,
    ...messagingResolvers.Mutation,
  },
  Subscription: {
    ...messagingResolvers.Subscription,
  },
  // Field resolvers
  User: userResolvers.User,
  Product: marketplaceResolvers.Product,
  ProductCategory: marketplaceResolvers.ProductCategory,
  ProductOrder: marketplaceResolvers.ProductOrder,
  ProductOrderItem: marketplaceResolvers.ProductOrderItem,
  ProductReview: marketplaceResolvers.ProductReview,
  Wishlist: marketplaceResolvers.Wishlist,
  WishlistItem: marketplaceResolvers.WishlistItem,
  Service: servicesResolvers.Service,
  ServiceCategory: servicesResolvers.ServiceCategory,
  ServiceRequest: servicesResolvers.ServiceRequest,
  ServiceReview: servicesResolvers.ServiceReview,
  Cafe: foodResolvers.Cafe,
  MenuItem: foodResolvers.MenuItem,
  FoodOrder: foodResolvers.FoodOrder,
  FoodOrderItem: foodResolvers.FoodOrderItem,
  FoodReview: foodResolvers.FoodReview,
  CafeReview: foodResolvers.CafeReview,
  Payment: paymentResolvers.Payment,
  SavedPaymentMethod: paymentResolvers.SavedPaymentMethod,
  DeliveryProfile: deliveryResolvers.DeliveryProfile,
  Delivery: deliveryResolvers.Delivery,
  DeliveryTracking: deliveryResolvers.DeliveryTracking,
  Conversation: messagingResolvers.Conversation,
  Message: messagingResolvers.Message,
  MessageAttachment: messagingResolvers.MessageAttachment,
  TypingIndicator: messagingResolvers.TypingIndicator,
  MessageReadReceipt: messagingResolvers.MessageReadReceipt,
};