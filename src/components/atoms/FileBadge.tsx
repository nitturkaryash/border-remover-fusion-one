import React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { FileMeta } from '@/store/appStore';

interface FileBadgeProps {
  file: FileMeta;
  onRemove?: () => void;
  error?: boolean;
  className?: string;
}

export const FileBadge: React.FC<FileBadgeProps> = ({
  file,
  onRemove,
  error = false,
  className,
}) => {
  // Get file extension
  const extension = file.name.split('.').pop()?.toUpperCase() || '';
  
  // Truncate filename if too long
  const truncatedName = file.name.length > 20
    ? `${file.name.substring(0, 17)}...`
    : file.name;
  
  return (
    <div 
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
        'border transition-all duration-200 ease-in-out',
        error 
          ? 'border-destructive bg-destructive/10 text-destructive' 
          : 'border-border bg-muted',
        className
      )}
    >
      {/* File icon or thumbnail */}
      <div className="flex items-center justify-center w-8 h-8 rounded bg-background font-medium">
        {file.thumbnail ? (
          <img src={file.thumbnail} alt={file.name} className="w-full h-full object-cover rounded" />
        ) : (
          extension
        )}
      </div>
      
      {/* File name */}
      <span className="flex-1" title={file.name}>{truncatedName}</span>
      
      {/* Remove button */}
      {onRemove && (
        <button 
          onClick={onRemove}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Remove ${file.name}`}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}; 