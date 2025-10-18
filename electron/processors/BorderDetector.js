// electron/processors/BorderDetector.js
// Comprehensive image processing module for detecting and removing black borders from scanned documents
// Features: Advanced border detection, memory management, batch processing, and robust error handling

const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const PdfKitDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument } = require('pdf-lib');
const logger = require('../utils/logger');
const pdf2pic = require('pdf2pic');

// Configuration constants
const CONFIG = {
  // Detection thresholds
  BLACK_THRESHOLD: 30,          // Pixels with intensity ≤ 30 considered black (very aggressive for thick gray borders)
  MIN_BORDER_SIZE: 1,           // Minimum border size in pixels to detect (very sensitive)
  MAX_MEMORY_USAGE: 500 * 1024 * 1024, // 500MB memory limit
  
  // Performance settings
  CHUNK_SIZE: 2048,              // Process large images in chunks
  MAX_DIMENSION: 10000,          // Maximum image dimension to prevent memory issues
  TIMEOUT_MS: 30000,             // 30 second timeout per image
  
  // File handling
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB max file size
  SUPPORTED_FORMATS: ['jpeg', 'jpg', 'png', 'tiff', 'tif', 'webp'],
  
  // Output settings - MAXIMUM QUALITY
  QUALITY: 100,                  // JPEG quality for output (maximum quality)
  COMPRESSION: 0                 // PNG compression level (no compression for maximum quality)
};

// Add PDF to supported formats
CONFIG.SUPPORTED_FORMATS.push('pdf');

const DEFAULT_OUTPUT_ROOT = path.join(os.homedir(), 'BlackBorderRemover', 'processed');

function getRunOutputDirectory(runTimestamp = new Date()) {
  const iso = runTimestamp.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const [datePart, timePart] = iso.split('T');
  const folderName = timePart ? `${datePart}_${timePart}` : datePart;
  return path.join(DEFAULT_OUTPUT_ROOT, folderName);
}

/**
 * Advanced border detection using multi-pass algorithm
 * Handles noisy, uneven, and partial borders from poor scanning conditions
 * @param {Buffer} imageBuffer - The image buffer
 * @param {object} options - Detection options
 * @returns {Promise<object>} - Border coordinates and metadata
 */
async function detectBorders(imageBuffer, options = {}) {
  const startTime = Date.now();
  const {
    threshold = CONFIG.BLACK_THRESHOLD,
    minBorderSize = CONFIG.MIN_BORDER_SIZE,
    noiseReduction = true,
    edgeRefinement = true
  } = options;

  try {
    logger.info('[BorderDetector] Starting border detection...');
    
    // Handle image orientation properly while preserving EXIF data
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const { width, height, format, orientation } = metadata;
    
    // Validate image dimensions
    if (width > CONFIG.MAX_DIMENSION || height > CONFIG.MAX_DIMENSION) {
      throw new Error(`Image too large: ${width}x${height}. Max: ${CONFIG.MAX_DIMENSION}x${CONFIG.MAX_DIMENSION}`);
    }
    
    logger.info(`[BorderDetector] Processing ${width}x${height} ${format} image (orientation: ${orientation || 'none'})`);
    
    // Convert to grayscale for processing - keep original orientation
    const { data, info } = await image
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
    // Initial border detection with edge scanning
    let borders = await scanEdgesForBorders(data, width, height, threshold);
    
    // Apply noise reduction if enabled
    if (noiseReduction) {
      borders = await applyNoiseReduction(data, width, height, borders, threshold);
    }
    
    // Refine edges for better accuracy
    if (edgeRefinement) {
      borders = await refineEdges(data, width, height, borders, threshold);
    }
    
    // Validate minimum border size
    const finalBorders = validateBorderSize(borders, minBorderSize, width, height);
    
    const processingTime = Date.now() - startTime;
    logger.info(`[BorderDetector] Border detection completed in ${processingTime}ms`);
    
    return {
      ...finalBorders,
      metadata: {
        originalSize: { width, height },
        processingTime,
        algorithm: 'multi-pass-edge-scan',
        settings: { threshold, minBorderSize, noiseReduction, edgeRefinement }
      }
    };
    
  } catch (error) {
    logger.error('[BorderDetector] Border detection failed:', error);
    throw new Error(`Border detection failed: ${error.message}`);
  }
}

/**
 * Scans image edges to detect black borders
 * @param {Buffer} data - Grayscale image data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} threshold - Black pixel threshold
 * @returns {Promise<object>} - Border coordinates
 */
