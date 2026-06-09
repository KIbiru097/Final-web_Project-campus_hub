const { gql } = require('graphql-tag');
const fs = require('fs');
const path = require('path');

const userDefs = fs.readFileSync(path.join(__dirname, 'user.graphql'), 'utf8');
const restaurantDefs = fs.readFileSync(path.join(__dirname, 'restaurant.graphql'), 'utf8');
const foodDefs = fs.readFileSync(path.join(__dirname, 'food.graphql'), 'utf8');
const orderDefs = fs.readFileSync(path.join(__dirname, 'order.graphql'), 'utf8');
const marketplaceDefs = fs.readFileSync(path.join(__dirname, 'marketplace.graphql'), 'utf8');
const messagingDefs = fs.readFileSync(path.join(__dirname, 'messaging.graphql'), 'utf8');
const paymentDefs = fs.readFileSync(path.join(__dirname, 'payment.graphql'), 'utf8');
const deliveryDefs = fs.readFileSync(path.join(__dirname, 'delivery.graphql'), 'utf8');
const servicesDefs = fs.readFileSync(path.join(__dirname, 'services.graphql'), 'utf8');

const typeDefs = gql`
  scalar JSON

  ${userDefs}
  ${restaurantDefs}
  ${foodDefs}
  ${orderDefs}
  ${marketplaceDefs}
  ${messagingDefs}
  ${paymentDefs}
  ${deliveryDefs}
  ${servicesDefs}
`;

module.exports = typeDefs;