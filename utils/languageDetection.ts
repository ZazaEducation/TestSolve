// Language detection and RTL support utilities

// RTL languages list
const RTL_LANGUAGES = new Set([
  'ar',    // Arabic
  'he',    // Hebrew
  'fa',    // Persian/Farsi
  'ur',    // Urdu
  'ps',    // Pashto
  'sd',    // Sindhi
  'ku',    // Kurdish
  'dv',    // Dhivehi/Maldivian
  'arc',   // Aramaic
  'syr',   // Syriac
  'ckb',   // Central Kurdish (Sorani)
  'yi',    // Yiddish
]);

// Common RTL characters ranges
const RTL_CHAR_RANGES = [
  /[\u0590-\u05FF]/,     // Hebrew
  /[\u0600-\u06FF]/,     // Arabic
  /[\u0750-\u077F]/,     // Arabic Supplement
  /[\u08A0-\u08FF]/,     // Arabic Extended-A
  /[\uFB50-\uFDFF]/,     // Arabic Presentation Forms-A
  /[\uFE70-\uFEFF]/,     // Arabic Presentation Forms-B
  /[\u200F]/,            // Right-to-Left Mark
  /[\u202E]/,            // Right-to-Left Override
];

/**
 * Detects if text contains RTL (Right-to-Left) characters
 * @param text - The text to analyze
 * @returns true if RTL characters are detected, false otherwise
 */
export function detectRTL(text: string): boolean {
  if (!text) return false;
  
  // Check if any character matches RTL ranges
  return RTL_CHAR_RANGES.some(range => range.test(text));
}

/**
 * Detects the primary language direction of a text
 * @param text - The text to analyze
 * @returns 'rtl' for right-to-left languages, 'ltr' for left-to-right
 */
export function detectLanguageDirection(text: string): 'rtl' | 'ltr' {
  if (!text) return 'ltr';
  
  let rtlCount = 0;
  let ltrCount = 0;
  
  // Count RTL and LTR characters
  for (const char of text) {
    if (RTL_CHAR_RANGES.some(range => range.test(char))) {
      rtlCount++;
    } else if (/[A-Za-z]/.test(char)) {
      ltrCount++;
    }
  }
  
  // If we have more RTL characters, it's an RTL text
  // Use a threshold to handle mixed content
  return rtlCount > ltrCount * 0.3 ? 'rtl' : 'ltr';
}

/**
 * Detects likely language from text content
 * @param text - The text to analyze
 * @returns ISO language code or null if detection fails
 */
export function detectLanguage(text: string): string | null {
  if (!text) return null;
  
  // Simple language detection based on character sets
  if (/[\u0590-\u05FF]/.test(text)) return 'he'; // Hebrew
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'; // Arabic
  if (/[\u0400-\u04FF]/.test(text)) return 'ru'; // Russian/Cyrillic
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'; // Chinese
  if (/[\u3040-\u309F]|\u30A0-\u30FF/.test(text)) return 'ja'; // Japanese
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'; // Korean
  
  // Default to English if no specific script detected
  return 'en';
}

/**
 * Checks if a language code represents an RTL language
 * @param languageCode - ISO language code
 * @returns true if the language is RTL, false otherwise
 */
export function isRTLLanguage(languageCode: string): boolean {
  return RTL_LANGUAGES.has(languageCode.toLowerCase());
}

/**
 * Gets appropriate CSS text alignment for detected direction
 * @param text - The text to analyze
 * @returns CSS text-align value
 */
export function getTextAlignment(text: string): 'left' | 'right' | 'start' | 'end' {
  const direction = detectLanguageDirection(text);
  return direction === 'rtl' ? 'right' : 'left';
}

/**
 * Gets appropriate CSS direction value for text
 * @param text - The text to analyze
 * @returns CSS direction value
 */
export function getTextDirection(text: string): 'ltr' | 'rtl' {
  return detectLanguageDirection(text);
}