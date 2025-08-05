'use client';

import { useState } from 'react';
import { Upload, Camera, Loader2, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import Image from 'next/image';
import { getTextDirection } from '../utils/languageDetection';

interface Answer {
  question: string;
  answer: string;
  confidence: number;
  reasoning?: string;
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
  const [processingStatus, setProcessingStatus] = useState<string>('');

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file size (50MB limit)
      const maxSize = 50 * 1024 * 1024; // 50MB in bytes
      if (file.size > maxSize) {
        alert('File is too large. Please select a file smaller than 50MB.');
        event.target.value = ''; // Clear the file input
        return;
      }
      
      setSelectedImage(file);
      setResults(null);
      setProcessingStatus(''); // Clear any previous status
      
      // Only create preview for image files
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setImagePreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        // For PDFs, set a placeholder preview
        setImagePreview('pdf');
      }
    }
  };

  const handleImageUpload = async () => {
    if (!selectedImage) return;

    setIsProcessing(true);
    setProcessingStatus('Uploading and analyzing your test...');
    setResults(null);
    
    try {
      const formData = new FormData();
      formData.append('image', selectedImage);

      // Update status based on file type
      if (selectedImage.type === 'application/pdf') {
        setProcessingStatus('Processing PDF - starting async extraction and solving pipeline...');
      } else {
        setProcessingStatus('Extracting questions from your test...');
      }
      
      // Create AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 300000); // 5 minute timeout
      
      const response = await fetch('/api/solve-test', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        // Try to get error message from response
        let errorMessage = `Server error (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If can't parse JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      if (selectedImage.type === 'application/pdf') {
        setProcessingStatus('PDF processed - extraction and solving completed concurrently...');
      } else {
        setProcessingStatus('Processing individual questions asynchronously...');
      }
      
      const result = await response.json();
      
      if (result.success) {
        setProcessingStatus(`Successfully solved ${result.answers?.length || 0} questions!`);
      }
      
      setResults(result);
    } catch (error) {
      console.error('Upload error:', error);
      
      let errorMessage = 'Failed to process file. Please try again.';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Processing timed out. The file might be too large or complex. Please try a smaller file.';
        } else if (error.message.includes('Failed to fetch')) {
          errorMessage = 'Network error. Please check your internet connection and try again.';
        } else {
          errorMessage = error.message;
        }
      }
      
      setResults({
        success: false,
        error: errorMessage,
      });
      setProcessingStatus('');
    } finally {
      setIsProcessing(false);
      // Clear status after a delay
      setTimeout(() => setProcessingStatus(''), 3000);
    }
  };

  const resetForm = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setResults(null);
    setProcessingStatus('');
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
                  Upload Test File
                </h3>
                <p className="text-gray-500 mb-4">
                  Select an image (JPG, PNG) or PDF containing test questions to solve
                </p>
                <p className="text-sm text-gray-400 mb-4">
                  ✓ Images: Screenshots, photos of tests, handwritten questions<br/>
                  ✓ PDFs: Digital tests, exams, quizzes, homework assignments (max 50MB)
                </p>
                <p className="text-xs text-amber-600 mb-4">
                  Note: Large PDF files may take several minutes to process
                </p>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleImageSelect}
                    className="hidden"
                    max="52428800"
                  />
                  <span className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
                    <Camera className="w-4 h-4 mr-2" />
                    Choose File
                  </span>
                </label>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  {imagePreview === 'pdf' ? (
                    <div className="flex flex-col items-center justify-center py-8 px-4 bg-blue-50 rounded-lg border-2 border-blue-200">
                      <FileText className="w-16 h-16 text-blue-500 mb-2" />
                      <p className="text-gray-700 font-medium">{selectedImage?.name}</p>
                      <p className="text-blue-600 text-sm">PDF test document ready for processing</p>
                      <p className="text-gray-500 text-xs mt-1">Will extract and solve all questions automatically</p>
                    </div>
                  ) : (
                    <Image
                      src={imagePreview}
                      alt="Selected test file"
                      width={400}
                      height={300}
                      className="mx-auto rounded-lg shadow-md max-h-96 object-contain"
                    />
                  )}
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
                {processingStatus && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin text-blue-600" />
                      <p className="text-blue-700 text-sm">{processingStatus}</p>
                    </div>
                  </div>
                )}
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
                        <p 
                          className="text-gray-700 mb-3 italic question-text"
                          style={{ 
                            direction: getTextDirection(answer.question),
                            textAlign: getTextDirection(answer.question) === 'rtl' ? 'right' : 'left'
                          }}
                        >
                          &ldquo;{answer.question}&rdquo;
                        </p>
                        <div className="bg-white border border-green-200 rounded p-3">
                          <p className="text-gray-800 font-medium">Answer:</p>
                          <p 
                            className="text-gray-700 mt-1 text-lg font-semibold answer-text"
                            style={{ 
                              direction: getTextDirection(answer.answer),
                              textAlign: getTextDirection(answer.answer) === 'rtl' ? 'right' : 'left'
                            }}
                          >
                            {answer.answer}
                          </p>
                          {answer.reasoning && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                              <p className="text-gray-600 text-sm font-medium">Reasoning:</p>
                              <p 
                                className="text-gray-600 text-sm mt-1 answer-text"
                                style={{ 
                                  direction: getTextDirection(answer.reasoning),
                                  textAlign: getTextDirection(answer.reasoning) === 'rtl' ? 'right' : 'left'
                                }}
                              >
                                {answer.reasoning}
                              </p>
                            </div>
                          )}
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