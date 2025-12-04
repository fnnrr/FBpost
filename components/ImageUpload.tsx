import React, { useState, useRef } from 'react';

interface ImageUploadProps {
  onImageSelected: (file: File) => void;
  isLoading: boolean;
  clearImage: () => void;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ onImageSelected, isLoading, clearImage }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Please upload an image file (e.g., JPEG, PNG, GIF).');
        setPreviewUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = ''; // Clear file input
        return;
      }
      onImageSelected(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
      clearImage();
    }
  };

  const handleClearImage = () => {
    setPreviewUrl(null);
    clearImage();
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Clear the file input
    }
  };

  return (
    <div className="border border-gray-300 rounded-lg p-4 flex flex-col items-center">
      <input
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={isLoading}
        className="hidden"
        id="image-upload"
        ref={fileInputRef}
      />
      <label
        htmlFor="image-upload"
        className="cursor-pointer bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {previewUrl ? 'Change Image' : 'Upload Image'}
      </label>

      {previewUrl && (
        <div className="mt-4 text-center">
          <img src={previewUrl} alt="Preview" className="max-h-48 rounded-lg shadow-md mx-auto" />
          <button
            onClick={handleClearImage}
            disabled={isLoading}
            className="mt-2 text-sm text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Remove Image
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
