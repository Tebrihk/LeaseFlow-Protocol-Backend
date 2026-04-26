/**
 * Graceful Shutdown Service for LeaseFlow Backend
 * Ensures zero-downtime deployments by handling SIGTERM signals properly
 */

class GracefulShutdownService {
  constructor() {
    this.isShuttingDown = false;
    this.activeConnections = new Set();
    this.backgroundJobs = new Map();
    this.shutdownTimeout = 60000; // 60 seconds
    this.healthCheckGracePeriod = 30000; // 30 seconds
  }

  /**
   * Initialize graceful shutdown handlers
   * @param {Object} app - Express app instance
   * @param {Object} server - HTTP server instance
   * @param {Object} dependencies - Application dependencies
   */
  initialize(app, server, dependencies = {}) {
    this.app = app;
    this.server = server;
    this.dependencies = dependencies;

    // Register signal handlers
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
    process.on('SIGINT', () => this.handleShutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('[GracefulShutdown] Uncaught exception:', error);
      this.handleShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[GracefulShutdown] Unhandled rejection at:', promise, 'reason:', reason);
      this.handleShutdown('unhandledRejection');
    });

    // Track active connections
    this.setupConnectionTracking();

    console.log('[GracefulShutdown] Service initialized');
  }

  /**
   * Setup connection tracking for graceful shutdown
   */
  setupConnectionTracking() {
    if (!this.server) return;

    this.server.on('connection', (socket) => {
      const connectionId = this.generateConnectionId(socket);
      this.activeConnections.add(connectionId);
      
      socket.on('close', () => {
        this.activeConnections.delete(connectionId);
      });

      // Set timeout for connections during shutdown
      socket.setTimeout(this.shutdownTimeout, () => {
        if (this.isShuttingDown) {
          socket.destroy();
          this.activeConnections.delete(connectionId);
        }
      });
    });
  }

  /**
   * Generate unique connection ID
   * @param {Object} socket - Socket connection
   * @returns {string} Connection ID
   */
  generateConnectionId(socket) {
    return `${socket.remoteAddress}:${socket.remotePort}:${Date.now()}`;
  }

  /**
   * Register background job for graceful shutdown
   * @param {string} name - Job name
   * @param {Object} job - Job instance with stop() method
   */
  registerBackgroundJob(name, job) {
    this.backgroundJobs.set(name, job);
  }

  /**
   * Handle shutdown signal
   * @param {string} signal - Shutdown signal type
   */
  async handleShutdown(signal) {
    if (this.isShuttingDown) {
      console.log('[GracefulShutdown] Shutdown already in progress, ignoring signal:', signal);
      return;
    }

    this.isShuttingDown = true;
    console.log(`[GracefulShutdown] Received ${signal}, starting graceful shutdown...`);

    try {
      // Start shutdown sequence
      await this.performGracefulShutdown();
    } catch (error) {
      console.error('[GracefulShutdown] Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Perform graceful shutdown sequence
   */
  async performGracefulShutdown() {
    const shutdownStart = Date.now();
    
    try {
      // Step 1: Stop accepting new connections
      await this.stopAcceptingConnections();
      
      // Step 2: Wait for active connections to finish (with timeout)
      await this.waitForActiveConnections();
      
      // Step 3: Stop background jobs
      await this.stopBackgroundJobs();
      
      // Step 4: Close database connections
      await this.closeDatabaseConnections();
      
      // Step 5: Close Redis connections
      await this.closeRedisConnections();
      
      // Step 6: Stop GraphQL server
      await this.stopGraphQLServer();
      
      // Step 7: Close HTTP server
      await this.closeHttpServer();
      
      const shutdownDuration = Date.now() - shutdownStart;
      console.log(`[GracefulShutdown] Shutdown completed in ${shutdownDuration}ms`);
      
      process.exit(0);
    } catch (error) {
      console.error('[GracefulShutdown] Shutdown failed:', error);
      process.exit(1);
    }
  }

  /**
   * Stop accepting new connections
   */
  async stopAcceptingConnections() {
    console.log('[GracefulShutdown] Stopping new connections...');
    
    // Mark health check endpoint as shutting down
    if (this.app) {
      this.app.get('/health', (req, res) => {
        res.status(503).json({
          status: 'shutting_down',
          message: 'Server is shutting down',
          timestamp: new Date().toISOString()
        });
      });
    }

    // Wait a moment for health check propagation
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Wait for active connections to complete
   */
  async waitForActiveConnections() {
    console.log(`[GracefulShutdown] Waiting for ${this.activeConnections.size} active connections...`);
    
    const startTime = Date.now();
    const maxWaitTime = this.shutdownTimeout - 10000; // Leave 10s for other operations
    
    while (this.activeConnections.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      console.log(`[GracefulShutdown] Still waiting for ${this.activeConnections.size} connections...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (this.activeConnections.size > 0) {
      console.warn(`[GracefulShutdown] Force closing ${this.activeConnections.size} remaining connections`);
      this.activeConnections.clear();
    }
  }

  /**
   * Stop all background jobs
   */
  async stopBackgroundJobs() {
    console.log('[GracefulShutdown] Stopping background jobs...');
    
    const stopPromises = [];
    
    for (const [name, job] of this.backgroundJobs) {
      console.log(`[GracefulShutdown] Stopping job: ${name}`);
      
      if (job && typeof job.stop === 'function') {
        stopPromises.push(
          Promise.resolve().then(() => job.stop())
            .catch(error => console.error(`[GracefulShutdown] Error stopping job ${name}:`, error))
        );
      }
      
      // Handle Soroban indexer worker specifically
      if (name === 'sorobanIndexer' && job && typeof job.pause === 'function') {
        stopPromises.push(
          Promise.resolve().then(() => job.pause())
            .catch(error => console.error(`[GracefulShutdown] Error pausing indexer ${name}:`, error))
        );
      }
    }
    
    await Promise.all(stopPromises);
    console.log('[GracefulShutdown] All background jobs stopped');
  }

  /**
   * Close database connections
   */
  async closeDatabaseConnections() {
    console.log('[GracefulShutdown] Closing database connections...');
    
    if (this.dependencies.database) {
      try {
        await this.dependencies.database.close();
        console.log('[GracefulShutdown] Database connections closed');
      } catch (error) {
        console.error('[GracefulShutdown] Error closing database:', error);
      }
    }
  }

  /**
   * Close Redis connections
   */
  async closeRedisConnections() {
    console.log('[GracefulShutdown] Closing Redis connections...');
    
    if (this.dependencies.redisService) {
      try {
        const redis = await this.dependencies.redisService.getWorkingClient();
        await redis.quit();
        console.log('[GracefulShutdown] Redis connections closed');
      } catch (error) {
        console.error('[GracefulShutdown] Error closing Redis:', error);
      }
    }
  }

  /**
   * Stop GraphQL server
   */
  async stopGraphQLServer() {
    console.log('[GracefulShutdown] Stopping GraphQL server...');
    
    if (this.dependencies.apolloServer) {
      try {
        await this.dependencies.apolloServer.stop();
        console.log('[GracefulShutdown] GraphQL server stopped');
      } catch (error) {
        console.error('[GracefulShutdown] Error stopping GraphQL server:', error);
      }
    }
  }

  /**
   * Close HTTP server
   */
  async closeHttpServer() {
    console.log('[GracefulShutdown] Closing HTTP server...');
    
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close((error) => {
          if (error) {
            console.error('[GracefulShutdown] Error closing HTTP server:', error);
          } else {
            console.log('[GracefulShutdown] HTTP server closed');
          }
          resolve();
        });
      });
    }
  }

  /**
   * Check if shutdown is in progress
   * @returns {boolean} True if shutting down
   */
  isShuttingDownInProgress() {
    return this.isShuttingDown;
  }

  /**
   * Get active connection count
   * @returns {number} Number of active connections
   */
  getActiveConnectionCount() {
    return this.activeConnections.size;
  }
}

module.exports = { GracefulShutdownService };
