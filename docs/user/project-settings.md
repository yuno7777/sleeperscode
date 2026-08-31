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

You can also name the MCP profile and set an advisory number of MCP calls per turn. The context
card reports the servers and tools actually observed in a thread, flags servers outside the shared
profile, and calls out a budget overrun. T3 Code does not claim to block those calls because each
provider CLI owns its own MCP execution policy.

Use **Scope guardrail** to make the project boundary visible before work begins, for example a
directory boundary or a requirement to ask before changing dependencies. Use **Approval baseline**
to choose the shared starting approval mode. These guide each provider in the same place, while the
provider remains responsible for enforcing its own approval controls.

When a guardrail is set, T3 Code adds it to the provider input for every turn without changing the
message shown in the conversation. It asks the provider to request approval before working outside
that boundary. Provider approval prompts remain the final enforcement mechanism.

The project context card also shows active related work. A shared worktree is marked as the
highest merge risk. If two saved handoffs declare the same changed file, T3 Code shows that overlap
as a coordination signal. It does not claim to predict a Git merge conflict.

When a provider compacts its context, the context card reports whether this thread has a checkpoint
captured afterward. A later checkpoint is the evidence for a recoverable repository state. If one
is not recorded yet, let the turn settle before relying on a handoff or continuation.

When you start a new thread, T3 Code shows the project context card with the detected stack,
local rule and documentation paths, recent checkpoints, and other active work in the project.

## Save a handoff

After a task settles, T3 Code saves a local handoff draft with the files from its latest
checkpoint. Add decisions, verification, and remaining work before you save it. Choose
**Review and add to project notes** only when you want that handoff retained as a project note.

To continue work with another provider, select its model in the composer, open the settled task's
handoff, then choose **Continue with selected provider**. T3 Code starts a new thread from the
reviewed summary and leaves the original provider session unchanged.

When a provider explicitly reports that a rate limit is exhausted, the handoff card calls this out.
It does not switch providers automatically. Save the handoff, select an available provider, and
continue from the reviewed summary.
