import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  HostBinding,
  Input,
  Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface ChatMessage {
  role: 'assistant' | 'user';
  text: string;
}

@Component({
  selector: 'app-chat-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-assistant.component.html',
  styleUrl: './chat-assistant.component.css',
})
export class ChatAssistantComponent {
  @Input() messages: ChatMessage[] = [];
  @Output() messageSubmitted = new EventEmitter<string>();
  @Output() voiceRequested = new EventEmitter<void>();
  @Output() clearRequested = new EventEmitter<void>();

  draft = '';
  attachmentName = '';
  expanded = false;
  closed = false;

  @HostBinding('class.is-expanded')
  get isExpanded(): boolean {
    return this.expanded;
  }

  @HostBinding('class.is-closed')
  get isClosed(): boolean {
    return this.closed;
  }

  submit(): void {
    const message = this.draft.trim();
    if (!message) return;

    this.messageSubmitted.emit(message);
    this.draft = '';
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }

  close(): void {
    this.expanded = false;
    this.closed = true;
  }

  reopen(): void {
    this.closed = false;
  }

  selectAttachment(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.attachmentName = input.files?.[0]?.name ?? '';
  }
}
