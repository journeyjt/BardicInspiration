# Foundry VTT Module: Synced YouTube DJ (Architecture & Work Plan)

> **Purpose**: Enable a designated “DJ” (or group) to queue YouTube links and synchronize playback for all users in a Foundry VTT world using the **official YouTube IFrame Player API** (ToS‑compliant). No re-streaming or audio extraction. The module coordinates **what** plays and **when**; each client uses an embedded YouTube player locally.

---

## 1) Goals & Non‑Goals

### Goals
- Collaborative queue of YouTube videos (players and/or GM can add).
- A single authority (“DJ”) controls transport (play/pause/seek/next).
- All clients embed the official YouTube player and follow DJ commands.
- Resilient sync (heartbeat & drift correction).
- Minimal friction (one-time “Enable playback” gesture per session).

### Non‑Goals
- No audio extraction or re-hosting of YouTube content.
- No guaranteed ad-free experience.
- No bypass of regional/account restrictions.

---

## 2) Constraints & Assumptions

- **Browser Autoplay Policies**: Sounded playback generally requires a user gesture; module must capture consent once per session.
- **Ads & Geo Restrictions**: May cause temporary desync; the heartbeat realigns after ads finish.
- **Latency & Drift**: Network jitter and device variance will create small offsets; acceptable target is ≤ 500ms after correction.
- **Permissions**: World admins/GM can override DJ selection. “Group DJ” mode is optional and configurable.

---

## 3) High‑Level Architecture

**Core concepts**
- **Queue State**: Ordered list of YouTube video IDs (optionally with fetched metadata).
- **Authority Model**: Exactly one **DJ** broadcasts control events & periodic heartbeats.
- **Players**: Listeners receive control + heartbeats and drive their local YouTube players accordingly.

**Layers**
1. **State & Settings** (world-scope):
   - Queue items, current index, DJ userId, role configuration, and feature flags (e.g., group DJ).
2. **Transport**:
   - **Foundry Socket** channel (or socketlib) for signaling: enqueue, control, heartbeats.
3. **Playback**:
   - Per-client **YouTube IFrame Player** (created once and reused).
   - Local **drift correction** to snap/seek when out of tolerance.
4. **UI**:
   - ApplicationV2 panel for queue, now playing, controls, and “Enable playback” consent UI.

---

## 4) Data Model (Conceptual)

- **VideoItem**
  - `id`: uuid
  - `videoId`: string (YouTube video ID only)
  - `title`/`thumbnail` (optional; fetched via oEmbed or Data API)
  - `addedBy`: userId
  - `addedAt`: epoch ms

- **QueueState**
  - `items`: VideoItem[]
  - `currentIndex`: number
  - `mode`: `"single-dj" | "group-dj"`
  - `djUserId`: userId | null

- **PlayerState (Leader Snapshot)**
  - `videoId`: string
  - `currentTime`: seconds
  - `isPlaying`: boolean
  - `playbackRate`: number
  - `updatedAt`: epoch ms (leader timestamp)

---

## 5) Message Protocol (Conceptual)

**Channel**: `module.<your-module-id>`

- `QUEUE/ADD` `{ videoId }`
- `QUEUE/REMOVE` `{ id }`
- `QUEUE/MOVE` `{ id, toIndex }`
- `CONTROL/LOAD` `{ videoId, startSeconds }`
- `CONTROL/PLAY` `{}`
- `CONTROL/PAUSE` `{}`
- `CONTROL/SEEK` `{ seconds }`
- `CONTROL/NEXT` `{}`
- `HEARTBEAT` `{ videoId, currentTime, playbackRate, serverTs }`
- `ROLE/DJ_SET` `{ userId }`  (GM override or DJ handoff)
- `ROLE/DJ_REQUEST` `{ requesterId }` (optional, for handoff UX)

> **Authority check**: Only DJ can emit `CONTROL/*` & `HEARTBEAT`. GM can override DJ.

---

## 6) Sync Strategy

