# VSCode Copilot Extension Notes

*Last updated: July 3, 2025*

## Repository Structure

Based on our exploration of the forked `vscode-copilot-chat` repository:

```
copilot-fork/
├── package.json                 # Extension manifest and dependencies
├── src/
│   ├── extension.ts            # Main extension entry point
│   ├── base/
│   │   └── extension.ts        # Base extension functionality
│   └── [other source files]
├── .vscode/
│   ├── launch.json            # Debug configurations
│   └── tasks.json             # Build tasks
└── [other config files]
```

## Package.json Analysis

### Key Extension Properties
- **Name**: `copilot-chat`
- **Display Name**: GitHub Copilot Chat
- **Main Entry**: `./out/extension.js` (compiled TypeScript)
- **Activation Events**: TBD (need to check)
- **Contributes**: TBD (commands, views, etc.)

### Dependencies
- TBD (need to analyze dependencies)

## Development Workflow

### Building the Extension
- TBD (need to explore build scripts)

### Running/Testing During Development
- TBD (need to check launch configurations)

### Installing Custom Extension
- TBD (need to figure out how to replace default Copilot Chat)

## Key Files to Understand

### `/src/extension.ts`
- Main extension activation point
- Exports `activate()` and `deactivate()` functions
- TBD (need to read the actual implementation)

### `/src/base/extension.ts`
- Base extension functionality
- TBD (need to analyze)

## Questions to Investigate

1. How is the extension built? (TypeScript compilation, bundling, etc.)
2. How do we run it in development mode?
3. How do we replace the default Copilot Chat extension with our fork?
4. What are the main extension points and APIs being used?
5. Where is the chat UI implemented?
6. How does the extension communicate with Copilot services?

## Next Steps

1. Analyze package.json scripts and build system
2. Examine the main extension files
3. Figure out development workflow
4. Test building and running the extension
5. Document how to swap it with the default extension