async function scanEdgesForBorders(data, width, height, threshold) {
  logger.info(`[BorderDetector] Scanning edges for black borders (enhanced detection)... Image: ${width}x${height}, threshold: ${threshold}`);
  
  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  const minBlackRatio = 0.8; // Need 80% black pixels to consider a line as a border
  const maxScanDepth = Math.min(100, Math.floor(Math.min(width, height) * 0.3)); // Scan up to 30% of image dimension
  
  logger.info(`[BorderDetector] Using enhanced detection with minBlackRatio: ${minBlackRatio} (${minBlackRatio*100}%), maxScanDepth: ${maxScanDepth}`);

  // Enhanced top border detection - look for mostly black rows first
  for (let y = 0; y < Math.min(maxScanDepth, height); y++) {
    const blackRatio = 1 - await getNonBlackRatioInRow(data, y, width, threshold);
    if (y < 10 || y % Math.floor(height/10) === 0) { // Log first 10 rows and every 10%
      logger.info(`[BorderDetector] Row ${y}: black ratio = ${(blackRatio*100).toFixed(1)}%`);
    }
    
    if (blackRatio >= minBlackRatio) {
      // Found a mostly black row, find where border ends (content starts)
      for (let contentY = y + 1; contentY < height; contentY++) {
        const contentBlackRatio = 1 - await getNonBlackRatioInRow(data, contentY, width, threshold);
        if (contentBlackRatio < 0.5) { // Less than 50% black = content area
          top = contentY;
          logger.info(`[BorderDetector] Found top border: rows ${y}-${contentY-1}, content starts at row ${contentY}`);
          break;
        }
      }
      break;
    }
  }
  
  // Enhanced bottom border detection - look for mostly black rows from bottom
  for (let y = height - 1; y >= Math.max(height - maxScanDepth, 0); y--) {
    const blackRatio = 1 - await getNonBlackRatioInRow(data, y, width, threshold);
    if (blackRatio >= minBlackRatio) {
      // Found a mostly black row, find where border starts (content ends)
      for (let contentY = y - 1; contentY >= 0; contentY--) {
        const contentBlackRatio = 1 - await getNonBlackRatioInRow(data, contentY, width, threshold);
        if (contentBlackRatio < 0.5) { // Less than 50% black = content area
          bottom = contentY;
          logger.info(`[BorderDetector] Found bottom border: rows ${contentY+1}-${y}, content ends at row ${contentY}`);
          break;
        }
      }
      break;
    }
  }
  
  // Enhanced left border detection - look for mostly black columns from left
  for (let x = 0; x < Math.min(maxScanDepth, width); x++) {
    const blackRatio = 1 - await getNonBlackRatioInColumn(data, x, width, height, top, bottom, threshold);
    if (blackRatio >= minBlackRatio) {
      // Found a mostly black column, find where border ends (content starts)
      for (let contentX = x + 1; contentX < width; contentX++) {
        const contentBlackRatio = 1 - await getNonBlackRatioInColumn(data, contentX, width, height, top, bottom, threshold);
        if (contentBlackRatio < 0.5) { // Less than 50% black = content area
          left = contentX;
          logger.info(`[BorderDetector] Found left border: cols ${x}-${contentX-1}, content starts at col ${contentX}`);
          break;
        }
      }
      break;
    }
  }
  
  // Enhanced right border detection - look for mostly black columns from right
  for (let x = width - 1; x >= Math.max(width - maxScanDepth, 0); x--) {
    const blackRatio = 1 - await getNonBlackRatioInColumn(data, x, width, height, top, bottom, threshold);
    if (blackRatio >= minBlackRatio) {
      // Found a mostly black column, find where border starts (content ends)
      for (let contentX = x - 1; contentX >= 0; contentX--) {
        const contentBlackRatio = 1 - await getNonBlackRatioInColumn(data, contentX, width, height, top, bottom, threshold);
        if (contentBlackRatio < 0.5) { // Less than 50% black = content area
          right = contentX;
          logger.info(`[BorderDetector] Found right border: cols ${contentX+1}-${x}, content ends at col ${contentX}`);
          break;
        }
      }
      break;
    }
  }
  
  logger.info(`[BorderDetector] Initial scan results: top=${top}, bottom=${bottom}, left=${left}, right=${right}`);
  logger.info(`[BorderDetector] Border sizes: top=${top}px, bottom=${height-1-bottom}px, left=${left}px, right=${width-1-right}px`);
  logger.info(`[BorderDetector] Content area: ${right-left+1}x${bottom-top+1} (${Math.round((right-left+1)/(width)*100)}% x ${Math.round((bottom-top+1)/(height)*100)}%)`);
  return { top, bottom, left, right };
}

/**
 * Calculates the ratio of non-black pixels in a row
 */
async function getNonBlackRatioInRow(data, y, width, threshold) {
  const startIdx = y * width;
  const endIdx = startIdx + width;
  let nonBlackCount = 0;
  
  for (let i = startIdx; i < endIdx; i++) {
    if (data[i] > threshold) {
      nonBlackCount++;
    }
  }
  
  return nonBlackCount / width;
}

/**
 * Calculates the ratio of non-black pixels in a column within the specified row range
 */
async function getNonBlackRatioInColumn(data, x, width, height, topRow, bottomRow, threshold) {
  let nonBlackCount = 0;
  const totalRows = bottomRow - topRow + 1;
  
  for (let y = topRow; y <= bottomRow; y++) {
    const idx = y * width + x;
    if (data[idx] > threshold) {
      nonBlackCount++;
    }
  }
  
  return totalRows > 0 ? nonBlackCount / totalRows : 0;
}

/**
 * Applies noise reduction to improve border detection accuracy
 * Uses morphological operations and statistical analysis
 */
async function applyNoiseReduction(data, width, height, borders, threshold) {
  logger.info('[BorderDetector] Applying noise reduction...');
  
  const { top, bottom, left, right } = borders;
  const noiseThreshold = 0.1; // 10% noise tolerance
  
  // Analyze border regions for noise
  const topNoise = await analyzeRegionNoise(data, width, 0, top, 0, width, threshold);
  const bottomNoise = await analyzeRegionNoise(data, width, bottom, height, 0, width, threshold);
  const leftNoise = await analyzeRegionNoise(data, width, top, bottom, 0, left, threshold);
  const rightNoise = await analyzeRegionNoise(data, width, top, bottom, right, width, threshold);
  
  // Adjust borders based on noise analysis
  let adjustedBorders = { top, bottom, left, right };
  
  if (topNoise > noiseThreshold) {
    adjustedBorders.top = Math.max(0, top - 2);
  }
  if (bottomNoise > noiseThreshold) {
    adjustedBorders.bottom = Math.min(height - 1, bottom + 2);
  }
  if (leftNoise > noiseThreshold) {
    adjustedBorders.left = Math.max(0, left - 2);
  }
  if (rightNoise > noiseThreshold) {
    adjustedBorders.right = Math.min(width - 1, right + 2);
  }
  
  return adjustedBorders;
}

/**
 * Analyzes noise level in a specific region
 */
async function analyzeRegionNoise(data, width, startY, endY, startX, endX, threshold) {
  let totalPixels = 0;
  let noisePixels = 0;
  
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = y * width + x;
      totalPixels++;
      
      // Consider pixels slightly above threshold as potential noise
      if (data[idx] > threshold && data[idx] < threshold * 2) {
        noisePixels++;
      }
    }
  }
  
  return totalPixels > 0 ? noisePixels / totalPixels : 0;
}

