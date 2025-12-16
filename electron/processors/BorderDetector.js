// electron/processors/BorderDetector.js
// Comprehensive image processing module for detecting and removing black borders from scanned documents
// Features: Advanced border detection, memory management, batch processing, and robust error handling

const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { promisify } = require('util');
const { execFile } = require('child_process');
const PdfKitDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument } = require('pdf-lib');
const logger = require('../utils/logger');
const execFileAsync = promisify(execFile);

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
  PDF_TIMEOUT_PER_PAGE: 10000,   // Extra timeout budget per additional PDF page
  
  // File handling
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB max file size
  SUPPORTED_FORMATS: ['jpeg', 'jpg', 'png', 'tiff', 'tif', 'webp'],
  
  // Output settings - MAXIMUM QUALITY
  QUALITY: 100,                  // JPEG quality for output (maximum quality)
  COMPRESSION: 4                 // Mild lossless PNG compression (keeps quality, trims ~5% size)
};

// Add PDF to supported formats
CONFIG.SUPPORTED_FORMATS.push('pdf');

// Ghostscript discovery (cross-platform)
const GHOSTSCRIPT_CANDIDATES = [
  process.env.GHOSTSCRIPT_PATH,
  process.env.GS_PATH,
  ...(process.platform === 'win32' ? ['gswin64c', 'gswin32c', 'gs'] : ['gs'])
].filter(Boolean);

let cachedGhostscriptBinary = null;

const DEFAULT_OUTPUT_ROOT = path.join(os.homedir(), 'BlackBorderRemover', 'processed');

class PdfPageOutOfRangeError extends Error {
  constructor(pageNumber) {
    super(`PDF page ${pageNumber} is out of range`);
    this.name = 'PdfPageOutOfRangeError';
    this.code = 'PDF_PAGE_OUT_OF_RANGE';
    this.pageNumber = pageNumber;
  }
}

const DEFAULT_PDF_DENSITY = 300;

async function resolveGhostscriptBinary() {
  if (cachedGhostscriptBinary) {
    return cachedGhostscriptBinary;
  }

  for (const candidate of GHOSTSCRIPT_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(candidate, ['-v']);
      const version = stdout?.split('\n')?.[0] || 'unknown';
      logger.info(`[BorderDetector-PDF] Found Ghostscript binary: ${candidate} (${version})`);
      cachedGhostscriptBinary = candidate;
      return candidate;
    } catch (error) {
      logger.debug?.(`[BorderDetector-PDF] Ghostscript candidate failed: ${candidate}`, { error: error.message });
    }
  }

  throw new Error('Ghostscript executable not found in PATH. Install Ghostscript and restart the app.');
}

async function renderPdfPageWithGhostscript(pdfPath, pageNumber, outputPath) {
  const ghostscriptBinary = await resolveGhostscriptBinary();
  const timeoutBudget = CONFIG.TIMEOUT_MS + CONFIG.PDF_TIMEOUT_PER_PAGE * Math.max(pageNumber - 1, 0);

  const args = [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    `-dFirstPage=${pageNumber}`,
    `-dLastPage=${pageNumber}`,
    '-sDEVICE=png16m',
    '-dTextAlphaBits=4',
    '-dGraphicsAlphaBits=4',
    `-r${DEFAULT_PDF_DENSITY}`,
    '-dUseCropBox',
    `-sOutputFile=${outputPath}`,
    pdfPath
  ];

  logger.info(`[BorderDetector-PDF] Running Ghostscript for page ${pageNumber}`, {
    binary: ghostscriptBinary,
    args
  });

  try {
    await execFileAsync(ghostscriptBinary, args, { timeout: timeoutBudget });
  } catch (error) {
    logger.error('[BorderDetector-PDF] Ghostscript conversion failed', {
      binary: ghostscriptBinary,
      args,
      error: error.message
    });

    if (error.code === 'ENOENT') {
      throw new Error('Ghostscript executable not found. Install Ghostscript and restart the app.');
    }

    throw new Error(`Ghostscript failed to render PDF page ${pageNumber}: ${error.message}`);
  }
}

function pixelsToPdfPoints(pixels, density = DEFAULT_PDF_DENSITY) {
  const safeDensity = Number.isFinite(density) && density > 0 ? density : DEFAULT_PDF_DENSITY;
  return Math.max((pixels / safeDensity) * 72, 1);
}

