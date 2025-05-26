const { processImage, detectBorders, convertPdfToImageBuffer } = require('./electron/processors/BorderDetector');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

async function testRealImages() {
  console.log('🔍 Testing border detection with real images...');
  
  // Create a test folder for sample images
  const testDir = path.join(__dirname, 'test-images');
  const outputDir = path.join(__dirname, 'test-output');
  const debugDir = path.join(__dirname, 'debug-output');
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir);
    console.log(`Created test directory: ${testDir}`);
    console.log('Please add your document images to this folder and run the script again.');
    return;
  }
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir);
  }
  
  // Get all image and PDF files from test directory
  const imageFiles = fs.readdirSync(testDir)
    .filter(file => /\.(jpg|jpeg|png|tiff|tif|pdf)$/i.test(file))
    .map(file => path.join(testDir, file));
  
  if (imageFiles.length === 0) {
    console.log('No image files found in test-images folder.');
    console.log('Please add some document images with black borders to test.');
    return;
  }
  
  console.log(`Found ${imageFiles.length} file(s) to process:`);
  imageFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
  
  // Process each image with multiple threshold settings
  const testThresholds = [10, 20, 30, 50, 80, 120]; // Very aggressive to very conservative
  
  for (const imagePath of imageFiles) {
    try {
      console.log(`\n📁 Processing: ${path.basename(imagePath)}`);
      
      let imageBuffer;
      
      // Handle PDF conversion
      if (path.extname(imagePath).toLowerCase() === '.pdf') {
        console.log('🔄 Converting PDF to image...');
        imageBuffer = await convertPdfToImageBuffer(imagePath);
        
        // Save the converted image for debugging
        const debugPdfPath = path.join(debugDir, `converted_${path.basename(imagePath, '.pdf')}.png`);
        await fs.promises.writeFile(debugPdfPath, imageBuffer);
        console.log(`💾 Saved converted PDF image: ${debugPdfPath}`);
      } else {
        imageBuffer = await fs.promises.readFile(imagePath);
      }
      
      // Get image info
      const metadata = await sharp(imageBuffer).metadata();
      console.log(`📏 Image dimensions: ${metadata.width}x${metadata.height}`);
      
      // Test different thresholds
      console.log('\n🎯 Testing different detection thresholds:');
      let bestResult = null;
      
      for (const threshold of testThresholds) {
        try {
          const result = await detectBorders(imageBuffer, {
            threshold: threshold,
            minBorderSize: 1, // Very sensitive
            noiseReduction: true,
            edgeRefinement: true
          });
          
          const borderTotal = (result.borderSizes?.top || 0) + 
                            (result.borderSizes?.bottom || 0) + 
                            (result.borderSizes?.left || 0) + 
                            (result.borderSizes?.right || 0);
          
          console.log(`  Threshold ${threshold.toString().padStart(3)}: ${result.hasBorders ? '✅' : '❌'} | Borders: T${result.borderSizes?.top}px B${result.borderSizes?.bottom}px L${result.borderSizes?.left}px R${result.borderSizes?.right}px | Total: ${borderTotal}px`);
          
          if (result.hasBorders && (!bestResult || borderTotal > bestResult.totalBorders)) {
            bestResult = { ...result, threshold, totalBorders: borderTotal };
          }
        } catch (error) {
          console.log(`  Threshold ${threshold.toString().padStart(3)}: ❌ Error - ${error.message}`);
        }
      }
      
      if (bestResult) {
        console.log(`\n🏆 Best detection with threshold ${bestResult.threshold}:`);
        console.log(`   Borders: T${bestResult.borderSizes?.top}px B${bestResult.borderSizes?.bottom}px L${bestResult.borderSizes?.left}px R${bestResult.borderSizes?.right}px`);
        
        // Process with best settings
        const result = await processImage(imagePath, {
          outputPath: path.join(outputDir, `cropped_${path.basename(imagePath, path.extname(imagePath))}.png`),
          threshold: bestResult.threshold,
          minBorderSize: 1,
          quality: 95
        });
        
        if (result.success) {
          console.log(`✅ Success: ${result.message}`);
          console.log(`   Output: ${result.outputPath}`);
        } else {
          console.log(`❌ Processing failed: ${result.message}`);
        }
      } else {
        console.log(`\n❌ No borders detected with any threshold. Saving original for manual inspection.`);
        
        // Save original for debugging
        const debugOrigPath = path.join(debugDir, `original_${path.basename(imagePath, path.extname(imagePath))}.png`);
        if (path.extname(imagePath).toLowerCase() === '.pdf') {
          await fs.promises.writeFile(debugOrigPath, imageBuffer);
        } else {
          const converted = await sharp(imageBuffer).png().toBuffer();
          await fs.promises.writeFile(debugOrigPath, converted);
        }
        console.log(`💾 Saved original for inspection: ${debugOrigPath}`);
        
        // Create a grayscale version to see what the algorithm sees
        const grayscale = await sharp(imageBuffer).grayscale().png().toBuffer();
        const grayscalePath = path.join(debugDir, `grayscale_${path.basename(imagePath, path.extname(imagePath))}.png`);
        await fs.promises.writeFile(grayscalePath, grayscale);
        console.log(`💾 Saved grayscale version: ${grayscalePath}`);
      }
      
    } catch (error) {
      console.error(`❌ Error processing ${path.basename(imagePath)}:`, error.message);
    }
  }
  
  console.log(`\n🎉 Processing complete!`);
  console.log(`📁 Check outputs: ${outputDir}`);
  console.log(`🔍 Check debug files: ${debugDir}`);
}

// Run the test
testRealImages().catch(console.error); 