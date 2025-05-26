# Black Border Detection & Removal System

A comprehensive, production-ready image processing module for detecting and removing black borders from scanned documents and images.

## Features

### Core Capabilities
- **Advanced Multi-Pass Detection**: Uses sophisticated algorithms to detect black borders with high accuracy
- **Noise Reduction**: Handles noisy, uneven, and partial borders from poor scanning conditions
- **Edge Refinement**: Sub-pixel accurate border detection using gradient analysis
- **Batch Processing**: Efficiently processes multiple images with progress tracking
- **Memory Management**: Optimized for large image batches with automatic cleanup
- **Error Recovery**: Robust error handling with detailed logging and recovery mechanisms

### Performance Specifications
- **Processing Speed**: <2s for 1920x1080 images on average hardware
- **Memory Usage**: <500MB for batch processing 100 images  
- **Supported Formats**: JPG, PNG, TIFF, WebP
- **Max File Size**: 50MB per image
- **Max Batch Size**: 500 images
- **Timeout Protection**: 30-second timeout per image

## Architecture

### Module Structure
```
electron/processors/
├── BorderDetector.js    # Core detection algorithms
├── ImageBatch.js       # Batch processing management
└── test-border-detection.js  # Comprehensive test suite

electron/utils/
├── logger.js           # Winston logging configuration
└── fileValidator.js    # File validation utilities
```

### Key Components

#### BorderDetector.js
The main processing engine that handles:
- Border detection using edge scanning algorithms
- Noise reduction and edge refinement
- Image cropping with format optimization
- File validation and memory management

#### ImageBatch.js  
Batch processing coordinator that provides:
- Queue management with validation
- Progress tracking and cancellation support
- Error recovery and memory cleanup
- Processing statistics and reporting

## API Reference

### Core Functions

#### `detectBorders(imageBuffer, options)`
Advanced border detection with configurable parameters.

```javascript
const result = await detectBorders(imageBuffer, {
  threshold: 10,           // Black pixel threshold (0-255)
  minBorderSize: 5,        // Minimum border size to detect
  noiseReduction: true,    // Enable noise reduction
  edgeRefinement: true     // Enable sub-pixel edge refinement
});

console.log(result);
// {
//   top: 25, left: 30, width: 740, height: 550,
//   hasBorders: true,
//   borderSizes: { top: 25, bottom: 25, left: 30, right: 30 },
//   originalDimensions: { width: 800, height: 600 },
//   croppedDimensions: { width: 740, height: 550 },
//   metadata: { processingTime: 156, algorithm: 'multi-pass-edge-scan' }
// }
```

#### `cropImage(imageBuffer, borders, options)`
Crops an image based on detected border coordinates.

```javascript
const croppedBuffer = await cropImage(imageBuffer, borders, {
  quality: 95,             // JPEG quality (1-100)
  compression: 6           // PNG compression (1-9)
});
```

#### `processImage(imagePath, options)`
Complete single-image processing pipeline.

```javascript
const result = await processImage('/path/to/image.jpg', {
  threshold: 10,
  outputPath: '/path/to/output.jpg',  // Optional custom output
  timeout: 30000           // Processing timeout in ms
});

console.log(result);
// {
//   success: true,
//   originalPath: '/path/to/image.jpg',
//   processedPath: '/path/to/output.jpg',
//   cropped: true,
//   processingTime: 1245,
//   fileSize: { original: 2048576, processed: 1856432 }
// }
```

#### `processBatch(imagePaths, options, progressCallback)`
Batch processing with progress tracking.

```javascript
const batchResult = await processBatch(
  ['/path/to/img1.jpg', '/path/to/img2.jpg'],
  {
    maxConcurrent: 3,        // Concurrent processing limit
    outputDir: '/output',    // Custom output directory
    continueOnError: true    // Don't stop on individual errors
  },
  (progress) => {
    console.log(`Progress: ${progress.progress}% (${progress.processed}/${progress.total})`);
  }
);

console.log(batchResult.summary);
// {
//   total: 50, successful: 48, failed: 2, cropped: 45,
//   processingTime: 125430, averageTime: 2508,
//   memoryUsage: { heapUsed: 87432192, ... }
// }
```

### Batch Processing API

#### Queue Management
```javascript
const { addToQueue, processQueue, getQueueStatus } = require('./processors/ImageBatch');

// Add files to processing queue
addToQueue([
  { id: 'img1', name: 'image1.jpg', path: '/path/to/image1.jpg', size: 2048576 },
  { id: 'img2', name: 'image2.jpg', path: '/path/to/image2.jpg', size: 1856432 }
]);

// Check queue status
const status = getQueueStatus();
console.log(`Queue: ${status.queueLength} files, ${status.isProcessing ? 'processing' : 'idle'}`);

// Start processing with callbacks
await processQueue(
  (progress) => console.log(`Progress: ${progress.progress}%`),
  (result) => console.log(`Complete: ${result.processedFiles.length} processed`)
);
```

