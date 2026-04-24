#!/usr/bin/env node

/**
 * Test runner for yield analytics functionality
 * This script runs comprehensive tests for the yield distribution sync & analytics feature
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('🧪 Running Yield Analytics Test Suite...\n');

// Test configuration
const testFiles = [
  'yieldAnalytics.test.js',
  'yieldEndpoints.test.js'
];

const testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

async function runTest(testFile) {
  console.log(`📋 Running ${testFile}...`);
  
  try {
    const testPath = path.join(__dirname, testFile);
    const result = execSync(`npx jest "${testPath}" --verbose --detectOpenHandles`, {
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: path.join(__dirname, '../../..')
    });
    
    console.log('✅ PASSED');
    console.log(result);
    
    return {
      file: testFile,
      status: 'PASSED',
      output: result
    };
    
  } catch (error) {
    console.log('❌ FAILED');
    console.log(error.stdout);
    console.log(error.stderr);
    
    return {
      file: testFile,
      status: 'FAILED',
      output: error.stdout + '\n' + error.stderr
    };
  }
}

async function runAllTests() {
  for (const testFile of testFiles) {
    const result = await runTest(testFile);
    testResults.details.push(result);
    testResults.total++;
    
    if (result.status === 'PASSED') {
      testResults.passed++;
    } else {
      testResults.failed++;
    }
    
    console.log('---\n');
  }
  
  // Print summary
  console.log('📊 Test Results Summary:');
  console.log(`Total Tests: ${testResults.total}`);
  console.log(`Passed: ${testResults.passed}`);
  console.log(`Failed: ${testResults.failed}`);
  console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  
  if (testResults.failed > 0) {
    console.log('\n❌ Some tests failed. Please review the output above.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed! Yield analytics functionality is working correctly.');
    process.exit(0);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { runAllTests, runTest, testResults };