function derivePageSizeFromMetadata(meta) {
  if (!meta?.width || !meta?.height) {
    return null;
  }
  return {
    width: pixelsToPdfPoints(meta.width, meta.density),
    height: pixelsToPdfPoints(meta.height, meta.density)
  };
}

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
    
    // Convert to PNG for downstream PDF embedding (lossless, lightly compressed)
    const normalizedCompression = Math.min(Math.max(Number.isFinite(compression) ? compression : CONFIG.COMPRESSION, 0), 9);
    const croppedBuffer = await pipeline.png({ 
      compressionLevel: normalizedCompression, 
      adaptiveFiltering: true,
      progressive: true,
      palette: false,
      quality: 100
    }).toBuffer();
    
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
 * Converts a specific PDF page to a PNG buffer
 * @param {string} pdfPath - Path to the PDF file
 * @param {number} pageNumber - 1-based page index to convert
 * @returns {Promise<Buffer>} - PNG image buffer of the selected page
 */
async function convertPdfToImageBuffer(pdfPath, pageNumber = 1) {
  logger.info(`[BorderDetector-PDF] Attempting to convert PDF page ${pageNumber}: ${pdfPath}`);
  
  // Check if file exists and is readable
  try {
    await fs.access(pdfPath);
    const stats = await fs.stat(pdfPath);
    logger.info(`[BorderDetector-PDF] PDF file accessible, size: ${(stats.size / 1024).toFixed(1)}KB`);
  } catch (accessError) {
    logger.error(`[BorderDetector-PDF] Cannot access PDF file: ${accessError.message}`);
    throw new Error(`PDF file not accessible: ${accessError.message}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbr-gs-'));
  const outputPath = path.join(tempDir, `page-${pageNumber}.png`);

  try {
    await renderPdfPageWithGhostscript(pdfPath, pageNumber, outputPath);

    const outputStats = await fs.stat(outputPath).catch(() => null);
    if (!outputStats || outputStats.size === 0) {
      logger.warn(`[BorderDetector-PDF] Page ${pageNumber} produced no output PNG (size=${outputStats?.size || 0})`);
      if (pageNumber > 1) {
        throw new PdfPageOutOfRangeError(pageNumber);
      }
      throw new Error('Ghostscript returned no image data for the first page. The PDF may be empty or unsupported.');
    }

    const buffer = await fs.readFile(outputPath);
    if (!buffer || buffer.length === 0) {
      throw new Error('Ghostscript returned empty PNG data.');
    }

    logger.info(`[BorderDetector-PDF] PDF page ${pageNumber} converted successfully. Buffer length: ${buffer.length}`);
    return buffer;
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
      logger.error('[BorderDetector-PDF] On Windows, install the Ghostscript 64-bit build and verify with: gswin64c -version');
      logger.error('[BorderDetector-PDF] Then restart the application.');
      throw new Error('Ghostscript not found. Install Ghostscript and verify gs/gswin64c is on PATH.');
    } else if (error.message.includes('PDF')) {
      logger.error('[BorderDetector-PDF] This might be a PDF file issue or Ghostscript compatibility problem.');
      throw new Error(`PDF processing failed: ${error.message}. Check if the PDF file is valid and not corrupted.`);
    } else {
      logger.error('[BorderDetector-PDF] Unknown error during PDF conversion.');
      throw new Error(`PDF to image conversion failed: ${error.message}`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function getPdfPageSizes(pdfPath) {
  const pdfBytes = await fs.readFile(pdfPath);
  const pdfDoc = await PdfLibDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new Error('PDF has no pages');
  }
  return pages.map((page, index) => {
    const { width, height } = page.getSize();
    return { width, height, pageNumber: index + 1 };
  });
}

async function buildRasterPageImage(pageEntry, { quality, scale = 1, grayscale = false } = {}) {
  const safeQuality = Math.min(Math.max(Math.round(quality ?? 85), 5), 95);
  const safeScale = Math.min(Math.max(scale, 0.05), 1);
  const baseWidth = pageEntry?.borderData?.width || pageEntry?.croppedMeta?.width || pageEntry?.imageMeta?.width || 1000;
  const baseHeight = pageEntry?.borderData?.height || pageEntry?.croppedMeta?.height || pageEntry?.imageMeta?.height || 1000;
  const targetWidth = Math.max(Math.round(baseWidth * safeScale), 8);
  const targetHeight = Math.max(Math.round(baseHeight * safeScale), 8);

  let pipeline = sharp(pageEntry.croppedBuffer);

  if (safeScale < 0.999) {
    pipeline = pipeline.resize({
      width: targetWidth,
      height: targetHeight,
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  if (pageEntry?.croppedMeta?.hasAlpha) {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
  }

  if (grayscale || safeQuality <= 40) {
    pipeline = pipeline.grayscale();
  }

  return pipeline.jpeg({
    quality: safeQuality,
    mozjpeg: true,
    chromaSubsampling: '4:4:4',
    progressive: true
  }).toBuffer();
}

async function buildRasterPdfFromPageResults(pageEntries, { quality, scale = 1, grayscale = false, sourcePdfPath = null } = {}) {
  if (!Array.isArray(pageEntries) || pageEntries.length === 0) {
    throw new Error('No page entries provided for raster PDF generation');
  }

  const rasterPages = [];
  for (const pageEntry of pageEntries) {
    const imageBuffer = await buildRasterPageImage(pageEntry, { quality, scale, grayscale });
    rasterPages.push({
      imageBuffer,
      borderData: pageEntry.borderData,
      pageSize: pageEntry.pageSize,
      pageNumber: pageEntry.pageNumber
    });
  }

  return await createRasterizedPdf(rasterPages, sourcePdfPath);
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
  let cachedPdfPageSizes = null;
  let effectiveTimeout = timeout;

  if (isPdf) {
    try {
      cachedPdfPageSizes = await getPdfPageSizes(imagePath);
      const pdfPageCount = cachedPdfPageSizes.length || 1;
      const perPageBudget = options.pdfTimeoutPerPage ?? CONFIG.PDF_TIMEOUT_PER_PAGE;
      effectiveTimeout = Math.max(timeout, CONFIG.TIMEOUT_MS + Math.max(pdfPageCount - 1, 0) * perPageBudget);
      logger.info(`[BorderDetector] PDF metadata loaded: ${pdfPageCount} pages. Timeout budget set to ${effectiveTimeout}ms`);
    } catch (metaError) {
      const fallbackTimeout = CONFIG.TIMEOUT_MS * 4;
      effectiveTimeout = Math.max(timeout, fallbackTimeout);
      logger.warn(`[BorderDetector] Could not pre-read PDF page sizes for ${imagePath}: ${metaError.message}. Using fallback timeout ${effectiveTimeout}ms`);
      cachedPdfPageSizes = null;
    }
  }

  // DEBUG: Add unique call tracking
  const callId = `processImage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const enforcedOutputFormat = 'pdf';
  options.outputFormat = enforcedOutputFormat;
  logger.info(`[DEBUG-${callId}] processImage called for ${path.basename(imagePath)} with outputFormat: ${enforcedOutputFormat}`);

  // Create timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Processing timeout')), effectiveTimeout);
  });

  // Main processing promise
  const processingPromise = async () => {
    try {
      if (signal && signal.aborted) {
        logger.info(`[BorderDetector] Processing of ${imagePath} aborted before start.`);
        throw new Error('Processing aborted by signal');
      }
      logger.info(`[BorderDetector] Starting to process: ${imagePath}`, { outputFormat: enforcedOutputFormat });
      const validation = await validateFile(imagePath);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Track original file size so final exports never exceed it
      const originalFileStats = await fs.stat(imagePath);
      const originalFileSize = originalFileStats.size;
      const pdfQualitySetting = Math.min(Math.max(options.pdfQuality ?? 85, 10), 95);

      if (isPdf) {
        return await processPdfDocument({
          imagePath,
          threshold,
          outputPath,
          outputDir: options.outputDir,
          runDate,
          originalFileSize,
          pdfQualitySetting,
          enforcedOutputFormat,
          callId,
          startTime,
          signal,
          pageSizeHints: cachedPdfPageSizes
        });
      }

      let imageBuffer = await fs.readFile(imagePath);
      // Don't auto-rotate to prevent distortion
      let imageMeta = await sharp(imageBuffer).metadata();
      logger.info(`[BorderDetector] Image loaded: ${imageMeta.format || ''}`);
      // Detect borders
      const borderData = await detectBorders(imageBuffer, { threshold });
      const outputFormat = enforcedOutputFormat;
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
        outputFormat: enforcedOutputFormat
      });
      const croppedMeta = await sharp(croppedBuffer).metadata();
      const singlePageEntry = {
        pageNumber: 1,
        borderData,
        hasBorders: borderData.hasBorders,
        croppedBuffer,
        croppedMeta,
        imageMeta,
        pageSize: derivePageSizeFromMetadata(imageMeta)
      };
      // Generate output path
      let finalOutputPath;
      const baseOutputDir = options.outputDir || path.join(path.dirname(imagePath), `${runDate}_processed`);
      if (outputPath) {
        finalOutputPath = outputPath;
      } else if (isPdf) {
        const base = path.basename(imagePath, path.extname(imagePath));
        
        // Determine file extension based on outputFormat, defaulting to png
        let extension = '.pdf';

        finalOutputPath = path.join(baseOutputDir, `${base}_page1_cropped${extension}`);
      } else {
        finalOutputPath = generateOutputPath(imagePath, { outputFormat: enforcedOutputFormat, outputDir: baseOutputDir, addTimestamp: false });
      }
      await ensureOutputDirectory(finalOutputPath);
      let outputBuffer = croppedBuffer;
      let actualOutputFormat = enforcedOutputFormat;
      let wroteFileDirectly = false;
      let processedSize = null;

      if (actualOutputFormat === 'pdf') {
        if (isPdf) {
          try {
            logger.info('[BorderDetector] Attempting vector-aware PDF crop via page boxes');
            await cropPdfVector(imagePath, finalOutputPath, borderData);
            wroteFileDirectly = true;
            processedSize = (await fs.stat(finalOutputPath)).size;
            logger.info('[BorderDetector] Vector crop succeeded, PDF saved without rasterization.');

            if (processedSize > originalFileSize) {
              logger.warn(`[BorderDetector] Vector crop output (${processedSize} bytes) exceeds original file (${originalFileSize} bytes). Applying rasterized fallback to enforce size limit.`);
              const constrained = await enforcePdfSizeLimit({
                currentPdfBuffer: null,
                pageEntries: [singlePageEntry],
                sourcePdfPath: imagePath,
                targetBytes: originalFileSize,
                baseQuality: pdfQualitySetting
              });
              outputBuffer = constrained.buffer;
              processedSize = outputBuffer.length;
              wroteFileDirectly = false; // Overwrite with constrained buffer below
            }
          } catch (vectorError) {
            logger.error('[BorderDetector] Vector PDF cropping failed, falling back to raster export:', vectorError);
            const pdfImageBuffer = await sharp(croppedBuffer)
              .jpeg({
                quality: pdfQualitySetting,
                mozjpeg: true,
                chromaSubsampling: '4:4:4'
              })
              .toBuffer();
            const rasterEntry = {
              imageBuffer: pdfImageBuffer,
              borderData,
              pageSize: null,
              pageNumber: 1
            };
            outputBuffer = await createRasterizedPdf([rasterEntry], imagePath);
            processedSize = outputBuffer.length;
            logger.info(`[BorderDetector] Raster PDF fallback size: ${(processedSize / 1024).toFixed(1)}KB`);
          }
        } else {
          const pdfImageBuffer = await sharp(croppedBuffer)
            .jpeg({
              quality: pdfQualitySetting,
              mozjpeg: true,
              chromaSubsampling: '4:4:4'
            })
            .toBuffer();
          const rasterEntry = {
            imageBuffer: pdfImageBuffer,
            borderData,
            pageSize: derivePageSizeFromMetadata(imageMeta),
            pageNumber: 1
          };
          outputBuffer = await createRasterizedPdf([rasterEntry]);
          processedSize = outputBuffer.length;
        }
      }

      if (!wroteFileDirectly) {
        if (actualOutputFormat === 'pdf') {
          const constrained = await enforcePdfSizeLimit({
            currentPdfBuffer: outputBuffer,
            pageEntries: [singlePageEntry],
            sourcePdfPath: isPdf ? imagePath : null,
            targetBytes: originalFileSize,
            baseQuality: pdfQualitySetting
          });
          outputBuffer = constrained.buffer;
          processedSize = outputBuffer.length;
        }

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
          original: originalFileSize,
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

async function processPdfDocument({
  imagePath,
  threshold,
  outputPath,
  outputDir,
  runDate,
  originalFileSize,
  pdfQualitySetting,
  enforcedOutputFormat,
  callId,
  startTime,
  signal,
  pageSizeHints = null
}) {
  logger.info(`[DEBUG-${callId}] Multi-page PDF processing enabled for ${path.basename(imagePath)}`);
  const baseOutputDir = outputDir || path.join(path.dirname(imagePath), `${runDate}_processed`);

  let pagePlan = Array.isArray(pageSizeHints) && pageSizeHints.length
    ? pageSizeHints.map(({ width, height, pageNumber }) => ({ width, height, pageNumber }))
    : null;

  if (!pagePlan) {
    try {
      const discovered = await getPdfPageSizes(imagePath);
      pagePlan = discovered;
      logger.info(`[BorderDetector-PDF] Loaded ${pagePlan.length} page descriptors via pdf-lib.`);
    } catch (metaError) {
      logger.warn(`[BorderDetector-PDF] Unable to read page sizes via pdf-lib for ${path.basename(imagePath)}: ${metaError.message}. Falling back to sequential detection.`);
      pagePlan = null;
    }
  }

  const pageResults = [];

  const processSinglePage = async (pageInfo) => {
    if (signal && signal.aborted) {
      throw new Error('Processing aborted by signal');
    }

    const pageNumber = pageInfo.pageNumber;
    logger.info(`[BorderDetector-PDF] Processing page ${pageNumber}/${pagePlan ? pagePlan.length : '?'}`);
    let pageBuffer = await convertPdfToImageBuffer(imagePath, pageNumber);
    let pageMeta = await sharp(pageBuffer).metadata();

    if (pageMeta.width > pageMeta.height) {
      logger.info(`[BorderDetector-PDF] Page ${pageNumber}: rotating to portrait orientation`);
      pageBuffer = await sharp(pageBuffer)
        .rotate(90, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .toBuffer();
      pageMeta = await sharp(pageBuffer).metadata();
    }

    const borderData = await detectBorders(pageBuffer, { threshold });
    borderData.pageNumber = pageNumber;

    let croppedBuffer = pageBuffer;
    if (borderData.hasBorders) {
      logger.info(`[BorderDetector-PDF] Page ${pageNumber}: cropping to ${borderData.width}x${borderData.height}`);
      croppedBuffer = await cropImage(pageBuffer, borderData, {
        rotateFinalOutput: false,
        preserveOrientation: true,
        outputFormat: enforcedOutputFormat
      });
    } else {
      logger.info(`[BorderDetector-PDF] Page ${pageNumber}: no borders detected`);
    }

    const croppedMeta = await sharp(croppedBuffer).metadata();
    const resolvedPageSize = pageInfo.width && pageInfo.height
      ? { width: pageInfo.width, height: pageInfo.height }
      : derivePageSizeFromMetadata(pageMeta) || {
          width: pixelsToPdfPoints(borderData.width || pageMeta.width || 1),
          height: pixelsToPdfPoints(borderData.height || pageMeta.height || 1)
        };

    pageResults.push({
      pageNumber,
      borderData,
      hasBorders: !!borderData.hasBorders,
      croppedBuffer,
      croppedMeta,
      imageMeta: pageMeta,
      pageSize: resolvedPageSize
    });
  };

  if (pagePlan) {
    for (const pageInfo of pagePlan) {
      try {
        await processSinglePage(pageInfo);
      } catch (error) {
        if (error instanceof PdfPageOutOfRangeError) {
          logger.warn(`[BorderDetector-PDF] Page ${pageInfo.pageNumber} reported by metadata but converter returned out-of-range. Stopping at previous page.`);
          break;
        }
        throw error;
      }
    }
  } else {
    let pageNumber = 1;
    while (true) {
      const fallbackInfo = { pageNumber };
      try {
        await processSinglePage(fallbackInfo);
        pageNumber++;
      } catch (error) {
        if (error instanceof PdfPageOutOfRangeError) {
          if (pageNumber === 1) {
            throw new Error('Unable to read any pages from PDF. File may be corrupted or encrypted.');
          }
          logger.info(`[BorderDetector-PDF] Reached end of document at page ${pageNumber - 1}. Total pages processed: ${pageResults.length}`);
          break;
        }
        throw error;
      }
    }
  }

  const totalPages = pageResults.length;
  if (totalPages === 0) {
    throw new Error('No PDF pages could be processed. Document may be unsupported.');
  }

  const pagesWithBorders = pageResults.filter(page => page.hasBorders);
  const baseName = path.basename(imagePath, path.extname(imagePath));
  const processedSuffix = totalPages > 1 ? '_processed.pdf' : '_page1_processed.pdf';
  const croppedSuffix = totalPages > 1 ? '_cropped.pdf' : '_page1_cropped.pdf';
  const pageMetadata = pageResults.map(({ pageNumber, borderData }) => ({ pageNumber, borderData }));

  if (pagesWithBorders.length === 0) {
    const targetPath = outputPath || path.join(baseOutputDir, `${baseName}${processedSuffix}`);
    await ensureOutputDirectory(targetPath);
    await fs.copyFile(imagePath, targetPath);
    const processedSize = (await fs.stat(targetPath)).size;
    const processingTime = Date.now() - startTime;
    logger.info(`[BorderDetector-PDF] No borders found across ${totalPages} pages. Copied original to ${targetPath}`);
    return {
      success: true,
      originalPath: imagePath,
      processedPath: targetPath,
      cropped: false,
      message: 'No borders detected - original saved',
      processingTime,
      borderData: pageResults.length === 1 ? pageResults[0].borderData : null,
      borderDataPages: pageMetadata,
      originalSize: pageResults[0]?.imageMeta,
      newSize: null,
      fileSize: {
        original: originalFileSize,
        processed: processedSize
      },
      pagesProcessed: totalPages,
      isPdf: true
    };
  }

  const finalOutputPath = outputPath || path.join(baseOutputDir, `${baseName}${croppedSuffix}`);
  await ensureOutputDirectory(finalOutputPath);

  let processedSize = 0;
  let vectorSucceeded = false;

  try {
    await cropPdfVector(imagePath, finalOutputPath, pageResults);
    processedSize = (await fs.stat(finalOutputPath)).size;
    vectorSucceeded = true;
    logger.info('[BorderDetector-PDF] Vector crop applied to PDF pages.');
  } catch (vectorError) {
    logger.error('[BorderDetector-PDF] Vector PDF cropping failed, falling back to raster export:', vectorError);
  }

  if (vectorSucceeded && processedSize <= originalFileSize) {
    const processingTime = Date.now() - startTime;
    return {
      success: true,
      originalPath: imagePath,
      processedPath: finalOutputPath,
      cropped: true,
      borderData: pageResults.length === 1 ? pageResults[0].borderData : null,
      borderDataPages: pageMetadata,
      originalSize: pageResults[0]?.imageMeta,
      newSize: pageResults.length === 1 ? { width: pageResults[0].borderData.width, height: pageResults[0].borderData.height } : null,
      processingTime,
      fileSize: {
        original: originalFileSize,
        processed: processedSize
      },
      pagesProcessed: totalPages,
      isPdf: true
    };
  }

  const baseRasterBuffer = await buildRasterPdfFromPageResults(pageResults, {
    quality: pdfQualitySetting,
    sourcePdfPath: imagePath
  });

  if (vectorSucceeded) {
    logger.warn(`[BorderDetector-PDF] Vector crop output (${processedSize} bytes) exceeds original (${originalFileSize} bytes). Regenerating raster PDF to enforce size limit.`);
  }

  const constrained = await enforcePdfSizeLimit({
    currentPdfBuffer: baseRasterBuffer,
    pageEntries: pageResults,
    targetBytes: originalFileSize,
    baseQuality: pdfQualitySetting,
    sourcePdfPath: imagePath
  });

  await fs.writeFile(finalOutputPath, constrained.buffer);
  processedSize = constrained.buffer.length;
  const processingTime = Date.now() - startTime;
  logger.info(`[BorderDetector-PDF] Raster PDF saved to ${finalOutputPath} (${(processedSize / 1024).toFixed(1)}KB).`);

  return {
    success: true,
    originalPath: imagePath,
    processedPath: finalOutputPath,
    cropped: true,
    borderData: pageResults.length === 1 ? pageResults[0].borderData : null,
    borderDataPages: pageMetadata,
    originalSize: pageResults[0]?.imageMeta,
    newSize: pageResults.length === 1 ? { width: pageResults[0].borderData.width, height: pageResults[0].borderData.height } : null,
    processingTime,
    fileSize: {
      original: originalFileSize,
      processed: processedSize
    },
    pagesProcessed: totalPages,
    isPdf: true
  };
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
  options.outputFormat = 'pdf';
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

async function cropPdfVector(originalPdfPath, outputPdfPath, pageCropEntries) {
  const pdfBytes = await fs.readFile(originalPdfPath);
  const pdfDoc = await PdfLibDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new Error('PDF has no pages to crop');
  }

  const entries = Array.isArray(pageCropEntries)
    ? pageCropEntries
    : [{ pageNumber: 1, borderData: pageCropEntries }];

  for (const entry of entries) {
    const { borderData, pageNumber = 1 } = entry || {};
    if (!borderData || !borderData.hasBorders) {
      continue;
    }

    const pageIndex = Math.min(Math.max(pageNumber - 1, 0), pages.length - 1);
    const page = pages[pageIndex];
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
  }

  const croppedPdfBytes = await pdfDoc.save();
  await fs.writeFile(outputPdfPath, croppedPdfBytes);
}

async function createRasterizedPdf(pageEntries, sourcePdfPath = null) {
  const entries = Array.isArray(pageEntries) ? pageEntries : [pageEntries];
  if (entries.length === 0) {
    throw new Error('No pages provided for raster PDF creation');
  }

  const doc = new PdfKitDocument({ autoFirstPage: false });
  const pdfChunks = [];

  const resolvePageSize = async (entry, index) => {
    const originalDims = entry.borderData?.originalDimensions || entry.borderData?.metadata?.originalSize;
    const providedSize = entry.pageSize;
    let widthPoints = entry.borderData?.width || providedSize?.width || 1;
    let heightPoints = entry.borderData?.height || providedSize?.height || 1;

    if (providedSize && originalDims?.width && originalDims?.height) {
      widthPoints = clampValue(
        (entry.borderData.width / originalDims.width) * providedSize.width,
        1,
        providedSize.width
      );
      heightPoints = clampValue(
        (entry.borderData.height / originalDims.height) * providedSize.height,
        1,
        providedSize.height
      );
    } else if (!providedSize && sourcePdfPath) {
      try {
        const { width: pageWidth, height: pageHeight } = await getPdfPageSize(sourcePdfPath, index);
        if (originalDims?.width && originalDims?.height) {
          widthPoints = clampValue(
            (entry.borderData.width / originalDims.width) * pageWidth,
            1,
            pageWidth
          );
          heightPoints = clampValue(
            (entry.borderData.height / originalDims.height) * pageHeight,
            1,
            pageHeight
          );
        } else {
          widthPoints = pageWidth;
          heightPoints = pageHeight;
        }
      } catch (err) {
        logger.warn('[BorderDetector] Falling back to pixel dimensions for raster PDF page sizing.', err);
      }
    }

    return { width: Math.max(widthPoints, 1), height: Math.max(heightPoints, 1) };
  };

  return await new Promise((resolve, reject) => {
    doc.on('data', chunk => pdfChunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(pdfChunks)));
    doc.on('error', reject);

    (async () => {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry?.imageBuffer || !entry?.borderData) {
          throw new Error('Raster PDF entry missing image buffer or border data');
        }
        const { width, height } = await resolvePageSize(entry, entry.pageNumber ? entry.pageNumber - 1 : i);
        doc.addPage({ size: [width, height], margin: 0 });
        doc.image(entry.imageBuffer, 0, 0, {
          width,
          height,
          align: 'center',
          valign: 'center'
        });
      }
      doc.end();
    })().catch(reject);
  });
}

