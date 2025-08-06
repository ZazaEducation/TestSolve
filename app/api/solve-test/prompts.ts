import fs from 'fs';
import path from 'path';

// Read the markdown prompt file
function getDirectSolverPrompt(): string {
  try {
    const promptPath = path.join(process.cwd(), 'app', 'api', 'solve-test', 'prompts/prompt1.md');
    console.log("succesfully imported prompt")
    return fs.readFileSync(promptPath, 'utf8');
  } catch (error) {
    console.error('Error reading prompt file:', error);
    // Fallback to inline prompt if file can't be read
    return `You are an expert test solver who can analyze complete test documents and provide answers to all questions found within them.

INSTRUCTIONS:
1. Carefully read through the entire document/image
2. Identify ALL questions present (numbered, lettered, or any question format)
3. For each question, provide a complete, accurate answer
4. Handle all question types: multiple choice, true/false, short answer, essay, math problems, fill-in-blank
5. Use your knowledge and reasoning to solve each question thoroughly

You must respond with ONLY a valid JSON object. Do not include any text before or after the JSON.

Return JSON with this exact structure:
{
  "answers": [
    {
      "question_number": "1" or "Question 1" or null,
      "question": "Complete question text as found in document",
      "answer": "Complete answer with full explanation when needed",
      "confidence": 0.95,
      "reasoning": "Brief explanation of solution approach"
    }
  ],
  "summary": {
    "total_questions": 5,
    "average_confidence": 0.87,
    "document_type": "test|quiz|exam|worksheet"
  }
}`;
  }
}

export const DIRECT_SOLVER_SYSTEM_PROMPT = getDirectSolverPrompt();

