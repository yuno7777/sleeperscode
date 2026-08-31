# Customize a project icon

T3 Code selects a project icon automatically. It checks `t3.json`, common favicon and app icon
paths, and icon links in project HTML files.

To choose a different icon:

1. Open **Settings** and select **Projects**.
2. Select the project.
3. Under **Appearance**, select **Choose a project file**.
4. Search for an image file and select it.

T3 Code supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. The selected path applies to
each checkout in the project group and appears on your connected clients.

To use automatic detection again, select **Automatic**.

## Share setup between agents

Under **Settings** → **Projects** → **Shared agent setup**, you can save rule paths, MCP server
names, and a recommended runtime mode for a project. These are shared suggestions for every
provider, not provider credentials or command-line settings.

When you start a new thread, T3 Code shows the project context card with the detected stack,
local rule and documentation paths, recent checkpoints, and other active work in the project.

## Save a handoff

After a task settles, T3 Code saves a local handoff draft with the files from its latest
checkpoint. Add decisions, verification, and remaining work before you save it. Choose
**Review and add to project notes** only when you want that handoff retained as a project note.
