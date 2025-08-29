# Bardic Inspiration

![FoundryVTT Version](https://img.shields.io/badge/FoundryVTT-v13-green)
![Module Version](https://img.shields.io/badge/version-1.0.2-blue)
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
- **Save & Load Queues**: DJs can save the current queue with a custom name and load saved queues later
- **Export/Import**: Share queue configurations between games or GMs

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

### Getting Started

1. **Enable the Module**
   - Navigate to **Game Settings** → **Manage Modules**
   - Find "Bardic Inspiration" and check the box to enable it
   - Click **Save Module Settings**
   - The YouTube player widget will automatically appear above the player list

2. **Join the Music Session**
   - Look for the widget above the player list on the left side of the screen
   - Click the **"Join Session"** button (play icon) in the widget
   - This connects you to synchronized playback with all other players
   - The YouTube player will become visible once you've joined

3. **Open DJ Controls**
   - After joining the session, click the **"Open DJ Controls"** button (sliders icon) in the widget
   - This opens the full DJ application window where you can manage the queue and control playback
   - Only the DJ can control playback, but all users can view the queue

### Becoming the DJ

1. **Claim DJ Control**
   - In the DJ Controls window, click **"Become DJ"** to take control
   - Only one person can be DJ at a time
   - The current DJ's name is displayed at the top of the DJ Controls window

2. **DJ Indicators**
   - The widget shows who is currently the DJ
   - A crown icon appears next to the DJ's name in the session members list

### DJ Controls (DJ Only)

#### Managing the Queue
- **Add Videos**: 
  - Copy any YouTube video URL (e.g., `https://youtube.com/watch?v=...`)
  - Paste it into the "Add YouTube URL" field
  - Press **Enter** or click **"Add to Queue"**
  - Videos are added to the bottom of the queue

- **Reorder Queue**:
  - Use the **↑** and **↓** arrow buttons to move songs up or down
  - The currently playing video is highlighted in blue

- **Remove Videos**:
  - Click the **✕** button next to any video to remove it from the queue

- **Save Current Queue**:
  - Click **"Save Queue"** button
  - Enter a unique name for your queue
  - The queue will be saved and can be loaded later
  
- **Load Saved Queue**:
  - Click **"Load Queue"** button  
  - Select from your saved queues
  - Choose to replace the current queue or append to it
  - Note: Loading a queue does not automatically start playback - you must press play
  
- **Manage Saved Queues**:
  - View all saved queues with creation date and song count
  - Rename saved queues to better organize them
  - Delete queues you no longer need
  - Export queues to share with other GMs
  - Import queues from other games

- **Clear Queue**:
  - Click **"Clear All"** to remove all videos
  - You'll be prompted to save the current queue before clearing

#### Playback Controls
- **Play/Pause**: Toggle playback for all connected users
- **Next**: Skip to the next video in the queue
- **Previous**: Return to the previous video
- **Seek**: Click anywhere on the progress bar to jump to that position
- **Loop Queue**: When the queue ends, it automatically restarts from the beginning

### Player Controls (All Users)

- **Volume**: Adjust your own volume using the slider in the widget
- **Mute/Unmute**: Toggle audio on/off locally without affecting others (speaker icon in widget)
- **Leave Session**: Click the exit icon in the widget to disconnect from synchronized playback
- **Request DJ**: In the DJ Controls window, click to notify the current DJ that you'd like control

### DJ Management

#### Handing Off DJ Role
1. Current DJ clicks **"Release DJ"**
2. Another player clicks **"Become DJ"** to claim control
3. Alternatively, DJ can directly hand off to a specific player

#### GM Override
- Game Masters can always override and claim DJ control
- GM can forcibly release DJ role from any player

### Tips for Best Experience

- **Stable Connection**: Ensure all players have a stable internet connection for synchronized playback
- **Prepare Playlists**: Add multiple videos to the queue before starting for uninterrupted music
- **Save Your Playlists**: Save frequently-used queues for quick loading in future sessions
- **Volume Balance**: Start with lower volume and adjust up to avoid startling players
- **Session Persistence**: The queue and current playback position persist between sessions
- **Late Joiners**: Players who join mid-session automatically sync to current playback
- **Audio Settings Preserved**: Loading a saved queue won't change users' volume or mute settings

### Troubleshooting

- **Widget Not Visible**: Make sure the module is enabled and refresh the page
- **Player Not Loading**: Ensure you've clicked "Join Session" in the widget first
- **Videos Not Playing**: Check that YouTube isn't blocked by browser extensions or network filters
- **Out of Sync**: The module automatically corrects drift, but you can leave and rejoin the session to force a resync
- **No Sound**: Check the volume slider in the widget, ensure you're not muted, and verify system volume
- **Can't Find DJ Controls**: After joining the session, click the sliders icon in the widget to open the DJ Controls window

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

- FoundryVTT v13 or higher
- Modern web browser with YouTube iframe API support
- Active internet connection for YouTube playback

## Compatibility

This module has been tested with:
- FoundryVTT v13.347
- Chrome, Firefox, Edge browsers
- Windows, Linux operating systems

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
