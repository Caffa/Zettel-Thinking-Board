# Installation & Dependency Management Feature

## Overview

Added a comprehensive installation and dependency management system to help users quickly set up Python, Ollama, and recommended AI models directly from the plugin settings.

## What Was Added

### 1. New Module: `src/engine/installer.ts`

A utility module that provides:

- **Dependency Status Checks**: Functions to verify Python and Ollama installations
- **Service Management**: Ability to start/stop Ollama service
- **Model Management**: Check installed models and download recommended ones
- **Platform-Specific Instructions**: Tailored installation guides for macOS, Windows, and Linux
- **Web Integration**: Open installation pages in system browser

### 2. Enhanced Settings UI: `src/settings.ts`

Added new "Installation & Dependencies" section with:

#### Python Status Panel
- Check if Python is installed
- Display Python version and path
- Platform-specific installation instructions
- Direct link to python.org

#### Ollama Status Panel
- Check if Ollama is installed and running
- Display Ollama version
- Start service button (if installed but not running)
- Platform-specific installation instructions
- Direct link to ollama.ai

#### Recommended Models Section
Three optimized models for different use cases:

**gemma3:4b (3.3 GB)**
- Fast, compact model for text cleaning
- Quick text processing, formatting, and simple tasks
- ~1-2 minute download time

**gemma3:27b (17 GB)**
- Large, high-quality model for conversation
- Complex conversations and detailed responses
- ~5-10 minute download time

**deepseek-r1:32b (19 GB)**
- Advanced reasoning model for logical breakdown
- Complex analysis, logical reasoning, and structured thinking
- ~5-10 minute download time

Each model has:
- Status indicator (installed/not installed)
- Check button to verify installation
- Download button for one-click installation
- Real-time progress feedback

### 3. Styling: `styles.css`

Added CSS for:
- Installation status indicators
- Model download cards
- Status colors (success, error, warning, muted)
- Responsive button layouts
- Progress indicators

### 4. Documentation Updates

#### README.md
- New "Installation & Setup" section
- One-click dependency check instructions
- Recommended models guide with use cases
- Manual installation fallback instructions
- Updated Quick Start guide

#### PRD.md
- Section 6: Installation & Dependencies
- Detailed feature specifications
- Model recommendations with rationale
- Desktop-only feature notes

## Technical Implementation

### Desktop-Only Features

All installation features use Node.js `child_process` module, which is only available in Obsidian desktop app:

```typescript
// Dynamic require to avoid bundling issues
const {execSync} = require("child_process") as typeof import("child_process");
```

Graceful degradation for mobile:
```typescript
if (typeof require === "undefined" || !Platform.isDesktopApp) {
    return {installed: false};
}
```

### API Integration

Uses Ollama's HTTP API for:
- Checking service status: `GET http://localhost:11434/api/tags`
- Downloading models: `ollama pull <model-name>` via child_process

### Error Handling

- Timeouts for all network requests (3-5 seconds)
- Try-catch blocks for system command execution
- User-friendly error messages via Obsidian Notice API
- Console logging for debugging

## User Experience Flow

### First Time Setup

1. User opens plugin settings
2. Installation section auto-checks Python and Ollama status
3. Status indicators show installation state with color coding:
   - ✓ Green: Installed and working
   - ⚠ Yellow: Installed but needs attention (e.g., service not running)
   - ✗ Red: Not installed
4. User clicks "Install instructions" if needed
5. Browser opens to installation page
6. After installing dependencies, user clicks "Check status" to verify
7. User downloads recommended models with one click
8. Progress feedback shows download status
9. Models are ready to use in canvas workflows

### Model Download Flow

1. User clicks "Download" next to a recommended model
2. Plugin checks if Ollama is running
3. Starts download via `ollama pull`
4. Shows progress in status indicator
5. Displays success message when complete
6. Model automatically appears in model selection dropdowns

## Benefits

- **Reduced Friction**: No more manual CLI commands
- **Guided Setup**: Clear instructions for each platform
- **Status Visibility**: Always know what's installed and working
- **One-Click Downloads**: No need to leave Obsidian
- **Best Practices**: Recommends optimized models for common use cases
- **Error Prevention**: Checks dependencies before allowing operations

## Platform Support

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Python Check | ✓ | ✓ | ✓ |
| Ollama Check | ✓ | ✓ | ✓ |
| Start Service | ✓ | ✓ | ✓ |
| Model Download | ✓ | ✓ | ✓ |
| Installation Links | ✓ | ✓ | ✓ |

## Future Enhancements

Potential improvements:
- Progress bar for model downloads
- Model size verification before download
- Automatic retry on failed downloads
- Model usage statistics
- Custom model recommendations based on usage
- Batch model downloads
- Model update notifications
