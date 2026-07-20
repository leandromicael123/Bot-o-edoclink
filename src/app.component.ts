import { Component } from '@angular/core';
import {
  ChatAssistantComponent,
  ChatMessage,
} from './chat-assistant/chat-assistant.component';
import { EdoclinkVoiceButtonComponent } from './edoclink-voice-button/edoclink-voice-button.component';
import { SpeechRecognitionComponent } from './speech-recognition/speech-recognition.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    ChatAssistantComponent,
    EdoclinkVoiceButtonComponent,
    SpeechRecognitionComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  private readonly greeting: ChatMessage = {
    role: 'assistant',
    text: 'Olá, sou o Assistente Link. Como posso ajudar?',
  };

  messages: ChatMessage[] = [
    {
      role: 'assistant',
      text: 'Olá, sou o Assistente Link. Como posso ajudar?',
    },
  ];

  addMessage(text: string): void {
    const message = text.trim();
    if (!message) return;

    this.messages = [...this.messages, { role: 'user', text: message }];
  }

  clearConversation(): void {
    this.messages = [{ ...this.greeting }];
  }
}
