# Packaging MonoScan as a Native Installer

The `monoscan.py` agent is a single Python file. To ship it as a native
double-clickable executable (no Python required on the user's machine),
use **PyInstaller**. Below are the exact commands for each OS.

> Note: signing/notarising for public distribution requires a paid developer
> certificate (Apple Developer, Microsoft SmartScreen, etc.). The steps below
> produce an unsigned but fully functional binary suitable for internal use.

---

## macOS (`.app` + `.pkg`)

```bash
pip install pyinstaller
pyinstaller --onefile --name MonoScan --console monoscan.py
# → dist/MonoScan

# Optional: wrap into a .pkg installer
mkdir -p pkgroot/usr/local/bin && cp dist/MonoScan pkgroot/usr/local/bin/
pkgbuild --root pkgroot --identifier com.mononode.monoscan --version 1.0 MonoScan.pkg
```

**To notarise for distribution:**
```bash
codesign --sign "Developer ID Application: Your Name" --options runtime dist/MonoScan
xcrun notarytool submit MonoScan.pkg --apple-id you@example.com --team-id TEAMID --wait
```

---

## Windows (`.exe`)

```powershell
pip install pyinstaller
pyinstaller --onefile --name MonoScan --console monoscan.py
# → dist\MonoScan.exe
```

**Optional MSI:**
```powershell
# Use WiX Toolset (https://wixtoolset.org/)
candle MonoScan.wxs
light MonoScan.wixobj -o MonoScan.msi
```

For SmartScreen trust: sign with a code-signing certificate:
```powershell
signtool sign /f cert.pfx /p PASSWORD /tr http://timestamp.digicert.com /td SHA256 /fd SHA256 dist\MonoScan.exe
```

---

## Linux (`.deb` / `.rpm` / AppImage)

```bash
pip install pyinstaller
pyinstaller --onefile --name monoscan --console monoscan.py
# → dist/monoscan
```

**.deb package (Debian/Ubuntu):**
```bash
mkdir -p monoscan_1.0-1/DEBIAN monoscan_1.0-1/usr/local/bin
cp dist/monoscan monoscan_1.0-1/usr/local/bin/
cat > monoscan_1.0-1/DEBIAN/control <<EOF
Package: monoscan
Version: 1.0-1
Architecture: amd64
Maintainer: You <you@example.com>
Description: MonoNode local dedup scanner
EOF
dpkg-deb --build monoscan_1.0-1
```

**AppImage:**
```bash
# Use appimagetool (https://appimage.github.io/appimagetool/)
appimagetool MonoScan.AppDir
```

---

## Auto-schedule (continuous dedup enforcement)

Once the binary is installed on the user's machine, schedule it to run
periodically or as a login item.

**macOS (launchd):** `~/Library/LaunchAgents/com.mononode.monoscan.plist`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mononode.monoscan</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/MonoScan</string>
    <string>--root</string><string>/Users/YOU</string>
    <string>--watch</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```
Load with `launchctl load ~/Library/LaunchAgents/com.mononode.monoscan.plist`.

**Windows (Task Scheduler):**
```powershell
$action = New-ScheduledTaskAction -Execute "C:\Program Files\MonoScan\MonoScan.exe" `
    -Argument "--root C:\Users\YOU --watch"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "MonoScan" -Action $action -Trigger $trigger
```

**Linux (systemd user unit):** `~/.config/systemd/user/monoscan.service`
```ini
[Unit]
Description=MonoScan dedup watcher
[Service]
ExecStart=/usr/local/bin/monoscan --root %h --watch
Restart=always
[Install]
WantedBy=default.target
```
Enable: `systemctl --user enable --now monoscan.service`.

---

## Direct-run alternative (no packaging)

If you don't want to package at all, just tell users:
```bash
curl -o monoscan.py <backend>/api/agent/monoscan.py?request_backend=<backend>
pip install requests
python3 monoscan.py --root ~ --watch
```
That's the simplest — 3 lines, no signing, no cert. This is what the
in-app Scan tab already surfaces.
