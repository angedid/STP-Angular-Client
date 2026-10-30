import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FourOFour } from './four-ofour';

describe('FourOFour', () => {
  let component: FourOFour;
  let fixture: ComponentFixture<FourOFour>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FourOFour]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FourOFour);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
