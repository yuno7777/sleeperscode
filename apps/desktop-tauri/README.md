# Sleepers Code Tauri shell experiment

This is a reversible desktop-shell experiment. It does not replace the production Electron app,
start the backend, or expose native commands to web content. It opens an already running local
Sleepers Code web surface inside a Tauri WebView2 window.

Start the normal isolated development server in one terminal and copy its local web origin. In a
second PowerShell terminal:

```powershell
$env:SLEEPERS_CODE_TAURI_URL = "http://localhost:<web-port>"
vp run dev:tauri-experiment
```

Only loopback HTTP or HTTPS origins are accepted. The URL is supplied through an environment
variable so a pairing token is not exposed in the process command line. The shell intentionally has
no Tauri plugins or application commands while capability parity is incomplete.
