import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_PROMPT,
  SOLVING_SYSTEM_PROMPT,
  SOLVING_USER_PROMPT
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
    
    // Process PDF page by page using streaming events
    const { pages, totalPages } = await new Promise<{pages: PageData[], totalPages: number}>((resolve, reject) => {
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
    });
    
    console.log(`PDF processed successfully: ${totalPages} pages, processing questions page by page...`);
    
    // Process each page with AI to extract questions
    const allQuestions: any[] = [];
    
    // Filter out empty pages
    const validPages = pages.filter(page => page.pageText.trim().length > 0);
    
    if (validPages.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No text could be extracted from the PDF file. Please ensure the PDF contains readable text.'
      }, { status: 400 });
    }

    console.log(`Processing ${validPages.length} valid pages for question extraction...`);
    
    // Process pages in batches to manage context window and API limits
    const batchSize = 3; // Process 3 pages at a time to stay within context limits
    const pageBatches = [];
    
    for (let i = 0; i < validPages.length; i += batchSize) {
      pageBatches.push(validPages.slice(i, i + batchSize));
    }
    
    console.log(`Created ${pageBatches.length} batches for processing`);
    
    // Process each batch of pages
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
            
            allQuestions.push(...processedQuestions);
            console.log(`Added ${processedQuestions.length} questions from batch ${batchIndex + 1}`);
          }
          
        } catch (parseError) {
          console.error(`Failed to parse questions from batch ${batchIndex + 1}:`, parseError);
          // Continue with next batch instead of failing entirely
        }
        
      } catch (batchError) {
        console.error(`Error processing batch ${batchIndex + 1}:`, batchError);
        // Continue with next batch
      }
      
      // Add delay between batches to respect API rate limits
      if (batchIndex < pageBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`Question extraction completed. Found ${allQuestions.length} questions total.`);
    
    if (allQuestions.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No questions could be identified in the PDF. Please ensure the PDF contains clear test questions.'
      }, { status: 400 });
    }

    // Now solve all extracted questions
    console.log(`Starting question solving for ${allQuestions.length} questions...`);
    
    const solvingLLM = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      modelKwargs: {
        response_format: { type: "json_object" }
      }
    });

    const solvingResponse = await solvingLLM.invoke([
      {
        role: 'system',
        content: SOLVING_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: SOLVING_USER_PROMPT({
          questions: allQuestions,
          document_info: {
            title: "PDF Test Document",
            total_questions: allQuestions.length.toString(),
            total_pages: totalPages.toString(),
            test_type: "general"
          }
        })
      }
    ]);

    const solvedAnswers = solvingResponse.content as string;
    console.log('Solved PDF answers:', solvedAnswers);

    // Parse and process solved answers
    const answersData = JSON.parse(solvedAnswers);
    const answers = processAnswers(answersData);
    
    if (answers.length === 0) {
      throw new Error('No valid answers generated');
    }
    
    console.log(`Successfully processed PDF answers: ${answers.length} questions solved`);

    return NextResponse.json({
      success: true,
      answers,
      metadata: {
        total_pages: totalPages,
        questions_found: allQuestions.length,
        answers_generated: answers.length
      }
    });

  } catch (error) {
    console.error('Error processing PDF:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process PDF file. Please try again or use an image file instead.'
    }, { status: 500 });
  }
}

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
      return await handlePdfFile(buffer);
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

      // Step 2: Solve questions directly
      console.log('Step 2: Solving questions...');
      const solvingLLM = new ChatOpenAI({
        model: 'gpt-4o-mini',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
        modelKwargs: {
          response_format: { type: "json_object" }
        }
      });

      const solvingResponse = await solvingLLM.invoke([
        {
          role: 'system',
          content: SOLVING_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: SOLVING_USER_PROMPT(questionsData)
        }
      ]);

      const solvedAnswers = solvingResponse.content as string;
      console.log('Solved answers:', solvedAnswers);

      // Parse and process solved answers
      const answersData = JSON.parse(solvedAnswers);
      answers = processAnswers(answersData);
      
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

// Process and validate answers from the solving agent
function processAnswers(answersData: any): Answer[] {
  let answers: Answer[] = [];
  
  if (answersData.answers && Array.isArray(answersData.answers)) {
    answers = answersData.answers.map((ans: any) => ({
      question: ans.question || "Unknown question",
      answer: ans.answer || "No answer provided",
      confidence: Math.min(Math.max(ans.confidence || 0.5, 0.1), 0.95),
      reasoning: ans.reasoning || "No reasoning provided"
    }));
  }
  
  return answers;
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