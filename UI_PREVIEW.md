# Installation UI Preview

## Settings Layout

When users open **Settings → Zettel Thinking Board**, they'll see:

```
┌─────────────────────────────────────────────────────────────────┐
│ Zettel Thinking Board Settings                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Right-click a node on the canvas and choose Run node or Run     │
│ chain.                                                           │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Installation & Dependencies                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Ensure Python and Ollama are installed before using the plugin. │
│ Download recommended models for optimal performance.             │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✓ Python installed: Python 3.11.5                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Python                                                           │
│ Required for Python nodes. Recommended: Python 3.8 or higher.   │
│ [Check status] [Install instructions]                           │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✓ Ollama installed and running: v0.1.23                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Ollama                                                           │
│ Required for AI model nodes. Provides local LLM inference.      │
│ [Check status] [Start service] [Install instructions]           │
│                                                                  │
│ ───────────────────────────────────────────────────────────────  │
│ Recommended Models                                               │
│ ───────────────────────────────────────────────────────────────  │
│                                                                  │
│ Download these models for optimal performance. Each model is    │
│ optimized for different tasks.                                   │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✓ Installed                                                 │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ gemma3:4b                                                        │
│ Fast, compact model for text cleaning (3.3 GB)                  │
│ 💡 Quick text processing, formatting, and simple tasks          │
│ [Check] [Download]                                               │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Not installed                                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ gemma3:27b                                                       │
│ Large, high-quality model for conversation (17 GB)              │
│ 💡 Best for complex conversations and detailed responses        │
│ [Check] [Download]                                               │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Not installed                                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ deepseek-r1:32b                                                  │
│ Advanced reasoning model for logical breakdown (19 GB)          │
│ 💡 Complex analysis, logical reasoning, and structured thinking │
│ [Check] [Download]                                               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Execution                                                        │
├─────────────────────────────────────────────────────────────────┤
│ Loading Ollama models…                                          │
│ ...                                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Color Coding

Status indicators use Obsidian's CSS variables for consistent theming:

- **✓ Green** (`--text-success`): Installed and working
- **⚠ Yellow** (`--text-warning`): Installed but needs attention
- **✗ Red** (`--text-error`): Not installed or error
- **Gray** (`--text-muted`): Neutral status

## Interaction Flow

### 1. First Visit (Nothing Installed)

```
Python
┌───────────────────────────────────┐
│ ✗ Python not found               │
└───────────────────────────────────┘
[Check status] [Install instructions]
```

User clicks **Install instructions**:
- Notice appears with platform-specific instructions
- Browser opens to python.org/downloads/

### 2. After Installing Python

User clicks **Check status**:
```
Python
┌───────────────────────────────────┐
│ ✓ Python installed: Python 3.11.5│
└───────────────────────────────────┘
[Check status] [Install instructions]
```

### 3. Ollama Installed but Not Running

```
Ollama
┌───────────────────────────────────┐
│ ⚠ Ollama installed but not       │
│   running. Click 'Start service' │
│   to start it.                    │
└───────────────────────────────────┘
[Check status] [Start service] [Install instructions]
```

User clicks **Start service**:
- Notice: "Starting Ollama service..."
- After 3 seconds: "Ollama service started successfully"
- Status updates to green

### 4. Downloading a Model

Initial state:
```
gemma3:4b
┌───────────────────────────────────┐
│ Not installed                     │
└───────────────────────────────────┘
[Check] [Download]
```

User clicks **Download**:
```
gemma3:4b
┌───────────────────────────────────┐
│ Downloading... pulling manifest...│
└───────────────────────────────────┘
[Check] [Downloading...]  (disabled)
```

After completion:
```
gemma3:4b
┌───────────────────────────────────┐
│ ✓ Downloaded successfully         │
└───────────────────────────────────┘
[Check] [Download]
```

Notice: "✓ gemma3:4b downloaded successfully"

## Mobile / Web Version

On mobile or when `require` is unavailable:

```
Installation & Dependencies

This feature requires Obsidian desktop app.
Please install dependencies manually:

Python: python.org/downloads/
Ollama: ollama.ai/download

Then configure paths in the settings below.
```

## Integration with Existing UI

The Installation section appears **before** the Execution section, making it the first thing users see. This ensures they set up dependencies before trying to configure models.

Order:
1. ⚙️ Installation & Dependencies (NEW)
2. ▶️ Execution (Models, Python path)
3. 📋 Canvas Templates
4. 🎨 Display (Colors, Labels)

## Accessibility

- All status indicators use both color and text (✓, ⚠, ✗)
- Buttons have clear labels
- Status messages are readable by screen readers
- Keyboard navigation supported through standard Obsidian controls
