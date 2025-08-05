'use client';

import { getTextDirection } from '../utils/languageDetection';

const RTLDemo = () => {
  const testTexts = [
    {
      label: 'Hebrew Question',
      text: 'מהו השם של הבירה של ישראל?',
      answer: 'ירושלים היא בירת ישראל'
    },
    {
      label: 'Arabic Question', 
      text: 'ما هي عاصمة مصر؟',
      answer: 'القاهرة هي عاصمة مصر'
    },
    {
      label: 'English Question',
      text: 'What is the capital of France?',
      answer: 'Paris is the capital of France'
    },
    {
      label: 'Mixed Content',
      text: 'מהו השם של הבירה של France?',
      answer: 'Paris היא בירת France'
    }
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">RTL Language Support Demo</h2>
      
      {testTexts.map((item, index) => (
        <div key={index} className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <h3 className="font-medium text-gray-900 mb-2">{item.label}:</h3>
          
          <p 
            className="text-gray-700 mb-3 italic question-text"
            style={{ 
              direction: getTextDirection(item.text),
              textAlign: getTextDirection(item.text) === 'rtl' ? 'right' : 'left'
            }}
          >
            &ldquo;{item.text}&rdquo;
          </p>
          
          <div className="bg-white border border-green-200 rounded p-3">
            <p className="text-gray-800 font-medium">Answer:</p>
            <p 
              className="text-gray-700 mt-1 text-lg font-semibold answer-text"
              style={{ 
                direction: getTextDirection(item.answer),
                textAlign: getTextDirection(item.answer) === 'rtl' ? 'right' : 'left'
              }}
            >
              {item.answer}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default RTLDemo;