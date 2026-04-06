# Image Studio

Generate AI images from text prompts using DALL·E 3 or Google Imagen 4. All generations are saved locally and browsable in the history strip.

## Layout

The page splits into two areas:

- **Left panel** — prompt input, model picker, and generation options
- **Main canvas** — current image preview + history strip at the bottom

## Models

| Model | Provider | Notes |
|-------|----------|-------|
| DALL·E 3 | OpenAI | Supports quality and style options |
| Imagen 4 | Google | Faster, no quality/style controls |

## Options

### Size
All models support three aspect ratios:
- **Square** — 1024×1024
- **Landscape** — 1792×1024
- **Portrait** — 1024×1792

### Quality (DALL·E 3 only)
- **Standard** — faster, lower cost
- **HD** — sharper detail, higher cost

### Style (DALL·E 3 only)
- **Vivid** — bold, hyper-real aesthetic
- **Natural** — softer, more photographic

## Generating

1. Type a description in the **Prompt** field
2. Choose your model and options
3. Click **Generate Image** — or press `⌘↵` / `Ctrl↵`

Generation takes a few seconds. The spinner appears in the canvas area while it runs.

## History

Every successful generation is stored locally and shown as thumbnails at the bottom of the screen. Click any thumbnail to view it full-size. Hover a thumbnail to reveal a delete button (trash icon) — you'll be asked to confirm before it's removed.

## Downloading

Click the **Download** button below the active image to save it as a `.png` named after the prompt.

## Tips

- Be specific in your prompts — more detail = better results
- Use **Vivid** + **HD** for photorealistic renders; **Natural** + **Standard** for quick concept sketches
- The history persists across sessions — your generations are saved on disk
