import React from 'react';
import { cn } from '@/lib/utils';
import { ProgressBar } from '@/components/atoms/ProgressBar';
import { Button } from '@/components/ui/button';
import { Pause, X } from 'lucide-react';

interface ProcessingControlsProps {
  progress: number;
  currentFile?: string;
  isPaused?: boolean;
  onPauseResume?: () => void;
  onCancel?: () => void;
  className?: string;
}

export const ProcessingControls: React.FC<ProcessingControlsProps> = ({
  progress,
  currentFile,
  isPaused = false,
  onPauseResume,
  onCancel,
  className,
}) => {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Processing Images</h3>
          <span className="text-sm text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <ProgressBar progress={progress} showPercentage={false} className="h-6" />
      </div>
      
      {currentFile && (
        <div className="text-sm text-muted-foreground">
          Currently processing: <span className="font-medium">{currentFile}</span>
        </div>
      )}
      
      <div className="flex gap-2 justify-end">
        {onPauseResume && (
          <Button 
            variant="outline" 
            onClick={onPauseResume}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
        )}
        
        {onCancel && (
          <Button 
            variant="outline" 
            className="text-destructive hover:text-destructive" 
            onClick={onCancel}
          >
            <X className="mr-1 h-4 w-4" />
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}; 