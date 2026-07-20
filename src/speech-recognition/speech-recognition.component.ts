import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  NgZone,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';

type RecognitionState = 'idle' | 'listening' | 'paused';

@Component({
  selector: 'app-speech-recognition',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './speech-recognition.component.html',
  styleUrl: './speech-recognition.component.css',
})
export class SpeechRecognitionComponent implements OnInit, OnDestroy {
  @Output() messageSent = new EventEmitter<string>();

  visible = false;
  state: RecognitionState = 'idle';
  finalTranscript = '';
  interimTranscript = '';
  lastSentMessage = '';
  errorMessage = '';
  unsupported = false;

  waveformLevels = Array.from({ length: 46 }, () => 0.1);

  private recognition: any;
  private recognitionActive = false;
  private restartAfterEnd = false;
  private automaticSendRequested = false;
  private accumulatedTranscript = '';
  private sessionFinalTranscript = '';
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private finalResultTimer?: ReturnType<typeof setTimeout>;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private readonly autoSendDelay = 2200;
  private mediaStream?: MediaStream;
  private audioContext?: AudioContext;
  private analyser?: AnalyserNode;
  private frequencyData?: Uint8Array;
  private animationFrameId?: number;
  private visualizationToken = 0;
  private destroyed = false;

  constructor(
    private readonly zone: NgZone,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  get isListening(): boolean {
    return this.state === 'listening';
  }

  get isPaused(): boolean {
    return this.state === 'paused';
  }

  get transcript(): string {
    return `${this.finalTranscript} ${this.interimTranscript}`.trim();
  }

  ngOnInit(): void {
    const RecognitionConstructor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!RecognitionConstructor) {
      this.unsupported = true;
      this.errorMessage = 'O reconhecimento de voz não é suportado neste browser.';
      return;
    }

    this.recognition = new RecognitionConstructor();
    this.recognition.lang = 'pt-PT';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.updateView(() => {
        this.recognitionActive = true;
      });
    };

    this.recognition.onresult = (event: any) => {
      this.updateView(() => this.handleResult(event));
    };

    this.recognition.onspeechstart = () => {
      this.updateView(() => this.clearSilenceTimer());
    };

    this.recognition.onspeechend = () => {
      this.updateView(() => this.scheduleAutomaticSend());
    };

    this.recognition.onsoundend = () => {
      this.updateView(() => this.scheduleAutomaticSend());
    };

    this.recognition.onerror = (event: any) => {
      this.updateView(() => {
        if (event.error === 'aborted') return;

        this.recognitionActive = false;

        if (event.error === 'no-speech' && this.isListening) {
          return;
        }

        this.errorMessage = this.describeError(event.error);
        this.restartAfterEnd = false;
        this.automaticSendRequested = false;
        this.clearTimers();
        this.stopMicrophoneVisualization();
        this.state = 'idle';
      });
    };

