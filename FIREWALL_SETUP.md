# Firewall Setup Guide for Van System

## Quick Setup

To allow network access to the Van System application, you need to configure Windows Firewall to allow incoming connections on three ports:

- **Port 8090**: Vite development server (web interface)
- **Port 8091**: WebSocket server (real-time communication)
- **Port 8092**: RTSP converter server (stream conversion)

## Automatic Setup (Recommended)

1. **Open PowerShell as Administrator**:
   - Press `Win + X`
   - Select "Windows PowerShell (Admin)" or "Terminal (Admin)"

2. **Navigate to the project directory**:
   ```powershell
   cd C:\Users\PC\Documents\GitHub\VanSystem
   ```

3. **Run the setup script**:
   ```powershell
   .\setup-firewall.ps1
   ```

4. **Verify the rules were created**:
   ```powershell
   .\check-firewall.ps1
   ```

## Manual Setup

If you prefer to set up firewall rules manually:

1. Open **Windows Defender Firewall with Advanced Security**
2. Click **Inbound Rules** → **New Rule**
3. Select **Port** → **Next**
4. Select **TCP** and enter the port number (8090, 8091, or 8092)
5. Select **Allow the connection** → **Next**
6. Check all profiles (Domain, Private, Public) → **Next**
7. Name it "Van System - [Service Name]" → **Finish**
8. Repeat for all three ports

## Verify Firewall Rules

Run the check script (as Administrator):
```powershell
.\check-firewall.ps1
```

Or manually check in Windows Defender Firewall:
- Look for rules named "Van System - Vite Server", "Van System - WebSocket Server", and "Van System - RTSP Converter"
- Ensure they are **Enabled** and set to **Allow**

## Troubleshooting

### If clients still can't connect:

1. **Check Windows Firewall is not blocking**:
   - Run `check-firewall.ps1` as Administrator
   - Ensure all rules are enabled

2. **Check if ports are in use**:
   ```powershell
   netstat -an | findstr "8090 8091 8092"
   ```

3. **Check Windows Defender Firewall logs**:
   - Open Event Viewer
   - Navigate to: Windows Logs → Security
   - Look for blocked connections

4. **Temporarily disable firewall for testing** (not recommended for production):
   - Only for testing purposes
   - Re-enable immediately after testing

### Network Access

Once firewall is configured, the app will be accessible from other devices on your local network at:
- `http://[YOUR_IP]:8090` (e.g., `http://192.168.4.41:8090`)

The app automatically detects the IP address and uses it for WebSocket and RTSP converter connections.

