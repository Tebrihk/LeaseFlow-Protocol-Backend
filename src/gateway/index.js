const { ApolloServer } = require('@apollo/server');
const { ApolloGateway } = require('@apollo/gateway');
const { readFileSync } = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');

// Initialize Express app
const app = express();
app.use(cors());

// Initialize Apollo Gateway
const gateway = new ApolloGateway({
  supergraphSdl: readFileSync('./src/federation/supergraph.graphql').toString(),
  // Security: Only allow requests from authorized sources
  // JWT headers will be propagated to subgraphs
  buildService: ({ name, url }) => {
    return {
      name,
      url,
      // Propagate authentication headers to subgraphs
      willSendRequest({ request, context }) {
        if (context.headers && context.headers.authorization) {
          request.http.headers.set('authorization', context.headers.authorization);
        }
        if (context.headers && context.headers['x-user-id']) {
          request.http.headers.set('x-user-id', context.headers['x-user-id']);
        }
      },
    };
  },
});

// Create Apollo Server with gateway
const server = new ApolloServer({
  gateway,
  // Enable subscriptions if needed
  subscriptions: false,
  context: ({ req }) => {
    // Extract authentication headers for propagation
    return {
      headers: req.headers,
    };
  },
});

// Start server
async function startServer() {
  const { url } = await startStandaloneServer(server, {
    context: async ({ req }) => {
      return {
        headers: req.headers,
      };
    },
    listen: { port: 4000 },
  });
  console.log(`🚀 Apollo Gateway ready at ${url}`);
}

// Helper function for standalone server
async function startStandaloneServer(server, options) {
  const httpServer = http.createServer(app);
  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });
  
  return new Promise((resolve) => {
    httpServer.listen(options.listen, () => {
      resolve({
        url: `http://localhost:${options.listen.port}${server.graphqlPath}`,
      });
    });
  });
}

startServer().catch(err => {
  console.error('Failed to start Apollo Gateway:', err);
  process.exit(1);
});
