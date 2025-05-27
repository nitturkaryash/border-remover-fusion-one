const { processImage } = require('./electron/processors/BorderDetector');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

async function testFixedOrientation() {
  console.log('🔄 Testing fixed orientation functionality...');
  
  const testDir = path.join(__dirname, 'test-images');
  const outputDir = path.join(__dirname, 'test-output', 'fixed-orientation');
  
  // Create directories if they don't exist
  try {
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
  } catch (error) {
    // Directories already exist
  }
  
  // Look for any image files in the test directory
  const files = await fs.readdir(testDir);
  const imageFiles = files.filter(file => 
    /\.(jpg|jpeg|png|tiff|tif|pdf)$/i.test(file)
  );
  
  if (imageFiles.length === 0) {
    console.log('❌ No test images found in test-images folder');
    console.log('Please add some images or PDFs to test the orientation fix');
    return;
  }
  
  for (const imageFile of imageFiles) {
    const imagePath = path.join(testDir, imageFile);
    console.log(`\n📁 Testing fixed orientation on: ${imageFile}`);
    
    try {
      // Get original image info
      let originalBuffer;
      let originalMeta;
      
      if (path.extname(imageFile).toLowerCase() === '.pdf') {
        console.log('📄 PDF detected - will test with orientation preservation');
        originalBuffer = await fs.readFile(imagePath);
        console.log(`   Original PDF size: ${(originalBuffer.length / 1024).toFixed(1)}KB`);
      } else {
        originalBuffer = await fs.readFile(imagePath);
        originalMeta = await sharp(originalBuffer).metadata();
        console.log(`   Original: ${originalMeta.width}x${originalMeta.height} (${originalMeta.width > originalMeta.height ? 'landscape' : 'portrait'})`);
        console.log(`   Orientation: ${originalMeta.orientation || 'none'}`);
      }
      
      // Process the image with our fixed orientation logic
      const result = await processImage(imagePath, {
        outputPath: path.join(outputDir, `fixed_orientation_${path.basename(imageFile, path.extname(imageFile))}.png`),
        threshold: 30,
        minBorderSize: 1
      });
      
      if (result.success) {
        console.log(`✅ Processing successful: ${result.cropped ? 'borders removed' : 'no borders found'}`);
        
        // Check the output image orientation
        const outputBuffer = await fs.readFile(result.processedPath);
        const outputMeta = await sharp(outputBuffer).metadata();
        console.log(`   Output: ${outputMeta.width}x${outputMeta.height} (${outputMeta.width > outputMeta.height ? 'landscape' : 'portrait'})`);
        
        // Calculate aspect ratios for non-PDF files
        if (!path.extname(imageFile).toLowerCase().includes('pdf') && originalMeta) {
          const originalAspect = originalMeta.width / originalMeta.height;
          const outputAspect = outputMeta.width / outputMeta.height;
          
          console.log(`   Original aspect ratio: ${originalAspect.toFixed(2)}`);
          console.log(`   Output aspect ratio: ${outputAspect.toFixed(2)}`);
          
          // Check if orientation was preserved (allowing for border cropping)
          const wasLandscape = originalMeta.width > originalMeta.height;
          const isNowLandscape = outputMeta.width > outputMeta.height;
          
          if (wasLandscape === isNowLandscape) {
            console.log(`   ✅ Orientation preserved: ${wasLandscape ? 'landscape' : 'portrait'}`);
          } else {
            console.log(`   ❌ Orientation changed from ${wasLandscape ? 'landscape' : 'portrait'} to ${isNowLandscape ? 'landscape' : 'portrait'}`);
          }
        }
        
        console.log(`   📁 Output saved: ${result.processedPath}`);
      } else {
        console.log(`❌ Processing failed: ${result.error}`);
      }
      
    } catch (error) {
      console.log(`❌ Error testing ${imageFile}: ${error.message}`);
    }
  }
  
  console.log('\n🎉 Fixed orientation testing complete!');
  console.log(`📁 Check outputs in: ${outputDir}`);
}

// Run the test
testFixedOrientation().catch(error => {
  console.error('Test failed:', error);
}); 