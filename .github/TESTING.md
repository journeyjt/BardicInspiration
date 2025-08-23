# Testing Requirements

This project maintains **100% test pass rate** as a mandatory requirement for all contributions.

## 🎯 Current Status

- **Total Tests**: 146
- **Pass Rate**: 100% (146/146)
- **Coverage**: Comprehensive across all components

## 🧪 Test Categories

### Unit Tests
- **PlayerManager**: YouTube player operations and synchronization
- **QueueManager**: Queue operations and persistence  
- **SessionManager**: DJ roles, member management, session lifecycle
- **SessionStore**: Centralized state management
- **SocketManager**: Message handling and broadcasting

### Integration Tests
- **WidgetIntegration**: Widget functionality and player command integration
- **MultiUserSession**: Multi-user session scenarios

### End-to-End Tests
- **CoreUserFlows**: Complete user workflows and session lifecycle
- **GhostUserScenario**: Edge cases and cleanup scenarios

### Performance Tests
- **PerformanceAndEdgeCases**: High-frequency operations, timeouts, and edge cases

## ⚡ Running Tests

```bash
# Run all tests (required before any commit)
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode for development
npm run test:watch

# Run tests with UI (interactive)
npm run test:ui

# Pre-commit check (tests + validation)
npm run precommit
```

## 🚫 Mandatory Requirements

### For All Pull Requests:
1. **All 146 tests MUST pass** - No exceptions
2. Module validation MUST succeed
3. TypeScript compilation MUST succeed
4. Build process MUST complete without errors

### For Builds:
- Production builds automatically run full test suite
- CI builds include coverage reporting
- Failed tests block all deployments

## 🔧 Test Architecture

### Key Testing Patterns:
- **Hook-based Communication**: Tests validate service communication via FoundryVTT hooks
- **State Management**: Tests verify SessionStore state updates and persistence  
- **Mock Integration**: Comprehensive mocking of FoundryVTT APIs and browser APIs
- **Async Operations**: Proper handling of async service operations
- **Widget Simulation**: Tests simulate widget-service communication patterns

### Critical Test Scenarios:
- Multi-user session synchronization
- DJ role transitions and permissions
- Queue management across users
- Player controls and heartbeat sync
- Error handling and recovery
- Performance under load

## 🛠️ Adding New Tests

When adding new functionality:

1. **Write tests first** (TDD approach recommended)
2. Ensure **100% pass rate maintained**
3. Follow existing test patterns and architecture
4. Include both positive and negative test cases
5. Test edge cases and error conditions

### Test File Structure:
```
tests/
├── unit/           # Service-level unit tests
├── integration/    # Component interaction tests  
├── e2e/           # Complete user workflow tests
├── performance/   # Load and edge case tests
└── setup/         # Test configuration and mocks
```

## 🚀 CI/CD Integration

### GitHub Actions Workflows:
- **Pull Request Checks**: Tests run on every PR
- **Status Checks**: Required checks for branch protection
- **Test Matrix**: Multi-environment testing (Node 18/20/22)
- **Release Pipeline**: Tests required for all releases

### Branch Protection:
- Main branch requires passing tests
- No direct pushes allowed without PR review
- Status checks must pass before merge

## 📊 Test Quality Metrics

- **Reliability**: Tests must be deterministic and stable
- **Coverage**: All critical paths must be tested
- **Performance**: Test suite completes in under 10 seconds
- **Maintainability**: Tests use clear patterns and abstractions

## 🐛 Troubleshooting

### Common Issues:
1. **Video ID Validation**: Use 11-character YouTube video IDs in tests
2. **Hook Call Filtering**: Filter hook calls when testing service communication  
3. **Async Timing**: Use proper async/await patterns for service operations
4. **State Setup**: Ensure proper user and permission setup in tests

### Getting Help:
- Check existing test patterns in similar test files
- Review test setup utilities in `tests/setup/test-setup.ts`
- Consult CLAUDE.md for architectural guidance

---

**Remember: Every line of code should be backed by tests. Every test should pass. No exceptions.** ✨