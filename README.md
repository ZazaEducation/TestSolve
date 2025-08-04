# AI Test Solver App

An intelligent test-solving application that uses OpenAI's GPT-4o Vision model to analyze uploaded photos of test questions and provide AI-powered answers.

## Features

- **Image Upload**: Upload photos of test questions directly through the web interface
- **AI-Powered OCR**: Extract text and questions from images using GPT-4o Vision
- **Intelligent Question Processing**: Automatically identify question types (multiple choice, short answer, math, etc.)
- **Comprehensive Answers**: Get detailed, step-by-step explanations for each question
- **Confidence Scoring**: Each answer includes a confidence score to help you evaluate reliability
- **Responsive Design**: Clean, modern interface that works on all devices

## Technology Stack

- **Frontend**: Next.js 15 with React and TypeScript
- **Styling**: Tailwind CSS
- **AI/ML**: OpenAI GPT-4o Vision and Chat models
- **Icons**: Lucide React
- **Development**: Turbopack for fast builds

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Setup**
   - Add your OpenAI API key to `.env.local`:
   ```bash
   OPENAI_API_KEY=your_openai_api_key_here
   ```

3. **Run Development Server**
   ```bash
   npm run dev
   ```

4. **Open Application**
   - Navigate to [http://localhost:3000](http://localhost:3000)
   - Upload a photo of test questions
   - Click "Solve Questions" to get AI-powered answers

## How It Works

### Agentic Pipeline

The application uses a sophisticated agentic pipeline:

1. **Image Analysis**: GPT-4o Vision analyzes the uploaded image to extract questions
2. **Question Classification**: Automatically identifies question types and formats
3. **Answer Generation**: GPT-4o generates detailed answers with explanations
4. **Confidence Assessment**: Calculates confidence scores based on question type and answer quality

### Supported Question Types

- Multiple Choice
- Short Answer
- Essay Questions
- Math Problems
- True/False
- General Knowledge

## API Routes

- `POST /api/solve-test` - Main endpoint for processing uploaded test images

## Usage Tips

- **Image Quality**: Use clear, well-lit photos for best results
- **Question Visibility**: Ensure all text is readable in the uploaded image
- **Multiple Questions**: The app can handle multiple questions in a single image
- **Answer Review**: Always review AI-generated answers for accuracy

## Development

Built with modern web technologies and best practices:

- TypeScript for type safety
- Modular component architecture
- Responsive design principles
- Error handling and user feedback
- Optimized image processing

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
