export interface Word {
  text: string;
  start: number; // in seconds
  end: number;   // in seconds
}

export interface Flashcard {
  id: string;
  expression: string;
  translation: string;
  explanation: string;
  audioUrl?: string;
  audioBase64?: Record<string, string>;
  audioVoiceId?: string;
}

export interface TranscriptSegment {
  text: string;
  translation?: string;
  start: number;
  end: number;
  words: Word[];
}

export interface AudioTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  coverUrl: string;
  transcript: TranscriptSegment[];
  rawAssemblyWords?: Word[]; // Original AssemblyAI word timestamps for re-alignment after segment edits
  flashcards?: Flashcard[];
  knownWords?: string[]; // Array of lowercase text strings known by user
  youtubeId?: string;
  localVideoUrl?: string;
  videoFileName?: string;
  isVideo?: boolean;
  audioFileName?: string; // Original audio file name used to create this lesson
  language?: string; // Language code (e.g., 'en', 'es', 'fr')
  lessonNumber?: number; // User-defined order number
  driveFileId?: string; // Google Drive file ID for the lesson JSON
  driveAudioFileId?: string; // Google Drive file ID for the audio file
  syncStatus?: 'synced' | 'pending' | 'missing_local' | 'error' | 'cloud_only';
  lastAccessedAt?: number; // Timestamp for cache eviction (5 most recent kept locally)
  updatedAt?: number; // Timestamp of last metadata edit (title, lessonNumber, etc.) — used for multi-device conflict resolution
  transcriptUpdatedAt?: number; // Timestamp of last transcript edit — used for multi-device transcript sync
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
