# Bardic Inspiration

A Foundry VTT module.

## Development Setup

### Prerequisites

- Docker Desktop
- FoundryVTT account with valid license

### Development Environment

1. Copy `.env.example` to `.env` and fill in your FoundryVTT credentials:
   ```bash
   cp .env.example .env
   ```

2. Start the development environment:
   ```bash
   npm run dev
   ```

3. Access FoundryVTT at `http://localhost:30000`

4. Install the module through FoundryVTT's interface:
   - Go to "Add-on Modules" → "Install Module"
   - Use the manifest URL or browse for local modules

### Development Workflow

#### Starting Development
```bash
npm run dev              # Start FoundryVTT container
```

#### Making Changes
1. Edit your module files (scripts, styles, etc.)
2. Reinstall/update the module through FoundryVTT's interface
3. Refresh browser (F5) to see changes

#### Other Commands
```bash
npm run dev:stop         # Stop the development environment
npm run dev:logs         # View container logs
npm run dev:restart      # Restart the container
```

### Development Notes

- **Module Installation:** Install the module through FoundryVTT's built-in module manager
- **File Changes:** After editing files, reinstall or update the module via the FoundryVTT interface
- **Clean Environment:** Container data doesn't persist between restarts - install modules fresh each time
- **Port Access:** FoundryVTT runs on `http://localhost:30000`

### Recommended Development Modules

Install these modules in your development environment:
- **Developer Mode** - Enables debug flags and console logging
- **libWrapper** - Safe monkey-patching for core function modifications
- **Find the Culprit!** - Debugging tool to identify problematic modules

### Project Structure

```
├── .github/workflows/    # GitHub Actions for automated releases
├── scripts/             # JavaScript module files
├── styles/              # CSS stylesheets
├── languages/           # Localization files
├── templates/           # Handlebars templates
├── docker-compose.yml   # Docker development environment
├── module.json          # Module manifest
└── README.md
```

## Deployment

Releases are automatically created via GitHub Actions when you publish a release on GitHub.

## License

MIT