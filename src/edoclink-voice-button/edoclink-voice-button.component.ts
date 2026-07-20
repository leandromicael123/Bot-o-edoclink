import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'edoclink-button',
  standalone: true,
  templateUrl: './edoclink-voice-button.component.html',
  styleUrl: './edoclink-voice-button.component.css',
})
export class EdoclinkVoiceButtonComponent {
  @Output() pressed = new EventEmitter<void>();
}
