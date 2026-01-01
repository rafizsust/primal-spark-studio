import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { GeminiApiKeyManager } from '@/components/user/GeminiApiKeyManager';
import { GeminiQuotaDisplay } from '@/components/common/GeminiQuotaDisplay';
import { toast } from 'sonner';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { Globe, Save } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const SUPPORTED_LANGUAGES = [
  { code: 'bn', name: 'বাংলা (Bengali)' },
  { code: 'hi', name: 'हिंदी (Hindi)' },
  { code: 'ar', name: 'العربية (Arabic)' },
  { code: 'zh', name: '中文 (Chinese)' },
  { code: 'es', name: 'Español (Spanish)' },
  { code: 'fr', name: 'Français (French)' },
  { code: 'de', name: 'Deutsch (German)' },
  { code: 'pt', name: 'Português (Portuguese)' },
  { code: 'ru', name: 'Русский (Russian)' },
  { code: 'ja', name: '日本語 (Japanese)' },
  { code: 'ko', name: '한국어 (Korean)' },
  { code: 'ur', name: 'اردو (Urdu)' },
  { code: 'vi', name: 'Tiếng Việt (Vietnamese)' },
  { code: 'th', name: 'ไทย (Thai)' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'tr', name: 'Türkçe (Turkish)' },
];

// Local storage key for language preference
const LANGUAGE_PREF_KEY = 'user_language_preference';
const AUTO_DETECTED_KEY = 'user_language_auto_detected';

// Map of common browser language codes to our supported language codes
const BROWSER_LANG_MAP: Record<string, string> = {
  'bn': 'bn', 'hi': 'hi', 'ar': 'ar', 'zh': 'zh', 'es': 'es',
  'fr': 'fr', 'de': 'de', 'pt': 'pt', 'ru': 'ru', 'ja': 'ja',
  'ko': 'ko', 'ur': 'ur', 'vi': 'vi', 'th': 'th', 'id': 'id', 'tr': 'tr',
  // Common variants
  'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hk': 'zh',
  'pt-br': 'pt', 'pt-pt': 'pt',
  'es-mx': 'es', 'es-es': 'es',
  'fr-ca': 'fr', 'fr-fr': 'fr',
  'de-de': 'de', 'de-at': 'de',
  'ar-sa': 'ar', 'ar-eg': 'ar',
};

function detectBrowserLanguage(): string {
  // Get all browser languages (navigator.languages includes preferred order)
  const browserLangs = navigator.languages || [navigator.language];
  
  for (const lang of browserLangs) {
    const normalized = lang.toLowerCase();
    // Try exact match first
    if (BROWSER_LANG_MAP[normalized]) {
      return BROWSER_LANG_MAP[normalized];
    }
    // Try base language code
    const baseLang = normalized.split('-')[0];
    if (BROWSER_LANG_MAP[baseLang]) {
      return BROWSER_LANG_MAP[baseLang];
    }
  }
  
  // Default to Bengali if no match (as per original default)
  return 'bn';
}

export default function Settings() {
  useAuth();
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [quotaRefreshTrigger, setQuotaRefreshTrigger] = useState(0);
  const [autoDetected, setAutoDetected] = useState(false);

  useEffect(() => {
    // Load language preference from localStorage
    const storedLang = localStorage.getItem(LANGUAGE_PREF_KEY);
    const wasAutoDetected = localStorage.getItem(AUTO_DETECTED_KEY);
    
    if (storedLang) {
      setSelectedLanguage(storedLang);
      setAutoDetected(wasAutoDetected === 'true');
    } else {
      // Auto-detect from browser/location
      const detectedLang = detectBrowserLanguage();
      setSelectedLanguage(detectedLang);
      setAutoDetected(true);
      // Save the auto-detected preference
      localStorage.setItem(LANGUAGE_PREF_KEY, detectedLang);
      localStorage.setItem(AUTO_DETECTED_KEY, 'true');
    }

    const tempApiKey = sessionStorage.getItem('tempGeminiApiKey');
    if (tempApiKey) {
      toast.info('Please save your Gemini API key below to complete setup.');
      sessionStorage.removeItem('tempGeminiApiKey');
    }
  }, []);

  const handleSaveLanguage = async () => {
    setIsSaving(true);
    try {
      localStorage.setItem(LANGUAGE_PREF_KEY, selectedLanguage);
      localStorage.setItem(AUTO_DETECTED_KEY, 'false'); // Mark as manually set
      setAutoDetected(false);
      toast.success('Language preference saved successfully!');
    } catch (error) {
      console.error('Error saving language:', error);
      toast.error('Failed to save language preference');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApiKeyChanged = () => {
    // Increment trigger to refresh the quota display
    setQuotaRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-heading">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your account preferences and integrations.</p>
        </div>

        <div className="space-y-6">
          {/* Language Preferences */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe size={20} className="text-primary" />
                Language Preferences
              </CardTitle>
              <CardDescription>
                Set your preferred language for translations in flashcards and reading study mode.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="language">Translation Language</Label>
                <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                  <SelectTrigger id="language" className="w-full max-w-xs">
                    <SelectValue placeholder="Select a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Selected words in reading passages and flashcards will be translated to this language.
                  {autoDetected && (
                    <span className="block mt-1 text-xs text-primary">
                      Auto-detected from your browser settings. Save to confirm or change.
                    </span>
                  )}
                </p>
              </div>
              <Button onClick={handleSaveLanguage} disabled={isSaving} className="gap-2">
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save Language'}
              </Button>
            </CardContent>
          </Card>

          {/* AI Integrations */}
          <Card>
            <CardHeader>
              <CardTitle>AI Integrations</CardTitle>
              <CardDescription>
                Manage your Gemini API key and view usage statistics.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <GeminiApiKeyManager onApiKeyChanged={handleApiKeyChanged} />
              <GeminiQuotaDisplay showCard={false} refreshTrigger={quotaRefreshTrigger} />
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