- **Initial Load / Seek**: Followers call `loadVideoById(videoId, startSeconds)` when receiving `CONTROL/LOAD` and set paused/playing to match leader.
- **Heartbeat (1 Hz)**: Leader emits current time & rate. Followers compute drift:  
  - If `|leaderTime - localTime| > 0.5s`: snap to `leaderTime` (seek).  
  - Else ignore; reduce churn.
- **State Loss Recovery**: Upon joining late or reconnecting, follower requests a **state snapshot**; DJ responds with `CONTROL/LOAD` and immediate heartbeat.

---

## 7) Permissions & Roles

- **DJ**: World setting `djUserId` or derived from socket event.  
- **Group DJ Mode**: Anyone can add to queue; only DJ can issue transport.
- **GM Controls**: Override DJ; lock queue; clear queue; set modes.

---

## 8) UX Overview

- **Control Panel** (ApplicationV2):
  - Top bar: Now Playing (title/thumbnail), time/display, local volume (per-user).
  - Transport: Prev / Play–Pause / Next / Seek bar / Playback rate (optional).
  - Queue list: Add (paste YouTube URL), remove, reorder (drag).
  - Roles: “Become DJ”, “Relinquish DJ”, “Request DJ” (optional).
  - Consent: **Enable Synced Playback** button shown until autoplay permission satisfied.
- **Status Bar Widget** (optional):
  - Compact display with current track and a small “open panel” button.

---

## 9) Error Handling & Resilience

- **YouTube Errors**: Surface error code + friendly message; allow retry.
- **Ad Playback**: Warn: “Ad detected—sync will resume after ad.” Heartbeat realigns.
- **Geo/Account Restrictions**: Show “Unavailable in your region/account”; auto-skip if configured.
- **Socket Disconnects**: Followers keep local playback; resync when heartbeats resume or on reconnect snapshot.
- **Rate Limiting**: Debounce rapid seeks/play/pause to avoid thrash.

---

## 10) Telemetry (Optional, Local Only)

- Aggregate join/leave counts, playback events, average drift (anonymized).
- Toggle via a world setting (off by default).

---

## 11) Testing Strategy (High Level)

- **Unit-like validation via prompts** (below) for each feature slice.
- **Multi-client testing**: One DJ + 2–3 followers in separate browser profiles.
- **Edge tests**: Join mid-track; ad interruption; packet loss simulation; DJ handoff; GM override.

---

# MVP Implementation Plan (Phased Approach)
> Modified from original architecture to focus on rapid prototyping and validation. Each phase builds incrementally toward the full vision while maintaining a working product at each step.

---

## Phase 1: Proof of Concept (Core Validation)

### MVP-U1 — YouTube Player Integration (Single Client)

**Goal**: Validate YouTube IFrame Player API integration within FoundryVTT
**Deliverable**: Single user can control YouTube videos in a FoundryVTT panel

**Tasks**:
- Create basic ApplicationV2 panel with YouTube player embed
- Implement YouTube URL → video ID extraction
- Add basic transport controls (play/pause/seek)
- Handle autoplay permission consent UI
- Test video loading, playback, and error states

**Success Criteria**:
- User can paste YouTube URL and video loads
- Play/pause/seek controls work reliably  
- Clear error messages for invalid URLs or restricted videos
- Autoplay consent captured and respected

---

### MVP-U2 — Socket Communication Foundation

**Goal**: Establish real-time communication between clients
**Deliverable**: Basic command broadcasting (DJ → followers)

**Tasks**:
- Set up FoundryVTT socket channel for module
- Implement simple authority system (first user = DJ)
- Create basic message protocol (PLAY, PAUSE, SEEK, LOAD)
- Add DJ status indicator to UI
- Test with 2 clients (1 DJ, 1 follower)

**Success Criteria**:
- DJ commands reach follower clients reliably
- Basic authority system prevents command conflicts
- Socket disconnection doesn't crash module
- Clear visual indication of DJ status

