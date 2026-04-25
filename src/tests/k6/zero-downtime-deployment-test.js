import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics for zero-downtime testing
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    // Ramp up to normal load
    { duration: '2m', target: 50 },
    // Maintain normal load
    { duration: '3m', target: 50 },
    // Ramp up to high load (simulating peak traffic during deployment)
    { duration: '2m', target: 100 },
    // Maintain high load during deployment window
    { duration: '5m', target: 100 },
    // Ramp down
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    // Critical: No 502/503/504 errors during deployment
    http_req_failed: ['rate<0.01'], // Less than 1% errors
    // Response times should remain reasonable
    http_req_duration: ['p(95)<2000'], // 95th percentile under 2s
    // Custom error rate threshold
    errors: ['rate<0.01'],
  },
  // Graceful stop for K6
  gracefulStop: '30s',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Test data
const testQueries = [
  // Basic health check
  {
    name: 'Health Check',
    method: 'GET',
    path: '/health',
    expectedStatus: 200,
  },
  // GraphQL queries for different endpoints
  {
    name: 'GraphQL - Assets Query',
    method: 'POST',
    path: '/graphql',
    body: JSON.stringify({
      query: `
        query GetAssets($limit: Int) {
          assets(limit: $limit) {
            id
            type
            status
            address
            ipfsMetadataCid
            assetCondition {
              overall
            }
          }
        }
      `,
      variables: { limit: 10 }
    }),
    expectedStatus: 200,
  },
  {
    name: 'GraphQL - Leases Query',
    method: 'POST',
    path: '/graphql',
    body: JSON.stringify({
      query: `
        query GetLeases($limit: Int) {
          leases(limit: $limit) {
            id
            status
            rentAmount
            startDate
            endDate
            asset {
              id
              type
            }
          }
        }
      `,
      variables: { limit: 10 }
    }),
    expectedStatus: 200,
  },
  {
    name: 'GraphQL - RWA Metadata Query',
    method: 'POST',
    path: '/graphql',
    body: JSON.stringify({
      query: `
        query GetAssetWithRWA($id: ID!) {
          asset(id: $id) {
            id
            type
            ipfsMetadataCid
            assetCondition {
              overall
              structural
              mechanical
              cosmetic
            }
            geolocation {
              latitude
              longitude
              address
              city
              country
            }
            insuranceStatus {
              insured
              provider
              coverageAmount
            }
            imageUrls
            physicalTraits {
              yearManufactured
              make
              model
              dimensions {
                length
                width
                height
                unit
              }
            }
          }
        }
      `,
      variables: { id: "test-asset-1" }
    }),
    expectedStatus: 200,
  },
  {
    name: 'GraphQL - Federation Reference',
    method: 'POST',
    path: '/graphql',
    body: JSON.stringify({
      query: `
        query GetLeaseWithReferences($id: ID!) {
          lease(id: $id) {
            id
            status
            rentAmount
            asset {
              id
              type
              address
            }
            landlordId
            tenantId
          }
        }
      `,
      variables: { id: "test-lease-1" }
    }),
    expectedStatus: 200,
  },
];

export function setup() {
  console.log('🚀 Starting Zero-Downtime Deployment Load Test');
  console.log(`📍 Target URL: ${BASE_URL}`);
  console.log('⏱️  This test simulates traffic during a rolling deployment');
  console.log('🎯 Goal: Verify zero 502/503/504 errors during deployment');
  
  // Pre-warm the connection pool
  const warmupResponse = http.get(`${BASE_URL}/health`);
  if (warmupResponse.status !== 200) {
    console.error(`❌ Warmup failed: ${warmupResponse.status}`);
  } else {
    console.log('✅ Warmup successful');
  }
}

