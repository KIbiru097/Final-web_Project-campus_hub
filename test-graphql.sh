#!/bin/bash

echo "Testing GraphQL endpoint..."

# Test login mutation
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { login(input: { email: \"test@example.com\", password: \"password123\" }) { token user { id firstName lastName email } } }"
  }'

echo -e "\n\nTesting products query..."
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ products(limit: 5) { id title price condition } }"
  }'

echo -e "\n"