#### Cancellation & Control
```javascript
// Cancel ongoing processing
const cancelResult = cancelProcessing();
console.log(cancelResult.message); // "Processing cancelled. 15 queued items cleared."

// Clear the queue
const clearResult = clearQueue();
console.log(clearResult.message); // "Queue cleared. 25 items removed."

// Validate queue files
const validation = await validateQueue();
console.log(`${validation.validFiles} valid, ${validation.invalidFiles} invalid`);
```

## Configuration

### Default Settings (CONFIG object)
```javascript
const CONFIG = {
  // Detection thresholds
  BLACK_THRESHOLD: 10,           // Pixels ≤ 10 considered black
  MIN_BORDER_SIZE: 5,            // Minimum 5px border to detect
  
  // Performance limits  
  MAX_MEMORY_USAGE: 500 * 1024 * 1024,  // 500MB memory limit
  MAX_DIMENSION: 10000,          // 10k pixel max dimension
  TIMEOUT_MS: 30000,             // 30s timeout per image
  
  // File constraints
  MAX_FILE_SIZE: 50 * 1024 * 1024,      // 50MB max file size
  SUPPORTED_FORMATS: ['jpeg', 'jpg', 'png', 'tiff', 'tif', 'webp'],
  
  // Output quality
  QUALITY: 95,                   // JPEG quality
  COMPRESSION: 6                 // PNG compression
};
```

### Customization Examples
```javascript
// High precision detection
const preciseBorders = await detectBorders(buffer, {
  threshold: 5,              // More sensitive to dark pixels
  minBorderSize: 2,         // Detect smaller borders
  noiseReduction: true,     // Clean up noise
  edgeRefinement: true      // Sub-pixel accuracy
});

// Fast processing mode
const fastBorders = await detectBorders(buffer, {
  threshold: 15,            // Less sensitive = faster
  noiseReduction: false,    // Skip noise reduction
  edgeRefinement: false     // Skip refinement
});

// Batch with custom settings
const batchOptions = {
  threshold: 8,
  maxConcurrent: 2,         // Limit for low-memory systems
  continueOnError: true,
  outputDir: '/custom/output'
};
```

## Error Handling

### Comprehensive Error Recovery
The system includes robust error handling at multiple levels:

1. **File Validation**: Pre-processing validation of file size, format, and accessibility
2. **Processing Timeouts**: Automatic timeout protection for hung operations
3. **Memory Management**: Automatic cleanup and garbage collection hints
4. **Graceful Degradation**: Continue processing other images when individual files fail
5. **Detailed Logging**: Winston-based logging with multiple levels and structured output

### Error Response Format
```javascript
// Individual processing error
{
  success: false,
  originalPath: '/path/to/problem.jpg',
  error: 'File too large: 75.3MB. Max: 50MB',
  processingTime: 156
}

// Batch processing errors
{
  status: 'complete',
  processedFiles: [...],
  errors: [
    {
      fileId: 'img1',
      fileName: 'corrupted.jpg', 
      filePath: '/path/to/corrupted.jpg',
      message: 'Invalid image format',
      timestamp: '2024-01-15T10:30:45.123Z'
    }
  ]
}
```

## Integration with Electron

### IPC Handlers
The system integrates with Electron through IPC handlers in `main.js`:

```javascript
// Start processing
ipcMain.handle('start-image-processing', async (event, files) => {
  addToQueue(files);
  return await processQueue(progressCallback, completionCallback);
});

// Cancel processing  
ipcMain.handle('cancel-image-processing', async () => {
  return cancelProcessing();
});

// Get status
ipcMain.handle('get-queue-status', async () => {
  return getQueueStatus();
});

// Validate queue
ipcMain.handle('validate-queue', async () => {
  return await validateQueue();
});
```

### Progress Events
The system emits progress events to the renderer process:

```javascript
// Progress updates
mainWindow.webContents.send('image-processing-progress', {
  progress: 75,
  processed: 38,
  total: 50,
  currentFile: 'document_scan.jpg',
  successful: 36,
  errors: 2
});

// Completion notification
mainWindow.webContents.send('image-processing-complete', {
  status: 'complete',
  processedFiles: [...],
  summary: { total: 50, successful: 48, processingTime: 125000 }
});

// Cancellation notification
mainWindow.webContents.send('image-processing-cancelled', {
  success: true,
  cancelledItems: 12
});
```

## Testing

### Comprehensive Test Suite
Run the included test suite to validate functionality:

```bash
node electron/test-border-detection.js
```

