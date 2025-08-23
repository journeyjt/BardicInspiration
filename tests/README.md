# YouTube DJ Module Test Suite

A comprehensive testing strategy for the Bardic Inspiration FoundryVTT module using Vitest.

## Overview

This test suite provides unit, integration, and end-to-end tests for the YouTube DJ module's core functionality, with a focus on multi-user session management, state synchronization, and the complex interaction patterns that occur in real-world usage.

## Test Structure

```
tests/
├── setup/
│   └── test-setup.ts           # Test configuration and FoundryVTT mocks
├── unit/                       # Unit tests for individual services
│   ├── SessionStore.test.ts    # State management tests
│   ├── SessionManager.test.ts  # DJ roles and member management
│   └── SocketManager.test.ts   # Message handling and broadcasting
├── integration/                # Tests for service interactions
│   └── MultiUserSession.test.ts # Multi-user scenarios
├── e2e/                       # End-to-end scenario tests
│   └── GhostUserScenario.test.ts # Complete "ghost user" bug scenario
└── README.md                  # This file
```

## Running Tests

### Install Dependencies
```bash
npm install
```

### Run Tests
```bash
# Run all tests once
npm run test

# Run tests in watch mode (re-run on changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with UI (browser interface)
npm run test:ui
```

## Test Categories

### Unit Tests

**SessionStore.test.ts**
- Singleton pattern behavior
- State updates and change notifications
- DJ role identification
- Session activity detection
- State recovery after disconnection
- Member cleanup and duplicate handling

**SessionManager.test.ts**
- DJ role claiming, releasing, and handoff
- GM override functionality
- DJ request approval/denial workflow
- Session member addition and removal
- User join/leave event processing
- Activity tracking and heartbeat handling

**SocketManager.test.ts**
- Message handler registration and execution
- Socket connection monitoring
- Message validation and filtering
- State synchronization between users
- Fallback communication when disconnected

### Integration Tests

**MultiUserSession.test.ts**
- Multiple users joining sessions simultaneously
- DJ handoff between different users
- Session state recovery scenarios
- Heartbeat system and inactive user cleanup
- Complete socket message flows
- State synchronization edge cases

### End-to-End Tests

**GhostUserScenario.test.ts**
- Complete "ghost user" bug reproduction and fix verification
- User disconnect without proper session leave
- Heartbeat-based cleanup of inactive users
- Session state recovery on reconnection
- Multi-user scenario with cleanup and reconnection
- State consistency across all service interactions

## Testing Approach

### Mocking Strategy

The test suite uses comprehensive mocks for FoundryVTT-specific functionality:

- **Game Context**: User management, socket communication, settings
- **UI Notifications**: Success/error message display
- **YouTube Player API**: Video playback control and state
- **DOM Operations**: Element manipulation and event handling
- **Hooks System**: FoundryVTT's event system

### Test Utilities

**TestUtils** provides helper functions for:
- Resetting all mocks between tests
- Setting up different user contexts (regular user, GM)
- Creating test data (session state, queue items, player state)
- Simulating network conditions
- Waiting for async operations

### Key Test Scenarios

1. **Session Join/Leave Flow**
   - Users joining existing sessions
   - DJ role claiming and management
   - Proper USER_JOIN message broadcasting

2. **Multi-User State Synchronization**
   - State changes propagating to all users
   - Conflict resolution between simultaneous operations
   - Network disconnect/reconnect scenarios

3. **Ghost User Bug (Fixed)**
   - User disconnects without leaving session
   - Heartbeat system removes inactive user from persistent state
   - User reconnects and session state is properly reset
   - User must rejoin session to appear in member list

4. **DJ Management**
   - Role claiming, releasing, and handoff
   - Request approval workflow
   - GM override capabilities

5. **Heartbeat and Cleanup**
   - Inactive user detection and removal
   - Grace period for newly joined users
   - Activity tracking and state updates

## Benefits of This Testing Strategy

### Bug Prevention
- Catches regression bugs before they reach production
- Validates complex multi-user interaction scenarios
- Tests edge cases that are difficult to reproduce manually

### Development Confidence
- Enables safe refactoring of complex systems
- Provides fast feedback during development
- Documents expected behavior through test cases

### Scenario Coverage
- Tests real-world usage patterns
- Validates fixes for previously encountered bugs
- Ensures consistent behavior across different user contexts

### Code Quality
- Enforces good separation of concerns
- Validates service layer architecture
- Tests error handling and edge cases

## Adding New Tests

### For New Features
1. Add unit tests for individual service methods
2. Add integration tests for multi-service interactions
3. Add E2E tests for complete user scenarios

### For Bug Fixes
1. Write a failing test that reproduces the bug
2. Implement the fix
3. Verify the test passes
4. Consider edge cases and additional scenarios

### Test Structure Guidelines
```typescript
describe('FeatureName', () => {
  let service: ServiceClass;
  
  beforeEach(() => {
    TestUtils.resetMocks();
    // Setup test environment
  });

  describe('Specific Functionality', () => {
    it('should handle expected case correctly', async () => {
      // Arrange
      // Act  
      // Assert
    });

    it('should handle edge case properly', async () => {
      // Test edge case
    });
  });
});
```

## Coverage Goals

The test suite aims for:
- **>90% line coverage** for core services
- **100% coverage** for critical paths (DJ role management, session state)
- **Complete scenario coverage** for user-reported bugs
- **Integration test coverage** for all service interactions

## Continuous Integration

Tests are designed to run in CI environments:
- Fast execution (all tests complete in <10 seconds)
- No external dependencies required
- Deterministic results with proper mock isolation
- Clear failure messages for debugging

## Future Enhancements

Planned additions to the test suite:
- Performance tests for large session scenarios
- Browser-based widget testing with Playwright
- Queue management comprehensive testing
- YouTube API integration testing with mock player
- Network latency simulation for real-world conditions