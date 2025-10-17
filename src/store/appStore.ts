import { create } from 'zustand';

export interface FileMeta {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
  thumbnail?: string;
}

export interface ProcessingError {
  fileId: string;
  fileName: string;
  message: string;
}

export type OutputFormat = 'original' | 'pdf' | 'svg' | 'png' | 'jpg';

interface AppState {
  files: FileMeta[];
  progress: number;
  isProcessing: boolean;
  errors: ProcessingError[];
  outputFormat: OutputFormat;
  
  // Actions
  setFiles: (files: FileMeta[]) => void;
  clearFiles: () => void;
  setProgress: (progress: number) => void;
  startProcessing: () => void;
  stopProcessing: () => void;
  addError: (error: ProcessingError) => void;
  clearErrors: () => void;
  setOutputFormat: (format: OutputFormat) => void;
}

export const useAppStore = create<AppState>((set) => ({
  files: [],
  progress: 0,
  isProcessing: false,
  errors: [],
  outputFormat: 'original',
  
  setFiles: (files) => set({ files }),
  clearFiles: () => set({ files: [] }),
  setProgress: (progress) => set({ progress }),
  startProcessing: () => set({ isProcessing: true, progress: 0, errors: [] }),
  stopProcessing: () => set({ isProcessing: false }),
  addError: (error) => set((state) => ({ errors: [...state.errors, error] })),
  clearErrors: () => set({ errors: [] }),
  setOutputFormat: (format) => set({ outputFormat: format }),
})); 