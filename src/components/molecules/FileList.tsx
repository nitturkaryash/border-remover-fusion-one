import React from 'react';
import { cn } from '@/lib/utils';
import { FileBadge } from '@/components/atoms/FileBadge';
import { FileMeta, ProcessingError } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface FileListProps {
  files: FileMeta[];
  errors?: ProcessingError[];
  onRemoveFile?: (fileId: string) => void;
  onClearAll?: () => void;
  className?: string;
}

export const FileList: React.FC<FileListProps> = ({
  files,
  errors = [],
  onRemoveFile,
  onClearAll,
  className,
}) => {
  if (!files.length) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <p>No files selected</p>
      </div>
    );
  }

  // Create a map of file IDs with errors
  const fileErrors = new Map(errors.map(error => [error.fileId, error]));
  
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Selected Files ({files.length})</h3>
        {onClearAll && files.length > 1 && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onClearAll}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Clear All
          </Button>
        )}
      </div>
      
      <div className="max-h-[40vh] overflow-y-auto space-y-2 p-1">
        {files.map(file => (
          <FileBadge 
            key={file.id}
            file={file}
            error={fileErrors.has(file.id)}
            onRemove={onRemoveFile ? () => onRemoveFile(file.id) : undefined}
          />
        ))}
      </div>
      
      {errors.length > 0 && (
        <div className="mt-4 p-3 border border-destructive/50 rounded-lg bg-destructive/10 text-destructive text-sm">
          <p className="font-medium">Errors ({errors.length})</p>
          <ul className="mt-1 list-disc list-inside">
            {errors.slice(0, 3).map((error, index) => (
              <li key={index}>{error.message} ({error.fileName})</li>
            ))}
            {errors.length > 3 && <li>...and {errors.length - 3} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}; 