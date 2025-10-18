import React, { useState, useEffect, useCallback } from 'react';
import { cn, buildFileMetaList } from '@/lib/utils';
import { useAppStore, FileMeta } from '@/store/appStore';
import { FileList } from '@/components/molecules/FileList';
import { ProcessingControls } from '@/components/molecules/ProcessingControls';
import { DropZone } from '@/components/molecules/DropZone';
import { OutputFormatSelector } from '@/components/molecules/OutputFormatSelector';
import { Button } from '@/components/ui/button';
import { CheckCircle, FolderOpen, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ImageProcessingProgressUpdate, ImageProcessingCompletionResult, ImageProcessingError } from '@/electron-api.d';

// Add some console logging at the top level
console.log('BatchProcessorLayout module loaded');

interface BatchProcessorLayoutProps {
  className?: string;
}

export const BatchProcessorLayout: React.FC<BatchProcessorLayoutProps> = ({
  className,
}) => {
  console.log('BatchProcessorLayout component rendering');
  const {
    files,
    progress,
    isProcessing,
    errors,
    outputFormat,
    setFiles,
    clearFiles,
    setProgress,
    startProcessing,
    stopProcessing,
    addError,
    clearErrors,
    setOutputFormat,
  } = useAppStore();
  const [currentProcessingFile, setCurrentProcessingFile] = useState<string | undefined>();
  const [isComplete, setIsComplete] = useState(false);
  const [dropZoneError, setDropZoneError] = useState<Error | null>(null);
  const { toast } = useToast();
  const [outputFolder, setOutputFolder] = useState<string | null>(null);
  const [processingSummary, setProcessingSummary] = useState<{
    total: number;
    successful: number;
    failed: number;
    cropped: number;
  } | null>(null);

  useEffect(() => {
    console.log('========================================');
    console.log('BatchProcessorLayout mounted');
    console.log('window.electronAPI available:', !!window.electronAPI);

    if (window.electronAPI) {
      console.log('✅ Running in Electron mode with full API access');
      console.log('Available API methods:', Object.keys(window.electronAPI));
    } else {
      console.warn('❌ Running in BROWSER mode - electronAPI NOT available');
      console.warn('⚠️ Image processing will NOT work in browser mode!');
      console.warn('💡 To run properly, use: npm run electron:dev');
    }
    console.log('========================================');

    let cleanupSelect: (() => void) | void;
    let cleanupProgress: (() => void) | void;
    let cleanupComplete: (() => void) | void;

    if (window.electronAPI) {
      try {
        cleanupSelect = window.electronAPI.onSelectFilesRequest?.(async () => {
          await handleSelectFiles();
        });

        cleanupProgress = window.electronAPI.onImageProcessingProgress?.((progressUpdate: ImageProcessingProgressUpdate) => {
          setProgress(progressUpdate.progress);
          setCurrentProcessingFile(progressUpdate.currentFile);
        });

        cleanupComplete = window.electronAPI.onImageProcessingComplete?.((result: ImageProcessingCompletionResult & { outputDir?: string }) => {
          stopProcessing();
          setCurrentProcessingFile(undefined);
          setIsComplete(true);
          result.errors.forEach(err => addError(err));

          const croppedCount = result.summary?.cropped ?? result.processedFiles.filter(f => (f as any).cropped).length;
          const totalCount = result.summary?.total ?? (result.processedFiles.length + result.errors.length);
          const successfulCount = result.summary?.successful ?? result.processedFiles.length;
          const failedCount = result.summary?.failed ?? result.errors.length;
          setProcessingSummary({
            total: totalCount,
            successful: successfulCount,
            failed: failedCount,
            cropped: croppedCount,
          });

          // Calculate statistics for better user feedback
          const processedCount = successfulCount - croppedCount;

          const notificationBody = failedCount === 0
            ? `${successfulCount} files processed successfully. ${croppedCount} cropped, ${processedCount} had no borders.`
            : `${successfulCount} of ${totalCount} files processed. ${failedCount} error(s).`;

          window.electronAPI?.showNotification?.({
            title: 'Processing Complete',
            body: notificationBody,
          });
          setOutputFolder(result.outputDir || null);
        });
        console.log('✅ Electron event listeners registered successfully');
      } catch (error) {
        console.error('❌ Error setting up Electron API listeners:', error);
      }
    }

    return () => {
      if (typeof cleanupSelect === 'function') cleanupSelect();
      if (typeof cleanupProgress === 'function') cleanupProgress();
      if (typeof cleanupComplete === 'function') cleanupComplete();
    };
  }, [files.length]);

  const isElectronAvailable = typeof window !== 'undefined' && !!window.electronAPI;

  const promptBrowserForFiles = useCallback(async (): Promise<FileMeta[]> => {
    return new Promise<FileMeta[]>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/jpeg,image/png,image/tiff,application/pdf';

      const cleanup = () => {
        input.onchange = null;
      };

      input.onchange = async (event) => {
        try {
          const target = event.target as HTMLInputElement;
          const filesList = target.files;
          if (!filesList || filesList.length === 0) {
            cleanup();
            resolve([]);
            return;
          }

          const { files: fileMetas, unsupportedCount } = await buildFileMetaList(filesList);

          if (unsupportedCount > 0) {
            toast({
              title: `${unsupportedCount} unsupported file(s) skipped`,
              description: 'Only JPG, PNG, TIFF and PDF files are supported',
              variant: 'default',
            });
          }

          cleanup();
          resolve(fileMetas);
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      input.click();
    });
  }, [toast]);

  const filesAreDuplicates = useCallback((existing: FileMeta, incoming: FileMeta) => {
    if (existing.path && incoming.path) {
      return existing.path === incoming.path;
    }

    return (
      existing.name === incoming.name &&
      existing.size === incoming.size &&
      existing.lastModified === incoming.lastModified
    );
  }, []);

  const handleSelectFiles = async () => {
    try {
      const selectedFiles = isElectronAvailable
        ? await window.electronAPI.selectFiles()
        : await promptBrowserForFiles();

      if (selectedFiles && selectedFiles.length > 0) {
        setFiles(selectedFiles);
        setIsComplete(false);
        clearErrors();
        setProcessingSummary(null);
      }
    } catch (error) {
      console.error('Error selecting files:', error);
      toast({ title: 'Error selecting files', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleAddMoreFiles = async () => {
    try {
      const selectedFiles = isElectronAvailable
        ? await window.electronAPI.selectFiles()
        : await promptBrowserForFiles();

      if (selectedFiles && selectedFiles.length > 0) {
        const newFiles = selectedFiles.filter((candidate) =>
          !files.some((existing) => filesAreDuplicates(existing, candidate))
        );

        if (newFiles.length > 0) {
          setFiles([...files, ...newFiles]);
        }

        if (newFiles.length < selectedFiles.length) {
          toast({ title: 'Some files already selected', description: 'Duplicate files were not added.', variant: 'default' });
        }
        if (newFiles.length > 0) {
          setProcessingSummary(null);
        }
      }
    } catch (error) {
      console.error('Error adding more files:', error);
      toast({ title: 'Error adding files', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleProcessFiles = async () => {
    if (files.length === 0) {
      toast({ title: 'No files selected', description: 'Please select images first', variant: 'destructive' });
      return;
    }
    if (files.length > 500) {
      toast({ title: 'Too many files', description: 'Maximum 500 images per batch.', variant: 'destructive' });
      return;
    }
    if (!window.electronAPI || !window.electronAPI.startImageProcessing) {
        console.error('❌ Processing API not available!');
        console.error('This usually means the app is running in browser mode instead of Electron.');
        console.error('To fix: Close this browser tab and run: npm run electron:dev');
        toast({
          title: 'Electron API Not Available',
          description: 'This app must run in Electron. Close this browser and run: npm run electron:dev',
          variant: 'destructive'
        });
        return;
    }
    if (files.some(file => !file.path)) {
      toast({
        title: 'Missing file locations',
        description: 'At least one selected file does not include an absolute path. Please use the "Select Images" button in the desktop app.',
        variant: 'destructive',
      });
      return;
    }

    startProcessing();
    setIsComplete(false);
    clearErrors();
    setCurrentProcessingFile(files[0]?.name);
    setProcessingSummary(null);

    try {
      const result = await window.electronAPI.startImageProcessing(files, { outputFormat });
      if (!result.success) {
        toast({ title: 'Failed to start processing', description: result.message, variant: 'destructive' });
        stopProcessing();
      }
    } catch (error) {
      console.error('Error starting processing:', error);
      toast({ title: 'Processing Error', description: (error as Error).message, variant: 'destructive' });
      stopProcessing();
    }
  };

  const handleCancelProcessing = async () => {
    if (!window.electronAPI || !window.electronAPI.cancelImageProcessing) {
        toast({ title: 'Error', description: 'Cancellation API not available.', variant: 'destructive' });
        return;
    }
    try {
        const result = await window.electronAPI.cancelImageProcessing();
        if(result.success) {
            toast({ title: 'Processing Cancelled', description: result.message });
        } else {
            toast({ title: 'Cancellation Failed', description: result.message, variant: 'destructive' });
        }
    } catch (error) {
        console.error('Error cancelling processing:', error);
        toast({ title: 'Cancellation Error', description: (error as Error).message, variant: 'destructive' });
    }
    stopProcessing();
    setCurrentProcessingFile(undefined);
  };

  const handleDropZoneSelection = useCallback((incomingFiles: FileMeta[]) => {
    if (incomingFiles.length === 0) {
      return;
    }
    setFiles(incomingFiles);
    setIsComplete(false);
    clearErrors();
    setProcessingSummary(null);
  }, [clearErrors, setFiles]);

  return (
    <div className={cn('w-full max-w-4xl mx-auto p-6 space-y-8', className)}>
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Black Border Remover</h1>
        <p className="text-muted-foreground mt-2">
          Automatically detect and remove black borders from your images
        </p>
      </div>
      
      <div className="bg-card border rounded-lg shadow-sm p-6">
        {isProcessing ? (
          <ProcessingControls
            progress={progress}
            currentFile={currentProcessingFile}
            onCancel={handleCancelProcessing}
          />
        ) : isComplete ? (
          <div className="text-center py-8 space-y-6">
            <div className="flex flex-col items-center justify-center">
              {(processingSummary?.failed ?? errors.length) === 0 ? 
                <CheckCircle className="h-16 w-16 text-primary mb-4" /> :
                <XCircle className="h-16 w-16 text-destructive mb-4" />
              }
              <h2 className="text-xl font-medium">Processing Complete!</h2>
              <p className="text-muted-foreground mt-2">
                {(processingSummary?.failed ?? errors.length) === 0 
                  ? 'All files have been successfully processed and saved to the output folder' 
                  : `${processingSummary?.successful ?? Math.max(files.length - errors.length, 0)} of ${processingSummary?.total ?? files.length} files processed. ${(processingSummary?.failed ?? errors.length)} error(s).`}
              </p>
            </div>
            <div className="flex gap-4 justify-center">
              <Button onClick={async () => {
                if (window.electronAPI) {
                  try {
                    if (outputFolder) {
                      await window.electronAPI.openOutputFolder(outputFolder);
                    }
                  } catch (error) {
                     console.error('Error opening output folder:', error);
                     toast({ title: 'Error', description: 'Could not open output folder.', variant: 'destructive' });
                  }
                } else {
                  toast({ title: 'Error', description: 'API not available.', variant: 'destructive' });
                }
              }}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Open Output Folder
              </Button>
              <Button variant="outline" onClick={() => {
                setIsComplete(false);
                clearFiles();
                clearErrors();
              }}>
                Process More Images
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="space-y-4">
              {files.length === 0 ? (
                <>
                  {dropZoneError ? (
                    <div className="border-2 border-dashed border-red-500 p-8 rounded-lg text-center">
                      <p className="text-red-500 mb-4">Error loading dropzone component: {dropZoneError.message}</p>
                      <Button 
                        size="lg" 
                        onClick={handleSelectFiles}
                      >
                        Select Images
                      </Button>
                    </div>
                  ) : (
                    <React.Suspense fallback={<div>Loading...</div>}>
                      <ErrorBoundary onError={setDropZoneError}>
                        <DropZone onFilesSelected={handleDropZoneSelection} onButtonClick={handleSelectFiles} />
                      </ErrorBoundary>
                    </React.Suspense>
                  )}
                </>
              ) : (
                <FileList
                  files={files}
                  errors={errors}
                  onRemoveFile={(fileId) => setFiles(files.filter(f => f.id !== fileId))}
                  onClearAll={() => { clearFiles(); clearErrors(); }}
                />
              )}
              {files.length > 0 && (
                <div className="flex justify-center mt-4">
                  <Button variant="outline" onClick={handleAddMoreFiles}>
                    Add More Images
                  </Button>
                </div>
              )}
            </div>
            {files.length > 0 && (
              <div className="space-y-6">
                <div className="max-w-xs mx-auto">
                  <OutputFormatSelector
                    value={outputFormat}
                    onValueChange={setOutputFormat}
                    disabled={isProcessing}
                  />
                </div>
                <div className="flex justify-center">
                  <Button size="lg" onClick={handleProcessFiles} disabled={isProcessing}>
                    Process Images ({files.length})
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="text-center text-sm text-muted-foreground">
        <p>Supported formats: JPG, PNG, TIFF, PDF • Max 500 images per batch</p>
      </div>
    </div>
  );
};

// Simple error boundary component
class ErrorBoundary extends React.Component<{
  children: React.ReactNode;
  onError: (error: Error) => void;
}> {
  componentDidCatch(error: Error) {
    console.error("Error in component:", error);
    this.props.onError(error);
  }

  render() {
    return this.props.children;
  }
} 
