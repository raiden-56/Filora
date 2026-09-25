/** OCR languages supported by both tesseract.js and native Tesseract. */
export const OCR_LANGUAGES: { code: string; name: string }[] = [
  { code: 'eng', name: 'English' },
  { code: 'spa', name: 'Spanish' },
  { code: 'fra', name: 'French' },
  { code: 'deu', name: 'German' },
  { code: 'ita', name: 'Italian' },
  { code: 'por', name: 'Portuguese' },
  { code: 'nld', name: 'Dutch' },
  { code: 'rus', name: 'Russian' },
  { code: 'pol', name: 'Polish' },
  { code: 'tur', name: 'Turkish' },
  { code: 'hin', name: 'Hindi' },
  { code: 'ara', name: 'Arabic' },
  { code: 'chi_sim', name: 'Chinese (Simplified)' },
  { code: 'chi_tra', name: 'Chinese (Traditional)' },
  { code: 'jpn', name: 'Japanese' },
  { code: 'kor', name: 'Korean' },
];

export const OCR_LANGUAGE_CODES = new Set(OCR_LANGUAGES.map((l) => l.code));

export function isValidLanguage(code: string): boolean {
  return OCR_LANGUAGE_CODES.has(code);
}
