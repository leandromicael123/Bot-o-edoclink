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

  readonly waveformBars = Array.from({ length: 46 });

  private recognition: any;
  private recognitionActive = false;
  private restartAfterEnd = false;
  private automaticSendRequested = false;
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private finalResultTimer?: ReturnType<typeof setTimeout>;
  private readonly autoSendDelay = 1600;
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
          this.safeStart();
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
    this.state = 'listening';
    this.restartAfterEnd = true;
    this.automaticSendRequested = false;
    this.clearTimers();
    this.safeStart();
  }

  pause(): void {
    if (!this.isListening) return;

    this.state = 'paused';
    this.restartAfterEnd = false;
    this.automaticSendRequested = false;
    this.clearTimers();

    if (this.recognitionActive) {
      this.recognition.stop();
    }
  }

  resume(): void {
    if (!this.isPaused) return;

    this.errorMessage = '';
    this.state = 'listening';
    this.restartAfterEnd = true;
    this.automaticSendRequested = false;
    this.safeStart();
  }

  send(): void {
    const message = this.transcript;
    if (!message) return;

    this.restartAfterEnd = false;
    this.automaticSendRequested = false;
    this.clearTimers();
    this.state = 'idle';

    if (this.recognitionActive) {
      this.recognition?.abort();
    }

    this.lastSentMessage = message;
    this.messageSent.emit(message);
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.visible = false;
  }

  cancel(): void {
    this.restartAfterEnd = false;
    this.automaticSendRequested = false;
    this.clearTimers();
    this.state = 'idle';

    if (this.recognitionActive) {
      this.recognition?.abort();
    }

    this.recognitionActive = false;
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.errorMessage = '';
    this.visible = false;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.restartAfterEnd = false;
    this.automaticSendRequested = false;
    this.clearTimers();
    this.recognition?.abort();
  }

  private handleResult(event: any): void {
    let newFinalText = '';
    let newInterimText = '';

    for (let index = event.resultIndex; index < event.results.length; index++) {
      const text = event.results[index][0].transcript;

      if (event.results[index].isFinal) {
        newFinalText += `${text} `;
      } else {
        newInterimText += text;
      }
    }

    if (newFinalText) {
      this.finalTranscript = `${this.finalTranscript} ${newFinalText}`
        .replace(/\s+/g, ' ')
        .trim();
    }

    this.interimTranscript = newInterimText.trim();

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
      }, 700);
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
  }

  private safeStart(): void {
    try {
      this.recognition.start();
    } catch {
      // O reconhecimento já pode estar ativo durante uma tentativa de reinício.
    }
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
