/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_PROMPT
} from './prompts';

interface Answer {
  question: string;
  answer: string;
  confidence: number;
  reasoning?: string;
}

// Interface to track page processing
interface PageData {
  pageNumber: number;
  pageText: string;
  rawData: any;
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
    console.log('Processing PDF file with page-by-page analysis...', `Buffer size: ${buffer.length} bytes`);
    
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
    
    // Create parser instance
    const pdfParser = new PDFParser();
    
    // Process PDF page by page using streaming events with timeout
    const { pages, totalPages } = await Promise.race([
      new Promise<{pages: PageData[], totalPages: number}>((resolve, reject) => {
      const pages: PageData[] = [];
      let currentPageNumber = 0;
      let totalPages = 0;
      
      // Set up event handlers for page-by-page processing
      pdfParser.on("pdfParser_dataError", (errData: any) => {
        console.error('PDF parsing error:', errData.parserError);
        reject(new Error(`PDF parsing failed: ${errData.parserError}`));
      });
      
      // Handle metadata and total page count
      pdfParser.on("readable", (meta: any) => {
        console.log('PDF Metadata received:', meta);
      });
      
      // Handle each page as it's processed
      pdfParser.on("data", (pageData: any) => {
        if (pageData) {
          // Individual page processed
          currentPageNumber++;
          
          // Extract text from this specific page
          const pageText = extractTextFromPage(pageData);
          
          console.log(`Page ${currentPageNumber} processed: ${pageText.length} characters`);
          
          pages.push({
            pageNumber: currentPageNumber,
            pageText: pageText,
            rawData: pageData
          });
        } else {
          // null indicates all pages are done
          totalPages = currentPageNumber;
          console.log(`All ${totalPages} pages processed successfully`);
          resolve({ pages, totalPages });
        }
      });
      
      // Handle parsing completion - use pdfParser_dataReady event
      pdfParser.on("pdfParser_dataReady" as any, () => {
        console.log('PDF parsing completed - all data ready');
        if (pages.length === 0) {
          reject(new Error('No pages were processed from the PDF'));
        } else {
          resolve({ pages, totalPages: pages.length });
        }
      });
      
        // Start parsing the buffer
        console.log('Starting page-by-page PDF parsing...');
        pdfParser.parseBuffer(buffer);
      }),
      // Timeout after 2 minutes
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('PDF parsing timeout - file is too complex or large')), 120000)
      )
    ]);
    
    console.log(`PDF processed successfully: ${totalPages} pages, processing questions page by page...`);
    
    // Process each page with AI to extract questions using async pipeline
    
    // Filter out empty pages
    const validPages = pages.filter(page => page.pageText.trim().length > 0);
    
    if (validPages.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No text could be extracted from the PDF file. Please ensure the PDF contains readable text.'
      }, { status: 400 });
    }

    console.log(`Processing ${validPages.length} valid pages for question extraction...`);
    
    // Create async pipeline for concurrent extraction and solving
    const questionQueue: any[] = [];
    const solvedAnswers: Answer[] = [];
    let extractionComplete = false;
    let totalExtractedQuestions = 0;
    
    // Start the solving agent as a separate async process
    const solvingProcess = startSolvingAgent(questionQueue, solvedAnswers, () => extractionComplete && questionQueue.length === 0);
    
    // Process pages in batches to manage context window and API limits
    const batchSize = 3; // Process 3 pages at a time to stay within context limits
    const pageBatches = [];
    
    for (let i = 0; i < validPages.length; i += batchSize) {
      pageBatches.push(validPages.slice(i, i + batchSize));
    }
    
    console.log(`Created ${pageBatches.length} batches for processing with async pipeline`);
    
    // Process each batch of pages with enhanced error handling (ASYNC EXTRACTION)
    for (let batchIndex = 0; batchIndex < pageBatches.length; batchIndex++) {
      const batch = pageBatches[batchIndex];
      console.log(`Processing batch ${batchIndex + 1}/${pageBatches.length} with ${batch.length} pages...`);
      
      // Create batch text with page markers
      let batchText = '';
      for (const page of batch) {
        batchText += `\n=== PAGE ${page.pageNumber} ===\n${page.pageText}\n`;
      }
      
      try {
        // Extract questions from this batch using AI
        console.log(`Extracting questions from batch ${batchIndex + 1}...`);
        const extractionLLM = new ChatOpenAI({
          model: 'gpt-4o',
          temperature: 0,
          apiKey: process.env.OPENAI_API_KEY,
          modelKwargs: {
            response_format: { type: "json_object" }
          }
        });

        const batchExtractionPrompt = `Please analyze the following text extracted from PDF pages and identify all questions present. 

IMPORTANT INSTRUCTIONS:
1. Look for numbered questions (1., 2., Q1, Question 1, etc.)
2. Identify question types: multiple choice (A/B/C/D options), true/false, fill-in-blank, short answer, essay, mathematical problems
3. Extract the complete question text including any context or setup
4. For multiple choice, capture all answer options with their labels
5. Maintain the original question numbering from the document
6. Pay attention to question sections, parts (a), (b), etc.
7. Include any diagrams, charts, or reference materials mentioned
8. Note which page each question appears on

Format your response as JSON:
{
  "questions": [
    {
      "question": "Complete question text with all context",
      "type": "multiple_choice|math|short_answer|essay|true_false|fill_blank|general",
      "choices": ["A. option1", "B. option2", "C. option3", "D. option4"] or null,
      "context": "any additional context, formulas, or reference material",
      "question_number": "original question numbering from document",
      "page_number": ${batch[0].pageNumber},
      "section": "section or part if applicable",
      "points": "point value if mentioned"
    }
  ],
  "batch_info": {
    "pages_processed": [${batch.map(p => p.pageNumber).join(', ')}],
    "total_questions": "number of questions found in this batch"
  }
}

PDF Text to analyze:
${batchText}`;

        const extractionResponse = await extractionLLM.invoke([
          {
            role: 'system',
            content: 'You are an expert at extracting and structuring questions from academic test documents. Always respond in valid JSON format.'
          },
          {
            role: 'user',
            content: batchExtractionPrompt
          }
        ]);

        const extractedQuestions = extractionResponse.content as string;
        console.log(`Batch ${batchIndex + 1} extraction completed`);

        // Parse extracted questions
        let batchQuestionsData: any;
        try {
          batchQuestionsData = JSON.parse(extractedQuestions);
          
          if (batchQuestionsData.questions && Array.isArray(batchQuestionsData.questions)) {
            // Process and validate questions
            const processedQuestions = batchQuestionsData.questions.map((q: any, index: number) => ({
              question: q.question || `Question from page ${batch[0].pageNumber}`,
              type: q.type || 'general',
              choices: q.choices || null,
              context: q.context || null,
              question_number: q.question_number || `${batch[0].pageNumber}-${index + 1}`,
              page_number: q.page_number || batch[0].pageNumber,
              section: q.section || null,
              points: q.points || null,
            }));
            
            // Add questions to async queue for immediate processing by solve agent
            questionQueue.push(...processedQuestions);
            totalExtractedQuestions += processedQuestions.length;
            console.log(`Batch ${batchIndex + 1}: Added ${processedQuestions.length} questions to processing queue (Total: ${totalExtractedQuestions})`);
          }
          
        } catch (parseError) {
          console.error(`Failed to parse questions from batch ${batchIndex + 1}:`, parseError);
          // Continue with next batch instead of failing entirely
        }
        
      } catch (batchError) {
        console.error(`Error processing batch ${batchIndex + 1}:`, batchError);
        // Continue with next batch
      }
      
      // Add delay between batches to respect API rate limits and manage memory
      if (batchIndex < pageBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }
    }
    
    // Mark extraction as complete
    extractionComplete = true;
    console.log(`Question extraction completed. Found ${totalExtractedQuestions} questions total.`);
    
    if (totalExtractedQuestions === 0) {
      return NextResponse.json({
        success: false,
        error: 'No questions could be identified in the PDF. Please ensure the PDF contains clear test questions.'
      }, { status: 400 });
    }

    // Wait for all solving to complete
    console.log(`Waiting for solve agent to complete processing ${totalExtractedQuestions} questions...`);
    await solvingProcess;
    
    if (solvedAnswers.length === 0) {
      throw new Error('No valid answers generated');
    }
    
    console.log(`Successfully processed PDF answers: ${solvedAnswers.length} questions solved`);

    return NextResponse.json({
      success: true,
      answers: solvedAnswers,
      metadata: {
        total_pages: totalPages,
        questions_found: totalExtractedQuestions,
        answers_generated: solvedAnswers.length
      }
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    
    // Determine error type and provide specific feedback
    let errorMessage = 'Failed to process PDF file.';
    
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        errorMessage = 'PDF processing timed out. The file is too large or complex. Please try a smaller file or convert to images.';
      } else if (error.message.includes('memory') || error.message.includes('heap')) {
        errorMessage = 'PDF file is too large to process. Please try a smaller file or split it into multiple files.';
      } else if (error.message.includes('parsing')) {
        errorMessage = 'PDF file appears to be corrupted or uses an unsupported format. Please try converting it to images.';
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

    // Handle image files (existing logic)
    const base64Image = buffer.toString('base64');

    // Process the image directly with individual agents
    console.log('Starting multi-agent processing...');
    
    let answers: Answer[] = [];
    
    try {
      // Step 1: Extract questions from image
      console.log('Step 1: Extracting questions...');
      const extractionLLM = new ChatOpenAI({
        model: 'gpt-4o',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
        modelKwargs: {
          response_format: { type: "json_object" }
        }
      });

      const extractionResponse = await extractionLLM.invoke([
        {
          role: 'system',
          content: EXTRACTION_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: EXTRACTION_USER_PROMPT
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

      const extractedQuestions = extractionResponse.content as string;
      console.log('Extracted questions:', extractedQuestions);

      // Parse extracted questions with improved error handling
      let questionsData: any;
      try {
        questionsData = JSON.parse(extractedQuestions);
        
        // Validate the structure
        if (!questionsData.questions || !Array.isArray(questionsData.questions)) {
          throw new Error('Invalid questions structure');
        }
        
        // Ensure each question has required fields
        questionsData.questions = questionsData.questions.map((q: any, index: number) => ({
          question: q.question || `Question ${index + 1}`,
          type: q.type || 'general',
          choices: q.choices || null,
          visual_elements: q.visual_elements || null,
          context: q.context || questionsData.page_context || null,
          question_number: q.question_number || (index + 1).toString(),
          formatting_notes: q.formatting_notes || null,
          related_questions: q.related_questions || null
        }));
        
      } catch (error) {
        console.error('Failed to parse extracted questions:', error);
        console.error('Raw response:', extractedQuestions);
        
        // Fallback: try to extract questions manually from the response
        const fallbackQuestions = extractQuestionsManually(extractedQuestions);
        if (fallbackQuestions.length > 0) {
          questionsData = { questions: fallbackQuestions };
        } else {
          throw new Error('Question extraction failed completely');
        }
      }

      // Step 2: Solve questions individually using async processing
      console.log('Step 2: Solving questions individually...');
      answers = await solveQuestionsIndividually(questionsData.questions);
      
      if (answers.length === 0) {
        throw new Error('No valid answers generated');
      }
      
      console.log(`Successfully processed image answers: ${answers.length} questions solved`);

    } catch (error) {
      console.error('Error in multi-agent processing:', error);
      answers = [{
        question: "Processing Error",
        answer: "Unable to process the test image. Please ensure the image contains clear, readable questions and try again.",
        confidence: 0.1
      }];
    }

    return NextResponse.json({
      success: true,
      answers,
    });

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


// Fallback function to extract questions manually when JSON parsing fails
function extractQuestionsManually(response: string): any[] {
  const questions: any[] = [];
  
  try {
    // Try to find question-like patterns in the response
    const questionPatterns = [
      /(?:Question\s*\d+[:\.]?\s*)(.*?)(?=Question\s*\d+|$)/gi,
      /(?:^\d+[:\.]?\s*)(.*?)(?=^\d+[:\.]|$)/gm,
      /(?:.*\?\s*$)/gm
    ];
    
    for (const pattern of questionPatterns) {
      const matches = response.match(pattern);
      if (matches && matches.length > 0) {
        matches.forEach((match, index) => {
          const cleanMatch = match.trim();
          if (cleanMatch.length > 10) { // Avoid very short matches
            questions.push({
              question: cleanMatch,
              type: 'general',
              choices: null,
              visual_elements: null,
              context: null,
              question_number: (index + 1).toString(),
              formatting_notes: null,
              related_questions: null
            });
          }
        });
        break; // Use first successful pattern
      }
    }
    
    // If no patterns found, create a single general question
    if (questions.length === 0) {
      questions.push({
        question: "Unable to parse specific questions from the image",
        type: 'general',
        choices: null,
        visual_elements: "Image contains text that could not be parsed",
        context: null,
        question_number: "1",
        formatting_notes: null,
        related_questions: null
      });
    }
    
  } catch (error) {
    console.error('Manual extraction failed:', error);
  }
  
  return questions;
}

// Async solving agent that processes questions from queue as they become available
async function startSolvingAgent(
  questionQueue: any[], 
  solvedAnswers: Answer[], 
  isComplete: () => boolean
): Promise<void> {
  console.log('🚀 Starting async solving agent...');
  
  const processedQuestions = new Set<string>();
  let processedCount = 0;
  
  while (!isComplete() || questionQueue.length > 0) {
    // Check if there are questions to process
    if (questionQueue.length === 0) {
      // Wait a bit for more questions to arrive
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    
    // Take questions from queue (up to 3 at a time to manage context window)
    const batchSize = Math.min(3, questionQueue.length);
    const questionsToProcess = questionQueue.splice(0, batchSize);
    
    // Filter out duplicates
    const uniqueQuestions = questionsToProcess.filter(q => {
      const questionId = `${q.question_number}-${q.question.substring(0, 50)}`;
      if (processedQuestions.has(questionId)) {
        return false;
      }
      processedQuestions.add(questionId);
      return true;
    });
    
    if (uniqueQuestions.length === 0) continue;
    
    console.log(`🧠 Solving batch of ${uniqueQuestions.length} questions (Queue: ${questionQueue.length} remaining)`);
    
    // Process this batch of questions in parallel
    const batchPromises = uniqueQuestions.map((question, index) => 
      solveIndividualQuestionOptimized(question, processedCount + index)
    );
    
    try {
      const batchResults = await Promise.all(batchPromises);
      solvedAnswers.push(...batchResults);
      processedCount += batchResults.length;
      
      console.log(`✅ Completed ${batchResults.length} questions (Total solved: ${processedCount})`);
    } catch (error) {
      console.error('Error in solving batch:', error);
      // Continue processing other questions even if some fail
    }
    
    // Brief pause to prevent overwhelming the API
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log(`🎯 Solving agent completed. Total questions solved: ${processedCount}`);
}

// Optimized individual question solver with reduced context
async function solveIndividualQuestionOptimized(question: any, index: number): Promise<Answer> {
  try {
    const solvingLLM = new ChatOpenAI({
      model: 'gpt-4o-mini', // Use mini model for faster, cheaper processing
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      modelKwargs: {
        response_format: { type: "json_object" }
      }
    });

    // Create concise prompt to minimize context window usage
    const optimizedPrompt = createOptimizedSolvingPrompt(question);

    const solvingResponse = await solvingLLM.invoke([
      {
        role: 'system',
        content: `You are an expert test solver. Solve questions accurately and concisely. Always respond in JSON format: {"answer": "your answer", "confidence": 0.95, "reasoning": "brief explanation"}`
      },
      {
        role: 'user',
        content: optimizedPrompt
      }
    ]);

    const solvedAnswer = solvingResponse.content as string;
    
    // Parse the individual answer
    let answerData;
    try {
      answerData = JSON.parse(solvedAnswer);
    } catch (parseError) {
      console.error(`Failed to parse answer for question ${index + 1}:`, parseError);
      return {
        question: question.question || `Question ${index + 1}`,
        answer: "Unable to process this question",
        confidence: 0.1,
        reasoning: "Failed to parse AI response"
      };
    }

    return {
      question: question.question || `Question ${index + 1}`,
      answer: answerData.answer || "No answer provided",
      confidence: Math.min(Math.max(answerData.confidence || 0.5, 0.1), 0.95),
      reasoning: answerData.reasoning || "No reasoning provided"
    };

  } catch (error) {
    console.error(`Error solving question ${index + 1}:`, error);
    return {
      question: question.question || `Question ${index + 1}`,
      answer: "Error processing this question",
      confidence: 0.1,
      reasoning: "An error occurred while processing this question"
    };
  }
}

// Create optimized prompt with minimal context to save tokens
function createOptimizedSolvingPrompt(question: any): string {
  let prompt = `Question: ${question.question}`;
  
  if (question.choices && Array.isArray(question.choices)) {
    prompt += `\nChoices: ${question.choices.join(', ')}`;
  }
  
  if (question.type) {
    prompt += `\nType: ${question.type}`;
  }
  
  // Only include context if it's short (to save tokens)
  if (question.context && question.context.length < 200) {
    prompt += `\nContext: ${question.context}`;
  }
  
  return prompt;
}

// Function to solve individual questions asynchronously with batching (LEGACY - keeping for image processing)
async function solveQuestionsIndividually(questions: any[]): Promise<Answer[]> {
  console.log(`Processing ${questions.length} questions individually with async execution...`);
  
  // Process questions in smaller batches to manage memory and API limits
  const batchSize = 5; // Process 5 questions at a time
  const results: Answer[] = [];
  
  for (let i = 0; i < questions.length; i += batchSize) {
    const batch = questions.slice(i, i + batchSize);
    console.log(`Processing question batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(questions.length / batchSize)}`);
    
    const batchResults = await Promise.all(
      batch.map((question, batchIndex) => solveIndividualQuestionOptimized(question, i + batchIndex))
    );
    
    results.push(...batchResults);
    
    // Add delay and garbage collection between batches
    if (i + batchSize < questions.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (global.gc) {
        global.gc();
      }
    }
  }
  
  return results;
}