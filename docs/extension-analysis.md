# VSCode Copilot Chat Extension Analysis

*Understanding the structure and build process of the Microsoft VSCode Copilot Chat extension*

## Build System Overview

### Key Build Scripts (package.json)
- `npm run compile` - Development build using esbuild
- `npm run build` - Production build (minified)
- `npm run watch` - Watch mode for development (runs multiple watchers in parallel)
- `npm run package` - Create .vsix package using vsce

### Development Workflow
1. **Initial Setup**: `npm install` (already completed)
2. **Development**: Use F5 in VSCode or "Launch Copilot Extension - Watch Mode" configuration
3. **Watch Mode**: Automatically rebuilds on file changes
4. **Testing**: New VSCode window opens with extension loaded for testing

### Build Configuration
- Uses **esbuild** for bundling (configured in `.esbuild.ts`)
- TypeScript compilation with `tsc` for type checking
- Multiple watch tasks run in parallel:
  - `watch:esbuild` - Main bundling
  - `watch:tsc-extension` - Type checking for main extension
  - `watch:tsc-extension-web` - Type checking for web version
  - `watch:tsc-simulation-workbench` - Type checking for simulation tests

### Launch Configurations (.vscode/launch.json)
- **"Launch Copilot Extension"** - Basic launch for testing
- **"Launch Copilot Extension - Watch Mode"** - Includes pre-launch watch task
- Both create new VSCode window with extension loaded from development path

## Project Structure

### Main Entry Points
- `src/extension/extension.ts` - Main extension activation
- `src/base/extension.ts` - Base extension functionality
- Package compiles to `./dist/**/*.js`

### Key Features
- Uses `extensionHost` debugging
- Source maps enabled for development
- Environment variables loaded from `.env` file
- Telemetry logging available in dev mode

## Development Process for Our Fork

### Quick Start
1. Open copilot-fork folder in VSCode
2. Press F5 or use "Launch Copilot Extension - Watch Mode"
3. New VSCode window opens with our custom extension
4. Make changes, they rebuild automatically
5. Reload extension window to see changes

### Installing Our Fork as Default
- Need to disable default Copilot Chat extension
- Install our version as VSIX package
- Or use development path configuration

## Next Steps
- [ ] Test the launch configuration
- [ ] Make a simple modification to verify our build process
- [ ] Figure out how to replace the default extension