### Test Coverage
The test suite includes:
- **Basic Border Detection**: Standard border detection validation
- **Edge Cases**: No borders, thin borders, uneven borders
- **Performance Tests**: Speed validation for various image sizes
- **Memory Management**: Memory leak detection and cleanup validation
- **File Validation**: Format and size constraint testing
- **Error Handling**: Timeout and failure recovery testing

### Sample Test Output
```
[TEST] Starting comprehensive border detection test suite...
[TEST] Basic border detection: PASSED
[TEST] Edge case No Borders: PASSED  
[TEST] Edge case Thin Borders: PASSED
[TEST] Performance Standard: PASSED (1,245ms < 2,000ms)
[TEST] Image cropping: PASSED
[TEST] Memory management: PASSED (12.3MB increase)

=== TEST SUITE SUMMARY ===
Total Tests: 12
Passed: 11
Failed: 1
Success Rate: 91.7%
Total Time: 8,432ms
```

## Usage Examples

### Single Image Processing
```javascript
const { processImage } = require('./processors/BorderDetector');

// Basic processing
const result = await processImage('/path/to/scan.jpg');
if (result.success && result.cropped) {
  console.log(`Cropped image saved to: ${result.processedPath}`);
  console.log(`Size reduced: ${result.originalSize.width}x${result.originalSize.height} → ${result.newSize.width}x${result.newSize.height}`);
}
```

### Batch Processing with Progress
```javascript
const { processBatch } = require('./processors/BorderDetector');

const imagePaths = ['/scan1.jpg', '/scan2.jpg', '/scan3.jpg'];

const result = await processBatch(imagePaths, {}, (progress) => {
  console.log(`${progress.progress}% complete - processing ${progress.currentFile}`);
});

console.log(`Processed ${result.summary.successful}/${result.summary.total} images`);
console.log(`${result.summary.cropped} images had borders removed`);
```

### Custom Output Organization
```javascript
const { generateOutputPath, processImage } = require('./processors/BorderDetector');

// Custom output path generation
const outputPath = generateOutputPath('/input/scan.jpg', {
  outputDir: '/processed',
  addTimestamp: true,    // Creates 2024-01-15_processed folder
  suffix: '_clean'       // scan_clean.jpg
});

const result = await processImage('/input/scan.jpg', { outputPath });
```

## Performance Optimization

### Memory Management
- Automatic garbage collection hints after batch processing
- Chunked processing for large batches to prevent memory exhaustion
- Buffer cleanup and Sharp pipeline optimization

### Processing Speed
- Concurrent processing with configurable limits
- Early termination for images without borders
- Optimized pixel scanning algorithms with reduced memory allocations

### Quality vs Speed Trade-offs
```javascript
// Maximum quality (slower)
const options = {
  threshold: 5,
  minBorderSize: 1,
  noiseReduction: true,
  edgeRefinement: true
};

// Balanced performance (recommended)
const options = {
  threshold: 10,
  minBorderSize: 5,
  noiseReduction: true,
  edgeRefinement: false
};

// Maximum speed (faster, less accurate)
const options = {
  threshold: 20,
  minBorderSize: 10,
  noiseReduction: false,
  edgeRefinement: false
};
```

## Troubleshooting

### Common Issues

1. **"Image too large" errors**: Reduce image size or increase `MAX_DIMENSION` in CONFIG
2. **"Processing timeout" errors**: Increase timeout or optimize image size
3. **Memory issues**: Reduce `maxConcurrent` in batch processing options
4. **No borders detected**: Adjust `threshold` and `minBorderSize` parameters
5. **Poor detection accuracy**: Enable `noiseReduction` and `edgeRefinement`

### Debug Logging
Enable detailed logging for troubleshooting:

```javascript
// Enable debug logging in winston configuration
logger.level = 'debug';

// All processing steps will be logged with timing information
const result = await processImage('/path/to/problematic.jpg');
```

### Performance Monitoring
```javascript
// Monitor processing performance
const startTime = Date.now();
const result = await processBatch(imagePaths);
const avgTime = (Date.now() - startTime) / imagePaths.length;
console.log(`Average processing time: ${avgTime.toFixed(0)}ms per image`);
```

## Future Enhancements

### Planned Features
- **PDF Support**: First-page extraction and processing
- **Color Border Detection**: Detection of non-black borders
- **Skew Correction**: Automatic rotation correction for scanned documents  
- **OCR Integration**: Text recognition for document validation
- **Cloud Processing**: Optional cloud-based processing for very large files

### Extensibility
The modular architecture allows for easy extension:
- Add new detection algorithms in `BorderDetector.js`
- Implement custom progress callbacks in `ImageBatch.js`
- Extend file validation in `fileValidator.js`
- Add new output formats and optimization strategies

## License & Support

This module is part of the Black Border Remover desktop application. For issues, feature requests, or contributions, please refer to the main project repository.

Built with Sharp.js for high-performance image processing and Winston for comprehensive logging. 