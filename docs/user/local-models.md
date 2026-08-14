# Local coding models

Sleepers Code can use models running on the environment host as coding workers. Ollama, LM Studio,
and one optional OpenAI-compatible localhost endpoint are supported. OpenCode supplies the coding
agent around each model, so a selected local model can inspect files, run commands, and apply edits
through the same thread workflow as other OpenCode models.

## Before you start

Install OpenCode on the environment host, then start at least one local model server:

- Ollama at `http://localhost:11434`
- LM Studio at `http://localhost:1234/v1`
- Another OpenAI-compatible server at a localhost URL you provide

The model must already be downloaded and visible from that server's model-list endpoint. Sleepers
Code does not download model weights or start the model server.

## Configure the host

Open **Settings → Providers**, add or edit an OpenCode provider, and leave **Discover local models**
enabled. To use another OpenAI-compatible server, enter its versioned base URL under **Local model
endpoint**, for example `http://127.0.0.1:8080/v1`.

Only `localhost`, `127.0.0.1`, and `::1` addresses are accepted. This keeps a model probe from
becoming an arbitrary network request from the environment host. The generated OpenCode provider
configuration is passed only to the managed child process; Sleepers Code does not rewrite global or
project OpenCode configuration files.

When models are detected, they appear in the normal model picker under the OpenCode provider. The
server's provider inventory is shared by web, desktop, and mobile, so a remote client can select a
model running on the connected host. Restart or reconnect the OpenCode provider after downloading or
removing model weights so its inventory is rebuilt.

## Boundaries

- Local discovery is skipped for an external OpenCode **Server URL**, because Sleepers Code cannot
  inject host-local configuration into a server it did not start.
- Automatic routing does not assign tasks to local models yet. The user selects the model.
- Discovery does not infer context limits, tool reliability, RAM or VRAM requirements, or suitability
  for architecture and security work.
- Local execution has no per-token API charge, but electricity and hardware costs are outside the
  Usage dashboard.
- If an existing inline OpenCode configuration is invalid, Sleepers Code preserves it and does not
  replace it with generated content.
