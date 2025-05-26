import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, X, RotateCcw } from 'lucide-react';

interface ImagePreviewProps {
  isOpen: boolean;
  onClose: () => void;
  onDownload: () => void;
  originalImage: string;
  processedImage: string;
  fileName: string;
  borderInfo?: {
    cropped: boolean;
    originalSize: { width: number; height: number };
    newSize?: { width: number; height: number };
    borderSizes?: {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
  };
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({
  isOpen,
  onClose,
  onDownload,
  originalImage,
  processedImage,
  fileName,
  borderInfo
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Preview: {fileName}
            {borderInfo?.cropped ? (
              <span className="text-green-600 text-sm font-normal">
                ✂️ Borders Detected & Removed
              </span>
            ) : (
              <span className="text-blue-600 text-sm font-normal">
                ℹ️ No Borders Detected
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-4">
          {/* Original Image */}
          <div className="space-y-3">
            <h3 className="font-semibold text-lg">Original</h3>
            <div className="border rounded-lg overflow-hidden bg-gray-50">
              <img 
                src={originalImage} 
                alt="Original" 
                className="w-full h-auto max-h-96 object-contain"
              />
            </div>
            {borderInfo && (
              <div className="text-sm text-gray-600">
                Size: {borderInfo.originalSize.width} × {borderInfo.originalSize.height}px
              </div>
            )}
          </div>

          {/* Processed Image */}
          <div className="space-y-3">
            <h3 className="font-semibold text-lg">
              {borderInfo?.cropped ? 'After Border Removal' : 'Processed (No Changes)'}
            </h3>
            <div className="border rounded-lg overflow-hidden bg-gray-50">
              <img 
                src={processedImage} 
                alt="Processed" 
                className="w-full h-auto max-h-96 object-contain"
              />
            </div>
            {borderInfo?.newSize && (
              <div className="text-sm text-gray-600">
                Size: {borderInfo.newSize.width} × {borderInfo.newSize.height}px
              </div>
            )}
          </div>
        </div>

        {/* Border Detection Info */}
        {borderInfo?.cropped && borderInfo.borderSizes && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-2">Border Detection Details</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-blue-700 font-medium">Top:</span> {borderInfo.borderSizes.top}px
              </div>
              <div>
                <span className="text-blue-700 font-medium">Bottom:</span> {borderInfo.borderSizes.bottom}px
              </div>
              <div>
                <span className="text-blue-700 font-medium">Left:</span> {borderInfo.borderSizes.left}px
              </div>
              <div>
                <span className="text-blue-700 font-medium">Right:</span> {borderInfo.borderSizes.right}px
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex items-center gap-2">
            <X className="w-4 h-4" />
            Cancel
          </Button>
          <Button onClick={onDownload} className="flex items-center gap-2">
            <Download className="w-4 h-4" />
            Download Processed Image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}; 