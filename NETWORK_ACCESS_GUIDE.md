# Network Access Guide for Van System

This guide helps you configure the application so other devices on your local network can access it.

## Quick Fix

**Most likely issue: Windows Firewall is blocking the ports**

1. **Open PowerShell as Administrator** (Right-click → Run as Administrator)
2. Navigate to the project folder:
   ```powershell
   cd C:\Users\PC\Documents\GitHub\VanSystem
   ```
3. Run the firewall setup:
   ```powershell
   .\setup-firewall.ps1
   ```
4. Verify it worked:
   ```powershell
   .\diagnose-network.ps1
   ```

## Step-by-Step Troubleshooting

### Step 1: Verify Servers Are Running

Make sure `npm run dev` is running and you see:
```
✓ WebSocket server running on ws://0.0.0.0:8091/ws
✓ RTSP Conversion Server running on http://0.0.0.0:8092
✓ Vite dev server running on http://0.0.0.0:8090
```

### Step 2: Find Your IP Address

**Method 1: Using PowerShell**
```powershell
ipconfig | findstr IPv4
```

**Method 2: Using Command Prompt**
```cmd
ipconfig
```
Look for "IPv4 Address" under your active network adapter (usually starts with 192.168.x.x or 10.x.x.x)

**Method 3: Run Diagnostic Script**
```powershell
.\diagnose-network.ps1
```

### Step 3: Configure Windows Firewall

**Option A: Automatic Setup (Recommended)**
1. Open PowerShell as **Administrator**
2. Run:
   ```powershell
   .\setup-firewall.ps1
   ```

**Option B: Manual Setup**
1. Open **Windows Defender Firewall with Advanced Security**
2. Click **Inbound Rules** → **New Rule**
3. For each port (8090, 8091, 8092):
   - Select **Port** → **Next**
   - Select **TCP** → Enter port number → **Next**
   - Select **Allow the connection** → **Next**
   - Check all profiles (Domain, Private, Public) → **Next**
   - Name it "Van System - [Service Name]" → **Finish**

### Step 4: Test Access

1. **From the same PC:**
   - Open browser: `http://localhost:8090`
   - Should work immediately

2. **From another device on the same network:**
   - Open browser: `http://[YOUR_IP]:8090`
   - Example: `http://192.168.4.217:8090`
   - If it doesn't work, continue troubleshooting

### Step 5: Run Diagnostics

Run the diagnostic script to identify issues:
```powershell
.\diagnose-network.ps1
```

This will check:
- ✓ Server configuration
- ✓ If servers are running
- ✓ Windows Firewall rules
- ✓ Network IP addresses
- ✓ Port accessibility

## Common Issues and Solutions

### Issue 1: "Connection Refused" or "Can't Reach This Page"

**Cause:** Windows Firewall is blocking the ports

**Solution:**
1. Run `.\setup-firewall.ps1` as Administrator
2. Verify rules were created: `.\check-firewall.ps1`
3. Restart `npm run dev`

### Issue 2: "This Site Can't Be Reached" from Other Devices

**Causes:**
- Firewall blocking (most common)
- Wrong IP address
- Devices not on same network
- Antivirus blocking

**Solutions:**
1. **Check firewall:**
   ```powershell
   .\diagnose-network.ps1
   ```

2. **Verify IP address:**
   - Run `ipconfig` on the server PC
   - Use the IPv4 address (not 127.0.0.1 or 169.254.x.x)
   - Make sure you're using the correct IP on the client device

3. **Check network:**
   - Ensure both devices are on the same Wi-Fi/network
   - Try pinging the server IP from the client device:
     ```cmd
     ping 192.168.4.217
     ```

4. **Check antivirus:**
   - Temporarily disable antivirus firewall to test
   - If it works, add exceptions for ports 8090, 8091, 8092

### Issue 3: WebSocket Connection Fails

**Cause:** Port 8091 is blocked or WebSocket server isn't running

**Solution:**
1. Check if WebSocket server is running (should see in `npm run dev` output)
2. Verify port 8091 is open in firewall
3. Check browser console for WebSocket errors

### Issue 4: Streams Don't Load on Client Devices

**Cause:** Port 8092 (RTSP converter) is blocked

**Solution:**
1. Ensure port 8092 is allowed in firewall
2. Check server console for RTSP converter errors
3. Verify FFmpeg is installed and working

### Issue 5: Works Locally But Not from Network

**Cause:** Server is only listening on localhost instead of 0.0.0.0

**Solution:**
1. Check `vite.config.js` has `host: '0.0.0.0'`
2. Check server files listen on `0.0.0.0` (they should by default)
3. Restart `npm run dev`

## Verification Checklist

Before asking for help, verify:

- [ ] `npm run dev` is running without errors
- [ ] All three servers show "0.0.0.0" in their startup messages
- [ ] Firewall rules are created and enabled (run `.\diagnose-network.ps1`)
- [ ] You're using the correct IP address (not localhost)
- [ ] Both devices are on the same network
- [ ] You can ping the server IP from the client device
- [ ] Ports 8090, 8091, 8092 are listening (check with `netstat -an | findstr "8090 8091 8092"`)

## Quick Test Commands

**Check if ports are listening:**
```powershell
netstat -an | findstr "8090 8091 8092"
```

**Check firewall rules:**
```powershell
Get-NetFirewallRule -DisplayName "*Van System*" | Format-Table DisplayName, Enabled, Action
```

**Test local connectivity:**
```powershell
Test-NetConnection -ComputerName localhost -Port 8090
```

**Get your IP address:**
```powershell
ipconfig | findstr IPv4
```

## Still Having Issues?

1. Run the diagnostic script: `.\diagnose-network.ps1`
2. Check the server console for errors
3. Check browser console (F12) on the client device
4. Verify all steps in the checklist above

## Security Note

The firewall rules created by `setup-firewall.ps1` allow incoming connections on ports 8090, 8091, and 8092. These are only accessible from your local network, not from the internet. This is safe for local network use.

