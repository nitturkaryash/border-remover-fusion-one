const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const pdf2pic = require('pdf2pic');

async function forcePortraitPdf() {
  console.log('🔄 Testing forced portrait orientation...');
  
  // Specific PDF file to test
  const pdfPath = path.join(__dirname, 'test-images', '2410205455_76634_Part3.pdf');
  const outputDir = path.join(__dirname, 'test-output', 'portrait-fix');
  
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (error) {
    // Directory exists
  }
  
  console.log(`📄 Processing PDF: ${pdfPath}`);
  
  try {
    // Step 1: Convert PDF to image
    console.log('1️⃣ Converting PDF to image');
    const converter = pdf2pic.fromPath(pdfPath, {
      density: 300,
      format: "png",
      quality: 100,
      saveFilename: "temp"
    });
    
    const result = await converter(1, { responseType: 'base64' });
    if (!result || !result.base64) {
      throw new Error('PDF conversion failed');
    }
    
    // Step 2: Convert base64 to buffer
    console.log('2️⃣ Decoding base64 to buffer');
    const imageBuffer = Buffer.from(result.base64, 'base64');
    
    // Step 3: Check orientation and fix if needed
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`3️⃣ Image dimensions: ${metadata.width}x${metadata.height}`);
    console.log(`   Current orientation: ${metadata.width > metadata.height ? 'LANDSCAPE' : 'PORTRAIT'}`);
    
    // Step 4: Force portrait if needed
    let processedBuffer = imageBuffer;
    if (metadata.width > metadata.height) {
      console.log('4️⃣ Rotating to portrait orientation');
      processedBuffer = await sharp(imageBuffer)
        .rotate(90, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .toBuffer();
        
      const newMeta = await sharp(processedBuffer).metadata();
      console.log(`   New dimensions: ${newMeta.width}x${newMeta.height}`);
      console.log(`   New orientation: ${newMeta.width > newMeta.height ? 'LANDSCAPE' : 'PORTRAIT'}`);
    } else {
      console.log('4️⃣ Already in portrait orientation');
    }
    
    // Step 5: Remove any borders in the image
    console.log('5️⃣ Detecting and removing borders');
    const finalBuffer = await sharp(processedBuffer)
      .trim()
      .toBuffer();
      
    const finalMeta = await sharp(finalBuffer).metadata();
    console.log(`   Final dimensions: ${finalMeta.width}x${finalMeta.height}`);
    
    // Step 6: Save the result
    const outputPath = path.join(outputDir, 'portrait_fixed.png');
    await fs.writeFile(outputPath, finalBuffer);
    console.log(`✅ Saved output to: ${outputPath}`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    console.error(error);
  }
}

forcePortraitPdf().catch(error => {
  console.error('Test failed:', error);
}); 