/**
 * Refines edge detection for sub-pixel accuracy
 */
async function refineEdges(data, width, height, borders, threshold) {
  logger.info('[BorderDetector] Refining edge detection...');
  
  // Use gradient analysis for more precise edge detection
  const refinedBorders = { ...borders };
  const gradientThreshold = threshold * 0.5;
  
  // Refine top edge
  for (let y = Math.max(0, borders.top - 5); y <= Math.min(height - 1, borders.top + 5); y++) {
    const gradient = await calculateRowGradient(data, y, width, threshold);
    if (gradient > gradientThreshold) {
      refinedBorders.top = y;
      break;
    }
  }
  
  // Refine bottom edge
  for (let y = Math.min(height - 1, borders.bottom + 5); y >= Math.max(0, borders.bottom - 5); y--) {
    const gradient = await calculateRowGradient(data, y, width, threshold);
    if (gradient > gradientThreshold) {
      refinedBorders.bottom = y;
      break;
    }
  }
  
  // Refine left edge
  for (let x = Math.max(0, borders.left - 5); x <= Math.min(width - 1, borders.left + 5); x++) {
    const gradient = await calculateColumnGradient(data, x, width, height, threshold);
    if (gradient > gradientThreshold) {
      refinedBorders.left = x;
      break;
    }
  }
  
  // Refine right edge
  for (let x = Math.min(width - 1, borders.right + 5); x >= Math.max(0, borders.right - 5); x--) {
    const gradient = await calculateColumnGradient(data, x, width, height, threshold);
    if (gradient > gradientThreshold) {
      refinedBorders.right = x;
      break;
    }
  }
  
  return refinedBorders;
}

/**
 * Calculates gradient intensity for a row
 */
async function calculateRowGradient(data, y, width, threshold) {
  let gradientSum = 0;
  const rowStart = y * width;
  
  for (let x = 1; x < width - 1; x++) {
    const current = data[rowStart + x];
    const prev = data[rowStart + x - 1];
    const next = data[rowStart + x + 1];
    
    gradientSum += Math.abs(current - prev) + Math.abs(current - next);
  }
  
  return gradientSum / (width - 2);
}

/**
 * Calculates gradient intensity for a column
 */
async function calculateColumnGradient(data, x, width, height, threshold) {
  let gradientSum = 0;
  
  for (let y = 1; y < height - 1; y++) {
    const current = data[y * width + x];
    const prev = data[(y - 1) * width + x];
    const next = data[(y + 1) * width + x];
    
    gradientSum += Math.abs(current - prev) + Math.abs(current - next);
  }
  
  return gradientSum / (height - 2);
}

/**
 * Validates and adjusts border size based on minimum requirements
 */
function validateBorderSize(borders, minBorderSize, width, height) {
  const { top, bottom, left, right } = borders;
  
  // Check if detected borders meet minimum size requirements
  const topBorder = top;
  const bottomBorder = height - 1 - bottom;
  const leftBorder = left;
  const rightBorder = width - 1 - right;
  
  const hasBorders = 
    topBorder >= minBorderSize ||
    bottomBorder >= minBorderSize ||
    leftBorder >= minBorderSize ||
    rightBorder >= minBorderSize;
  
  // Calculate crop dimensions with padding to ensure complete border removal
  const padding = 2; // Add small padding to ensure borders are completely removed
  const cropLeft = Math.max(0, Math.max(0, left - padding));
  const cropTop = Math.max(0, Math.max(0, top - padding));
  const cropWidth = Math.max(1, Math.min(width - cropLeft, right - cropLeft + 1 + padding * 2));
  const cropHeight = Math.max(1, Math.min(height - cropTop, bottom - cropTop + 1 + padding * 2));
  
  return {
    top: cropTop,
    left: cropLeft,
    width: cropWidth,
    height: cropHeight,
    hasBorders,
    borderSizes: {
      top: topBorder,
      bottom: bottomBorder,
      left: leftBorder,
      right: rightBorder
    },
    originalDimensions: { width, height },
    croppedDimensions: { width: cropWidth, height: cropHeight }
  };
}

/**
 * Crops an image based on detected borders
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {object} borders - Border coordinates from detectBorders
 * @param {object} options - Cropping options
 * @returns {Promise<Buffer>} - Cropped image buffer
 */
