'use client';

import { useState } from 'react';
import { Upload, Camera, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import Image from 'next/image';

interface Answer {
  question: string;
  answer: string;
  confidence: number;
}

interface ProcessingResult {
  success: boolean;
  answers?: Answer[];
  error?: string;
}

export default function TestSolverApp() {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ProcessingResult | null>(null);

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      setResults(null);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageUpload = async () => {
    if (!selectedImage) return;

    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('image', selectedImage);

      const response = await fetch('/api/solve-test', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      setResults(result);
    } catch {
      setResults({
        success: false,
        error: 'Failed to process image. Please try again.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const resetForm = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setResults(null);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Upload Section */}
        <div className="p-6">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
            {!imagePreview ? (
              <div>
                <div className="flex justify-center mb-4">
                  <div className="p-3 bg-blue-100 rounded-full">
                    <Upload className="w-8 h-8 text-blue-600" />
                  </div>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Upload Test Image
                </h3>
                <p className="text-gray-500 mb-4">
                  Select an image containing test questions to solve
                </p>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                  <span className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
                    <Camera className="w-4 h-4 mr-2" />
                    Choose Image
                  </span>
                </label>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <Image
                    src={imagePreview}
                    alt="Selected test image"
                    width={400}
                    height={300}
                    className="mx-auto rounded-lg shadow-md max-h-96 object-contain"
                  />
                </div>
                <div className="flex justify-center gap-4">
                  <button
                    onClick={handleImageUpload}
                    disabled={isProcessing}
                    className="inline-flex items-center px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Solve Questions'
                    )}
                  </button>
                  <button
                    onClick={resetForm}
                    disabled={isProcessing}
                    className="inline-flex items-center px-6 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Results Section */}
        {results && (
          <div className="border-t border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Results</h3>
            
            {results.success ? (
              <div className="space-y-4">
                {results.answers?.map((answer, index) => (
                  <div key={index} className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <CheckCircle className="w-5 h-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 mb-2">
                          Question {index + 1}:
                        </h4>
                        <p className="text-gray-700 mb-3 italic">
                          &ldquo;{answer.question}&rdquo;
                        </p>
                        <div className="bg-white border border-green-200 rounded p-3">
                          <p className="text-gray-800 font-medium">Answer:</p>
                          <p className="text-gray-700 mt-1">{answer.answer}</p>
                        </div>
                        <div className="mt-2 text-sm text-gray-600">
                          Confidence: {Math.round(answer.confidence * 100)}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center">
                  <AlertCircle className="w-5 h-5 text-red-600 mr-3" />
                  <div>
                    <h4 className="font-medium text-red-900">Error</h4>
                    <p className="text-red-700 mt-1">
                      {results.error || 'An unexpected error occurred'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}