    this.recognition.onend = () => {
      this.updateView(() => {
        this.recognitionActive = false;

        if (this.automaticSendRequested) {
          this.completeAutomaticSend();
          return;
        }

        if (this.state === 'listening' && this.restartAfterEnd) {
          this.commitCurrentSession();
          this.scheduleRestart();
        }
      });
    };
  }

  openAndStart(): void {
    this.visible = true;
    this.start();
  }

  start(): void {
    if (this.unsupported || !this.recognition) return;

    this.errorMessage = '';
    this.lastSentMessage = '';
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.accumulatedTranscript = '';
    this.sessionFinalTranscript = '';
    this.state = 'listening';
    this.restartAfterEnd = true;
    this.automaticSendRequested = false;
    this.clearTimers();
    void this.startMicrophoneVisualization();
    this.safeStart();
  }

  pause(): void {
    if (!this.isListening) return;

    this.state = 'paused';
    this.restartAfterEnd = false;
    this.automaticSendRequested = false;
    this.clearTimers();
    this.stopMicrophoneVisualization();

    if (this.recognitionActive) {
      this.recognition.stop();
    }
  }

  resume(): void {
    if (!this.isPaused) return;

    this.errorMessage = '';
    this.commitCurrentSession();
    this.state = 'listening';
    this.restartAfterEnd = true;
    this.automaticSendRequested = false;
    void this.startMicrophoneVisualization();
    this.safeStart();
  }

  send(): void {
    const message = this.transcript;
    if (!message) return;

    this.restartAfterEnd = false;
    this.automaticSendRequested = false;
    this.clearTimers();
    this.stopMicrophoneVisualization();
    this.state = 'idle';

    if (this.recognitionActive) {
      this.recognition?.abort();
    }

    this.lastSentMessage = message;
    this.messageSent.emit(message);
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.accumulatedTranscript = '';
    this.sessionFinalTranscript = '';
    this.visible = false;
  }

  cancel(): void {
    this.restartAfterEnd = false;
    this.automaticSendRequested = false;
    this.clearTimers();
    this.stopMicrophoneVisualization();
    this.state = 'idle';

    if (this.recognitionActive) {
      this.recognition?.abort();
    }

    this.recognitionActive = false;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.accumulatedTranscript = '';
    this.sessionFinalTranscript = '';
    this.errorMessage = '';
    this.visible = false;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.restartAfterEnd = false;
    this.automaticSendRequested = false;
    this.clearTimers();
    this.stopMicrophoneVisualization();
    this.recognition?.abort();
  }

  private handleResult(event: any): void {
    let sessionFinal = '';
    let sessionInterim = '';

    // Reconstrói toda a sessão. Alguns browsers alteram resultados anteriores
    // quando transformam texto provisório em texto final.
    for (let index = 0; index < event.results.length; index++) {
      const text = this.normalize(event.results[index][0]?.transcript ?? '');

      if (event.results[index].isFinal) {
        sessionFinal = this.joinText(sessionFinal, text);
      } else {
        sessionInterim = this.joinText(sessionInterim, text);
      }
    }

    this.sessionFinalTranscript = sessionFinal;
    this.finalTranscript = this.joinText(
      this.accumulatedTranscript,
      sessionFinal,
    );
    this.interimTranscript = sessionInterim;

    if (!this.automaticSendRequested) {
      this.scheduleAutomaticSend();
    }
  }

  private scheduleAutomaticSend(): void {
    this.clearSilenceTimer();

    if (!this.isListening || !this.transcript) return;

    this.silenceTimer = setTimeout(() => {
      this.updateView(() => this.requestAutomaticSend());
    }, this.autoSendDelay);
  }

  private requestAutomaticSend(): void {
    if (!this.isListening || !this.transcript) return;

    this.automaticSendRequested = true;
    this.restartAfterEnd = false;
    this.clearSilenceTimer();

    if (!this.recognitionActive) {
      this.completeAutomaticSend();
      return;
    }

    try {
      // stop(), ao contrário de abort(), pede ao browser o último resultado final.
      this.recognition.stop();

      this.finalResultTimer = setTimeout(() => {
        this.updateView(() => this.completeAutomaticSend());
      }, 1500);
    } catch {
      this.completeAutomaticSend();
    }
  }

  private completeAutomaticSend(): void {
    if (!this.automaticSendRequested) return;

    this.automaticSendRequested = false;
    this.clearFinalResultTimer();
    this.send();
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }

  private clearFinalResultTimer(): void {
    if (this.finalResultTimer) {
      clearTimeout(this.finalResultTimer);
      this.finalResultTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.clearSilenceTimer();
    this.clearFinalResultTimer();

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }

  private safeStart(): void {
    if (!this.isListening || this.recognitionActive) return;

    try {
      this.recognition.start();
    } catch {
      // O reconhecimento já pode estar ativo durante uma tentativa de reinício.
    }
  }

  private scheduleRestart(): void {
    if (!this.isListening || !this.restartAfterEnd) return;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.updateView(() => this.safeStart());
    }, 150);
  }

  private commitCurrentSession(): void {
    const currentSession = this.joinText(
      this.sessionFinalTranscript,
      this.interimTranscript,
    );

    this.accumulatedTranscript = this.joinText(
      this.accumulatedTranscript,
      currentSession,
    );
    this.sessionFinalTranscript = '';
    this.finalTranscript = this.accumulatedTranscript;
    this.interimTranscript = '';
  }

  private joinText(...parts: string[]): string {
    return this.normalize(parts.filter(Boolean).join(' '));
  }

  private normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  trackWaveformBar(index: number): number {
    return index;
  }

  private async startMicrophoneVisualization(): Promise<void> {
    this.stopMicrophoneVisualization();
    const token = this.visualizationToken;

    if (!navigator.mediaDevices?.getUserMedia) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });

      if (token !== this.visualizationToken || !this.isListening) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const AudioContextConstructor =
        window.AudioContext || (window as any).webkitAudioContext;

      if (!AudioContextConstructor) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const audioContext: AudioContext = new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -20;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);

      this.mediaStream = stream;
      this.audioContext = audioContext;
      this.analyser = analyser;
      this.frequencyData = new Uint8Array(analyser.frequencyBinCount);

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      this.zone.runOutsideAngular(() => this.drawMicrophoneLevels(token));
    } catch {
      // O próprio SpeechRecognition apresenta os erros de permissão/captura.
      this.resetWaveform();
    }
  }

  private drawMicrophoneLevels(token: number): void {
    if (
      token !== this.visualizationToken ||
      !this.isListening ||
      !this.analyser ||
      !this.frequencyData
    ) {
      return;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);
    const usableBins = Math.min(96, this.frequencyData.length);
    const levels = this.waveformLevels.map((_, index) => {
      const start = Math.floor((index * usableBins) / this.waveformLevels.length);
      const end = Math.max(
        start + 1,
        Math.floor(((index + 1) * usableBins) / this.waveformLevels.length),
      );
      let total = 0;

      for (let bin = start; bin < end; bin++) {
        total += this.frequencyData?.[bin] ?? 0;
      }

      const average = total / (end - start);
      return Math.min(1, 0.1 + Math.pow(average / 255, 0.72) * 1.15);
    });

    this.zone.run(() => {
      this.waveformLevels = levels;

      if (!this.destroyed) {
        this.changeDetector.detectChanges();
      }
    });

    this.animationFrameId = requestAnimationFrame(() =>
      this.drawMicrophoneLevels(token),
    );
  }

  private stopMicrophoneVisualization(): void {
    this.visualizationToken++;

    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = undefined;
    this.analyser = undefined;
    this.frequencyData = undefined;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
    }

    this.audioContext = undefined;
    this.resetWaveform();
  }

  private resetWaveform(): void {
    this.waveformLevels = this.waveformLevels.map(() => 0.1);
  }

  private updateView(action: () => void): void {
    if (this.destroyed) return;

    this.zone.run(() => {
      action();

      if (!this.destroyed) {
        this.changeDetector.detectChanges();
      }
    });
  }

  private describeError(error: string): string {
    const messages: Record<string, string> = {
      'not-allowed': 'Autoriza o acesso ao microfone para utilizar a voz.',
      'audio-capture': 'Não foi possível encontrar ou utilizar o microfone.',
      network: 'O serviço de reconhecimento de voz não está disponível.',
      'no-speech': 'Não foi detetada voz.',
    };

    return messages[error] ?? `Erro no reconhecimento de voz: ${error}`;
  }
}
