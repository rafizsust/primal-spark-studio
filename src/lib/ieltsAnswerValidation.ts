/**
 * IELTS Unified Marking Protocol
 * 
 * Implements Cambridge/IDP standard answer validation including:
 * - Word & Number counting rules
 * - Pre-existing context handling (avoid duplicates)
 * - Valid alternative formats (dates, times, measurements, currency, spelling)
 * - Grammatical & case sensitivity rules
 * - Alphanumeric code handling
 */

// ============================================================================
// BRITISH/AMERICAN SPELLING VARIATIONS
// ============================================================================
const SPELLING_VARIATIONS: Record<string, string[]> = {
  // -our/-or variations
  colour: ['colour', 'color'],
  honour: ['honour', 'honor'],
  favour: ['favour', 'favor'],
  behaviour: ['behaviour', 'behavior'],
  neighbour: ['neighbour', 'neighbor'],
  labour: ['labour', 'labor'],
  harbour: ['harbour', 'harbor'],
  vapour: ['vapour', 'vapor'],
  flavour: ['flavour', 'flavor'],
  rumour: ['rumour', 'rumor'],
  humour: ['humour', 'humor'],
  tumour: ['tumour', 'tumor'],
  
  // -ise/-ize variations
  organise: ['organise', 'organize'],
  organisation: ['organisation', 'organization'],
  realise: ['realise', 'realize'],
  recognise: ['recognise', 'recognize'],
  analyse: ['analyse', 'analyze'],
  apologise: ['apologise', 'apologize'],
  characterise: ['characterise', 'characterize'],
  criticise: ['criticise', 'criticize'],
  emphasise: ['emphasise', 'emphasize'],
  specialise: ['specialise', 'specialize'],
  standardise: ['standardise', 'standardize'],
  summarise: ['summarise', 'summarize'],
  prioritise: ['prioritise', 'prioritize'],
  visualise: ['visualise', 'visualize'],
  minimise: ['minimise', 'minimize'],
  maximise: ['maximise', 'maximize'],
  utilise: ['utilise', 'utilize'],
  
  // -re/-er variations
  centre: ['centre', 'center'],
  metre: ['metre', 'meter'],
  litre: ['litre', 'liter'],
  theatre: ['theatre', 'theater'],
  fibre: ['fibre', 'fiber'],
  calibre: ['calibre', 'caliber'],
  
  // -ogue/-og variations
  catalogue: ['catalogue', 'catalog'],
  dialogue: ['dialogue', 'dialog'],
  analogue: ['analogue', 'analog'],
  prologue: ['prologue', 'prolog'],
  
  // -ence/-ense variations
  defence: ['defence', 'defense'],
  offence: ['offence', 'offense'],
  licence: ['licence', 'license'],
  pretence: ['pretence', 'pretense'],
  
  // -ll-/-l- variations
  travelling: ['travelling', 'traveling'],
  traveller: ['traveller', 'traveler'],
  cancelled: ['cancelled', 'canceled'],
  cancelling: ['cancelling', 'canceling'],
  labelled: ['labelled', 'labeled'],
  modelling: ['modelling', 'modeling'],
  counsellor: ['counsellor', 'counselor'],
  jewellery: ['jewellery', 'jewelry'],
  
  // Other variations
  grey: ['grey', 'gray'],
  programme: ['programme', 'program'],
  cheque: ['cheque', 'check'],
  tyre: ['tyre', 'tire'],
  aluminium: ['aluminium', 'aluminum'],
  aeroplane: ['aeroplane', 'airplane'],
  storey: ['storey', 'story'],
  plough: ['plough', 'plow'],
  mould: ['mould', 'mold'],
  doughnut: ['doughnut', 'donut'],
  practise: ['practise', 'practice'],
  focussed: ['focussed', 'focused'],
  ageing: ['ageing', 'aging'],
  judgement: ['judgement', 'judgment'],
  acknowledgement: ['acknowledgement', 'acknowledgment'],
  learnt: ['learnt', 'learned'],
  burnt: ['burnt', 'burned'],
  dreamt: ['dreamt', 'dreamed'],
  spelt: ['spelt', 'spelled'],
  smelt: ['smelt', 'smelled'],
};

