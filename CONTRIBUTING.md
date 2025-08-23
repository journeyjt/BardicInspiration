# Contributing to Bardic Inspiration

Thank you for your interest in contributing to Bardic Inspiration! This document provides guidelines and instructions for contributing to this FoundryVTT module.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When you create a bug report, please include as many details as possible using our [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).

### Suggesting Features

Feature suggestions are welcome! Please use our [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) to ensure you provide all necessary information.

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Make your changes
4. Test your changes thoroughly
5. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
6. Push to the branch (`git push origin feature/AmazingFeature`)
7. Open a Pull Request

## Development Setup

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- FoundryVTT (v12 or higher)

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/BardicInspiration.git
   cd BardicInspiration
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development server:
   ```bash
   npm run dev:serve
   ```

4. The module will be available at `http://localhost:5000/modules/bardic-inspiration/`

### Building

```bash
npm run build  # Creates production build and module.zip
```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Follow existing code style and patterns
- Ensure no TypeScript errors before submitting

### CSS

- Use CSS custom properties for theming
- Follow the existing design system (see `src/styles/main.css`)

### Git Commit Messages

- Use clear and meaningful commit messages
- Start with a verb in present tense ("Add", "Fix", "Update", etc.)
- Keep the first line under 50 characters
- Add detailed description if needed after a blank line

Example:
```
Add queue reordering functionality

- Implement up/down buttons for queue items
- Maintain current playing index during reorder
- Add visual feedback for reorder actions
```

## Testing

### Manual Testing Checklist

Before submitting a PR, please test:

- [ ] DJ role assignment and handoff works correctly
- [ ] Queue operations (add, remove, reorder) function properly
- [ ] Playback synchronization works across multiple users
- [ ] No console errors during normal operation
- [ ] UI displays correctly in different window sizes
- [ ] Module works with latest FoundryVTT version

### Automated Testing

Currently, this project doesn't have automated tests. Contributions to add testing infrastructure are welcome!

## Documentation

- Update README.md if you change functionality
- Update CLAUDE.md if you change architecture
- Add JSDoc comments to new functions and classes
- Update module.json version following semantic versioning

## Questions?

Feel free to open an issue for any questions about contributing or join the discussion in our [GitHub Discussions](https://github.com/yourusername/BardicInspiration/discussions).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.