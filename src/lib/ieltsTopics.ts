// Common IELTS topics for each module
// These are based on frequently appearing topics in official IELTS tests

export const READING_TOPICS = [
  'Climate Change & Environment',
  'Technology & Innovation',
  'Health & Medicine',
  'Education & Learning',
  'History & Archaeology',
  'Space & Astronomy',
  'Psychology & Behavior',
  'Business & Economics',
  'Art & Culture',
  'Language & Communication',
  'Wildlife & Conservation',
  'Urban Development',
  'Agriculture & Food',
  'Transport & Infrastructure',
  'Energy & Resources',
  'Ocean & Marine Life',
  'Ancient Civilizations',
  'Social Issues',
  'Scientific Research',
  'Architecture & Design',
] as const;

export const LISTENING_TOPICS = [
  'University & Campus Life',
  'Travel & Tourism',
  'Job Interview & Employment',
  'Accommodation & Housing',
  'Health & Fitness',
  'Library & Study Resources',
  'Shopping & Services',
  'Transport & Directions',
  'Events & Entertainment',
  'Banking & Finance',
  'Food & Restaurants',
  'Sports & Recreation',
  'Museum & Exhibition',
  'Environment & Nature',
  'Technology & Gadgets',
  'Community Services',
  'Medical Appointments',
  'Course Registration',
  'Research Projects',
  'Local Facilities',
] as const;

export const WRITING_TASK1_TOPICS = [
  'Population Statistics',
  'Economic Data',
  'Environmental Trends',
  'Technology Adoption',
  'Education Statistics',
  'Health & Lifestyle Data',
  'Transport & Traffic',
  'Energy Consumption',
  'Employment Trends',
  'Consumer Behavior',
  'Process Diagrams',
  'Map Comparisons',
  'Life Cycle Diagrams',
  'Manufacturing Process',
  'Natural Phenomena',
] as const;

export const WRITING_TASK2_TOPICS = [
  'Education System',
  'Technology in Society',
  'Environment & Pollution',
  'Health & Lifestyle',
  'Work & Career',
  'Government & Policy',
  'Crime & Punishment',
  'Globalization',
  'Media & Advertising',
  'Culture & Traditions',
  'Youth & Children',
  'Urban vs Rural Life',
  'Travel & Tourism',
  'Arts & Creativity',
  'Science & Research',
  'Social Issues',
  'Economic Development',
  'Communication',
  'Sports & Competition',
  'Gender Equality',
] as const;

export const SPEAKING_TOPICS_PART1 = [
  'Hometown & Living Area',
  'Accommodation & Home',
  'Work & Career',
  'Study & Education',
  'Daily Routine',
  'Family & Friends',
  'Food & Cooking',
  'Shopping & Spending',
  'Hobbies & Leisure',
  'Sports & Fitness',
  'Music & Art',
  'Books & Films',
  'Travel & Holidays',
  'Transport',
  'Weather & Seasons',
  'Technology & Gadgets',
  'Social Media',
  'Health & Lifestyle',
  'Clothes & Fashion',
  'Pets & Animals',
  'Weekend Plans',
  'Celebrations & Festivals',
] as const;

export const SPEAKING_TOPICS_PART2 = [
  'Describe a person you admire',
  'Describe a memorable trip',
  'Describe a place in your city',
  'Describe an important event',
  'Describe a time you helped someone',
  'Describe a challenging experience',
  'Describe an achievement you are proud of',
  'Describe a gift you received',
  'Describe a skill you learned',
  'Describe a book/movie you enjoyed',
  'Describe a piece of technology you use',
  'Describe a hobby you enjoy',
  'Describe a time you solved a problem',
  'Describe a time you learned something new',
  'Describe a time you worked in a team',
  'Describe a special meal',
  'Describe an object you use every day',
  'Describe a rule you would change',
] as const;

export const SPEAKING_TOPICS_PART3 = [
  'Education & Learning',
  'Work Culture & Careers',
  'Technology and Society',
  'Media & Communication',
  'Environment & Climate',
  'Health in Modern Life',
  'City Life vs Rural Life',
  'Transport and Urban Planning',
  'Culture & Traditions',
  'Tourism & Globalisation',
  'Arts and Public Funding',
  'Sports and Wellbeing',
  'Family Roles and Relationships',
  'Consumerism & Advertising',
  'Crime and Safety',
  'The Future of Work',
] as const;

export const SPEAKING_TOPICS_FULL = [
  'Hometown & Living Area',
  'Work & Career',
  'Study & Education',
  'Technology',
  'Travel & Holidays',
  'Food & Cooking',
  'Health & Fitness',
  'Sports & Leisure',
  'Music & Art',
  'Books & Films',
  'Shopping & Spending',
  'Transport',
  'Environment',
  'Family & Friends',
  'Culture & Traditions',
  'Media & Communication',
  'City Life',
  'Education (Deep Dive)',
  'Technology (Deep Dive)',
] as const;

// Helper to get topics by module and subtype
export function getTopicsForModule(
  module: 'reading' | 'listening' | 'writing' | 'speaking',
  subtype?: string
): readonly string[] {
  switch (module) {
    case 'reading':
      return READING_TOPICS;
    case 'listening':
      return LISTENING_TOPICS;
    case 'writing':
      return subtype === 'TASK_1' ? WRITING_TASK1_TOPICS : WRITING_TASK2_TOPICS;
    case 'speaking':
      switch (subtype) {
        case 'PART_1': return SPEAKING_TOPICS_PART1;
        case 'PART_2': return SPEAKING_TOPICS_PART2;
        case 'PART_3': return SPEAKING_TOPICS_PART3;
        default: return SPEAKING_TOPICS_FULL;
      }
    default:
      return [];
  }
}
