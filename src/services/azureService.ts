import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// --- AZURE TTS (Text-to-Speech) ---
export async function generateAzureExpressionAudio(text: string, apiKey: string, region: string): Promise<string> {
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const safeText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  
  // Usando a voz "Aria Neural", uma das vozes mais premium e naturais da Microsoft para inglês
  const ssml = `<speak version='1.0' xml:lang='en-US'>
    <voice xml:lang='en-US' xml:gender='Female' name='en-US-AriaNeural'>
      ${safeText}
    </voice>
  </speak>`;

  const response = await fetch(url, {
      method: 'POST',
      headers: {
          'Ocp-Apim-Subscription-Key': apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
      },
      body: ssml
  });

  if (!response.ok) {
      throw new Error(`Erro na Azure TTS: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  // Converte ArrayBuffer para Base64
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
  }
  // Return as data URI so the player decodes it as compressed audio (mp3), not raw PCM.
  return `data:audio/mpeg;base64,${btoa(binary)}`;
}

// --- AZURE STT (Speech-to-Text) ---
// Retorna um array de objetos parecidos com o TranscriptSegment
export async function transcribeAudioAzure(audioBase64: string, apiKey: string, region: string): Promise<any[]> {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Converter Base64 para ArrayBuffer
      const binaryString = atob(audioBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

      // 2. Decodificar o áudio original (MP3, MP4, AAC) para PCM bruto usando AudioContext nativo do navegador
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // 3. Obter os dados do canal mono
      const channelData = audioBuffer.getChannelData(0);
      
      // 4. Converter Float32 (AudioContext) para Int16 (formato esperado pelo Speech SDK)
      const int16Array = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        let s = Math.max(-1, Math.min(1, channelData[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // 5. Alimentar o SDK da Microsoft
      const pushStream = sdk.AudioInputStream.createPushStream(
        sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
      );
      
      // Enviamos o buffer todo de uma vez (ou poderíamos fazer em chunks)
      pushStream.write(int16Array.buffer);
      pushStream.close();

      const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
      const speechConfig = sdk.SpeechConfig.fromSubscription(apiKey, region);
      speechConfig.speechRecognitionLanguage = "en-US";
      
      // Solicita formato detalhado para obtermos os timestamps
      speechConfig.outputFormat = sdk.OutputFormat.Detailed;
      // Solicita word-level timestamps (embora o Detailed já traga, garante a extração máxima)
      speechConfig.requestWordLevelTimestamps();

      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      
      const segments: any[] = [];

      recognizer.recognized = (s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
          const jsonResult = JSON.parse(e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult));
          
          if (jsonResult.NBest && jsonResult.NBest.length > 0) {
             const best = jsonResult.NBest[0];
             // O offset vem em ticks (1 tick = 100ns = 0.0001 ms = 0.0000001s)
             // Duration também em ticks.
             const startSec = e.result.offset / 10000000; 
             const endSec = startSec + (e.result.duration / 10000000);
             
             const words = best.Words ? best.Words.map((w: any) => ({
               text: w.Word,
               start: w.Offset / 10000000,
               end: (w.Offset + w.Duration) / 10000000
             })) : [];

             segments.push({
               text: best.Display, // O texto com pontuação correta
               start: startSec,
               end: endSec,
               words: words,
               // Como a Azure STT não traduz, colocamos null aqui temporariamente
               translation: "" 
             });
          }
        }
      };

      recognizer.canceled = (s, e) => {
        if (e.reason === sdk.CancellationReason.Error) {
          recognizer.stopContinuousRecognitionAsync();
          reject(new Error(`Erro Azure STT: ${e.errorDetails}`));
        }
      };

      recognizer.sessionStopped = (s, e) => {
        recognizer.stopContinuousRecognitionAsync(() => {
          resolve(segments);
        });
      };

      recognizer.startContinuousRecognitionAsync();

    } catch (err) {
      reject(err);
    }
  });
}