async function enforcePdfSizeLimit({
  currentPdfBuffer,
  pageEntries,
  targetBytes,
  baseQuality = 85,
  sourcePdfPath = null
}) {
  const hasPages = Array.isArray(pageEntries) && pageEntries.length > 0;

  if (!hasPages) {
    return {
      buffer: currentPdfBuffer,
      satisfied: currentPdfBuffer ? currentPdfBuffer.length <= targetBytes : false
    };
  }

  if (!targetBytes || targetBytes <= 0) {
    const fallbackBuffer = currentPdfBuffer && currentPdfBuffer.length > 0
      ? currentPdfBuffer
      : await buildRasterPdfFromPageResults(pageEntries, { quality: baseQuality, sourcePdfPath });
    return {
      buffer: fallbackBuffer,
      satisfied: true
    };
  }

  if (currentPdfBuffer && currentPdfBuffer.length <= targetBytes) {
    return { buffer: currentPdfBuffer, satisfied: true };
  }

  const MIN_QUALITY = 5;
  const QUALITY_STEP = 5;
  const MIN_SCALE = 0.05;
  const SCALE_STEP = 0.1;
  const normalizedBaseQuality = Math.min(Math.max(Math.round(baseQuality), MIN_QUALITY), 95);

  let bestCandidate = null;
  if (currentPdfBuffer) {
    bestCandidate = { buffer: currentPdfBuffer, length: currentPdfBuffer.length, scale: 1, quality: normalizedBaseQuality };
  } else {
    const basePdf = await buildRasterPdfFromPageResults(pageEntries, {
      quality: normalizedBaseQuality,
      sourcePdfPath
    });
    bestCandidate = { buffer: basePdf, length: basePdf.length, scale: 1, quality: normalizedBaseQuality };
    if (basePdf.length <= targetBytes) {
      return { buffer: basePdf, satisfied: true };
    }
  }

  const qualityLevels = [];
  for (let q = normalizedBaseQuality; q >= MIN_QUALITY; q -= QUALITY_STEP) {
    qualityLevels.push(Math.round(q));
  }
  if (!qualityLevels.includes(MIN_QUALITY)) {
    qualityLevels.push(MIN_QUALITY);
  }

  const scaleLevels = [];
  for (let scale = 1; scale >= MIN_SCALE - 1e-6; scale -= SCALE_STEP) {
    const rounded = Number(scale.toFixed(2));
    if (!scaleLevels.includes(rounded)) {
      scaleLevels.push(rounded);
    }
  }
  if (!scaleLevels.includes(MIN_SCALE)) {
    scaleLevels.push(MIN_SCALE);
  }

  const baseQualityRounded = Math.round(normalizedBaseQuality);

  for (const scale of scaleLevels) {
    for (const quality of qualityLevels) {
      if (scale === 1 && quality === baseQualityRounded && !currentPdfBuffer) {
        continue; // Already evaluated base combination
      }

      const grayscale = quality <= 40;
      const candidatePdf = await buildRasterPdfFromPageResults(pageEntries, {
        quality,
        scale,
        grayscale,
        sourcePdfPath
      });

      if (!bestCandidate || candidatePdf.length < bestCandidate.length) {
        bestCandidate = { buffer: candidatePdf, length: candidatePdf.length, scale, quality };
      }

      if (candidatePdf.length <= targetBytes) {
        logger.info(`[BorderDetector] PDF size enforcement succeeded at quality ${quality} and scale ${(scale * 100).toFixed(0)}% (size ${(candidatePdf.length / 1024).toFixed(1)}KB).`);
        return { buffer: candidatePdf, satisfied: true };
      }
    }
  }

  if (bestCandidate) {
    logger.warn(`[BorderDetector] Could not reduce PDF below original size (${targetBytes} bytes). Using smallest available output (${bestCandidate.length} bytes).`);
    return { buffer: bestCandidate.buffer, satisfied: bestCandidate.length <= targetBytes };
  }

  logger.warn('[BorderDetector] Size enforcement failed: returning original PDF buffer.');
  return {
    buffer: currentPdfBuffer,
    satisfied: currentPdfBuffer ? currentPdfBuffer.length <= targetBytes : false
  };
}

async function getPdfPageSize(pdfPath, pageIndex = 0) {
  const pdfBytes = await fs.readFile(pdfPath);
  const pdfDoc = await PdfLibDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new Error('PDF has no pages');
  }
  const index = Math.min(Math.max(pageIndex, 0), pages.length - 1);
  return pages[index].getSize();
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
