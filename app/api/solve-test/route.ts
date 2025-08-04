import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';


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
        temperature: 0.05,
        apiKey: process.env.OPENAI_API_KEY,
        modelKwargs: {
          response_format: { type: "json_object" }
        }
      });

      const extractionResponse = await extractionLLM.invoke([
        {
          role: 'system',
          content: `You are a specialized Question Extraction Agent. Extract questions from test images with perfect accuracy.

CRITICAL RULES:
1. Extract EVERY question visible in the image
2. Distinguish between questions and answer choices clearly
3. For multiple choice: Question is the stem, choices are A/B/C/D options
4. Include complete context and setup paragraphs
5. Preserve exact formatting and numbering

You must respond with ONLY a valid JSON object. Do not include any text before or after the JSON.

Return a JSON object with this exact structure:
{
  "questions": [
    {
      "question": "Complete question text",
      "type": "multiple_choice|math|short_answer|essay|true_false|fill_blank|general",
      "choices": ["A. First choice", "B. Second choice", "C. Third choice", "D. Fourth choice"] or null,
      "visual_elements": "Description of any diagrams/charts" or null,
      "context": "Additional context" or null,
      "question_number": "1" or null,
      "formatting_notes": "Special formatting" or null
    }
  ]
}`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract ALL questions from this test image. Return ONLY valid JSON with the questions array structure specified.'
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

      // Parse extracted questions
      let questionsData;
      try {
        questionsData = JSON.parse(extractedQuestions);
      } catch (error) {
        console.error('Failed to parse extracted questions:', error);
        throw new Error('Question extraction failed');
      }

      // Step 2: Solve questions directly
      console.log('Step 2: Solving questions...');
      const solvingLLM = new ChatOpenAI({
        model: 'gpt-4o',
        temperature: 0.1,
        apiKey: process.env.OPENAI_API_KEY,
        modelKwargs: {
          response_format: { type: "json_object" }
        }
      });

      const solvingResponse = await solvingLLM.invoke([
        {
          role: 'system',
          content: `You are an expert Question Solving Agent. Provide ONLY direct, concise answers.

ANSWER FORMAT RULES:
- Multiple choice: ONLY the letter (A, B, C, or D)
- True/False: ONLY "True" or "False"
- Math: ONLY the numerical answer
- Short answer: ONLY the essential answer
- Fill-in-blank: ONLY the missing word(s)

You must respond with ONLY a valid JSON object. Do not include any text before or after the JSON.

Return JSON with this exact structure:
{
  "answers": [
    {
      "question": "Original question text",
      "answer": "Direct answer only",
      "confidence": 0.95
    }
  ]
}`
        },
        {
          role: 'user',
          content: `Solve these questions with direct, concise answers. Return ONLY valid JSON:\n\n${JSON.stringify(questionsData, null, 2)}`
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


// Helper function to calculate confidence (used by solving agent)
// function calculateConfidence(questionType: string, answer: string): number {
//   let confidence = 0.85;
  
//   if (questionType === 'multiple_choice' && /^[A-D]$/.test(answer.trim())) {
//     confidence += 0.1;
//   } else if (questionType === 'true_false' && /^(True|False)$/.test(answer.trim())) {
//     confidence += 0.1;
//   } else if (questionType === 'math' && /^-?\d+(\.\d+)?$/.test(answer.trim())) {
//     confidence += 0.05;
//   }
  
//   if (answer.length > 50) confidence -= 0.15;
//   if (answer.length <= 10) confidence += 0.05;
  
//   return Math.max(0.1, Math.min(confidence, 0.95));
// }