async function cropImage(imageBuffer, borders, options = {}) {
  const startTime = Date.now();
  const { 
    quality = CONFIG.QUALITY, 
    compression = CONFIG.COMPRESSION,
    rotateFinalOutput = false,
    preserveOrientation = true  // Add new option to preserve orientation
  } = options;
  
  try {
    logger.info('[BorderDetector] Starting image cropping...');
    
    // Handle image orientation properly during cropping
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    
    logger.info(`[BorderDetector] Cropping image with orientation: ${metadata.orientation || 'none'}`);
    
    // Validate crop parameters against original image dimensions
    if (borders.left < 0 || borders.top < 0 || 
        borders.width <= 0 || borders.height <= 0 ||
        borders.left + borders.width > metadata.width ||
        borders.top + borders.height > metadata.height) {
      logger.error('[BorderDetector] Invalid crop parameters:', {
        borders,
        metadataWidth: metadata.width,
        metadataHeight: metadata.height
      });
      throw new Error('Invalid crop parameters');
    }
    
    // Configure output - extract borders without rotating content
    let pipeline = image
      .extract({
        left: borders.left,
        top: borders.top,
        width: borders.width,
        height: borders.height
      });
    
    // Apply final rotation if needed (for PDFs that should display as portrait)
    // But only if preserveOrientation is false
    if (rotateFinalOutput && !preserveOrientation) {
      logger.info(`[BorderDetector] Applying 90° rotation to final output for portrait display`);
      pipeline = pipeline.rotate(90);
    }
    
    // Apply format-specific optimization based on desired output format
    const outputFormat = options.outputFormat || 'original';
    
    if (outputFormat === 'original') {
      // Use original format with maximum quality
      switch (metadata.format) {
        case 'jpeg':
          pipeline = pipeline.jpeg({ 
            quality, 
            progressive: true,
            mozjpeg: true // Use mozjpeg encoder for better quality
          });
          break;
        case 'png':
          pipeline = pipeline.png({ 
            compressionLevel: compression, 
            progressive: true,
            palette: false, // Avoid palette compression for better quality
            quality: 100    // Maximum PNG quality
          });
          break;
        case 'tiff':
          pipeline = pipeline.tiff({ 
            compression: 'none', // No compression for maximum quality
            quality: 100
          });
          break;
        case 'webp':
          pipeline = pipeline.webp({ 
            quality: 100, 
            lossless: true, // Use lossless WebP for maximum quality
            effort: 6       // Maximum compression effort
          });
          break;
        default:
          // For unknown formats, save as high-quality PNG
          pipeline = pipeline.png({ 
            compressionLevel: 0, 
            progressive: true,
            palette: false,
            quality: 100
          });
          break;
      }
    } else {
      // Convert to specified format
      switch (outputFormat) {
        case 'png':
          pipeline = pipeline.png({ 
            compressionLevel: compression, 
            progressive: true,
            palette: false,
            quality: 100
          });
          break;
        case 'jpg':
        case 'jpeg':
          pipeline = pipeline.jpeg({ 
            quality, 
            progressive: true,
            mozjpeg: true
          });
          break;
        case 'tiff':
          pipeline = pipeline.tiff({ 
            compression: 'none',
            quality: 100
          });
          break;
        case 'webp':
          pipeline = pipeline.webp({ 
            quality: 100, 
            lossless: true,
            effort: 6
          });
          break;
        case 'pdf':
          // For PDF output, convert to PNG first (PDFs will be handled separately)
          pipeline = pipeline.png({ 
            compressionLevel: 0, 
            progressive: true,
            palette: false,
            quality: 100
          });
          break;
        case 'svg':
          // For SVG output, convert to PNG first (SVGs will be handled separately)
          pipeline = pipeline.png({ 
            compressionLevel: 0, 
            progressive: true,
            palette: false,
            quality: 100
          });
          break;
        default:
          // Default to PNG for unknown formats
          pipeline = pipeline.png({ 
            compressionLevel: 0, 
            progressive: true,
            palette: false,
            quality: 100
          });
          break;
      }
    }
    
    const croppedBuffer = await pipeline.toBuffer();
    
    const processingTime = Date.now() - startTime;
    logger.info(`[BorderDetector] Image cropping completed in ${processingTime}ms`);
    
    return croppedBuffer;
    
  } catch (error) {
    logger.error('[BorderDetector] Image cropping failed:', error);
    throw new Error(`Image cropping failed: ${error.message}`);
  }
}

/**
 * Generates output file path with organized folder structure and format conversion
 * @param {string} originalPath - Original file path
 * @param {object} options - Path generation options
 * @returns {string} - Generated output path
 */
function generateOutputPath(originalPath, options = {}) {
  const { 
    outputDir = null,
    preserveStructure = false,
    suffix = '_cropped',
    outputFormat = 'original'
  } = options;
  
  const addTimestamp = options.addTimestamp ?? (outputDir ? false : true);
  
  const dir = outputDir || path.dirname(originalPath);
  const originalExt = path.extname(originalPath);
  const name = path.basename(originalPath, originalExt);
  
  let finalDir = dir;
  
  if (addTimestamp) {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    finalDir = path.join(dir, `${timestamp}_processed`);
  }
  
  // Determine output extension based on format
  let outputExt = originalExt;
  if (outputFormat !== 'original') {
    switch (outputFormat) {
      case 'png':
        outputExt = '.png';
        break;
      case 'jpg':
      case 'jpeg':
        outputExt = '.jpg';
        break;
      case 'pdf':
        outputExt = '.pdf';
        break;
      case 'svg':
        outputExt = '.svg';
        break;
      default:
        outputExt = originalExt;
    }
  }
  
  const fileName = `${name}${suffix}${outputExt}`;
  return path.join(finalDir, fileName);
}

/**
 * Ensures output directory exists with proper permissions
 * @param {string} filePath - File path to create directory for
 */
async function ensureOutputDirectory(filePath) {
  const dir = path.dirname(filePath);
  
  try {
    await fs.access(dir);
    logger.info(`[BorderDetector] Output directory exists: ${dir}`);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    logger.info(`[BorderDetector] Created output directory: ${dir}`);
  }
}

/**
 * Converts the first page of a PDF to a PNG buffer
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<Buffer>} - PNG image buffer of the first page
 */
