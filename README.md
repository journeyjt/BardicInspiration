# Bardic Inspiration

![FoundryVTT Version](https://img.shields.io/badge/FoundryVTT-v13-green)
![Module Version](https://img.shields.io/badge/version-0.8.33-blue)
![License](https://img.shields.io/badge/license-MIT-yellow)

A synchronized YouTube music player module for FoundryVTT that lets Game Masters and players share a musical experience during tabletop sessions. Features DJ controls, queue management, and real-time synchronization across all connected players.

## Features

### Synchronized Playback
- Real-time YouTube video synchronization across all players
- Automatic drift correction ensures everyone stays in sync
- Late-joiner support - new players automatically sync to current playback

### DJ Management System
- Single DJ controls playback for all users
- DJ role can be claimed, released, or handed off
- Request system for players to ask for DJ privileges
- GM override capabilities for ultimate control

### Queue Management
- Add unlimited YouTube videos to the queue
- Reorder queue items with up/down controls
- Remove videos from queue
- Automatic loop - restarts from beginning when queue ends
- Queue persists across sessions

### Modern UI
- Clean, modern blue-themed interface
- Responsive design that works at any window size
- Visual indicators for DJ status and current playing video
- Intuitive controls with clear visual feedback

## Installation

### Method 1: Manifest URL (Recommended)
1. In FoundryVTT, navigate to **Add-on Modules**
2. Click **Install Module**
3. Paste this manifest URL:
   ```
   https://github.com/journeyjt/BardicInspiration/releases/latest/download/module.json
   ```
4. Click **Install**

### Method 2: Manual Installation
1. Download the latest release from [Releases](https://github.com/journeyjt/BardicInspiration/releases)
2. Extract the zip file to your FoundryVTT modules folder:
   - Windows: `%appdata%/FoundryVTT/Data/modules/`
   - macOS: `~/Library/Application Support/FoundryVTT/Data/modules/`
   - Linux: `~/.local/share/FoundryVTT/Data/modules/`
3. Restart FoundryVTT

## Usage

1. **Enable the Module**: In your world settings, enable "Bardic Inspiration"

2. **Open the YouTube DJ**: Click the music note icon in the scene controls toolbar

3. **Join the Session**: Click "Join Session" to connect to synchronized playback

4. **Become the DJ**: 
   - Click "Become DJ" to take control
   - Only the DJ can control playback and manage the queue

5. **Add Videos**: 
   - Paste YouTube URLs in the input field
   - Click "Add to Queue" or press Enter

6. **Control Playback**: 
   - Use play/pause/next buttons (DJ only)
   - Adjust volume locally
   - Mute/unmute as needed

## For Developers

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidelines.

### Quick Start
```bash
npm install
npm run dev:serve  # Start development server with HMR
```

### Building
```bash
npm run build  # Create production build and module.zip
```

## Requirements

- FoundryVTT v12 or higher (tested with v13.347)
- Modern web browser with YouTube iframe API support
- Active internet connection for YouTube playback

## Compatibility

This module has been tested with:
- FoundryVTT v13.347
- Chrome, Firefox, Edge browsers
- Windows, macOS, Linux operating systems

## Support

- **Bug Reports**: [Create an issue](https://github.com/journeyjt/BardicInspiration/issues/new?template=bug_report.md)
- **Feature Requests**: [Submit a feature request](https://github.com/journeyjt/BardicInspiration/issues/new?template=feature_request.md)
- **Discussions**: [Join the conversation](https://github.com/journeyjt/BardicInspiration/discussions)

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## Testing

This module includes a comprehensive test suite using Vitest to ensure reliability and prevent regressions.

### Running Tests

```bash
# Install test dependencies
npm install

# Run all tests once
npm run test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Test Coverage

The test suite includes:
- **Unit Tests**: Individual service functionality (SessionStore, SessionManager, SocketManager)
- **Integration Tests**: Multi-user scenarios and service interactions
- **End-to-End Tests**: Complete user workflows and bug scenario reproductions

Key scenarios tested:
- Multi-user session management and synchronization
- DJ role claiming, handoff, and release workflows
- Session state recovery after disconnection
- Heartbeat system and inactive user cleanup
- "Ghost user" bug prevention and user reconnection flows

See [tests/README.md](tests/README.md) for detailed testing documentation.

## License

This module is licensed under the [MIT License](LICENSE).

## Acknowledgments

- The FoundryVTT community for their invaluable feedback and support
- YouTube for providing the iframe API
- All contributors who have helped improve this module

## Changelog

See [Releases](https://github.com/journeyjt/BardicInspiration/releases) for a detailed changelog.

---

**Note**: This module requires an active internet connection and is subject to YouTube's terms of service. Please ensure you have the appropriate rights to play any content in your sessions.