// ============================================================================
// ORDINAL NUMBERS
// ============================================================================
export const ORDINAL_MAP: Record<string, string[]> = {
  '1st': ['1', 'first', '1st'],
  '2nd': ['2', 'second', '2nd'],
  '3rd': ['3', 'third', '3rd'],
  '4th': ['4', 'fourth', '4th'],
  '5th': ['5', 'fifth', '5th'],
  '6th': ['6', 'sixth', '6th'],
  '7th': ['7', 'seventh', '7th'],
  '8th': ['8', 'eighth', '8th'],
  '9th': ['9', 'ninth', '9th'],
  '10th': ['10', 'tenth', '10th'],
  '11th': ['11', 'eleventh', '11th'],
  '12th': ['12', 'twelfth', '12th'],
  '13th': ['13', 'thirteenth', '13th'],
  '14th': ['14', 'fourteenth', '14th'],
  '15th': ['15', 'fifteenth', '15th'],
  '16th': ['16', 'sixteenth', '16th'],
  '17th': ['17', 'seventeenth', '17th'],
  '18th': ['18', 'eighteenth', '18th'],
  '19th': ['19', 'nineteenth', '19th'],
  '20th': ['20', 'twentieth', '20th'],
  '21st': ['21', 'twenty-first', '21st'],
  '22nd': ['22', 'twenty-second', '22nd'],
  '23rd': ['23', 'twenty-third', '23rd'],
  '24th': ['24', 'twenty-fourth', '24th'],
  '25th': ['25', 'twenty-fifth', '25th'],
  '26th': ['26', 'twenty-sixth', '26th'],
  '27th': ['27', 'twenty-seventh', '27th'],
  '28th': ['28', 'twenty-eighth', '28th'],
  '29th': ['29', 'twenty-ninth', '29th'],
  '30th': ['30', 'thirtieth', '30th'],
  '31st': ['31', 'thirty-first', '31st'],
};

// ============================================================================
// MONTH VARIATIONS
// ============================================================================
export const MONTH_VARIATIONS: Record<string, string[]> = {
  january: ['jan', 'january', '01', '1'],
  february: ['feb', 'february', '02', '2'],
  march: ['mar', 'march', '03', '3'],
  april: ['apr', 'april', '04', '4'],
  may: ['may', '05', '5'],
  june: ['jun', 'june', '06', '6'],
  july: ['jul', 'july', '07', '7'],
  august: ['aug', 'august', '08', '8'],
  september: ['sep', 'sept', 'september', '09', '9'],
  october: ['oct', 'october', '10'],
  november: ['nov', 'november', '11'],
  december: ['dec', 'december', '12'],
};

// ============================================================================
// NUMBER WORDS (including large numbers)
// ============================================================================
const NUMBER_WORDS: Record<string, string[]> = {
  '0': ['zero', 'o', 'oh', '0', 'nil', 'nought'],
  '1': ['one', '1'],
  '2': ['two', '2'],
  '3': ['three', '3'],
  '4': ['four', '4'],
  '5': ['five', '5'],
  '6': ['six', '6'],
  '7': ['seven', '7'],
  '8': ['eight', '8'],
  '9': ['nine', '9'],
  '10': ['ten', '10'],
  '11': ['eleven', '11'],
  '12': ['twelve', '12'],
  '13': ['thirteen', '13'],
  '14': ['fourteen', '14'],
  '15': ['fifteen', '15'],
  '16': ['sixteen', '16'],
  '17': ['seventeen', '17'],
  '18': ['eighteen', '18'],
  '19': ['nineteen', '19'],
  '20': ['twenty', '20'],
  '30': ['thirty', '30'],
  '40': ['forty', '40'],
  '50': ['fifty', '50'],
  '60': ['sixty', '60'],
  '70': ['seventy', '70'],
  '80': ['eighty', '80'],
  '90': ['ninety', '90'],
  '100': ['hundred', 'one hundred', 'a hundred', '100'],
  '1000': ['thousand', 'one thousand', 'a thousand', '1000', '1,000'],
  '1000000': ['million', 'one million', 'a million', '1000000', '1,000,000'],
};