---

### MVP-U3 — Multi-Client Sync (Basic)

**Goal**: Synchronize video playback across multiple clients
**Deliverable**: Crude but functional sync (2-3 second tolerance acceptable)

**Tasks**:
- Implement follower response to DJ commands
- Add basic drift detection and correction
- Create simple heartbeat system (5-10 second intervals)
- Handle common YouTube player states
- Test with 3+ clients

**Success Criteria**:
- Videos start/stop together across clients (within 3 seconds)
- Seeking approximately syncs all clients
- Late joiners can sync to current playback
- Basic recovery from YouTube errors (ads, buffering)

---

## Phase 2: Core Features (MVP Complete)

### MVP-U4 — Simple Queue System

**Goal**: Enable basic playlist functionality
**Deliverable**: Add/remove/next queue management

**Tasks**:
- Create queue data structure in world settings
- Add "Add to Queue" URL input
- Implement queue display in UI panel
- Add "Next" button and auto-advance
- Simple remove from queue functionality

**Success Criteria**:
- DJ can build a queue of videos
- Queue advances automatically when video ends
- All clients see same queue state
- Simple queue persistence across sessions

---

### MVP-U5 — Improved Sync & Persistence

**Goal**: Refine sync accuracy and handle edge cases
**Deliverable**: Production-ready sync system

**Tasks**:
- Increase heartbeat frequency (1Hz)
- Improve drift correction algorithm (≤1 second tolerance)
- Add reconnection state recovery
- Implement world settings persistence
- Enhanced error handling and user feedback

**Success Criteria**:
- Sync accuracy under 1 second in normal conditions
- Clients recover gracefully from disconnections
- Settings persist across world reloads
- Clear error messages and recovery options

---

### MVP-U6 — DJ Management & Permissions

**Goal**: Proper authority and role management
**Deliverable**: Controlled DJ handoffs and GM overrides

**Tasks**:
- Implement DJ handoff system
- Add GM override capabilities
- Create "Request DJ" functionality
- Add basic permission checks
- DJ status persistence
- Handle case where DJ leaves without handing off
- Handle case where GM leaves session and now world settings can't be updated
- Everyone should have a Mute button for their local player
**Success Criteria**:
- Smooth DJ transitions without playback interruption
- GM can always override DJ control
- Clear UX for DJ requests and handoffs
- Permissions respected across all features
- People can mute the player or clearly see that it is muted
- If DJ leaves without handing off anyone can become the DJ
- The GM should not need to be in the session for the module to function

---

## Phase 3: Polish & Advanced Features (Post-MVP)

### Future Enhancements:
- Metadata fetching (titles, thumbnails, duration)
- Advanced queue management (drag-and-drop reordering)
- Volume controls and audio ducking
- Playlist import/export
- Advanced error recovery
- Performance optimizations
- Accessibility improvements
- Mobile responsiveness

---

## Implementation Notes

### MVP Simplifications:
1. **No metadata fetching** - Just show video IDs initially
2. **Basic UI** - Functional over beautiful for Phase 1
3. **Simple state management** - World settings over complex Documents
4. **Relaxed sync tolerance** - Perfect sync not required for MVP
5. **Limited error handling** - Cover common cases, not edge cases

### Technical Decisions:
- **Socket System**: Start with built-in `game.socket`, evaluate socketlib later
- **State Storage**: World settings for queue/DJ state, user settings for preferences  
- **UI Framework**: ApplicationV2 + HandlebarsApplicationMixin (proven working)
- **YouTube API**: IFrame Player API only, defer Data/oEmbed API until Phase 2

### Success Metrics:
- **Phase 1**: Single session works reliably for 2-3 users
- **Phase 2**: Multi-session reliability with 4-6 users  
- **Phase 3**: Production-ready for larger groups

---

# Original Units of Work (Reference)
> The original comprehensive plan below remains valid for the complete feature set, but has been reorganized above into an MVP-focused approach.
