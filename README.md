# Bardic Inspiration

A Foundry VTT module.

## Development Setup

### Prerequisites

- Docker Desktop
- FoundryVTT account with valid license

### Development Environment

This module uses **Vite** for modern bundling, **TypeScript** for type safety, and **Hot Module Replacement** for fast development.

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Set up Environment:**
   ```bash
   cp .env.example .env
   # Fill in your FoundryVTT credentials
   ```

3. **Start Development:**
   ```bash
   npm run dev:vite        # Start FoundryVTT + Vite dev server with HMR
   ```

4. **Access Development Environment:**
   - **FoundryVTT:** `http://localhost:30000` (main application)
   - **Vite Dev Server:** `http://localhost:30001` (with HMR proxy)

### Development Workflow

#### Modern Development (Recommended)
```bash
npm run dev:vite         # Start FoundryVTT + Vite with HMR
```
- **Hot Module Replacement:** Changes appear instantly without page refresh
- **TypeScript compilation:** Real-time type checking and compilation
- **CSS processing:** Modern CSS with auto-prefixing
- **Source maps:** Debug with original source files

#### Traditional Development
```bash
npm run dev              # Start FoundryVTT container only
npm run build            # Build for testing
```

#### File Structure
```
src/
├── main.ts              # Main module entry (TypeScript)
├── lib/                 # Utility libraries
│   └── lib-wrapper-utils.ts
└── styles/
    └── main.css         # Processed by Vite

dist/                    # Built files (generated)
├── main.js              # Compiled bundle
└── main.css             # Processed styles
```

#### Making Changes
1. **TypeScript/JavaScript:** Edit files in `src/` - changes apply instantly with HMR
2. **CSS:** Edit `src/styles/main.css` - styles update live
3. **Module Config:** Edit `module.json` - restart container to see changes

#### Commands
```bash
npm run dev:vite         # Development with HMR
npm run vite:build       # Build for production
npm run validate         # Validate module structure
npm run build            # Validate + build + create zip
```

### TypeScript Support

- **FoundryVTT Types:** Full type definitions for FoundryVTT API
- **Modern JavaScript:** ES2022 with full module support
- **Type Safety:** Catch errors at compile-time
- **IntelliSense:** Rich IDE support with autocompletion

### Development Features

- **🔥 Hot Module Replacement:** Instant updates without page refresh
- **📝 TypeScript:** Full type safety and modern JavaScript features  
- **🎨 Modern CSS:** CSS processing with Vite
- **🔍 Source Maps:** Debug with original source files
- **⚡ Fast Builds:** Optimized bundling with Vite
- **🛠️ libWrapper Integration:** Type-safe monkey-patching utilities
- **🧪 Developer Mode Support:** Enhanced debugging capabilities

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

## Release and Deployment

### Enhanced Release Workflow

This module uses an automated release system with comprehensive validation:

#### Pre-Release Validation
Before creating a release, validate your module locally:
```bash
npm run validate         # Validate module structure and manifest
npm run build           # Validate and create module.zip
```

#### Creating a Release
1. **Prepare Your Module**
   - Ensure all changes are committed
   - Update version in `module.json`
   - Run `npm run validate` to check for issues

2. **Create GitHub Release**
   - Go to your GitHub repository
   - Click "Releases" → "Create a new release"
   - Tag version should match `module.json` version (e.g., `0.1.0`)
   - Add release title and description
   - Publish the release

3. **Automatic Processing**
   The GitHub Action will automatically:
   - ✅ Validate module manifest and file structure
   - ✅ Check version consistency between release tag and manifest
   - ✅ Generate enhanced changelog from git commits
   - ✅ Update manifest URLs for release
   - ✅ Create properly structured module.zip
   - ✅ Attach assets and update release notes

#### Release Features
- **Comprehensive Validation**: Checks manifest syntax, required fields, file existence
- **Automatic Changelog**: Generated from git commits since last release
- **Version Consistency**: Ensures release tag matches manifest version
- **Enhanced Release Notes**: Includes installation instructions and compatibility info
- **Proper Asset URLs**: Automatically updates manifest and download URLs

#### Installation for Users
Users can install your module using:
```
https://github.com/yourusername/BardicInspiration/releases/latest/download/module.json
```

## License

MIT