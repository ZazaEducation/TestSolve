import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_PROMPT,
  SOLVING_SYSTEM_PROMPT,
  SOLVING_USER_PROMPT
} from './prompts';


// Define schemas for structured data (for future use with structured outputs)
// const QuestionSchema = z.object({
//   question: z.string().describe('Complete question text with all context'),
//   type: z.enum(['multiple_choice', 'math', 'short_answer', 'essay', 'true_false', 'fill_blank', 'general']).describe('Question type'),
//   choices: z.array(z.string()).nullable().describe('Array of answer choices with labels (A, B, C, D) or null'),
//   visual_elements: z.string().nullable().describe('Description of diagrams, charts, or visual components'),
//   context: z.string().nullable().describe('Additional context or background information'),
//   question_number: z.string().nullable().describe('Question number if visible'),
//   formatting_notes: z.string().nullable().describe('Special formatting or emphasis notes')
// });

interface Answer {
  question: string;
  answer: string;
  confidence: number;
  reasoning?: string;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image') as File;

    if (!image) {
      return NextResponse.json(
        { success: false, error: 'No image provided' },
        { status: 400 }
      );
    }

    // Convert image to base64
    const bytes = await image.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');
    const mimeType = image.type;

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

      // Parse solved answers
      const answersData = JSON.parse(solvedAnswers);
      if (answersData.answers && Array.isArray(answersData.answers)) {
        answers = answersData.answers;
        console.log('Successfully processed answers:', answers);
      } else {
        throw new Error('Invalid answer format');
      }

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

// Helper function to calculate confidence (used by solving agent)
function calculateConfidence(questionType: string, answer: string): number {
  let confidence = 0.85;
  
  if (questionType === 'multiple_choice' && /^[A-G]$/.test(answer.trim())) {
    confidence += 0.1;
  } else if (questionType === 'true_false' && /^(True|False)$/.test(answer.trim())) {
    confidence += 0.1;
  } else if (questionType === 'math' && /^-?\d+(\.\d+)?$/.test(answer.trim())) {
    confidence += 0.05;
  }
  
  if (answer.length > 50) confidence -= 0.15;
  if (answer.length <= 10) confidence += 0.05;
  
  return Math.max(0.1, Math.min(confidence, 0.95));
}