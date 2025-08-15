/**
 * Hello World Application - Test Feature for Bardic Inspiration
 * A simple window to test the module integration using ApplicationV2
 */

interface HelloWorldData {
  message: string;
  timestamp: string;
  isDevMode: boolean;
  hasLibWrapper: boolean;
}

export class HelloWorldApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  
  constructor(options = {}) {
    super(options);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'bardic-inspiration-hello-world',
      window: {
        title: 'Bardic Inspiration - Hello World',
        minimizable: true,
        resizable: true
      },
      position: {
        width: 400,
        height: 300
      },
      classes: ['bardic-inspiration', 'hello-world']
    });
  }

  static get PARTS() {
    return {
      main: {
        template: 'modules/bardic-inspiration/templates/hello-world.hbs'
      }
    };
  }

  /** @override */
  async _prepareContext(options: any): Promise<HelloWorldData> {
    return {
      message: 'Hello World from Bardic Inspiration!',
      timestamp: new Date().toLocaleString(),
      isDevMode: game.modules.get('_dev-mode')?.active || false,
      hasLibWrapper: typeof libWrapper !== 'undefined'
    };
  }

  /** @override */
  _onRender(context: HelloWorldData, options: any): void {
    // Add event listeners after rendering
    const html = this.element;
    
    // Test button functionality
    html.querySelector('.test-button')?.addEventListener('click', this._onTestButtonClick.bind(this));
    html.querySelector('.close-button')?.addEventListener('click', this._onCloseClick.bind(this));
  }

  /**
   * Handle test button click
   */
  private _onTestButtonClick(event: Event): void {
    event.preventDefault();
    
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Testing...';
    
    // Test module functionality
    this._runModuleTest().then(() => {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-play"></i> Run Test';
    });
  }

  /**
   * Handle close button click
   */
  private _onCloseClick(event: Event): void {
    event.preventDefault();
    this.close();
  }

  /**
   * Run a simple test of module functionality
   */
  private async _runModuleTest(): Promise<void> {
    try {
      // Show a notification
      ui.notifications?.info('Bardic Inspiration: Test successful! 🎵');
      
      // Log to console
      console.log('🎵 Bardic Inspiration | Hello World test executed successfully');
      
      // Test libWrapper if available
      if (typeof libWrapper !== 'undefined') {
        console.log('🎵 Bardic Inspiration | libWrapper is available');
      }
      
      // Test Developer Mode if available
      const devMode = game.modules.get('_dev-mode');
      if (devMode?.active) {
        console.log('🎵 Bardic Inspiration | Developer Mode is active');
      }

      // Update the window content
      const content = this.element.querySelector('.test-results');
      if (content) {
        content.innerHTML = `
          <div class="test-success">
            <i class="fas fa-check-circle"></i>
            <p>All tests passed!</p>
            <ul>
              <li>✅ Module loaded and active</li>
              <li>✅ FoundryVTT API accessible</li>
              <li>✅ UI notifications working</li>
              <li>${typeof libWrapper !== 'undefined' ? '✅' : '❌'} libWrapper ${typeof libWrapper !== 'undefined' ? 'available' : 'not found'}</li>
              <li>${devMode?.active ? '✅' : '❌'} Developer Mode ${devMode?.active ? 'active' : 'not active'}</li>
            </ul>
          </div>
        `;
      }

    } catch (error) {
      console.error('🎵 Bardic Inspiration | Test failed:', error);
      ui.notifications?.error('Bardic Inspiration: Test failed! Check console for details.');
      
      const content = this.element.querySelector('.test-results');
      if (content) {
        content.innerHTML = `
          <div class="test-error">
            <i class="fas fa-exclamation-triangle"></i>
            <p>Test failed! Check console for details.</p>
          </div>
        `;
      }
    }
  }

  /**
   * Static method to open the Hello World window
   */
  static open(): HelloWorldApp {
    const app = new HelloWorldApp();
    app.render({ force: true });
    return app;
  }
}