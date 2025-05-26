const { processImage } = require('./electron/processors/BorderDetector');
const path = require('path');

async function testBorderDetection() {
  // You'll need to update this path to point to your test image
  const testImagePath = './test-image.png'; // Update this path
  
  console.log('Testing border detection on:', testImagePath);
  console.log('='.repeat(50));
  
  try {
    const result = await processImage(testImagePath, {
      threshold: 30, // Same as our updated threshold
      preserveOriginal: true
    });
    
    console.log('Processing result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('✅ Processing succeeded');
      console.log(`🖼️  Original size: ${result.originalSize?.width}x${result.originalSize?.height}`);
      if (result.borderData) {
        console.log(`✂️  Detected borders:`, result.borderData.borderSizes);
        console.log(`📐 New size: ${result.newSize?.width}x${result.newSize?.height}`);
        console.log(`🎯 Cropped: ${result.cropped ? 'YES' : 'NO'}`);
      }
    } else {
      console.log('❌ Processing failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testBorderDetection().catch(console.error); 