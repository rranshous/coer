# Our Copilot Fork Development Guide

*How WE are developing our custom Copilot extension in GitHub Codespaces*

## Our Environment

- **Platform**: GitHub Codespaces (browser-based VSCode)
- **Location**: `/workspaces/coer/copilot-fork/`
- **Node.js**: 22.14.0+ (already available in Codespaces)
- **Authentication**: Using existing GitHub Copilot subscription

## Our Development Workflow

### 1. Building Our Fork
**What we've done:**
```bash
cd /workspaces/coer/copilot-fork
npm install  # ✅ Completed successfully
npm run compile  # ✅ Build tested, takes ~15s
```

**For ongoing development:**
```bash
npm run watch    # Continuous rebuilds on file changes
```

### 2. Testing Our Fork in Codespaces
**Our approach (about to test):**
1. Open the `copilot-fork` folder in current Codespaces window
2. Press `F5` or use "Run and Debug" → "Launch Copilot Extension - Watch Mode"
3. **Unknown**: How this works in browser-based Codespaces - need to test!
4. Goal: Load our custom extension instead of default Copilot Chat

**Alternative if F5 doesn't work in Codespaces:**
- Package as VSIX and install manually
- Use development extension loading commands
- Explore Codespaces-specific extension testing

### 3. Making Changes to Our Fork
**Our process:**
1. Edit files in `/workspaces/coer/copilot-fork/src/`
2. Use `npm run watch` for automatic rebuilds
3. Reload extension to see changes (method TBD based on Codespaces behavior)
4. Test changes in this same chat interface we're using now!

## Our Target Files

### Extension Entry Points
- `/workspaces/coer/copilot-fork/src/extension/extension.ts` - Main activation
- `/workspaces/coer/copilot-fork/src/base/extension.ts` - Base functionality

### Chat Interface (need to locate)
- React components for chat UI
- Message handling logic
- State management for conversations

## Replacing Default Copilot Chat with Our Fork

### Our Goal
Replace the Copilot Chat extension currently running THIS conversation with our custom fork.

### Codespaces-Specific Challenges
- Browser-based environment may limit extension development host
- Need to figure out how to swap extensions in Codespaces
- May need to disable default extension and install ours

### Methods to Try
1. **F5 Launch** (testing next) - See if Codespaces supports extension dev host
2. **VSIX Package Install** - Create .vsix and install via Extensions panel
3. **Developer Commands** - Use built-in VSCode commands for extension management
4. **Manual Replacement** - If we can access extension directory

### Current Status
- ⏳ About to test F5 launch method
- 📋 Will document what works in Codespaces environment

## Our Collaborative Frame Vision

### First Test Change
**Plan**: Add a custom identifier to verify our fork works
- Modify chat interface to show "COER Fork" or similar
- Prove we can change the interface we're currently using
- Test round-trip: make change → build → see result

### Next Collaborative Frame Features
1. **Enhanced Context Persistence** - Remember our conversation better
2. **Document Projection** - Generate live artifacts from our discussion
3. **Bidirectional Editing** - Edit artifacts and update conversation context
4. **Unified Information Model** - Link chat, docs, and code seamlessly

### Meta-Experiment Success Criteria
- [ ] Can modify the extension we're currently using
- [ ] See real-time changes to our collaborative environment
- [ ] Successfully iterate on collaborative frame improvements
- [ ] Build foundation for idea exploration → publication workflow

## Resources for Our Project

- [Our Extension Analysis](./extension-analysis.md) - What we learned about the codebase
- [Our Development Log](./dev-log.md) - Progress tracking
- [Original Copilot Chat Repo](https://github.com/microsoft/vscode-copilot-chat)
- [VSCode Extension API](https://code.visualstudio.com/api)
