// electron/test-border-detection.js
// Comprehensive test suite for the enhanced border detection system

const path = require('path');
const fs = require('fs').promises;
const { detectBorders, cropImage, processImage, processBatch, validateFile, CONFIG } = require('./processors/BorderDetector');
const logger = require('./utils/logger');

/**
 * Test suite for border detection functionality
 */
class BorderDetectionTestSuite {
  constructor() {
    this.testResults = [];
    this.testImages = []; // Will be populated with test image paths
  }

  /**
   * Logs test results
   */
  log(message, level = 'info') {
    logger[level](`[BorderDetectionTest] ${message}`);
    console.log(`[TEST] ${message}`);
  }

  /**
   * Creates a synthetic black border test image
   */
  async createTestImage(width = 800, height = 600, borderSize = 50) {
    const sharp = require('sharp');
    
    // Create a white image with black borders
    const canvas = Buffer.alloc(width * height * 3, 255); // White background
    
    // Add black borders
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isTopBorder = y < borderSize;
        const isBottomBorder = y >= height - borderSize;
        const isLeftBorder = x < borderSize;
        const isRightBorder = x >= width - borderSize;
        
        if (isTopBorder || isBottomBorder || isLeftBorder || isRightBorder) {
          const idx = (y * width + x) * 3;
          canvas[idx] = 0;     // R
          canvas[idx + 1] = 0; // G
          canvas[idx + 2] = 0; // B
        }
      }
    }
    
    return await sharp(canvas, {
      raw: { width, height, channels: 3 }
    }).png().toBuffer();
  }

  /**
   * Test basic border detection functionality
   */
  async testBasicBorderDetection() {
    this.log('Testing basic border detection...');
    
    try {
      // Create test image with known borders
      const testBuffer = await this.createTestImage(800, 600, 50);
      
      // Detect borders
      const result = await detectBorders(testBuffer, {
        threshold: CONFIG.BLACK_THRESHOLD,
        minBorderSize: 10
      });
      
      // Validate results
      const expectedCropWidth = 800 - (2 * 50); // 700
      const expectedCropHeight = 600 - (2 * 50); // 500
      
      const success = result.hasBorders && 
                     Math.abs(result.width - expectedCropWidth) <= 5 &&
                     Math.abs(result.height - expectedCropHeight) <= 5;
      
      this.testResults.push({
        test: 'Basic Border Detection',
        success,
        details: {
          expected: { width: expectedCropWidth, height: expectedCropHeight },
          actual: { width: result.width, height: result.height },
          borderSizes: result.borderSizes,
          processingTime: result.metadata?.processingTime
        }
      });
      
      this.log(`Basic border detection: ${success ? 'PASSED' : 'FAILED'}`);
      return success;
      
    } catch (error) {
      this.log(`Basic border detection failed: ${error.message}`, 'error');
      this.testResults.push({
        test: 'Basic Border Detection',
        success: false,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Test edge cases
   */
  async testEdgeCases() {
    this.log('Testing edge cases...');
    
    const edgeTests = [
      {
        name: 'No Borders',
        imageGen: () => this.createTestImage(400, 300, 0),
        expectedHasBorders: false
      },
      {
        name: 'Thin Borders',
        imageGen: () => this.createTestImage(400, 300, 2),
        expectedHasBorders: false // Below minimum border size
      },
      {
        name: 'Uneven Borders',
        imageGen: async () => {
          const sharp = require('sharp');
          const canvas = Buffer.alloc(400 * 300 * 3, 255);
          
          // Add uneven borders (top: 30px, bottom: 10px, left: 20px, right: 40px)
          for (let y = 0; y < 300; y++) {
            for (let x = 0; x < 400; x++) {
              const isTopBorder = y < 30;
              const isBottomBorder = y >= 290;
              const isLeftBorder = x < 20;
              const isRightBorder = x >= 360;
              
              if (isTopBorder || isBottomBorder || isLeftBorder || isRightBorder) {
                const idx = (y * 400 + x) * 3;
                canvas[idx] = 0;
                canvas[idx + 1] = 0;
                canvas[idx + 2] = 0;
              }
            }
          }
          
          return await sharp(canvas, {
            raw: { width: 400, height: 300, channels: 3 }
          }).png().toBuffer();
        },
        expectedHasBorders: true
      }
    ];
    
    for (const edgeTest of edgeTests) {
      try {
        const testBuffer = await edgeTest.imageGen();
        const result = await detectBorders(testBuffer);
        
        const success = result.hasBorders === edgeTest.expectedHasBorders;
        
        this.testResults.push({
          test: `Edge Case: ${edgeTest.name}`,
          success,
          details: {
            expected: { hasBorders: edgeTest.expectedHasBorders },
            actual: { hasBorders: result.hasBorders },
            borderSizes: result.borderSizes
          }
        });
        
        this.log(`Edge case ${edgeTest.name}: ${success ? 'PASSED' : 'FAILED'}`);
        
      } catch (error) {
        this.log(`Edge case ${edgeTest.name} failed: ${error.message}`, 'error');
        this.testResults.push({
          test: `Edge Case: ${edgeTest.name}`,
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Test performance with various image sizes
   */
  async testPerformance() {
    this.log('Testing performance...');
    
    const performanceTests = [
      { width: 800, height: 600, name: 'Standard' },
      { width: 1920, height: 1080, name: 'HD' },
      { width: 3840, height: 2160, name: '4K' }
    ];
    
    for (const perfTest of performanceTests) {
      try {
        const startTime = Date.now();
        const testBuffer = await this.createTestImage(perfTest.width, perfTest.height, 50);
        const creationTime = Date.now() - startTime;
        
        const processStart = Date.now();
        const result = await detectBorders(testBuffer);
        const processingTime = Date.now() - processStart;
        
        const targetTime = perfTest.name === '4K' ? 5000 : 2000; // 5s for 4K, 2s for others
        const success = processingTime < targetTime;
        
        this.testResults.push({
          test: `Performance: ${perfTest.name} (${perfTest.width}x${perfTest.height})`,
          success,
          details: {
            imageCreationTime: creationTime,
            processingTime,
            targetTime,
            imageSize: perfTest.width * perfTest.height
          }
        });
        
        this.log(`Performance ${perfTest.name}: ${processingTime}ms (target: <${targetTime}ms) - ${success ? 'PASSED' : 'FAILED'}`);
        
      } catch (error) {
        this.log(`Performance test ${perfTest.name} failed: ${error.message}`, 'error');
        this.testResults.push({
          test: `Performance: ${perfTest.name}`,
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Test cropping functionality
   */
  async testCropping() {
    this.log('Testing image cropping...');
    
    try {
      const testBuffer = await this.createTestImage(600, 400, 30);
      
      // Detect borders
      const borderData = await detectBorders(testBuffer);
      
      if (!borderData.hasBorders) {
        throw new Error('No borders detected for cropping test');
      }
      
      // Crop image
      const croppedBuffer = await cropImage(testBuffer, borderData);
      
      // Verify cropped image
      const sharp = require('sharp');
      const croppedMetadata = await sharp(croppedBuffer).metadata();
      
      const expectedWidth = 600 - (2 * 30); // 540
      const expectedHeight = 400 - (2 * 30); // 340
      
      const success = Math.abs(croppedMetadata.width - expectedWidth) <= 5 &&
                     Math.abs(croppedMetadata.height - expectedHeight) <= 5;
      
      this.testResults.push({
        test: 'Image Cropping',
        success,
        details: {
          originalSize: { width: 600, height: 400 },
          expectedCroppedSize: { width: expectedWidth, height: expectedHeight },
          actualCroppedSize: { width: croppedMetadata.width, height: croppedMetadata.height },
          borderData
        }
      });
      
      this.log(`Image cropping: ${success ? 'PASSED' : 'FAILED'}`);
      return success;
      
    } catch (error) {
      this.log(`Image cropping failed: ${error.message}`, 'error');
      this.testResults.push({
        test: 'Image Cropping',
        success: false,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Test file validation
   */
  async testFileValidation() {
    this.log('Testing file validation...');
    
    const validationTests = [
      {
        name: 'Valid File Path',
        filePath: __filename, // This JS file exists
        expectedValid: false // JS files should be invalid
      },
      {
        name: 'Non-existent File',
        filePath: '/path/to/nonexistent/file.jpg',
        expectedValid: false
      }
    ];
    
    for (const validationTest of validationTests) {
      try {
        const result = await validateFile(validationTest.filePath);
        const success = result.valid === validationTest.expectedValid;
        
        this.testResults.push({
          test: `File Validation: ${validationTest.name}`,
          success,
          details: {
            filePath: validationTest.filePath,
            expected: { valid: validationTest.expectedValid },
            actual: { valid: result.valid, error: result.error }
          }
        });
        
        this.log(`File validation ${validationTest.name}: ${success ? 'PASSED' : 'FAILED'}`);
        
      } catch (error) {
        this.log(`File validation ${validationTest.name} failed: ${error.message}`, 'error');
        this.testResults.push({
          test: `File Validation: ${validationTest.name}`,
          success: false,
          error: error.message
        });
      }
    }
  }

  /**
   * Test memory management with large batches
   */
  async testMemoryManagement() {
    this.log('Testing memory management...');
    
    try {
      const initialMemory = process.memoryUsage();
      
      // Create a batch of test images
      const batchSize = 10;
      const testImages = [];
      
      for (let i = 0; i < batchSize; i++) {
        const buffer = await this.createTestImage(800, 600, 20);
        testImages.push(buffer);
      }
      
      const afterCreationMemory = process.memoryUsage();
      
      // Process images individually to test memory cleanup
      for (const imageBuffer of testImages) {
        await detectBorders(imageBuffer);
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      
      // Check if memory usage is reasonable
      const memoryIncreaseMB = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);
      const success = memoryIncreaseMB < CONFIG.MAX_MEMORY_USAGE / (1024 * 1024);
      
      this.testResults.push({
        test: 'Memory Management',
        success,
        details: {
          batchSize,
          initialMemoryMB: initialMemory.heapUsed / (1024 * 1024),
          afterCreationMemoryMB: afterCreationMemory.heapUsed / (1024 * 1024),
          finalMemoryMB: finalMemory.heapUsed / (1024 * 1024),
          memoryIncreaseMB,
          maxAllowedMB: CONFIG.MAX_MEMORY_USAGE / (1024 * 1024)
        }
      });
      
      this.log(`Memory management: ${success ? 'PASSED' : 'FAILED'} (${memoryIncreaseMB.toFixed(1)}MB increase)`);
      return success;
      
    } catch (error) {
      this.log(`Memory management test failed: ${error.message}`, 'error');
      this.testResults.push({
        test: 'Memory Management',
        success: false,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Runs all tests
   */
  async runAllTests() {
    this.log('Starting comprehensive border detection test suite...');
    
    const startTime = Date.now();
    
    await this.testBasicBorderDetection();
    await this.testEdgeCases();
    await this.testPerformance();
    await this.testCropping();
    await this.testFileValidation();
    await this.testMemoryManagement();
    
    const totalTime = Date.now() - startTime;
    
    // Generate summary
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(t => t.success).length;
    const failedTests = totalTests - passedTests;
    
    this.log(`\n=== TEST SUITE SUMMARY ===`);
    this.log(`Total Tests: ${totalTests}`);
    this.log(`Passed: ${passedTests}`);
    this.log(`Failed: ${failedTests}`);
    this.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    this.log(`Total Time: ${totalTime}ms`);
    
    // Log failed tests
    if (failedTests > 0) {
      this.log(`\n=== FAILED TESTS ===`);
      this.testResults.filter(t => !t.success).forEach(test => {
        this.log(`❌ ${test.test}: ${test.error || 'Unknown error'}`);
      });
    }
    
    return {
      totalTests,
      passedTests,
      failedTests,
      successRate: (passedTests / totalTests) * 100,
      totalTime,
      results: this.testResults
    };
  }

  /**
   * Demonstrates usage examples
   */
  async demonstrateUsage() {
    this.log('\n=== USAGE EXAMPLES ===');
    
    try {
      // Example 1: Basic single image processing
      this.log('Example 1: Basic single image processing');
      const testBuffer = await this.createTestImage(400, 300, 25);
      
      const borderResult = await detectBorders(testBuffer);
      this.log(`Detected borders: ${JSON.stringify(borderResult.borderSizes)}`);
      
      if (borderResult.hasBorders) {
        const croppedBuffer = await cropImage(testBuffer, borderResult);
        this.log(`Successfully cropped image to ${borderResult.width}x${borderResult.height}`);
      }
      
      // Example 2: Configuration options
      this.log('\nExample 2: Custom configuration');
      const customResult = await detectBorders(testBuffer, {
        threshold: 15,
        minBorderSize: 10,
        noiseReduction: true,
        edgeRefinement: true
      });
      this.log(`Custom detection result: ${customResult.hasBorders ? 'Borders found' : 'No borders'}`);
      
      // Example 3: Performance monitoring
      this.log('\nExample 3: Performance monitoring');
      const perfStart = Date.now();
      await detectBorders(testBuffer);
      const perfTime = Date.now() - perfStart;
      this.log(`Processing time: ${perfTime}ms`);
      
    } catch (error) {
      this.log(`Usage demonstration failed: ${error.message}`, 'error');
    }
  }
}

// Export for use in other modules or standalone execution
module.exports = BorderDetectionTestSuite;

// Run tests if executed directly
if (require.main === module) {
  const testSuite = new BorderDetectionTestSuite();
  
  testSuite.runAllTests()
    .then(async (summary) => {
      await testSuite.demonstrateUsage();
      process.exit(summary.failedTests > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Test suite execution failed:', error);
      process.exit(1);
    });
} 