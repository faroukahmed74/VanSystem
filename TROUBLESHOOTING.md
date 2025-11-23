# Troubleshooting Guide

## App Not Found / Not Loading

### Check if Server is Running

1. **Check the terminal** where you ran `npm run dev`
   - You should see output from all three servers
   - Look for any error messages

2. **Verify ports are listening:**
   ```powershell
   Get-NetTCPConnection -LocalPort 8090,8091,8092
   ```

### Common Issues

#### 1. Port Already in Use
**Error:** `Port 8090 is already in use`

**Solution:**
- Find and stop the process using the port
- Or change the port in `vite.config.js`

#### 2. Server Not Starting
**Check:**
- Are you in the correct directory?
- Did you run `npm install`?
- Are there any error messages in the console?

#### 3. Can't Access from Network
**Check:**
- Firewall settings (ports 8090, 8091, 8092)
- Use `http://localhost:8090` first to test locally
- Then try network IP: `http://192.168.x.x:8090`

#### 4. Browser Shows "Not Found"
**Try:**
- Clear browser cache
- Try a different browser
- Check browser console (F12) for errors
- Make sure you're using the correct URL

### Quick Fixes

1. **Restart everything:**
   ```bash
   # Stop server (Ctrl+C)
   # Then restart:
   npm run dev
   ```

2. **Check server output:**
   - Should see: "VITE v5.x.x ready"
   - Should see: "WebSocket server running"
   - Should see: "RTSP Conversion Server running"

3. **Test locally first:**
   - Open: `http://localhost:8090`
   - If this works, the issue is network/firewall

### Expected Server Output

When `npm run dev` runs successfully, you should see:

```
WebSocket server running on ws://0.0.0.0:8091/ws
RTSP Conversion Server running on http://0.0.0.0:8092
FFmpeg available: Yes
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:8090/
➜  Network: http://192.168.x.x:8090/
```

If you don't see this, there's an issue with the server startup.

