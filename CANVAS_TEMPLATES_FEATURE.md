# Canvas Templates Feature

## Overview
This document describes the Canvas Templates feature added to Zettel Thinking Board.

## Feature Description
Canvas Templates allows users to create reusable canvas workflows and quickly instantiate them for different projects. Users can:
- Save any canvas as a template
- Duplicate templates to create new canvases
- Edit existing templates
- See a visual indicator when viewing a template canvas

## Implementation Details

### Files Added
1. **`src/canvas/canvasTemplates.ts`** - Utility functions for template operations
   - `listCanvasTemplates()` - Lists all canvas files in the template folder
   - `duplicateCanvasTemplate()` - Creates a copy of a template in the output folder
   - `saveCanvasAsTemplate()` - Saves current canvas as a template
   - `isCanvasInTemplateFolder()` - Checks if a canvas is in the template folder

2. **`src/views/CanvasTemplateModal.ts`** - Modal UI for template selection
   - Displays all available templates from the configured folder
   - Shows template name and path
   - Handles template selection and modal closing
   - Reusable for both "Duplicate" and "Edit" workflows

### Files Modified

1. **`src/settings.ts`**
   - Added `canvasTemplateFolder` setting (string)
   - Added `canvasOutputFolder` setting (string)
   - Added UI section "Canvas Templates" in settings tab with:
     - Input field for template folder path
     - Input field for output folder path
     - Descriptive help text

2. **`src/main.ts`**
   - Added imports for template utilities
   - Added command "Duplicate canvas template" (ID: `duplicate-canvas-template`)
   - Added command "Save canvas as template" (ID: `save-canvas-as-template`) - only available when canvas is active
   - Added command "Edit canvas template" (ID: `edit-canvas-template`)
   - Added method `duplicateCanvasTemplate()` - creates new canvas from template
   - Added method `saveCanvasAsTemplate()` - saves current canvas to template folder
   - Added method `editCanvasTemplate()` - opens template for editing
   - Added method `syncTemplateBanner()` - shows/hides template indicator
   - Added method `clearTemplateBanner()` - removes template indicator
   - Integrated template banner into canvas label sync cycle

3. **`styles.css`**
   - Added styles for `.ztb-template-modal` and related classes
   - Styled template list items with hover effects
   - Styled modal buttons
   - Added styles for `.ztb-template-banner` - visual indicator for template canvases
   - Banner positioned in top-right corner with accent color

4. **`PRD.md`**
   - Added Section 5: Canvas Templates
   - Documented template management, creation workflow, and use cases

5. **`README.md`**
   - Added "Canvas Templates" section with setup instructions and use cases
   - Positioned before "Tutorial Canvas" section

## User Workflows

### 1. Setup (one-time)
- User opens Settings → Zettel Thinking Board → Canvas Templates
- Sets template folder path (e.g., `Templates/Canvases`)
- Sets output folder path (e.g., `Canvases`)

### 2. Creating Templates

**Option A: Save existing canvas as template**
- User creates/opens a canvas workflow
- Runs command "Save canvas as template"
- Canvas is copied to template folder
- Notification confirms template was saved

**Option B: Create directly in template folder**
- User creates canvas workflows directly in the template folder
- Template banner appears automatically

### 3. Using Templates

**Duplicate to create new canvas**
- User runs command "Duplicate canvas template"
- Modal opens showing all available templates
- User clicks on a template to select it
- Plugin creates a copy in the output folder with unique name
- New canvas opens automatically

**Edit existing template**
- User runs command "Edit canvas template"
- Modal opens showing all available templates
- User clicks on a template to open it
- Template banner appears to indicate editing a template
- User makes changes and saves (normal Obsidian save)

## Technical Details

### Template Discovery
- Recursively searches the template folder for `.canvas` files
- Includes files in subfolders
- Returns array of `TFile` objects

### Duplication Logic
- Reads template canvas data using `loadCanvasData()`
- Creates deep copy of nodes and edges
- Generates unique filename using base name + counter (e.g., "Research Template", "Research Template 1", etc.)
- Creates output folder if it doesn't exist
- Writes new canvas file using `saveCanvasData()`
- Returns path of new canvas or null on failure

### Auto-naming
- Uses template filename as base name
- Appends numeric suffix if file already exists
- Safety limit of 1000 iterations to prevent infinite loops

### Template Detection
- Checks if canvas path starts with template folder path
- Banner syncs automatically when switching between canvases
- Banner updates in real-time as part of the label sync cycle (every 2 seconds)

## Future Enhancements
Potential improvements for future versions:
- Template metadata (description, tags, preview image)
- Template variables (prompt placeholders to fill in on duplication)
- Template categories/folders in modal
- Recent templates list
- Template search/filter in modal
- Batch template operations
- Import/export template collections
