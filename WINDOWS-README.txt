Black Border Remover — Windows Quick Start (no GraphicsMagick needed)

Prerequisite (install before running)
- Ghostscript (64-bit). Download from https://ghostscript.com/releases/gsdnld.html and install.
- Verify from Command Prompt: gswin64c -version
- If the command is not found, add the Ghostscript bin folder to PATH and restart the terminal:
  - C:\\Program Files\\gs\\<version>\\bin

Running the app
- Installer: Run the setup .exe, then launch "Black Border Remover" from Start menu.
- Portable/Zip: Unzip, open the folder, double-click "Black Border Remover.exe".

First run notes
- SmartScreen may warn for unsigned builds -> click "More info" -> "Run anyway".
- No internet required; processing is offline.

Troubleshooting
- PDFs not processing or empty output: Ghostscript is missing from PATH. Reinstall or re-add and re-run `gswin64c -version`.
- Images not processing: ensure the files are not corrupted; no extra native tools are required.

Where results go
- Processed files are saved into a dated folder (e.g., 2025-05-26_processed) under your Pictures folder by default.

Support
- If you still have issues, capture a screenshot of any error and share it with the sender of this app.

 