// ============================================================================
// MEASUREMENT VARIATIONS
// ============================================================================
const MEASUREMENT_VARIATIONS: Record<string, string[]> = {
  km: ['km', 'kms', 'kilometre', 'kilometres', 'kilometer', 'kilometers'],
  m: ['m', 'metre', 'metres', 'meter', 'meters'],
  cm: ['cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters'],
  mm: ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters'],
  kg: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'],
  g: ['g', 'gram', 'grams', 'gramme', 'grammes'],
  mg: ['mg', 'milligram', 'milligrams'],
  l: ['l', 'litre', 'litres', 'liter', 'liters'],
  ml: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
  ft: ['ft', 'foot', 'feet'],
  in: ['in', 'inch', 'inches'],
  mi: ['mi', 'mile', 'miles'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  oz: ['oz', 'ounce', 'ounces'],
  sqm: ['sqm', 'sq m', 'square metre', 'square metres', 'square meter', 'square meters', 'm²', 'm2'],
  sqft: ['sqft', 'sq ft', 'square foot', 'square feet', 'ft²', 'ft2'],
  ha: ['ha', 'hectare', 'hectares'],
  acre: ['acre', 'acres'],
};

// ============================================================================
// CURRENCY VARIATIONS
// ============================================================================
const CURRENCY_VARIATIONS: Record<string, string[]> = {
  '$': ['$', 'dollar', 'dollars', 'usd', 'us dollar', 'us dollars'],
  '£': ['£', 'pound', 'pounds', 'gbp', 'pound sterling'],
  '€': ['€', 'euro', 'euros', 'eur'],
  '¥': ['¥', 'yen', 'jpy'],
  '₹': ['₹', 'rupee', 'rupees', 'inr'],
  '₽': ['₽', 'ruble', 'rubles', 'rub'],
  'A$': ['a$', 'aud', 'australian dollar', 'australian dollars'],
  'C$': ['c$', 'cad', 'canadian dollar', 'canadian dollars'],
  'cent': ['cent', 'cents', 'c', '¢'],
  'pence': ['pence', 'p', 'penny'],
};

// ============================================================================
// NORMALIZATION UTILITIES
// ============================================================================

/**
 * Normalize a string for comparison (case-insensitive, trim, normalize spaces)
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ') // Normalize multiple spaces to single
    .replace(/[''ʼ]/g, "'") // Normalize apostrophes
    .replace(/[""„]/g, '"'); // Normalize quotes
}

/**
 * Remove all spaces for strict comparison
 */
function removeAllSpaces(str: string): string {
  return str.replace(/\s+/g, '');
}

/**
 * Extract optional words from answer key format: (the) hospital
 * Returns { requiredPart: 'hospital', optionalParts: ['the'] }
 */
function parseOptionalWords(answer: string): { 
  requiredPart: string; 
  optionalParts: string[];
  allVariations: string[];
} {
  const optionalPattern = /\(([^)]+)\)/g;
  const optionalParts: string[] = [];
  let match;
  
  // Extract all optional parts
  while ((match = optionalPattern.exec(answer)) !== null) {
    optionalParts.push(match[1].trim().toLowerCase());
  }
  
  // Get required part by removing optional markers
  const requiredPart = answer
    .replace(/\([^)]+\)\s*/g, '')
    .trim()
    .toLowerCase();
  
  // Generate all variations
  const allVariations: string[] = [requiredPart];
  
  // Add variations with optional parts
  for (const opt of optionalParts) {
    allVariations.push(`${opt} ${requiredPart}`);
    allVariations.push(`${requiredPart} ${opt}`);
  }
  
  return { requiredPart, optionalParts, allVariations };
}

// ============================================================================
// SPELLING VARIATION CHECKER
// ============================================================================

/**
 * Check if two words are British/American spelling equivalents
 */
