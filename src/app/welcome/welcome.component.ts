import { Component } from '@angular/core';
import {RouterLink} from '@angular/router';
import {MatButton} from '@angular/material/button';
import {ReactiveFormsModule} from '@angular/forms';
@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  imports: [
    RouterLink,
    MatButton,
    ReactiveFormsModule,
  ],
  styleUrls: ['./welcome.component.css'],
  standalone: true
})
export class WelcomeComponent {
  slides  = [
    {image: "images/asso-logo0.png", title: "0", subtitle: "Subtitle 0"},
    {image: "images/asso-logo1.png", title: "1", subtitle: "Subtitle 1"},
    {image: "images/asso-logo0.png", title: "0", subtitle: "Subtitle 2"},
    {image: "images/asso-logo1.png", title: "1", subtitle: "Subtitle 3"}
  ];

  onItemChange($event: any): void {
    console.log('Carousel onItemChange', $event);
  }
}
