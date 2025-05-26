// electron/utils/fileValidator.js
// This module will validate files (e.g., type, size, etc.) before processing.

const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/tiff'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // Example: 100MB

/**
 * Validates a file based on its metadata.
 * @param {object} fileMeta - The file metadata object (e.g., from FileMeta).
 * @returns {{isValid: boolean, message?: string}}
 */
function validateFile(fileMeta) {
  if (!SUPPORTED_FORMATS.includes(fileMeta.type)) {
    return { isValid: false, message: `Unsupported file type: ${fileMeta.type}. Supported: JPG, PNG, TIFF` };
  }
  if (fileMeta.size > MAX_FILE_SIZE) {
    return { isValid: false, message: `File too large: ${(fileMeta.size / (1024*1024)).toFixed(1)}MB. Max: ${MAX_FILE_SIZE / (1024*1024)}MB` };
  }
  // Add more validation rules as needed (e.g., dimensions, corruption checks if possible early)
  return { isValid: true };
}

module.exports = { validateFile, SUPPORTED_FORMATS }; 