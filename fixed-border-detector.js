const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

// Fixed border detection algorithm
async function detectBordersFixed(imageBuffer, options = {}) {
  const {
    threshold = 30,
    minBorderSize = 1,
    maxScanDepth = 50 // How deep to scan for borders
  } = options;

  try {
    // Convert to grayscale for processing
    const { data, info } = await sharp(imageBuffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const { width, height } = info;
    console.log(`📏 Processing ${width}x${height} image with threshold ${threshold}`);
    
    // Enhanced edge scanning that handles white borders around black borders
    const borders = await scanEdgesWithWhiteBorderHandling(data, width, height, threshold, maxScanDepth);
    
    // Validate minimum border size
    const borderSizes = {
      top: borders.top,
      bottom: height - 1 - borders.bottom,
      left: borders.left,
      right: width - 1 - borders.right
    };
    
    const totalBorderSize = borderSizes.top + borderSizes.bottom + borderSizes.left + borderSizes.right;
    const hasBorders = totalBorderSize >= minBorderSize;
    
    if (hasBorders) {
      console.log(`✅ Borders detected: T${borderSizes.top} B${borderSizes.bottom} L${borderSizes.left} R${borderSizes.right}`);
    } else {
      console.log(`❌ No significant borders found (total: ${totalBorderSize}px, min: ${minBorderSize}px)`);
    }
    
    return {
      hasBorders,
      top: borders.top,
      bottom: borders.bottom,
      left: borders.left,
      right: borders.right,
      width: borders.right - borders.left + 1,
      height: borders.bottom - borders.top + 1,
      borderSizes,
      metadata: {
        originalSize: { width, height },
        algorithm: 'enhanced-white-border-aware'
      }
    };
    
  } catch (error) {
    console.error('Border detection failed:', error);
    throw error;
  }
}

async function scanEdgesWithWhiteBorderHandling(data, width, height, threshold, maxScanDepth) {
  console.log(`🔍 Scanning edges with white border handling...`);
  
  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  const minBlackRatio = 0.8; // Need 80% black pixels to consider a line as a border
  
  // Scan from top - look for first row with high black ratio
  for (let y = 0; y < Math.min(maxScanDepth, height); y++) {
    const blackRatio = getBlackRatioInRow(data, y, width, threshold);
    console.log(`  Top row ${y}: ${(blackRatio*100).toFixed(1)}% black`);
    
    if (blackRatio >= minBlackRatio) {
      // Found a mostly black row, this is likely the start of border
      // Now find where the border ends (where content starts)
      for (let contentY = y + 1; contentY < height; contentY++) {
        const contentBlackRatio = getBlackRatioInRow(data, contentY, width, threshold);
        if (contentBlackRatio < 0.5) { // Less than 50% black = content area
          top = contentY;
          console.log(`  📍 Top border found: rows ${y}-${contentY-1}, content starts at row ${contentY}`);
          break;
        }
      }
      break;
    }
  }
  
  // Scan from bottom - look for last row with high black ratio
  for (let y = height - 1; y >= Math.max(height - maxScanDepth, 0); y--) {
    const blackRatio = getBlackRatioInRow(data, y, width, threshold);
    console.log(`  Bottom row ${y}: ${(blackRatio*100).toFixed(1)}% black`);
    
    if (blackRatio >= minBlackRatio) {
      // Found a mostly black row, this is likely the end of border
      // Now find where the border starts (where content ends)
      for (let contentY = y - 1; contentY >= 0; contentY--) {
        const contentBlackRatio = getBlackRatioInRow(data, contentY, width, threshold);
        if (contentBlackRatio < 0.5) { // Less than 50% black = content area
          bottom = contentY;
          console.log(`  📍 Bottom border found: rows ${contentY+1}-${y}, content ends at row ${contentY}`);
          break;
        }
      }
      break;
    }
  }
  
  // Scan from left - look for first column with high black ratio
  for (let x = 0; x < Math.min(maxScanDepth, width); x++) {
    const blackRatio = getBlackRatioInColumn(data, x, width, height, top, bottom, threshold);
    console.log(`  Left col ${x}: ${(blackRatio*100).toFixed(1)}% black`);
    
    if (blackRatio >= minBlackRatio) {
      // Found a mostly black column, this is likely the start of border
      // Now find where the border ends (where content starts)
      for (let contentX = x + 1; contentX < width; contentX++) {
        const contentBlackRatio = getBlackRatioInColumn(data, contentX, width, height, top, bottom, threshold);
        if (contentBlackRatio < 0.5) { // Less than 50% black = content area
          left = contentX;
          console.log(`  📍 Left border found: cols ${x}-${contentX-1}, content starts at col ${contentX}`);
          break;
        }
      }
      break;
    }
  }
  
  // Scan from right - look for last column with high black ratio
  for (let x = width - 1; x >= Math.max(width - maxScanDepth, 0); x--) {
    const blackRatio = getBlackRatioInColumn(data, x, width, height, top, bottom, threshold);
    console.log(`  Right col ${x}: ${(blackRatio*100).toFixed(1)}% black`);
    
    if (blackRatio >= minBlackRatio) {
      // Found a mostly black column, this is likely the end of border
      // Now find where the border starts (where content ends)
      for (let contentX = x - 1; contentX >= 0; contentX--) {
        const contentBlackRatio = getBlackRatioInColumn(data, contentX, width, height, top, bottom, threshold);
        if (contentBlackRatio < 0.5) { // Less than 50% black = content area
          right = contentX;
          console.log(`  📍 Right border found: cols ${contentX+1}-${x}, content ends at col ${contentX}`);
          break;
        }
      }
      break;
    }
  }
  
  console.log(`📊 Final borders: top=${top}, bottom=${bottom}, left=${left}, right=${right}`);
  console.log(`📐 Content area: ${right-left+1}x${bottom-top+1}`);
  
  return { top, bottom, left, right };
}

function getBlackRatioInRow(data, y, width, threshold) {
  const startIdx = y * width;
  const endIdx = startIdx + width;
  let blackCount = 0;
  
  for (let i = startIdx; i < endIdx; i++) {
    if (data[i] <= threshold) {
      blackCount++;
    }
  }
  
  return blackCount / width;
}

function getBlackRatioInColumn(data, x, width, height, topRow, bottomRow, threshold) {
  let blackCount = 0;
  const totalRows = bottomRow - topRow + 1;
  
  for (let y = topRow; y <= bottomRow; y++) {
    const idx = y * width + x;
    if (data[idx] <= threshold) {
      blackCount++;
    }
  }
  
  return totalRows > 0 ? blackCount / totalRows : 0;
}

async function cropImageFixed(imageBuffer, borders) {
  const { top, bottom, left, right } = borders;
  const width = right - left + 1;
  const height = bottom - top + 1;
  
  console.log(`✂️ Cropping to: ${width}x${height} from (${left},${top})`);
  
  const croppedBuffer = await sharp(imageBuffer)
    .extract({ 
      left: left, 
      top: top, 
      width: width, 
      height: height 
    })
    .png()
    .toBuffer();
    
  return croppedBuffer;
}

// Test the fixed algorithm
async function testFixedDetection() {
  console.log('🚀 Testing FIXED border detection...');
  
  const documentPath = path.join(__dirname, 'test-images', 'document.png');
  const outputPath = path.join(__dirname, 'test-output', 'FIXED_cropped_document.png');
  
  try {
    // Load image
    const imageBuffer = await fs.readFile(documentPath);
    console.log(`📁 Loaded: ${documentPath}`);
    
    // Test multiple thresholds with the fixed algorithm
    const testThresholds = [10, 20, 30, 50];
    let bestResult = null;
    let maxBorderTotal = 0;
    
    for (const threshold of testThresholds) {
      console.log(`\n🎯 Testing threshold ${threshold}:`);
      
      const result = await detectBordersFixed(imageBuffer, {
        threshold: threshold,
        minBorderSize: 10,
        maxScanDepth: 100
      });
      
      if (result.hasBorders) {
        const borderTotal = result.borderSizes.top + result.borderSizes.bottom + 
                           result.borderSizes.left + result.borderSizes.right;
        
        if (borderTotal > maxBorderTotal) {
          bestResult = { ...result, threshold };
          maxBorderTotal = borderTotal;
        }
      }
    }
    
    if (bestResult) {
      console.log(`\n🎉 SUCCESS! Best result with threshold ${bestResult.threshold}:`);
      console.log(`   Detected borders: T${bestResult.borderSizes.top} B${bestResult.borderSizes.bottom} L${bestResult.borderSizes.left} R${bestResult.borderSizes.right}`);
      console.log(`   Content area: ${bestResult.width}x${bestResult.height}`);
      
      // Crop the image
      const croppedBuffer = await cropImageFixed(imageBuffer, bestResult);
      
      // Save result
      await fs.writeFile(outputPath, croppedBuffer);
      console.log(`✅ FIXED image saved to: ${outputPath}`);
      
    } else {
      console.log('❌ Still no borders detected even with fixed algorithm');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the test
testFixedDetection().catch(console.error); 