export default function() {
  // Randomly select a test scenario
  const test = testQueries[Math.floor(Math.random() * testQueries.length)];
  
  let response;
  const startTime = Date.now();
  
  try {
    if (test.method === 'GET') {
      response = http.get(`${BASE_URL}${test.path}`, {
        timeout: '10s',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'k6-zero-downtime-test',
        },
      });
    } else if (test.method === 'POST') {
      response = http.post(`${BASE_URL}${test.path}`, test.body, {
        timeout: '10s',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'k6-zero-downtime-test',
        },
      });
    }
    
    const responseTime = Date.now() - startTime;
    
    // Check for deployment-related errors
    const isDeploymentError = 
      response.status === 502 || // Bad Gateway
      response.status === 503 || // Service Unavailable
      response.status === 504;   // Gateway Timeout
    
    // Log deployment errors with extra detail
    if (isDeploymentError) {
      console.error(`🚨 DEPLOYMENT ERROR: ${test.name} - Status: ${response.status} - Response Time: ${responseTime}ms`);
      console.error(`📄 Response body: ${response.body}`);
      errorRate.add(1);
    }
    
    // Perform standard checks
    const success = check(response, {
      [`${test.name} status is ${test.expectedStatus}`]: (r) => r.status === test.expectedStatus,
      [`${test.name} response time < 2000ms`]: (r) => responseTime < 2000,
      [`${test.name} no deployment errors`]: (r) => !isDeploymentError,
      [`${test.name} response not empty`]: (r) => r.body.length > 0,
    });
    
    if (!success) {
      errorRate.add(1);
      console.warn(`⚠️  Test failed: ${test.name} - Status: ${response.status} - Time: ${responseTime}ms`);
    }
    
    // Additional checks for GraphQL responses
    if (test.path === '/graphql' && response.status === 200) {
      try {
        const graphqlResponse = JSON.parse(response.body);
        check(graphqlResponse, {
          [`${test.name} GraphQL response valid`]: (r) => !r.errors || r.errors.length === 0,
          [`${test.name} GraphQL has data`]: (r) => r.data !== undefined,
        });
      } catch (e) {
        console.error(`❌ Invalid GraphQL response: ${e.message}`);
        errorRate.add(1);
      }
    }
    
    // Brief pause between requests
    sleep(Math.random() * 2 + 1); // 1-3 seconds
    
  } catch (error) {
    console.error(`💥 Request failed: ${test.name} - Error: ${error.message}`);
    errorRate.add(1);
  }
}

export function teardown(data) {
  console.log('🏁 Zero-Downtime Deployment Load Test Completed');
  console.log('📊 Check the K6 output for detailed metrics');
  console.log('🎯 Success criteria: <1% errors, no 502/503/504 responses');
}

// Custom function to test deployment scenarios
export function handleSummary(data) {
  console.log('\n📈 ZERO-DOWNTIME DEPLOYMENT TEST SUMMARY');
  console.log('==========================================');
  
  // Check for deployment errors
  const deploymentErrors = data.metrics.http_req_failed?.values?.filter(status => 
    status === 502 || status === 503 || status === 504
  ) || [];
  
  if (deploymentErrors.length > 0) {
    console.log(`🚨 CRITICAL: ${deploymentErrors.length} deployment errors detected!`);
    console.log('❌ Zero-downtime deployment FAILED');
    return {
      'zero-downtime-status': 'FAILED',
      'deployment-errors': deploymentErrors.length,
      'total-requests': data.metrics.http_reqs?.count || 0,
      'error-rate': (data.metrics.http_req_failed?.rate || 0) * 100,
    };
  } else {
    console.log('✅ SUCCESS: No deployment errors detected!');
    console.log('🎉 Zero-downtime deployment PASSED');
    return {
      'zero-downtime-status': 'PASSED',
      'deployment-errors': 0,
      'total-requests': data.metrics.http_reqs?.count || 0,
      'error-rate': (data.metrics.http_req_failed?.rate || 0) * 100,
      'avg-response-time': data.metrics.http_req_duration?.avg || 0,
      'p95-response-time': data.metrics.http_req_duration?.values?.['p(95)'] || 0,
    };
  }
}
