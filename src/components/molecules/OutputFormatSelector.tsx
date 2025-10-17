import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { OutputFormat } from '@/store/appStore';
import { FileImage, FileText, Image, Download } from 'lucide-react';

interface OutputFormatSelectorProps {
  value: OutputFormat;
  onValueChange: (format: OutputFormat) => void;
  disabled?: boolean;
}

const formatOptions = [
  {
    value: 'original' as OutputFormat,
    label: 'Original Format',
    description: 'Keep the same format as input',
    icon: Download,
  },
  {
    value: 'png' as OutputFormat,
    label: 'PNG',
    description: 'High quality, lossless compression',
    icon: Image,
  },
  {
    value: 'jpg' as OutputFormat,
    label: 'JPG',
    description: 'Smaller file size, good quality',
    icon: Image,
  },
  {
    value: 'pdf' as OutputFormat,
    label: 'PDF',
    description: 'Document format (via PNG conversion)',
    icon: FileText,
  },
  {
    value: 'svg' as OutputFormat,
    label: 'SVG',
    description: 'Vector format (via PNG conversion)',
    icon: FileImage,
  },
];

export const OutputFormatSelector: React.FC<OutputFormatSelectorProps> = ({
  value,
  onValueChange,
  disabled = false,
}) => {
  const selectedOption = formatOptions.find(option => option.value === value);
  const SelectedIcon = selectedOption?.icon || Download;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground">
        Output Format
      </label>
      <Select 
        value={value} 
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <div className="flex items-center gap-2">
            <SelectedIcon className="h-4 w-4" />
            <SelectValue placeholder="Select output format" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {formatOptions.map((option) => {
            const Icon = option.icon;
            return (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}; 