async function convertPdfToImageBuffer(pdfPath) {
  logger.info(`[BorderDetector-PDF] Attempting to convert PDF: ${pdfPath}`);
  
  // Check if file exists and is readable
  try {
    await fs.access(pdfPath, fs.constants.R_OK);
    const stats = await fs.stat(pdfPath);
    logger.info(`[BorderDetector-PDF] PDF file accessible, size: ${(stats.size / 1024).toFixed(1)}KB`);
  } catch (accessError) {
    logger.error(`[BorderDetector-PDF] Cannot access PDF file: ${accessError.message}`);
    throw new Error(`PDF file not accessible: ${accessError.message}`);
  }

  try {
    // Use pdf2pic v3.x API with fromPath method
    logger.info('[BorderDetector-PDF] Initializing pdf2pic converter with fromPath method...');
    
    // Force a portrait orientation to maintain the document's original orientation
    // This is critical for proper document viewing - MAXIMUM QUALITY SETTINGS
    const converter = pdf2pic.fromPath(pdfPath, {
      density: 300, // Balanced DPI to keep size reasonable while maintaining clarity
      format: "png",
      quality: 90,
      // savePath: "./temp_pdf_conversion", // Temporary path, not used for base64
      // saveFilename: "temp_pdf_page",
      // Critical: Force preservation of PDF orientation as it appears in viewer
      preserveOrientation: true,
      autoOrient: false,
      // Use higher resolution dimensions for better quality
      width: 1190,  // Double standard A4 width for higher resolution
      height: 1684  // Double standard A4 height for higher resolution
    });
    
    logger.info('[BorderDetector-PDF] pdf2pic converter initialized with portrait orientation');

    logger.info('[BorderDetector-PDF] Converter initialized. Attempting to convert page 1...');
    
    // Convert page 1 to base64 using pdf2pic v3.x API
    // Try different approaches for pdf2pic v3.x
    let result;
    
    try {
      // Method 1: Direct call with responseType base64
      result = await converter(1, { responseType: 'base64' });
      logger.info('[BorderDetector-PDF] Used converter with responseType base64');
    } catch (error1) {
      logger.warn('[BorderDetector-PDF] Method 1 failed, trying alternative...', error1.message);
      
      try {
        // Method 2: Direct call without options
        result = await converter(1);
        logger.info('[BorderDetector-PDF] Used converter without options');
      } catch (error2) {
        logger.warn('[BorderDetector-PDF] Method 2 failed, trying bulk method...', error2.message);
        
        try {
          // Method 3: Try bulk conversion
          const bulkResult = await converter.bulk(1, { responseType: 'base64' });
          result = Array.isArray(bulkResult) ? bulkResult[0] : bulkResult;
          logger.info('[BorderDetector-PDF] Used bulk converter method');
        } catch (error3) {
          logger.error('[BorderDetector-PDF] All conversion methods failed:', {
            method1: error1.message,
            method2: error2.message,
            method3: error3.message
          });
          throw new Error(`PDF conversion failed with all methods: ${error1.message}`);
        }
      }
    }
    
    logger.info('[BorderDetector-PDF] PDF page conversion completed successfully');

    logger.info(`[BorderDetector-PDF] Raw conversion result type: ${typeof result}`, {
      hasBase64: !!(result && result.base64),
      resultKeys: result ? Object.keys(result) : 'null',
      resultLength: result && result.base64 ? result.base64.length : 'no base64'
    });

    // Handle different result formats
    let base64Data;
    
    if (result && result.base64) {
      base64Data = result.base64;
      logger.info('[BorderDetector-PDF] Found base64 in result.base64');
    } else if (result && typeof result === 'string') {
      base64Data = result;
      logger.info('[BorderDetector-PDF] Using result as direct base64 string');
    } else if (result && result.data) {
      base64Data = result.data;
      logger.info('[BorderDetector-PDF] Found base64 in result.data');
    } else {
      logger.error('[BorderDetector-PDF] No base64 data found in result:', result);
      throw new Error('PDF conversion succeeded but no base64 data was returned. This might indicate a Ghostscript issue.');
    }

    if (!base64Data || base64Data.length === 0) {
      logger.error('[BorderDetector-PDF] Base64 data is empty. This might mean:');
      logger.error('[BorderDetector-PDF] 1. PDF has no visual content (text-only PDF)');
      logger.error('[BorderDetector-PDF] 2. Ghostscript cannot render this PDF');
      logger.error('[BorderDetector-PDF] 3. PDF file is corrupted or invalid');
      logger.error('[BorderDetector-PDF] PDF size info:', result?.size || 'no size info');
      throw new Error('PDF conversion returned empty base64 data - PDF might be text-only or corrupted');
    }

    logger.info(`[BorderDetector-PDF] PDF page 1 converted successfully. Base64 length: ${base64Data.length}`);
    
    // Validate base64 data
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length === 0) {
        throw new Error('Base64 decode resulted in empty buffer');
      }
      logger.info(`[BorderDetector-PDF] Base64 decoded to ${buffer.length} bytes`);
      return buffer;
    } catch (decodeError) {
      logger.error(`[BorderDetector-PDF] Base64 decode failed: ${decodeError.message}`);
      throw new Error(`Invalid base64 data from PDF conversion: ${decodeError.message}`);
    }

  } catch (error) {
    logger.error(`[BorderDetector-PDF] Complete error details for ${pdfPath}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Provide more specific error messages
    if (error.message.includes('spawn') || error.message.includes('ENOENT')) {
      logger.error('[BorderDetector-PDF] This appears to be a Ghostscript installation issue.');
      logger.error('[BorderDetector-PDF] On macOS, install with: brew install ghostscript');
      logger.error('[BorderDetector-PDF] Then restart the application.');
      throw new Error('Ghostscript not found. Install with: brew install ghostscript');
    } else if (error.message.includes('PDF')) {
      logger.error('[BorderDetector-PDF] This might be a PDF file issue or Ghostscript compatibility problem.');
      throw new Error(`PDF processing failed: ${error.message}. Check if the PDF file is valid and not corrupted.`);
    } else {
      logger.error('[BorderDetector-PDF] Unknown error during PDF conversion.');
      throw new Error(`PDF to image conversion failed: ${error.message}`);
    }
  }
}

/**
 * Validates file before processing
 * @param {string} filePath - Path to the file
 * @returns {Promise<object>} - Validation result
 */
async function validateFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > CONFIG.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File too large: ${(stats.size / (1024 * 1024)).toFixed(1)}MB. Max: ${CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB`
      };
    }
    const ext = path.extname(filePath).toLowerCase().slice(1);
    if (!CONFIG.SUPPORTED_FORMATS.includes(ext)) {
      return {
        valid: false,
        error: `Unsupported format: ${ext}. Supported: ${CONFIG.SUPPORTED_FORMATS.join(', ')}`
      };
    }
    // For PDFs, check if at least 1 page exists (optional, for now just accept)
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `File access error: ${error.message}`
    };
  }
}

/**
 * Processes a single image with comprehensive error handling and memory management
 * @param {string} imagePath - Path to the image file
 * @param {object} options - Processing options
 * @returns {Promise<object>} - Processing result
 */
