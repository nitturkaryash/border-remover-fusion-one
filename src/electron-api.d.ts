import { FileMeta } from './store/appStore'; // Adjust path as needed

// Define interfaces for progress and completion data from backend
export interface ImageProcessingProgressUpdate {
  currentFile: string;
  progress: number; // Overall progress 0-100
  total: number;    // Total images in batch
  done: number;     // Images processed so far
}

export interface ImageProcessingError {
  fileId: string;
  fileName: string;
  message: string;
}

export interface ImageProcessingCompletionResult {
  status: string; // e.g., 'complete', 'cancelled', 'error'
  message: string;
  processedFiles: FileMeta[]; // Files that were successfully processed (might include new paths)
  errors: ImageProcessingError[];
  summary?: {
    total: number;
    successful: number;
    failed: number;
    cropped: number;
    processingTime?: number;
    averageTime?: number;
    memoryUsage?: unknown;
  };
}

declare global {
  interface Window {
    electronAPI: {
      selectFiles: () => Promise<FileMeta[]>;
      selectFolder: () => Promise<string | null>;
      openOutputFolder: (folderPath?: string) => Promise<boolean>;
      showNotification: (options: { title: string; body: string }) => Promise<boolean>;
      onSelectFilesRequest: (callback: () => void) => (() => void) | void; // Can optionally return a cleanup
      
      // Image Processing IPC
      startImageProcessing: (files: FileMeta[], options?: { outputFormat?: string }) => Promise<{success: boolean, message: string}>;
      cancelImageProcessing: () => Promise<{success: boolean, message: string}>;
      onImageProcessingProgress: (callback: (progressUpdate: ImageProcessingProgressUpdate) => void) => (() => void) | void;
      onImageProcessingComplete: (callback: (result: ImageProcessingCompletionResult) => void) => (() => void) | void;
    };
  }
}

// This export is needed to make it a module, otherwise it might be treated as a script
export {}; 