function areSpellingEquivalent(word1: string, word2: string): boolean {
  const w1 = word1.toLowerCase();
  const w2 = word2.toLowerCase();
  
  if (w1 === w2) return true;
  
  for (const variations of Object.values(SPELLING_VARIATIONS)) {
    if (variations.includes(w1) && variations.includes(w2)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if two phrases match with spelling variations
 */
function matchWithSpellingVariations(user: string, correct: string): boolean {
  const userWords = user.split(/\s+/);
  const correctWords = correct.split(/\s+/);
  
  if (userWords.length !== correctWords.length) return false;
  
  return userWords.every((userWord, index) => 
    areSpellingEquivalent(userWord, correctWords[index])
  );
}

// ============================================================================
// DATE MATCHING
// ============================================================================

/**
 * Extract day and month from various date formats
 */
function extractDateComponents(dateStr: string): { day: number; month: number } | null {
  const s = dateStr.toLowerCase().trim();
  
  // Patterns to match
  const patterns = [
    // "15 March", "15th March", "15th of March"
    /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)$/,
    // "March 15", "March 15th"
    /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/,
    // "15/03", "03/15" - ambiguous, try both DD/MM and MM/DD
    /^(\d{1,2})[\/\-.](\d{1,2})$/,
    // "15.03.2024" or "2024-03-15"
    /^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/,
  ];
  
  // Try month name patterns first
  let match = s.match(patterns[0]);
  if (match) {
    const day = parseInt(match[1]);
    const month = getMonthNumber(match[2]);
    if (month) return { day, month };
  }
  
  match = s.match(patterns[1]);
  if (match) {
    const month = getMonthNumber(match[1]);
    const day = parseInt(match[2]);
    if (month) return { day, month };
  }
  
  // Numeric patterns - return null for ambiguous ones
  // (the comparison will be done differently)
  match = s.match(patterns[2]);
  if (match) {
    const n1 = parseInt(match[1]);
    const n2 = parseInt(match[2]);
    // If one is clearly > 12, we can determine format
    if (n1 > 12) return { day: n1, month: n2 };
    if (n2 > 12) return { day: n2, month: n1 };
    // Ambiguous - try both interpretations
    return null;
  }
  
  return null;
}

/**
 * Get month number from name
 */
function getMonthNumber(monthStr: string): number | null {
  const m = monthStr.toLowerCase();
  for (const variations of Object.values(MONTH_VARIATIONS)) {
    if (variations.some(v => v.toLowerCase() === m || v === m)) {
      return parseInt(variations.find(v => !isNaN(parseInt(v))) || '0');
    }
  }
  return null;
}

/**
 * Check if two strings match as dates with format variations
 * Accepts: 15 March, March 15, 15th March, 15/03, 03/15
 */
function matchDate(userAnswer: string, correctAnswer: string): boolean {
  const userComponents = extractDateComponents(userAnswer);
  const correctComponents = extractDateComponents(correctAnswer);
  
  if (userComponents && correctComponents) {
    return userComponents.day === correctComponents.day && 
           userComponents.month === correctComponents.month;
  }
  
  // Handle numeric date formats that might be DD/MM or MM/DD
  const numericPattern = /^(\d{1,2})[\/\-.](\d{1,2})$/;
  const userMatch = userAnswer.match(numericPattern);
  const correctMatch = correctAnswer.match(numericPattern);
  
  if (userMatch && correctMatch) {
    const [, u1, u2] = userMatch;
    const [, c1, c2] = correctMatch;
    // Accept if same numbers in either order
    return (u1 === c1 && u2 === c2) || (u1 === c2 && u2 === c1);
  }
  
  return false;
}

// ============================================================================
// TIME MATCHING
// ============================================================================

/**
 * Normalize time string to comparable format
 */
function normalizeTime(timeStr: string): string {
  let s = timeStr.toLowerCase().trim();
  
  // Remove spaces
  s = s.replace(/\s+/g, '');
  
  // Normalize separators (: and . are equivalent)
  s = s.replace(/[.:]/g, ':');
  
  // Normalize AM/PM variations
  s = s.replace(/a\.?m\.?/gi, 'am');
  s = s.replace(/p\.?m\.?/gi, 'pm');
  s = s.replace(/o'?clock/gi, ':00');
  
  // Pad single digit hours
  if (/^\d:/.test(s)) {
    s = '0' + s;
  }
  
  return s;
}

/**
 * Check if two time strings match
 * Accepts: 9:30, 9.30, 09:30, 9.30am, 9:30 AM
 */
function matchTime(userAnswer: string, correctAnswer: string): boolean {
  return normalizeTime(userAnswer) === normalizeTime(correctAnswer);
}

// ============================================================================
// NUMBER MATCHING
// ============================================================================

/**
 * Normalize number string (remove commas, spaces)
 */
function normalizeNumber(numStr: string): string {
  return numStr
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Check if two strings match as numbers
 * Handles: 30000, 30,000, thirty thousand
 */
function matchNumber(userAnswer: string, correctAnswer: string): boolean {
  const user = normalizeNumber(userAnswer);
  const correct = normalizeNumber(correctAnswer);
  
  if (user === correct) return true;
  
  // Check number word equivalences
  for (const variations of Object.values(NUMBER_WORDS)) {
    if (variations.some(w => normalizeNumber(w) === user) && 
        variations.some(w => normalizeNumber(w) === correct)) {
      return true;
    }
  }
  
  // Try parsing as numbers
  const userNum = parseFloat(user.replace(/[^\d.-]/g, ''));
  const correctNum = parseFloat(correct.replace(/[^\d.-]/g, ''));
  
  if (!isNaN(userNum) && !isNaN(correctNum) && userNum === correctNum) {
    return true;
  }
  
  return false;
}

// ============================================================================
// MEASUREMENT MATCHING
// ============================================================================

/**
 * Extract number and unit from measurement string
 */
function parseMeasurement(str: string): { value: string; unit: string } | null {
  const s = str.toLowerCase().trim();
  
  // Pattern: number followed by unit (with or without space)
  const pattern = /^([\d,.]+)\s*(.+)$/;
  const match = s.match(pattern);
  
  if (match) {
    return { value: match[1].replace(/,/g, ''), unit: match[2].trim() };
  }
  
  return null;
}

/**
 * Check if two measurement strings match
 * Accepts: 10kg, 10 kg, 10 kilograms, 10 kilos
 */
function matchMeasurement(userAnswer: string, correctAnswer: string): boolean {
  const userMeasure = parseMeasurement(userAnswer);
  const correctMeasure = parseMeasurement(correctAnswer);
  
  if (!userMeasure || !correctMeasure) return false;
  
  // Check if values match
  if (userMeasure.value !== correctMeasure.value) return false;
  
  // Check if units are equivalent
  for (const variations of Object.values(MEASUREMENT_VARIATIONS)) {
    if (variations.includes(userMeasure.unit) && 
        variations.includes(correctMeasure.unit)) {
      return true;
    }
  }
  
  // Also check for British/American spelling of units
  return areSpellingEquivalent(userMeasure.unit, correctMeasure.unit);
}

// ============================================================================
// CURRENCY MATCHING
// ============================================================================

/**
 * Parse currency string into value and currency type
 */
function parseCurrency(str: string): { value: string; currency: string } | null {
  const s = str.toLowerCase().trim();
  
  // Patterns for different currency formats
  const patterns = [
    // $50, £50, €50
    /^([£$€¥₹₽])\s*([\d,.]+)$/,
    // 50$, 50£
    /^([\d,.]+)\s*([£$€¥₹₽])$/,
    // 50 dollars, 50 pounds
    /^([\d,.]+)\s+(dollar|dollars|pound|pounds|euro|euros|yen|cent|cents|pence)s?$/,
  ];
  
  for (const pattern of patterns) {
    const match = s.match(pattern);
    if (match) {
      const isAmountFirst = /^\d/.test(match[1]);
      return {
        value: (isAmountFirst ? match[1] : match[2]).replace(/,/g, ''),
        currency: isAmountFirst ? match[2] : match[1]
      };
    }
  }
  
  return null;
}

/**
 * Check if two currency strings match
 * Accepts: $50, 50 dollars, 50$
 */
function matchCurrency(userAnswer: string, correctAnswer: string): boolean {
  const userCurrency = parseCurrency(userAnswer);
  const correctCurrency = parseCurrency(correctAnswer);
  
  if (!userCurrency || !correctCurrency) return false;
  
  // Check if values match
  if (userCurrency.value !== correctCurrency.value) return false;
  
  // Check if currency types are equivalent
  for (const variations of Object.values(CURRENCY_VARIATIONS)) {
    if (variations.includes(userCurrency.currency) && 
        variations.includes(correctCurrency.currency)) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// PHONE NUMBER MATCHING
// ============================================================================

/**
 * Normalize phone number (handle O for 0, double/triple notation)
 */
function normalizePhoneNumber(phone: string): string {
  return phone
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[oO]/g, '0')
    .replace(/double\s*(\d)/gi, '$1$1')
    .replace(/triple\s*(\d)/gi, '$1$1$1')
    .replace(/[-()]/g, '');
}

/**
 * Check if two phone numbers match
 */
function matchPhoneNumber(userAnswer: string, correctAnswer: string): boolean {
  return normalizePhoneNumber(userAnswer) === normalizePhoneNumber(correctAnswer);
}

// ============================================================================
// ALPHANUMERIC CODE MATCHING
// ============================================================================

/**
 * Normalize alphanumeric codes (postcodes, flight numbers, etc.)
 * Rule: Spacing in codes is usually ignored
 */
function normalizeAlphanumericCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[oO]/g, '0'); // O can be mistaken for 0
}

/**
 * Check if two alphanumeric codes match
 * E.g., SW1 1AA, AC932
 */
function matchAlphanumericCode(userAnswer: string, correctAnswer: string): boolean {
  // First check with normalized (no spaces)
  if (normalizeAlphanumericCode(userAnswer) === normalizeAlphanumericCode(correctAnswer)) {
    return true;
  }
  return false;
}

// ============================================================================
// HYPHENATED WORD HANDLING
// ============================================================================

/**
 * Normalize hyphenated words
 * Cambridge rule: mother-in-law counts as 1 word
 * Hyphen/space variations should match
 */
function normalizeHyphens(str: string): string {
  return str
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if two strings match with hyphen variations
 */
function matchWithHyphens(userAnswer: string, correctAnswer: string): boolean {
  // Hyphen to space
  if (normalizeHyphens(userAnswer) === normalizeHyphens(correctAnswer)) {
    return true;
  }
  
  // Also try replacing spaces with hyphens
  const user = userAnswer.toLowerCase().replace(/\s+/g, '-');
  const correct = correctAnswer.toLowerCase().replace(/\s+/g, '-');
  
  return user === correct;
}

// ============================================================================
// MAIN VALIDATION FUNCTIONS
// ============================================================================

/**
 * Main answer checking function - checks if user answer matches correct answer
 * with IELTS Unified Marking Protocol
 */
export function checkIeltsAnswer(userAnswer: string, correctAnswers: string): boolean {
  if (!userAnswer || !correctAnswers) return false;

  const user = normalizeString(userAnswer);
  
  // Split correct answers by "/" for alternative answers
  const rawAnswers = correctAnswers.split('/').map(a => a.trim());
  
  for (const rawCorrect of rawAnswers) {
    // Handle optional words in brackets: (the) hospital
    const { allVariations } = parseOptionalWords(rawCorrect);
    
    for (const correct of allVariations) {
      const normalizedCorrect = normalizeString(correct);
      
      // 1. EXACT MATCH (case-insensitive)
      if (user === normalizedCorrect) return true;

      // 2. MATCH WITHOUT SPACES
      if (removeAllSpaces(user) === removeAllSpaces(normalizedCorrect)) return true;

      // 3. SPELLING VARIATIONS (British/American)
      if (matchWithSpellingVariations(user, normalizedCorrect)) return true;

      // 4. DATE FORMAT VARIATIONS
      if (matchDate(user, normalizedCorrect)) return true;

      // 5. TIME FORMAT VARIATIONS
      if (matchTime(user, normalizedCorrect)) return true;

      // 6. NUMBER FORMAT VARIATIONS
      if (matchNumber(user, normalizedCorrect)) return true;

      // 7. MEASUREMENT VARIATIONS
      if (matchMeasurement(user, normalizedCorrect)) return true;

      // 8. CURRENCY VARIATIONS
      if (matchCurrency(user, normalizedCorrect)) return true;

      // 9. PHONE NUMBER VARIATIONS
      if (matchPhoneNumber(user, normalizedCorrect)) return true;

      // 10. ALPHANUMERIC CODE VARIATIONS
      if (matchAlphanumericCode(user, normalizedCorrect)) return true;

      // 11. HYPHEN/SPACE VARIATIONS
      if (matchWithHyphens(user, normalizedCorrect)) return true;

      // 12. ARTICLE VARIATIONS ("the", "a", "an")
      const withoutArticle = (s: string) => s.replace(/^(the|a|an)\s+/, '');
      if (withoutArticle(user) === withoutArticle(normalizedCorrect)) return true;
    }
  }

  return false;
}

/**
 * Check multiple choice multiple answers (order-independent)
 * User answer and correct answer are comma-separated strings
 */
export function checkMultipleChoiceMultiple(userAnswer: string, correctAnswer: string): boolean {
  if (!userAnswer || !correctAnswer) return false;

  const userOptions = new Set(
    userAnswer.split(',').map(opt => normalizeString(opt)).filter(Boolean)
  );
  const correctOptions = new Set(
    correctAnswer.split(',').map(opt => normalizeString(opt)).filter(Boolean)
  );

  // Must have same number of answers
  if (userOptions.size !== correctOptions.size) return false;

  // All user answers must be in correct set and vice versa
  return [...userOptions].every(opt => correctOptions.has(opt)) &&
         [...correctOptions].every(opt => userOptions.has(opt));
}

/**
 * Smart answer checker that determines the question type and applies appropriate logic
 */
export function checkAnswer(
  userAnswer: string, 
  correctAnswer: string, 
  questionType?: string
): boolean {
  // Handle multiple choice multiple answers
  if (questionType === 'MULTIPLE_CHOICE_MULTIPLE') {
    return checkMultipleChoiceMultiple(userAnswer, correctAnswer);
  }

  // Use IELTS-aware validation for other types
  return checkIeltsAnswer(userAnswer, correctAnswer);
}

/**
 * Utility: Count words in an answer (IELTS rules)
 * - Hyphenated words count as 1 word
 * - Numbers in digits count as 1 number (not word)
 * - Symbols ($, £, %) are not counted
 */
export function countWords(text: string): { words: number; numbers: number } {
  if (!text) return { words: 0, numbers: 0 };
  
  const cleaned = text
    .replace(/[$£€¥%@#&*]/g, '') // Remove symbols
    .trim();
  
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  
  let words = 0;
  let numbers = 0;
  
  for (const token of tokens) {
    // Check if it's purely numeric (including dates like 15.05.2025, times like 9.30am)
    if (/^[\d,.:\-\/]+(?:am|pm)?$/i.test(token)) {
      numbers += 1;
    } else if (/^\d+(?:st|nd|rd|th)$/i.test(token)) {
      // Ordinals like "15th" count as 1 word and 1 number
      words += 1;
      numbers += 1;
    } else {
      // Hyphenated words count as 1 word
      words += 1;
    }
  }
  
  return { words, numbers };
}

/**
 * Validate word limit for an answer
 */
export function validateWordLimit(
  text: string, 
  maxWords: number, 
  maxNumbers: number = Infinity
): { valid: boolean; wordCount: number; numberCount: number } {
  const { words, numbers } = countWords(text);
  const totalCount = words; // Numbers don't count toward word limit in IELTS
  
  return {
    valid: totalCount <= maxWords && numbers <= maxNumbers,
    wordCount: words,
    numberCount: numbers
  };
}
