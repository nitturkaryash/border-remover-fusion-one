const pdf2pic = require('pdf2pic');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

async function debugPdfOrientation() {
  console.log('🔍 Debugging PDF orientation issue...');
  
  const pdfPath = path.join(__dirname, 'test-images', '2410205455_76634_Part3.pdf');
  const outputDir = path.join(__dirname, 'debug-output');
  
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (e) {
    // Directory exists
  }
  
  console.log(`📄 Testing PDF: ${pdfPath}`);
  
  // Test different conversion settings
  const testConfigs = [
    {
      name: 'Current_Fixed',
      config: {
        density: 300,
        format: "png",
        quality: 100
      }
    },
    {
      name: 'No_Size_Limit_High_DPI',
      config: {
        density: 600,
        format: "png",
        quality: 100
      }
    },
    {
      name: 'Standard_DPI',
      config: {
        density: 150,
        format: "png",
        quality: 100
      }
    },
    {
      name: 'Portrait_Friendly',
      config: {
        density: 300,
        format: "png",
        quality: 100,
        // Try to force portrait if the library supports it
        height: 1400, // Tall
        width: 1000   // Narrow
      }
    }
  ];
  
  for (const testConfig of testConfigs) {
    console.log(`\n🧪 Testing configuration: ${testConfig.name}`);
    console.log(`   Config:`, testConfig.config);
    
    try {
      const converter = pdf2pic.fromPath(pdfPath, {
        ...testConfig.config,
        savePath: outputDir,
        saveFilename: `test_${testConfig.name}`
      });
      
      // Convert page 1
      const result = await converter(1, { responseType: 'base64' });
      
      let base64Data;
      if (result && result.base64) {
        base64Data = result.base64;
      } else if (result && typeof result === 'string') {
        base64Data = result;
      } else if (result && result.data) {
        base64Data = result.data;
      } else {
        console.log(`   ❌ No base64 data returned`);
        continue;
      }
      
      // Convert to buffer and analyze
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const metadata = await sharp(imageBuffer).metadata();
      
      console.log(`   📏 Result: ${metadata.width}x${metadata.height} (${metadata.width > metadata.height ? 'landscape' : 'portrait'})`);
      console.log(`   📊 Aspect ratio: ${(metadata.width / metadata.height).toFixed(3)}`);
      
      // Save for inspection
      const debugPath = path.join(outputDir, `debug_${testConfig.name}.png`);
      await fs.writeFile(debugPath, imageBuffer);
      console.log(`   💾 Saved: ${debugPath}`);
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  // Also try to get PDF info directly
  console.log(`\n📋 Trying to get PDF metadata...`);
  try {
    const pdfBuffer = await fs.readFile(pdfPath);
    console.log(`   PDF file size: ${(pdfBuffer.length / 1024).toFixed(1)}KB`);
    
    // Try a simple conversion to see raw dimensions
    const simpleConverter = pdf2pic.fromPath(pdfPath, {
      density: 72, // Very low DPI to see basic dimensions
      format: "png"
    });
    
    const simpleResult = await simpleConverter(1, { responseType: 'base64' });
    if (simpleResult && simpleResult.base64) {
      const simpleBuffer = Buffer.from(simpleResult.base64, 'base64');
      const simpleMeta = await sharp(simpleBuffer).metadata();
      console.log(`   📐 PDF native dimensions (72 DPI): ${simpleMeta.width}x${simpleMeta.height}`);
      console.log(`   📊 PDF aspect ratio: ${(simpleMeta.width / simpleMeta.height).toFixed(3)}`);
      
      // Calculate what the dimensions should be at higher DPI
      const ratio = simpleMeta.width / simpleMeta.height;
      console.log(`   💡 Expected at 300 DPI: portrait should be ~${Math.round(300/72 * simpleMeta.height)}px tall`);
    }
    
  } catch (error) {
    console.log(`   ❌ PDF metadata error: ${error.message}`);
  }
  
  console.log(`\n🎯 Analysis complete! Check debug files in: ${outputDir}`);
}

// Run the debug
debugPdfOrientation().catch(console.error); 