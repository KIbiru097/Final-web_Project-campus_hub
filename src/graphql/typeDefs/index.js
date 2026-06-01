const fs = require('fs');
const path = require('path');

const typeDefs = [
  fs.readFileSync(path.join(__dirname, 'user.graphql'), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'marketplace.graphql'), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'services.graphql'), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'food.graphql'), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'payment.graphql'), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'delivery.graphql'), 'utf8'),
  fs.readFileSync(path.join(__dirname, 'messaging.graphql'), 'utf8'),
];

module.exports = typeDefs.join('\n');