const userResolvers = require('./user');
const messagingResolvers = require('./messaging');
const restaurantResolvers = require('./restaurant');
const foodResolvers = require('./food');
const orderResolvers = require('./order');
const marketplaceResolvers = require('./marketplace');
const cafeResolvers = require('./cafe');
const menuItemResolvers = require('./menuItem');
const foodOrderResolvers = require('./foodOrder');
const productResolvers = require('./product');
const paymentResolvers = require('./payment');


const resolvers = {
  Query: {
    ...userResolvers.Query,
    ...messagingResolvers.Query,
    ...cafeResolvers.Query,
    ...restaurantResolvers.Query,
    ...foodResolvers.Query,
    ...orderResolvers.Query,
    ...marketplaceResolvers.Query,
    ...menuItemResolvers.Query,
    ...foodOrderResolvers.Query,
    ...productResolvers.Query,
    ...paymentResolvers.Query,
  },
  Mutation: {
    ...userResolvers.Mutation,
    ...messagingResolvers.Mutation,
    ...restaurantResolvers.Mutation,
    ...foodResolvers.Mutation,
    ...orderResolvers.Mutation,
    ...marketplaceResolvers.Mutation,
    ...foodOrderResolvers.Mutation,
    ...productResolvers.Mutation,
    ...paymentResolvers.Mutation,
  },
};

module.exports = resolvers;