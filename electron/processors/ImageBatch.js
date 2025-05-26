// electron/processors/ImageBatch.js
// Enhanced batch processing module with cancellation support, error recovery, and memory management

const { processBatch, validateFile, CONFIG } = require('./BorderDetector');
const logger = require('../utils/logger');
const path = require('path');

let imageQueue = [];
let isCurrentlyProcessing = false;
let processingController = null; // AbortController for cancellation
let currentBatchOptions = {};

/**
 * Adds images to the processing queue with validation
 * @param {Array<object>} files - Array of file objects from frontend
 */
function addToQueue(files) {
  if (!Array.isArray(files)) {
    logger.error('[ImageBatch] Invalid files parameter - expected array');
    return;
  }

  // Filter and validate files before adding to queue
  const validFiles = files.filter(file => {
    if (!file.path) {
      logger.warn(`[ImageBatch] Skipping file without path: ${file.name || 'unknown'}`);
      return false;
    }
    return true;
  });

  imageQueue.push(...validFiles);
  logger.info(`[ImageBatch] Added ${validFiles.length} files to queue. Total: ${imageQueue.length}`);

  // Log queue statistics
  const totalSize = imageQueue.reduce((sum, file) => sum + (file.size || 0), 0);
  const avgSize = totalSize / imageQueue.length;
  logger.info(`[ImageBatch] Queue stats - Total size: ${(totalSize / (1024 * 1024)).toFixed(1)}MB, Average: ${(avgSize / (1024 * 1024)).toFixed(1)}MB`);
}

/**
 * Starts processing the image queue with enhanced error handling and progress tracking
 * @param {function} progressCallback - Progress update callback
 * @param {function} completionCallback - Completion callback
 * @param {object} options - Processing options
 */
