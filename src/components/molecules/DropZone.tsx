import React, { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ImagePlus } from 'lucide-react';
import { buildFileMetaList } from '@/lib/utils';
import { FileMeta } from '@/store/appStore';
import { useToast } from '@/hooks/use-toast';

interface DropZoneProps {
  onFilesSelected: (files: FileMeta[]) => void;
  onButtonClick?: () => void;
  className?: string;
}

export const DropZone: React.FC<DropZoneProps> = ({
  onFilesSelected,
  onButtonClick,
  className,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);
  
  const handleFilesSelected = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    
    try {
      const { files, unsupportedCount } = await buildFileMetaList(fileList);

      if (unsupportedCount > 0) {
        toast({
          title: `${unsupportedCount} unsupported file(s) skipped`,
          description: 'Only JPG, PNG, TIFF and PDF files are supported',
          variant: 'default',
        });
      }

      if (files.length === 0) {
        return;
      }

      onFilesSelected(files);
    } catch (error) {
      toast({
        title: 'Error processing files',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  }, [onFilesSelected, toast]);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    handleFilesSelected(e.dataTransfer.files);
  }, [handleFilesSelected]);
  
  const handleLocalButtonClick = useCallback(() => {
    if (onButtonClick) {
      onButtonClick();
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/jpeg,image/png,image/tiff,application/pdf';
      
      input.onchange = (e) => {
        const target = e.target as HTMLInputElement;
        handleFilesSelected(target.files);
      };
      
      input.click();
    }
  }, [onButtonClick, handleFilesSelected]);
  
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center p-8 rounded-lg border-2 border-dashed transition-colors duration-200',
        isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
        className
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Button 
        size="lg" 
        className="w-64 h-16 text-lg"
        onClick={handleLocalButtonClick}
      >
        <ImagePlus className="mr-2 h-5 w-5" />
        Select Images
      </Button>
      <p className="text-sm text-muted-foreground mt-2">
        or drag and drop images here
      </p>
      
      <div className="mt-4 text-xs text-muted-foreground">
        Supported formats: JPG, PNG, TIFF, PDF
      </div>
    </div>
  );
}; 