async function processImage(imagePath, options = {}) {
  const startTime = Date.now();
  const {
    threshold = CONFIG.BLACK_THRESHOLD,
    preserveOriginal = true,
    outputPath = null,
    timeout = CONFIG.TIMEOUT_MS,
    signal // AbortSignal
  } = options;
  const runTimestamp = options.runTimestamp instanceof Date ? options.runTimestamp : new Date();
  const runDate = runTimestamp.toISOString().split('T')[0];

  const ext = path.extname(imagePath).toLowerCase().slice(1);
  const isPdf = ext === 'pdf';

  // DEBUG: Add unique call tracking
  const callId = `processImage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info(`[DEBUG-${callId}] processImage called for ${path.basename(imagePath)} with outputFormat: ${options.outputFormat}`);

  // Create timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Processing timeout')), timeout);
  });

  // Main processing promise
  const processingPromise = async () => {
    try {
      if (signal && signal.aborted) {
        logger.info(`[BorderDetector] Processing of ${imagePath} aborted before start.`);
        throw new Error('Processing aborted by signal');
      }
      logger.info(`[BorderDetector] Starting to process: ${imagePath}`, { outputFormat: options.outputFormat });
      const validation = await validateFile(imagePath);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      let imageBuffer, imageMeta;
      if (isPdf) {
        logger.info(`[BorderDetector] Detected PDF, converting first page to image: ${imagePath}`);
        try {
          if (signal && signal.aborted) throw new Error('PDF conversion aborted by signal');
          
          // First convert the PDF to an image buffer
          imageBuffer = await convertPdfToImageBuffer(imagePath);
          imageMeta = await sharp(imageBuffer).metadata();
          logger.info(`[BorderDetector] PDF page converted. Initial dimensions: ${imageMeta.width}x${imageMeta.height}`);
          
          // CRITICAL FIX: Always force portrait orientation for documents
          // This ensures the document appears as it would in a PDF viewer
          if (imageMeta.width > imageMeta.height) {
            logger.info(`[BorderDetector] Forcing portrait orientation for document`);
            imageBuffer = await sharp(imageBuffer)
              .rotate(90, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
              .toBuffer();
            
            // Update metadata after rotation
            imageMeta = await sharp(imageBuffer).metadata();
            logger.info(`[BorderDetector] Document rotated to portrait. New dimensions: ${imageMeta.width}x${imageMeta.height}`);
          } else {
            logger.info(`[BorderDetector] Document already in portrait orientation`);
          }
          
          logger.info(`[BorderDetector] Processing document with correct orientation`);
        } catch (conversionError) {
          logger.error(`[BorderDetector] PDF to Image conversion failed for ${imagePath}: ${conversionError.message}`);
          throw conversionError;
        }
      } else {
        imageBuffer = await fs.readFile(imagePath);
        // Don't auto-rotate to prevent distortion
        imageMeta = await sharp(imageBuffer).metadata();
      }
      logger.info(`[BorderDetector] Image loaded: ${imageMeta.format || ''}`);
      // Detect borders
      const borderData = await detectBorders(imageBuffer, { threshold });
      const outputFormat = options.outputFormat || 'original';
      if (!borderData.hasBorders) {
        logger.info(`[BorderDetector] No significant borders detected: ${imagePath}`);
        
        // Still save the original image to output folder for user reference
        let finalOutputPath;
        const defaultPdfDir = path.join(path.dirname(imagePath), `${runDate}_processed`);
        const baseOutputDir = options.outputDir || defaultPdfDir;
        if (outputPath) {
          finalOutputPath = outputPath;
        } else if (isPdf) {
          const base = path.basename(imagePath, path.extname(imagePath));
          if (outputFormat === 'pdf') {
            finalOutputPath = path.join(baseOutputDir, `${base}_page1_processed.pdf`);
          } else {
            finalOutputPath = path.join(baseOutputDir, `${base}_page1_processed.png`);
          }
        } else {
          finalOutputPath = generateOutputPath(imagePath, { suffix: '_processed', outputFormat, outputDir: baseOutputDir, addTimestamp: false });
        }
        
        await ensureOutputDirectory(finalOutputPath);
        if (isPdf && outputFormat === 'pdf') {
          // Copy the PDF file
          await fs.copyFile(imagePath, finalOutputPath);
        } else {
          await fs.writeFile(finalOutputPath, imageBuffer);
        }
        logger.info(`[BorderDetector] Saved original image (no borders found): ${finalOutputPath}`);
    
    return {
      success: true,
      originalPath: imagePath,
          processedPath: finalOutputPath,
          cropped: false,
          message: 'No borders detected - original saved',
          processingTime: Date.now() - startTime,
          metadata: { originalSize: imageMeta, borderData },
          isPdf
        };
      }
      logger.info(`[BorderDetector] Borders detected, cropping to: ${borderData.width}x${borderData.height}`);
      // Only rotate if explicitly needed - in most cases we want to preserve original orientation
      const shouldRotateForPdf = false; // Disable automatic rotation to preserve orientation
      const croppedBuffer = await cropImage(imageBuffer, borderData, { 
        rotateFinalOutput: shouldRotateForPdf,
        preserveOrientation: true, // Always preserve original orientation
        outputFormat: options.outputFormat
      });
      // Generate output path
      let finalOutputPath;
      const baseOutputDir = options.outputDir || path.join(path.dirname(imagePath), `${runDate}_processed`);
      if (outputPath) {
        finalOutputPath = outputPath;
      } else if (isPdf) {
        const base = path.basename(imagePath, path.extname(imagePath));
        
        // Determine file extension based on outputFormat, defaulting to png
        let extension = `.${options.outputFormat || 'png'}`;
        if (options.outputFormat === 'original' || options.outputFormat === 'pdf') {
          extension = '.pdf';
        } else if (options.outputFormat === 'jpg') {
          extension = '.jpeg';
        }

        finalOutputPath = path.join(baseOutputDir, `${base}_page1_cropped${extension}`);
      } else {
        finalOutputPath = generateOutputPath(imagePath, { outputFormat: options.outputFormat, outputDir: baseOutputDir, addTimestamp: false });
      }
      await ensureOutputDirectory(finalOutputPath);
      let outputBuffer = croppedBuffer;
      let actualOutputFormat = options.outputFormat || 'original';
      let wroteFileDirectly = false;
      let processedSize = null;

      if (actualOutputFormat === 'pdf') {
        try {
          logger.info('[BorderDetector] Attempting vector-aware PDF crop via page boxes');
          await cropPdfVector(imagePath, finalOutputPath, borderData);
          wroteFileDirectly = true;
          processedSize = (await fs.stat(finalOutputPath)).size;
          logger.info('[BorderDetector] Vector crop succeeded, PDF saved without rasterization.');
        } catch (vectorError) {
          logger.error('[BorderDetector] Vector PDF cropping failed, falling back to raster export:', vectorError);
          // Convert cropped buffer to high-quality JPEG to keep PDF size manageable
          const pdfImageQuality = Math.min(Math.max(options.pdfQuality ?? 85, 10), 95);
          const pdfImageBuffer = await sharp(croppedBuffer)
            .jpeg({
              quality: pdfImageQuality,
              mozjpeg: true,
              chromaSubsampling: '4:4:4'
            })
            .toBuffer();
          outputBuffer = await createRasterizedPdf(pdfImageBuffer, borderData, imagePath);
          processedSize = outputBuffer.length;
          logger.info(`[BorderDetector] Raster PDF fallback size: ${(processedSize / 1024).toFixed(1)}KB`);
        }
      } else if (options.outputFormat === 'svg') {
        // Wrap cropped PNG in an SVG <image> element
        const svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${borderData.width}" height="${borderData.height}">\n  <image href=\"data:image/png;base64,${croppedBuffer.toString('base64')}\" width=\"${borderData.width}\" height=\"${borderData.height}\"/>\n</svg>`;
        outputBuffer = Buffer.from(svgContent, 'utf8');
      }
      if (!wroteFileDirectly) {
        await fs.writeFile(finalOutputPath, outputBuffer);
        processedSize = processedSize ?? outputBuffer.length;
      }
      const processingTime = Date.now() - startTime;
      logger.info(`[BorderDetector] Successfully processed ${imagePath} in ${processingTime}ms - Final output: ${finalOutputPath} (${actualOutputFormat} format)`);
      logger.info(`[DEBUG-${callId}] processImage completed for ${path.basename(imagePath)}`);
      return {
        success: true,
        originalPath: imagePath,
        processedPath: finalOutputPath,
      cropped: true,
        borderData,
        originalSize: imageMeta,
        newSize: { width: borderData.width, height: borderData.height },
        processingTime,
        fileSize: {
          original: imageBuffer.length,
          processed: processedSize ?? 0
        },
        isPdf
      };
    } catch (error) {
      logger.error(`[BorderDetector] Error processing ${imagePath}:`, error);
      return {
        success: false,
        originalPath: imagePath,
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  };
  try {
    return await Promise.race([processingPromise(), timeoutPromise]);
  } catch (error) {
    logger.error(`[BorderDetector] Processing failed for ${imagePath}:`, error);
    return {
      success: false,
      originalPath: imagePath,
      error: error.message,
      processingTime: Date.now() - startTime
    };
  }
}

