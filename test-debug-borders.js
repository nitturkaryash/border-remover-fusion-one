const { processImage, detectBorders } = require('./electron/processors/BorderDetector');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

async function debugBorderDetection() {
  console.log('🔍 Debugging border detection...');
  
  const testDir = path.join(__dirname, 'test-images');
  const outputDir = path.join(__dirname, 'test-output');
  const debugDir = path.join(__dirname, 'debug-output');
  
  // Create directories
  [outputDir, debugDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
  });
  
  // Find the document image
  const documentPath = path.join(testDir, 'document.png');
  
  if (!fs.existsSync(documentPath)) {
    console.log('❌ document.png not found in test-images folder');
    return;
  }
  
  console.log('📁 Processing: document.png');
  
  try {
    // Load the image
    const imageBuffer = await fs.promises.readFile(documentPath);
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`📏 Image dimensions: ${metadata.width}x${metadata.height}`);
    
    // Save original for debugging
    const debugOrigPath = path.join(debugDir, 'original.png');
    await fs.promises.writeFile(debugOrigPath, imageBuffer);
    console.log(`💾 Saved original: ${debugOrigPath}`);
    
    // Create grayscale version to see what the algorithm sees
    const grayscale = await sharp(imageBuffer).grayscale().raw().toBuffer({ resolveWithObject: true });
    const grayscaleImageBuffer = await sharp(imageBuffer).grayscale().png().toBuffer();
    const grayscalePath = path.join(debugDir, 'grayscale.png');
    await fs.promises.writeFile(grayscalePath, grayscaleImageBuffer);
    console.log(`💾 Saved grayscale: ${grayscalePath}`);
    
    // Analyze pixel intensities
    console.log('\n🔍 Analyzing pixel intensities...');
    const { data, info } = grayscale;
    const { width, height } = info;
    
    // Sample different areas of the image
    const samples = [
      { name: 'Top-left corner', x: 10, y: 10 },
      { name: 'Left edge (middle)', x: 10, y: Math.floor(height/2) },
      { name: 'Bottom-left corner', x: 10, y: height - 10 },
      { name: 'Bottom edge (middle)', x: Math.floor(width/2), y: height - 10 },
      { name: 'Center of image', x: Math.floor(width/2), y: Math.floor(height/2) },
      { name: 'Top edge (middle)', x: Math.floor(width/2), y: 10 },
      { name: 'Right edge (middle)', x: width - 10, y: Math.floor(height/2) }
    ];
    
    samples.forEach(sample => {
      const idx = sample.y * width + sample.x;
      const intensity = data[idx];
      console.log(`  ${sample.name}: ${intensity} (${intensity < 30 ? 'BLACK' : intensity < 100 ? 'DARK' : intensity < 200 ? 'GRAY' : 'WHITE'})`);
    });
    
    // Test multiple thresholds with detailed output
    console.log('\n🎯 Testing detection thresholds:');
    const testThresholds = [5, 10, 15, 20, 30, 50, 80, 120, 150, 200];
    
    let bestResult = null;
    let maxBorderTotal = 0;
    
    for (const threshold of testThresholds) {
      try {
        const result = await detectBorders(imageBuffer, {
          threshold: threshold,
          minBorderSize: 1,
          noiseReduction: false, // Disable for cleaner debugging
          edgeRefinement: false
        });
        
        const borderTotal = (result.borderSizes?.top || 0) + 
                          (result.borderSizes?.bottom || 0) + 
                          (result.borderSizes?.left || 0) + 
                          (result.borderSizes?.right || 0);
        
        const status = result.hasBorders ? '✅' : '❌';
        const borders = `T${result.borderSizes?.top || 0} B${result.borderSizes?.bottom || 0} L${result.borderSizes?.left || 0} R${result.borderSizes?.right || 0}`;
        
        console.log(`  Threshold ${threshold.toString().padStart(3)}: ${status} | ${borders} | Total: ${borderTotal}px`);
        
        if (result.hasBorders && borderTotal > maxBorderTotal) {
          bestResult = { ...result, threshold };
          maxBorderTotal = borderTotal;
        }
      } catch (error) {
        console.log(`  Threshold ${threshold.toString().padStart(3)}: ❌ Error - ${error.message}`);
      }
    }
    
    // Manual edge scanning with very low threshold
    console.log('\n🔬 Manual edge analysis with threshold 10:');
    await manualEdgeAnalysis(data, width, height, 10);
    
    if (bestResult) {
      console.log(`\n🏆 Best detection found with threshold ${bestResult.threshold}:`);
      console.log(`   Top: ${bestResult.borderSizes.top}px`);
      console.log(`   Bottom: ${bestResult.borderSizes.bottom}px`);
      console.log(`   Left: ${bestResult.borderSizes.left}px`);
      console.log(`   Right: ${bestResult.borderSizes.right}px`);
      
      // Process with best settings
      console.log(`\n🎯 Processing with threshold ${bestResult.threshold}...`);
      const result = await processImage(documentPath, {
        outputPath: path.join(outputDir, 'cropped_document.png'),
        threshold: bestResult.threshold,
        minBorderSize: 1,
        quality: 95
      });
      
      if (result.success) {
        console.log(`✅ Success! Output saved to: ${result.outputPath || result.processedPath}`);
      } else {
        console.log(`❌ Processing failed: ${result.message || result.error}`);
      }
    } else {
      console.log('\n❌ No borders detected with any threshold!');
      console.log('This suggests the image might not have the expected black borders,');
      console.log('or the detection algorithm needs adjustment.');
    }
    
  } catch (error) {
    console.error('❌ Error during debugging:', error);
  }
}

async function manualEdgeAnalysis(data, width, height, threshold) {
  // Check first few rows
  console.log('  Top edge analysis:');
  for (let y = 0; y < Math.min(10, height); y++) {
    let blackPixels = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (data[idx] <= threshold) {
        blackPixels++;
      }
    }
    const blackRatio = blackPixels / width;
    console.log(`    Row ${y}: ${(blackRatio * 100).toFixed(1)}% black (${blackPixels}/${width})`);
  }
  
  // Check last few rows
  console.log('  Bottom edge analysis:');
  for (let y = Math.max(0, height - 10); y < height; y++) {
    let blackPixels = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (data[idx] <= threshold) {
        blackPixels++;
      }
    }
    const blackRatio = blackPixels / width;
    console.log(`    Row ${y}: ${(blackRatio * 100).toFixed(1)}% black (${blackPixels}/${width})`);
  }
  
  // Check left edge
  console.log('  Left edge analysis:');
  for (let x = 0; x < Math.min(10, width); x++) {
    let blackPixels = 0;
    for (let y = 0; y < height; y++) {
      const idx = y * width + x;
      if (data[idx] <= threshold) {
        blackPixels++;
      }
    }
    const blackRatio = blackPixels / height;
    console.log(`    Col ${x}: ${(blackRatio * 100).toFixed(1)}% black (${blackPixels}/${height})`);
  }
  
  // Check right edge
  console.log('  Right edge analysis:');
  for (let x = Math.max(0, width - 10); x < width; x++) {
    let blackPixels = 0;
    for (let y = 0; y < height; y++) {
      const idx = y * width + x;
      if (data[idx] <= threshold) {
        blackPixels++;
      }
    }
    const blackRatio = blackPixels / height;
    console.log(`    Col ${x}: ${(blackRatio * 100).toFixed(1)}% black (${blackPixels}/${height})`);
  }
}

// Run the debug
debugBorderDetection().catch(console.error); 