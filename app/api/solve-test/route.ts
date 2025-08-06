/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import {
  DIRECT_SOLVER_SYSTEM_PROMPT
} from './prompts';

interface Answer {
  question_number?: string;
  question: string;
  answer: string;
  confidence: number;
  reasoning?: string;
}


// Extract text from a single page's data
function extractTextFromPage(pageData: any): string {
  try {
    if (!pageData || !pageData.Texts) {
      return '';
    }
    
    let pageText = '';
    
    // Process text blocks from the page
    for (const textBlock of pageData.Texts) {
      if (textBlock.R && Array.isArray(textBlock.R)) {
        // Extract text from text runs
        for (const textRun of textBlock.R) {
          if (textRun.T) {
            // Decode URI-encoded text and add spacing
            const decodedText = decodeURIComponent(textRun.T);
            pageText += decodedText + ' ';
          }
        }
      }
      pageText += '\n'; // Add line break after each text block
    }
    
    return pageText.trim();
  } catch (error) {
    console.error('Error extracting text from page:', error);
    return '';
  }
}

async function handlePdfFile(buffer: Buffer): Promise<NextResponse> {
  try {
    console.log('Processing PDF file directly with solver...', `Buffer size: ${buffer.length} bytes`);
    
    // Validate buffer
    if (!buffer || buffer.length === 0) {
      throw new Error('Invalid or empty PDF buffer');
    }
    
    // Dynamic import of pdf2json
    let PDFParser;
    try {
      const pdf2jsonModule = await import('pdf2json');
      // Handle both default and named export (v3.1.0+ uses named export)
      PDFParser = pdf2jsonModule.PDFParser || pdf2jsonModule.default;
      console.log('pdf2json imported successfully');
    } catch (importError) {
      console.error('Failed to import pdf2json:', importError);
      throw new Error('PDF processing library not available');
    }
    
    // Create parser instance and extract all text
    const pdfParser = new PDFParser();
    
    const fullText = await new Promise<string>((resolve, reject) => {
      let allText = '';
      
      pdfParser.on("pdfParser_dataError", (errData: any) => {
        console.error('PDF parsing error:', errData.parserError);
        reject(new Error(`PDF parsing failed: ${errData.parserError}`));
      });
      
      pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
        try {
          if (pdfData && pdfData.Pages) {
            for (let pageIndex = 0; pageIndex < pdfData.Pages.length; pageIndex++) {
              const page = pdfData.Pages[pageIndex];
              allText += `\n=== PAGE ${pageIndex + 1} ===\n`;
              allText += extractTextFromPage(page);
              allText += '\n';
            }
          }
          resolve(allText.trim());
        } catch (error) {
          reject(error);
        }
      });
      
      // Start parsing with timeout
      setTimeout(() => reject(new Error('PDF parsing timeout')), 120000);
      pdfParser.parseBuffer(buffer);
    });
    
    if (!fullText || fullText.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No text could be extracted from the PDF file. Please ensure the PDF contains readable text.'
      }, { status: 400 });
    }

    console.log(`PDF text extracted successfully (${fullText.length} characters). Sending to solver...`);
    
    // Send the full text directly to the solver
    const solverLLM = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      modelKwargs: {
        response_format: { type: "json_object" }
      }
    });

    const solverResponse = await solverLLM.invoke([
      {
        role: 'system',
        content: DIRECT_SOLVER_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: `Please analyze this complete test document and solve all questions found within it:\n\n${fullText}`
      }
    ]);

    const solvedContent = solverResponse.content as string;
    console.log('PDF solving completed');

    // Parse the solver response
    let solverData: any;
    try {
      solverData = JSON.parse(solvedContent);
      
      if (!solverData.answers || !Array.isArray(solverData.answers)) {
        throw new Error('Invalid solver response structure');
      }
      
    } catch (parseError) {
      console.error('Failed to parse solver response:', parseError);
      return NextResponse.json({
        success: false,
        error: 'Failed to process the test document. Please try again.'
      }, { status: 500 });
    }

    console.log(`Successfully solved PDF: ${solverData.answers.length} questions answered`);

    return NextResponse.json({
      success: true,
      answers: solverData.answers,
      metadata: {
        total_questions: solverData.answers.length,
        average_confidence: solverData.summary?.average_confidence || 0.5,
        document_type: solverData.summary?.document_type || 'test'
      }
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    
    let errorMessage = 'Failed to process PDF file.';
    
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        errorMessage = 'PDF processing timed out. The file is too large or complex.';
      } else if (error.message.includes('memory') || error.message.includes('heap')) {
        errorMessage = 'PDF file is too large to process.';
      } else if (error.message.includes('parsing')) {
        errorMessage = 'PDF file appears to be corrupted or uses an unsupported format.';
      } else {
        errorMessage = `PDF processing error: ${error.message}`;
      }
    }
    
    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 });
  }
}

// Configure API route for large responses and longer execution time
export const config = {
  api: {
    responseLimit: '50mb',
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 300, // 5 minutes
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mimeType = file.type;

    // Handle PDF files
    if (mimeType === 'application/pdf') {
      console.log('Processing PDF file:', file.name, 'Size:', buffer.length, 'bytes');
      
      // Check file size limit (50MB)
      if (buffer.length > 50 * 1024 * 1024) {
        return NextResponse.json({
          success: false,
          error: 'PDF file is too large. Please use a file smaller than 50MB.'
        }, { status: 413 });
      }
      
      try {
        return await handlePdfFile(buffer);
      } catch (error) {
        console.error('PDF processing failed:', error);
        return NextResponse.json({
          success: false,
          error: 'Failed to process PDF file. The file might be corrupted or contain unsupported content.'
        }, { status: 500 });
      }
    }

    // Handle image files with direct solver approach
    const base64Image = buffer.toString('base64');

    console.log('Processing image directly with solver...');
    
    try {
      // Send the image directly to the solver
      const solverLLM = new ChatOpenAI({
        model: 'gpt-4o',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
        modelKwargs: {
          response_format: { type: "json_object" }
        }
      });

      const solverResponse = await solverLLM.invoke([
        {
          role: 'system',
          content: DIRECT_SOLVER_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Please analyze this test image and solve all questions found within it.'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'high'
              },
            },
          ],
        }
      ]);

      const solvedContent = solverResponse.content as string;
      console.log('Image solving completed');

      // Parse the solver response
      let solverData: any;
      try {
        solverData = JSON.parse(solvedContent);
        
        if (!solverData.answers || !Array.isArray(solverData.answers)) {
          throw new Error('Invalid solver response structure');
        }
        
      } catch (parseError) {
        console.error('Failed to parse solver response:', parseError);
        return NextResponse.json({
          success: false,
          error: 'Failed to process the test image. Please try again.'
        }, { status: 500 });
      }

      console.log(`Successfully solved image: ${solverData.answers.length} questions answered`);

      return NextResponse.json({
        success: true,
        answers: solverData.answers,
        metadata: {
          total_questions: solverData.answers.length,
          average_confidence: solverData.summary?.average_confidence || 0.5,
          document_type: solverData.summary?.document_type || 'test'
        }
      });

    } catch (error) {
      console.error('Error processing image:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to process the test image. Please try again.'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Error in multi-agent processing:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process image. Please try again.' 
      },
      { status: 500 }
    );
  }
}

