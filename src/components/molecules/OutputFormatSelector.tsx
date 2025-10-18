import React from 'react';
import { FileText } from 'lucide-react';

export const OutputFormatSelector: React.FC = () => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground">
        Output Format
      </label>
      <div className="flex items-center gap-3 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-3">
        <FileText className="h-5 w-5 text-primary" />
        <div>
          <p className="font-medium text-sm">PDF Output</p>
          <p className="text-xs text-muted-foreground">
            PDFs keep vector fidelity when possible; images are embedded at high quality.
          </p>
        </div>
      </div>
    </div>
  );
};
