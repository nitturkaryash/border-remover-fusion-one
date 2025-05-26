import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  progress: number;  // 0-100
  showPercentage?: boolean;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  showPercentage = true,
  className,
}) => {
  // Ensure progress is between 0-100
  const safeProgress = Math.max(0, Math.min(100, progress));
  
  return (
    <div className={cn('relative w-full h-4 bg-secondary rounded-full overflow-hidden', className)}>
      <div 
        className="h-full bg-primary transition-all duration-200 ease-in-out rounded-full"
        style={{ width: `${safeProgress}%` }}
      />
      {showPercentage && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-medium">
          {Math.round(safeProgress)}%
        </div>
      )}
    </div>
  );
}; 