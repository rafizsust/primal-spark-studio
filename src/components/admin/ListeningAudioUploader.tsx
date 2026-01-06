import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { UploadCloud, Loader2, Music, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { uploadToR2 } from '@/lib/r2Upload';
import { compressAudio, formatFileSize, estimateCompressedSize, isCompressionSupported } from '@/utils/audioCompressor';

interface ListeningAudioUploaderProps {
  testId: string;
  currentAudioUrl: string | null;
  onUploadSuccess: (url: string) => void;
  onRemoveSuccess: () => void;
}

export function ListeningAudioUploader({
  testId,
  currentAudioUrl,
  onUploadSuccess,
  onRemoveSuccess,
}: ListeningAudioUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (!selectedFile.type.startsWith('audio/')) {
        toast.error('Please upload an audio file.');
        setFile(null);
        return;
      }
      setFile(selectedFile);
      setProgress(0);
    }
  };

  const handleUpload = async () => {
    if (!file || !testId) {
      toast.error('No file selected or test ID missing.');
      return;
    }

    setUploading(true);
    setProgress(0);
    
    let fileToUpload = file;
    let wasCompressed = false;

    // Try compression if supported
    if (isCompressionSupported()) {
      setCompressing(true);
      setCompressionProgress(0);

      try {
        toast.info('Compressing audio for optimal storage...');
        const originalSize = file.size;
        
        const compressedFile = await compressAudio(file, (p) => {
          setCompressionProgress(p);
        });
        
        const compressedSize = compressedFile.size;
        const savings = Math.round((1 - compressedSize / originalSize) * 100);
        
        toast.success(`Compressed: ${formatFileSize(originalSize)} → ${formatFileSize(compressedSize)} (${savings}% smaller)`);
        fileToUpload = compressedFile;
        wasCompressed = true;
      } catch (compressionError: any) {
        console.warn('Compression failed, uploading original file:', compressionError);
        toast.warning('Compression unavailable, uploading original file...');
        // Continue with original file
      } finally {
        setCompressing(false);
        setCompressionProgress(0);
      }
    } else {
      toast.info('Browser does not support compression, uploading original...');
    }

    try {
      // Upload the file (compressed or original)
      const result = await uploadToR2({
        file: fileToUpload,
        folder: `listening-audios/${testId}`,
        onProgress: setProgress,
      });

      if (!result.success || !result.url) {
        throw new Error(result.error || 'Upload failed');
      }

      onUploadSuccess(result.url);
      toast.success(`Audio uploaded successfully!${wasCompressed ? '' : ' (uncompressed)'}`);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      console.error('Error uploading audio:', error);
      toast.error(`Upload failed: ${error.message || 'Unknown error'}`);
    } finally {
      setUploading(false);
      setCompressing(false);
      setProgress(0);
      setCompressionProgress(0);
    }
  };

  const handleRemoveAudio = () => {
    if (!currentAudioUrl) return;
    if (!confirm('Are you sure you want to remove this audio file?')) return;
    onRemoveSuccess();
    toast.success('Audio file removed successfully!');
  };

  return (
    <div className="space-y-4">
      <Label htmlFor="audio-upload">Upload Audio File (MP3, WAV, etc.)</Label>
      {currentAudioUrl ? (
        <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/30">
          <Music size={20} className="text-primary" />
          <span className="flex-1 text-sm truncate">
            {currentAudioUrl.split('/').pop()}
          </span>
          <Button variant="destructive" size="sm" onClick={handleRemoveAudio}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Input
            id="audio-upload"
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            ref={fileInputRef}
            disabled={uploading || compressing}
          />
          {file && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Zap className="h-4 w-4" />
                <span>
                  Original: {formatFileSize(file.size)} → Est. compressed: {formatFileSize(estimateCompressedSize(file.size))}
                </span>
              </div>
              <Button onClick={handleUpload} disabled={uploading || compressing}>
                {compressing ? (
                  <>
                    <Loader2 size={18} className="mr-2 animate-spin" />
                    Compressing ({compressionProgress}%)
                  </>
                ) : uploading ? (
                  <>
                    <Loader2 size={18} className="mr-2 animate-spin" />
                    Uploading ({progress}%)
                  </>
                ) : (
                  <>
                    <UploadCloud size={18} className="mr-2" />
                    Compress & Upload Audio
                  </>
                )}
              </Button>
            </div>
          )}
          {compressing && <Progress value={compressionProgress} className="w-full" />}
          {uploading && !compressing && <Progress value={progress} className="w-full" />}
        </div>
      )}
    </div>
  );
}