/**
 * Processes multiple images in batch with progress tracking and error recovery
 * @param {string[]} imagePaths - Array of image file paths
 * @param {object} options - Processing options
 * @param {function} progressCallback - Progress callback function
 * @returns {Promise<object>} - Batch processing results
 */
async function processBatch(imagePaths, options = {}, progressCallback = null) {
  const startTime = Date.now();
  const {
    maxConcurrent = 3,
    continueOnError = true,
    outputDir = null,
    signal // AbortSignal from AbortController
  } = options;
  const runTimestamp = options.runTimestamp instanceof Date ? options.runTimestamp : new Date();
  const resolvedOutputDir = outputDir || getRunOutputDirectory(runTimestamp);
  try {
    await fs.mkdir(resolvedOutputDir, { recursive: true });
    logger.info(`[BorderDetector] Output directory prepared: ${resolvedOutputDir}`);
  } catch (dirError) {
    logger.error('[BorderDetector] Failed to prepare output directory:', dirError);
    throw new Error(`Unable to prepare output directory: ${dirError.message}`);
  }
  
  // DEBUG: Add unique batch call tracking
  const batchId = `processBatch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  logger.info(`[DEBUG-${batchId}] processBatch called with ${imagePaths.length} files, outputFormat: ${options.outputFormat}`);
  
  logger.info(`[BorderDetector] Starting batch processing of ${imagePaths.length} images with options:`, {
    outputFormat: options.outputFormat,
    maxConcurrent,
    totalFiles: imagePaths.length
  });
  
  // Validate batch size
  if (imagePaths.length > 500) {
    throw new Error(`Batch size too large: ${imagePaths.length}. Maximum: 500 images`);
  }
  
  const results = [];
  const errors = [];
  let processed = 0;
  let successful = 0;
  let cropped = 0;
  
  // Process images in chunks to manage memory
  for (let i = 0; i < imagePaths.length; i += maxConcurrent) {
    if (signal && signal.aborted) {
      logger.info('[BorderDetector] Batch processing aborted by signal.');
      break; // Exit loop if aborted
    }
    const chunk = imagePaths.slice(i, i + maxConcurrent);
    
    // Process chunk concurrently
    const chunkPromises = chunk.map(async (imagePath) => {
      if (signal && signal.aborted) {
        logger.info(`[BorderDetector] Skipping ${imagePath} due to abort signal.`);
        return { 
          success: false, 
          originalPath: imagePath, 
          error: 'Processing aborted', 
          aborted: true 
        };
      }
      // Pass the abort signal down to processImage if it can use it (currently uses timeout)
      const result = await processImage(imagePath, { ...options, outputDir: resolvedOutputDir, signal }); 
      
      if (result.success) {
        successful++;
        if (result.cropped) cropped++;
      } else {
        errors.push({
          file: imagePath,
          error: result.error,
          timestamp: new Date().toISOString()
        });
      }
      
      processed++;
      
      // Report progress
      if (progressCallback) {
        const progress = Math.round((processed / imagePaths.length) * 100);
        progressCallback({
          progress,
          processed,
          total: imagePaths.length,
          successful,
          errors: errors.length,
          currentFile: path.basename(imagePath),
          phase: 'processing'
        });
      }
      
      return result;
    });
    
    // Wait for chunk to complete
    const chunkResults = await Promise.allSettled(chunkPromises);
    
    // Collect results
    chunkResults.forEach((settlementResult) => {
      if (settlementResult.status === 'fulfilled') {
        results.push(settlementResult.value);
      } else {
        const error = {
          file: 'unknown',
          error: settlementResult.reason?.message || 'Unknown error',
          timestamp: new Date().toISOString()
        };
        errors.push(error);
        logger.error('[BorderDetector] Chunk processing error:', settlementResult.reason);
      }
    });
    
    // Memory cleanup between chunks
    if (global.gc) {
      global.gc();
    }
  }
  
  const totalTime = Date.now() - startTime;
  
  // Final progress report
  if (progressCallback) {
    progressCallback({
      progress: 100,
      processed: imagePaths.length,
      total: imagePaths.length,
      successful,
      errors: errors.length,
      currentFile: null,
      phase: 'complete'
    });
  }
  
  const summary = {
    total: imagePaths.length,
    successful,
    failed: errors.length,
    cropped,
    processingTime: totalTime,
    averageTime: totalTime / imagePaths.length,
    memoryUsage: process.memoryUsage()
  };
  
  logger.info(`[BorderDetector] Batch processing complete: ${successful}/${imagePaths.length} successful, ${cropped} cropped, ${errors.length} errors in ${totalTime}ms`);
  
  return {
    results,
    errors,
    summary
  };
}

const clampValue = (value, min, max) => Math.min(Math.max(value, min), max);

async function cropPdfVector(originalPdfPath, outputPdfPath, borderData) {
  const pdfBytes = await fs.readFile(originalPdfPath);
  const pdfDoc = await PdfLibDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new Error('PDF has no pages to crop');
  }
  const page = pages[0];
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const originalDims = borderData.originalDimensions || borderData.metadata?.originalSize;
  if (!originalDims?.width || !originalDims?.height) {
    throw new Error('Missing original dimensions for vector PDF cropping');
  }

  const pixelWidth = originalDims.width;
  const pixelHeight = originalDims.height;

  const leftPx = borderData.left ?? borderData.borderSizes?.left ?? 0;
  const topPx = borderData.top ?? borderData.borderSizes?.top ?? 0;
  const cropWidthPx = borderData.width ?? (pixelWidth - leftPx - (borderData.borderSizes?.right ?? 0));
  const cropHeightPx = borderData.height ?? (pixelHeight - topPx - (borderData.borderSizes?.bottom ?? 0));
  const bottomPx = Math.max(pixelHeight - (topPx + cropHeightPx), 0);

  const toPdfX = (px) => (px / pixelWidth) * pageWidth;
  const toPdfY = (px) => (px / pixelHeight) * pageHeight;

  let x = toPdfX(leftPx);
  let y = toPdfY(bottomPx);
  let w = toPdfX(cropWidthPx);
  let h = toPdfY(cropHeightPx);

  const minSize = 0.5;
  x = clampValue(x, 0, Math.max(pageWidth - minSize, 0));
  y = clampValue(y, 0, Math.max(pageHeight - minSize, 0));
  w = clampValue(w, minSize, pageWidth - x);
  h = clampValue(h, minSize, pageHeight - y);

  page.setMediaBox(x, y, w, h);
  page.setCropBox(x, y, w, h);
  page.setTrimBox(x, y, w, h);
  page.setBleedBox(x, y, w, h);

  const croppedPdfBytes = await pdfDoc.save();
  await fs.writeFile(outputPdfPath, croppedPdfBytes);
}

async function createRasterizedPdf(imageBuffer, borderData, sourcePdfPath = null) {
  let widthPoints = borderData.width;
  let heightPoints = borderData.height;

  if (sourcePdfPath) {
    try {
      const { width: pageWidth, height: pageHeight } = await getPdfPageSize(sourcePdfPath);
      const originalDims = borderData.originalDimensions || borderData.metadata?.originalSize;
      if (originalDims?.width && originalDims?.height) {
        widthPoints = clampValue(
          (borderData.width / originalDims.width) * pageWidth,
          1,
          pageWidth
        );
        heightPoints = clampValue(
          (borderData.height / originalDims.height) * pageHeight,
          1,
          pageHeight
        );
      }
    } catch (err) {
      logger.warn('[BorderDetector] Using pixel dimensions for raster PDF fallback size due to page size lookup failure.', err);
    }
  }

  const doc = new PdfKitDocument({
    size: [widthPoints, heightPoints],
    margin: 0
  });

  const pdfChunks = [];

  return await new Promise((resolve, reject) => {
    doc.on('data', chunk => pdfChunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(pdfChunks)));
    doc.on('error', reject);

    doc.image(imageBuffer, 0, 0, {
      width: widthPoints,
      height: heightPoints,
      align: 'center',
      valign: 'center'
    });
    doc.end();
  });
}

async function getPdfPageSize(pdfPath) {
  const pdfBytes = await fs.readFile(pdfPath);
  const pdfDoc = await PdfLibDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new Error('PDF has no pages');
  }
  return pages[0].getSize();
}

// Export the enhanced border detection module
module.exports = { 
  detectBorders,
  cropImage,
  processImage, 
  processBatch, 
  generateOutputPath,
  validateFile,
  CONFIG
};
