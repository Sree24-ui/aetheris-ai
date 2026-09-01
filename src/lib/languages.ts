// Single source of truth for teaching languages offered throughout the app
// (setup form, mid-lesson switcher). Keep in sync with the BCP-47 map in
// src/hooks/useSpeech.ts — every language listed here should have a voice
// mapping there too.
export const LANGUAGES = [
  "English", "Hindi", "Hinglish", "Spanish", "French", "German", "Japanese",
  "Chinese", "Arabic", "Portuguese", "Russian", "Tamil", "Telugu", "Marathi",
  "Bengali", "Gujarati", "Kannada", "Malayalam", "Punjabi", "Urdu", "Korean", "Italian",
] as const;
