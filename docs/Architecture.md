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

# Units of Work (as Actionable Prompts)
> Each prompt is a focused, testable unit. Run them in order. Replace `<your-module-id>` with your actual module id. **No code is included in this file**—these are instructions for the implementation.

---

## U1 — Module Settings & Storage

**Prompt**
