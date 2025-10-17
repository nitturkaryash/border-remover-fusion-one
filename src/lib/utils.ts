import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { v4 as uuidv4 } from "uuid"
import { FileMeta } from "@/store/appStore"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function createOutputFolderName(): string {
  const now = new Date()
  const date = now.toISOString().split('T')[0] // YYYY-MM-DD
  return `${date}_processed`
}

export function isSupportedImageType(file: File): boolean {
  const supportedTypes = ['image/jpeg', 'image/png', 'image/tiff', 'application/pdf']
  return supportedTypes.includes(file.type)
}

export function createFileMeta(file: File): FileMeta {
  return {
    id: uuidv4(),
    name: file.name,
    path: '', // This will be set by the Electron main process when needed
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    thumbnail: '',
  }
}

export async function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        
        // Calculate dimensions for thumbnail (max 100px)
        const maxSize = 100
        const scale = Math.min(maxSize / img.width, maxSize / img.height)
        const width = img.width * scale
        const height = img.height * scale
        
        canvas.width = width
        canvas.height = height
        
        ctx?.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = e.target?.result as string
    }
    
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function buildFileMetaList(fileList: FileList | File[]): Promise<{
  files: FileMeta[];
  unsupportedCount: number;
}> {
  const list = Array.isArray(fileList) ? fileList : Array.from(fileList);

  const supportedFiles = list.filter(isSupportedImageType);
  const unsupportedCount = list.length - supportedFiles.length;

  const files: FileMeta[] = await Promise.all(
    supportedFiles.map(async (file) => {
      const meta = createFileMeta(file);

      // Electron adds the absolute path to File objects, browsers do not
      const possiblePath = (file as unknown as { path?: string }).path;
      if (possiblePath) {
        meta.path = possiblePath;
      }

      const shouldGenerateThumbnail = file.type.startsWith('image/');

      if (shouldGenerateThumbnail) {
        try {
          meta.thumbnail = await generateThumbnail(file);
        } catch (error) {
          console.error('Failed to generate thumbnail:', error);
        }
      }

      return meta;
    })
  );

  return { files, unsupportedCount };
}
