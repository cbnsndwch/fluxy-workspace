# Documentation Center

The Documentation Center is where you write and organize docs for the workspace and its apps. All docs are stored as Markdown files in `workspace/docs/`.

## Features

- **Tree navigation** — collapsible folder tree in the left sidebar
- **Rendered Markdown** — GitHub-flavored Markdown with syntax highlighting
- **Inline editor** — click the pencil icon to edit any page in-place
- **File management** — create new files and folders, rename, delete

## File storage

Docs live in: `workspace/docs/`

The folder structure maps directly to the navigation tree. Files named `index.md` become the root page of a folder.

## MDX support

Files ending in `.mdx` are valid — standard Markdown content works fully. JSX components in MDX are not evaluated client-side (yet).

## Tips

- Ask sebastian to write or update docs for you
- Use `## Headings` to generate an automatic table of contents
- Link between docs with relative paths: `[CRM](./crm.md)`
