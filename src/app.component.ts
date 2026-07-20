import { Component, HostListener, ViewChild } from '@angular/core';
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
  @ViewChild('voiceAssistant')
  private voiceAssistant?: SpeechRecognitionComponent;

  @ViewChild('chatAssistant')
  private chatAssistant?: ChatAssistantComponent;

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
    this.chatAssistant?.open();

    window.setTimeout(() => {
      this.messages = [
        ...this.messages,
        { role: 'assistant', text: this.createAssistantReply(message) },
      ];
    }, 550);
  }

  openChatbot(): void {
    this.chatAssistant?.open();
  }

  clearConversation(): void {
    this.messages = [{ ...this.greeting }];
  }

  @HostListener('document:keydown', ['$event'])
  openVoiceWithShortcut(event: KeyboardEvent): void {
    if (!event.altKey || event.code !== 'KeyA' || event.repeat) return;

    event.preventDefault();
    event.stopPropagation();
    this.voiceAssistant?.openAndStart();
  }

  private createAssistantReply(message: string): string {
    const normalized = message.toLocaleLowerCase('pt-PT');

    if (normalized.includes('dashboard') || normalized.includes('painel')) {
      return 'O painel reúne documentos, pastas, tarefas, contadores e gráficos. Qual destes elementos pretende consultar?';
    }

    if (normalized.includes('documento') || normalized.includes('processo')) {
      return 'Posso ajudar a pesquisar um documento. Indique um código, assunto, autor ou intervalo de datas.';
    }

    if (normalized.includes('resum')) {
      return 'Posso preparar um resumo. Indique o conteúdo que pretende sintetizar.';
    }

    return `Recebi a sua mensagem: “${message}”. A ligação ao serviço de IA pode ser adicionada neste ponto de integração.`;
  }
}
