import { get, set, del } from 'idb-keyval';
import { AudioTrack } from '../types';

const STORE_KEY = 'lingosync_tracks';
const CONFIG_KEY = 'lingosync_config';

export interface StoredTrack extends Omit<AudioTrack, 'url' | 'localVideoUrl'> {
  audioBuffer: ArrayBuffer;
  audioType: string;
  audioHandle?: FileSystemFileHandle;
  videoBuffer?: ArrayBuffer;
  videoType?: string;
  videoHandle?: FileSystemFileHandle;
}

export async function saveLastDirectoryHandle(handle: FileSystemDirectoryHandle) {
  try {
    await set(`${CONFIG_KEY}_dir_handle`, handle);
  } catch (err) {
    console.warn("Failed to save directory handle", err);
  }
}

export async function getLastDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await get<FileSystemDirectoryHandle>(`${CONFIG_KEY}_dir_handle`) || null;
  } catch (err) {
    return null;
  }
}

export async function saveTrack(track: AudioTrack, audioBlob: Blob) {
  try {
    const storedTracks = await get<StoredTrack[]>(STORE_KEY) || [];
    const { url, localVideoUrl, ...metadata } = track;
    
    // Store as ArrayBuffer to bypass Safari/WebKit "NotSupportedError" on Blobs
    const audioBuffer = await audioBlob.arrayBuffer();
    
    const index = storedTracks.findIndex(t => t.id === track.id);
    const newStoredTrack: StoredTrack = { 
      ...metadata, 
      audioBuffer,
      audioType: audioBlob.type || 'audio/wav'
    };
    
    if (index >= 0) {
      // Preserve existing video if any
      newStoredTrack.videoBuffer = storedTracks[index].videoBuffer;
      newStoredTrack.videoType = storedTracks[index].videoType;
      storedTracks[index] = newStoredTrack;
    } else {
      storedTracks.push(newStoredTrack);
    }
    
    await set(STORE_KEY, storedTracks);
  } catch (error) {
    console.warn("Local storage (IndexedDB) is not available or supported in this context.", error);
  }
}

export async function saveTrackVideo(trackId: string, videoBlob: Blob) {
  try {
    const storedTracks = await get<StoredTrack[]>(STORE_KEY) || [];
    const index = storedTracks.findIndex(t => t.id === trackId);
    if (index >= 0) {
      const videoBuffer = await videoBlob.arrayBuffer();
      storedTracks[index].videoBuffer = videoBuffer;
      storedTracks[index].videoType = videoBlob.type;
      await set(STORE_KEY, storedTracks);
    }
  } catch (error) {
    console.warn("Failed to save video to Local Storage.", error);
  }
}

export async function getSavedTracks(): Promise<AudioTrack[]> {
  try {
    const storedTracks = await get<StoredTrack[]>(STORE_KEY) || [];
    return storedTracks.map(st => {
      // Reconstruct the audio blob
      const audioBlob = new Blob([st.audioBuffer], { type: st.audioType || 'audio/wav' });
      
      // Sanitization: use metadata directly as transient URLs are already omitted in StoredTrack
      const { ...metadata } = st;
      
      const track: AudioTrack = {
        ...metadata,
        url: URL.createObjectURL(audioBlob)
      };

      // Reconstruct video blob ONLY if we have the actual buffer
      if (st.videoBuffer && st.videoType) {
        const videoBlob = new Blob([st.videoBuffer], { type: st.videoType });
        track.localVideoUrl = URL.createObjectURL(videoBlob);
      } else {
        track.localVideoUrl = undefined;
      }

      return track;
    });
  } catch (error) {
    console.warn("Failed to read from Local Storage. Proceeding with empty library.", error);
    return [];
  }
}

export async function clearAllTracks() {
  try {
    await del(STORE_KEY);
  } catch (error) {
    console.warn("Failed to clear Local Storage.", error);
  }
}

export async function deleteTrack(id: string) {
  try {
    const storedTracks = await get<StoredTrack[]>(STORE_KEY) || [];
    const filtered = storedTracks.filter(t => t.id !== id);
    await set(STORE_KEY, filtered);
  } catch (error) {
    console.warn("Failed to delete track from Local Storage.", error);
  }
}

export async function removeTrackAudio(id: string) {
  try {
    const storedTracks = await get<StoredTrack[]>(STORE_KEY) || [];
    const index = storedTracks.findIndex(t => t.id === id);
    if (index >= 0) {
      delete storedTracks[index].audioBuffer;
      delete storedTracks[index].audioType;
      await set(STORE_KEY, storedTracks);
    }
  } catch (error) {
    console.warn("Failed to remove track audio from Local Storage.", error);
  }
}

export async function removeTrackVideo(trackId: string) {
  try {
    const storedTracks = await get<StoredTrack[]>(STORE_KEY) || [];
    const index = storedTracks.findIndex(t => t.id === trackId);
    if (index >= 0) {
      delete storedTracks[index].videoBuffer;
      delete storedTracks[index].videoType;
      // Also ensure metadata flags are cleared
      storedTracks[index].youtubeId = undefined;
      storedTracks[index].videoFileName = undefined;
      storedTracks[index].isVideo = false;
      
      await set(STORE_KEY, storedTracks);
    }
  } catch (error) {
    console.warn("Failed to remove video from Local Storage.", error);
  }
}

export async function updateTrackMetadata(id: string, updates: Partial<Omit<AudioTrack, 'url' | 'localVideoUrl'>>) {
  try {
    const storedTracks = await get<StoredTrack[]>(STORE_KEY) || [];
    const index = storedTracks.findIndex(t => t.id === id);
    if (index >= 0) {
      const { ...safeUpdates } = updates;
      // Explicitly remove transient properties just in case
      delete (safeUpdates as any).url;
      delete (safeUpdates as any).localVideoUrl;
      
      storedTracks[index] = { ...storedTracks[index], ...safeUpdates };
      await set(STORE_KEY, storedTracks);
    }
  } catch (error) {
    console.warn("Failed to update track metadata in Local Storage.", error);
  }
}