async function processQueue(progressCallback, completionCallback, options = {}) {
  // Prevent multiple simultaneous processing
  if (isCurrentlyProcessing) {
    logger.warn('[ImageBatch] Processing already in progress, ignoring new request');
    if (completionCallback) {
      completionCallback({ 
        status: 'error', 
        message: 'Processing already in progress', 
        processedFiles: [], 
        errors: [] 
      });
    }
    return;
  }

  // Check if queue is empty
  if (imageQueue.length === 0) {
    logger.info('[ImageBatch] Queue is empty, nothing to process');
    if (completionCallback) {
      completionCallback({ 
        status: 'complete', 
        message: 'Queue is empty', 
        processedFiles: [], 
        errors: [] 
      });
    }
    return;
  }

  isCurrentlyProcessing = true;
  currentBatchOptions = { ...CONFIG, ...options }; // Merge with defaults from CONFIG
  processingController = new AbortController();

  logger.info(`[ImageBatch] Starting queue processing with ${imageQueue.length} files`);

  try {
    // Prepare file paths for batch processing
    const filePaths = imageQueue.map(file => file.path);
    const fileMap = new Map(imageQueue.map(file => [file.path, file]));

    // Clear the queue as we're processing these files
    const processedQueue = [...imageQueue];
    imageQueue = [];

    // Enhanced progress callback that includes file metadata
    const enhancedProgressCallback = (progressData) => {
      const fileInfo = fileMap.get(progressData.currentFile);
      
      if (progressCallback) {
        progressCallback({
          ...progressData,
          currentFileInfo: fileInfo,
          queueLength: processedQueue.length
        });
      }

      logger.info(`[ImageBatch] Progress: ${progressData.processed}/${progressData.total} (${progressData.progress}%) - ${progressData.currentFile || 'Complete'}`);
    };

    // Process the batch with the enhanced BorderDetector
    const batchResult = await processBatch(
      filePaths, 
      {
        ...currentBatchOptions, // Use stored options
        threshold: currentBatchOptions.threshold || CONFIG.BLACK_THRESHOLD,
        maxConcurrent: Math.min(currentBatchOptions.maxConcurrent || 3, 5),
        continueOnError: true,
        signal: processingController.signal // Pass the abort signal
      }, 
      enhancedProgressCallback
    );

    // Process results and create response
    const processedFiles = [];
    const errors = [];
    let successfulCount = 0;
    let croppedCount = 0;

    // This check is important if processBatch itself could fail catastrophically 
    // before returning a structured result (though our current one is designed to always return one)
    if (!batchResult || !batchResult.results) {
        logger.error('[ImageBatch] Critical error: processBatch did not return a valid result structure.', batchResult);
        throw new Error('Batch processing failed to produce results.');
    }

    batchResult.results.forEach((result) => {
      const originalFile = fileMap.get(result.originalPath);
      if (!originalFile) {
          logger.warn(`[ImageBatch] Could not find original file metadata for path: ${result.originalPath}`);
          // Create a placeholder if not found, to prevent crashes, though this indicates a logic flaw upstream.
          errors.push({
            fileId: 'unknown',
            fileName: path.basename(result.originalPath),
            filePath: result.originalPath,
            message: 'Original file metadata not found during result processing.',
            timestamp: new Date().toISOString()
          });
          return; // Skip this result
      }

      if (result.success) {
        successfulCount++;
        if (result.cropped) croppedCount++;
        processedFiles.push({
          ...originalFile,
          processedPath: result.processedPath,
          cropped: result.cropped,
          originalSize: result.originalSize,
          newSize: result.newSize,
          processingTime: result.processingTime,
          fileSize: result.fileSize,
          isPdf: result.isPdf // Pass through PDF flag
        });
      } else {
        errors.push({
          fileId: originalFile.id,
          fileName: originalFile.name,
          filePath: result.originalPath,
          message: result.error || 'Unknown processing error',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Add any top-level errors from batchResult.errors (e.g., if a chunk failed)
    if (batchResult.errors && Array.isArray(batchResult.errors)) {
        batchResult.errors.forEach(error => {
            const originalFile = fileMap.get(error.file) || { id: 'unknown', name: path.basename(error.file || 'unknown_file') };
            errors.push({
                fileId: originalFile.id,
                fileName: originalFile.name,
                filePath: error.file || 'unknown_file_path',
                message: error.error || 'Batch processing chunk error',
                timestamp: error.timestamp || new Date().toISOString()
            });
        });
    }

    // Ensure summary data is valid
    const summary = batchResult.summary || {}; // Fallback to empty object if summary is missing
    const totalFilesProcessedInBatch = summary.total || processedQueue.length; // Use queue length as fallback

    const finalResult = {
      status: errors.length === totalFilesProcessedInBatch && totalFilesProcessedInBatch > 0 ? 'error' : 'complete',
      message: `Batch processing finished. ${successfulCount} successful, ${errors.length} errors out of ${totalFilesProcessedInBatch} files.`,
      processedFiles,
      errors,
      summary: {
        total: totalFilesProcessedInBatch,
        successful: successfulCount,
        failed: errors.length,
        cropped: croppedCount,
        processingTime: summary.processingTime || 0,
        averageTime: summary.averageTime || 0,
        memoryUsage: summary.memoryUsage || process.memoryUsage() // Fallback for memory
      },
      processingStats: {
        totalTime: summary.processingTime || 0,
        averageTime: summary.averageTime || 0,
        memoryUsage: summary.memoryUsage || process.memoryUsage(),
        filesProcessed: successfulCount,
        filesCropped: croppedCount,
        filesSkipped: successfulCount - croppedCount, // Successful but not cropped
        totalAttempted: totalFilesProcessedInBatch
      }
    };

    logger.info(`[ImageBatch] Queue processing completed successfully. ${processedFiles.length} processed, ${errors.length} errors`);

    if (completionCallback) {
      completionCallback(finalResult);
    }

  } catch (error) {
    logger.error('[ImageBatch] Critical error during queue processing:', error);

    const errorResult = {
      status: 'error',
      message: `Critical processing error: ${error.message}`,
      processedFiles: [],
      errors: [{
        fileId: 'batch',
        fileName: 'batch_processing',
        message: error.message,
        timestamp: new Date().toISOString()
      }]
    };

    if (completionCallback) {
      completionCallback(errorResult);
    }

  } finally {
    isCurrentlyProcessing = false;
    processingController = null;
    currentBatchOptions = {};
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
}

/**
 * Cancels ongoing image processing
 * @returns {object} Cancellation result
 */
function cancelProcessing() {
  logger.info('[ImageBatch] Cancellation requested');

  if (!isCurrentlyProcessing) {
    logger.warn('[ImageBatch] No processing in progress to cancel');
    return { success: false, message: 'No processing in progress' };
  }

  try {
    // Signal cancellation if controller exists
    if (processingController && !processingController.signal.aborted) {
      logger.info('[ImageBatch] Aborting processing controller.');
      processingController.abort();
    } else {
      logger.warn('[ImageBatch] Processing controller already aborted or null.');
    }

    // Clear the queue to prevent new processing after this batch might (or might not) stop
    const cancelledCount = imageQueue.length;
    imageQueue = [];

    // Reset processing state immediately - assumes ongoing batch will respect abort signal
    // isCurrentlyProcessing = false; // Consider delaying this reset until the batch truly finishes/aborts
    // currentBatchOptions = {};

    logger.info(`[ImageBatch] Processing cancellation signal sent. ${cancelledCount} queued items (for future batches) cleared.`);

    return { 
      success: true, 
      message: `Processing cancellation signal sent. Any ongoing batch will attempt to stop. ${cancelledCount} queued items for future batches cleared.`,
      cancelledItems: cancelledCount
    };

  } catch (error) {
    logger.error('[ImageBatch] Error during cancellation:', error);
    return { 
      success: false, 
      message: `Cancellation error: ${error.message}` 
    };
  }
}

/**
 * Gets current queue status with detailed information
 * @returns {object} Queue status and processing information
 */
function getQueueStatus() {
  const queueSize = imageQueue.length;
  const totalQueueSize = queueSize > 0 ? imageQueue.reduce((sum, file) => sum + (file.size || 0), 0) : 0;

  return {
    queueLength: queueSize,
    isProcessing: isCurrentlyProcessing,
    totalQueueSize,
    averageFileSize: queueSize > 0 ? totalQueueSize / queueSize : 0,
    estimatedProcessingTime: queueSize * (currentBatchOptions.estimatedTimePerFile || 2000), // 2s per file default
    processingOptions: isCurrentlyProcessing ? currentBatchOptions : null,
    memoryUsage: process.memoryUsage()
  };
}

/**
 * Clears the processing queue
 * @returns {object} Clear operation result
 */
function clearQueue() {
  if (isCurrentlyProcessing) {
    logger.warn('[ImageBatch] Cannot clear queue while processing is in progress');
    return { success: false, message: 'Cannot clear queue during processing' };
  }

  const clearedCount = imageQueue.length;
  imageQueue = [];

  logger.info(`[ImageBatch] Queue cleared. ${clearedCount} items removed.`);

  return { 
    success: true, 
    message: `Queue cleared. ${clearedCount} items removed.`,
    clearedItems: clearedCount
  };
}

/**
 * Validates files in the queue before processing
 * @returns {Promise<object>} Validation results
 */
async function validateQueue() {
  logger.info(`[ImageBatch] Validating ${imageQueue.length} files in queue`);

  const validationPromises = imageQueue.map(async (file) => {
    try {
      const validation = await validateFile(file.path);
      return {
        file: file,
        valid: validation.valid,
        error: validation.error || null
      };
    } catch (error) {
      return {
        file: file,
        valid: false,
        error: `Validation error: ${error.message}`
      };
    }
  });

  const validationResults = await Promise.allSettled(validationPromises);
  const results = validationResults.map(result => 
    result.status === 'fulfilled' ? result.value : {
      file: { name: 'unknown', path: 'unknown' },
      valid: false,
      error: 'Validation promise failed'
    }
  );

  const validFiles = results.filter(r => r.valid);
  const invalidFiles = results.filter(r => !r.valid);

  logger.info(`[ImageBatch] Validation complete: ${validFiles.length} valid, ${invalidFiles.length} invalid`);

  return {
    totalFiles: imageQueue.length,
    validFiles: validFiles.length,
    invalidFiles: invalidFiles.length,
    errors: invalidFiles.map(f => ({
      fileName: f.file.name,
      filePath: f.file.path,
      error: f.error
    }))
  };
}

module.exports = { 
  addToQueue, 
  processQueue, 
  getQueueStatus,
  cancelProcessing,
  clearQueue,
  validateQueue
}; 