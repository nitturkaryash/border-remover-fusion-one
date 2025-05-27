const { processImage } = require('./electron/processors/BorderDetector');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

async function testPdfOrientation() {
  console.log('🔄 Testing PDF orientation fix...');
  
  // Specific PDF file to test
  const pdfPath = path.join(__dirname, 'test-images', '2410205455_76634_Part3.pdf');
  const outputDir = path.join(__dirname, 'test-output', 'fixed-orientation');
  
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (error) {
    // Directory exists
  }
  
  console.log(`📄 Processing PDF: ${pdfPath}`);
  
  try {
    // Process the image with our fixed orientation logic
    const result = await processImage(pdfPath, {
      outputPath: path.join(outputDir, `portrait_fixed_output.png`),
      threshold: 30,
      minBorderSize: 1
    });
    
    if (result.success) {
      console.log(`✅ Processing successful: ${result.cropped ? 'borders removed' : 'no borders found'}`);
      
      // Check the output image orientation
      const outputBuffer = await fs.readFile(result.processedPath);
      const outputMeta = await sharp(outputBuffer).metadata();
      console.log(`📊 Output dimensions: ${outputMeta.width}x${outputMeta.height}`);
      console.log(`📏 Orientation: ${outputMeta.width > outputMeta.height ? 'LANDSCAPE' : 'PORTRAIT'}`);
      
      console.log(`📁 Output saved: ${result.processedPath}`);
    } else {
      console.log(`❌ Processing failed: ${result.error}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

testPdfOrientation().catch(error => {
  console.error('Test failed:', error);
}); 