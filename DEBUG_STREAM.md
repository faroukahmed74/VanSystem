# Debugging RTSP Stream Issues

## Problem
Stream works in VLC but not in the web app for local or network users.

## Debugging Steps

### 1. Check if FFmpeg is running and connecting
- Open browser console (F12) and check for errors
- Look for messages like:
  - "HLS error"
  - "FFmpeg error"
  - Network errors (404, 503, CORS)

### 2. Test the converter server directly
Run this in PowerShell:
```powershell
# Test health endpoint
Invoke-WebRequest -Uri "http://localhost:8092/health" | Select-Object -ExpandProperty Content

# Test HLS endpoint (replace with your RTSP URL)
$rtspUrl = "rtsp://10.0.0.21:8000/media/video2"
$encoded = [System.Web.HttpUtility]::UrlEncode($rtspUrl)
Invoke-WebRequest -Uri "http://localhost:8092/hls/$encoded/playlist.m3u8" | Select-Object StatusCode, Content
```

### 3. Check server console logs
Look for:
- "FFmpeg conversion started successfully"
- "FFmpeg error"
- "Connection refused" or "Connection timed out"
- "Stream connection established"

### 4. Common Issues

#### Issue: FFmpeg can't connect to RTSP stream
**Symptoms:**
- Server returns 503 (playlist not ready)
- FFmpeg errors in console about connection

**Solutions:**
- Verify RTSP URL is correct: `rtsp://10.0.0.21:8000/media/video2`
- Test in VLC first to confirm stream works
- Check firewall settings
- Try UDP instead of TCP: Change `-rtsp_transport tcp` to `-rtsp_transport udp` in `server/rtsp-converter.js`

#### Issue: Playlist generated but segments not accessible
**Symptoms:**
- Playlist loads but video doesn't play
- 404 errors for `.ts` segments in browser console

**Solutions:**
- Check if segments exist in `server/hls-output/` directory
- Verify segment paths in playlist are absolute URLs
- Check CORS headers are set correctly

#### Issue: HLS.js can't parse playlist
**Symptoms:**
- "HLS error" in browser console
- "manifest parsing error"

**Solutions:**
- Check playlist format is valid M3U8
- Verify playlist has proper headers
- Check if segments are being generated

### 5. Manual FFmpeg Test
Test FFmpeg directly:
```powershell
ffmpeg -rtsp_transport tcp -i rtsp://10.0.0.21:8000/media/video2 -c:v libx264 -c:a aac -f hls -hls_time 2 -hls_list_size 3 test-output/playlist.m3u8
```

If this works, the issue is in the Node.js server code.
If this fails, the issue is with FFmpeg or the RTSP stream itself.

### 6. Check Network Access
For network users:
- Verify converter server is listening on `0.0.0.0:8092` (not just `localhost`)
- Test from another machine: `http://192.168.4.217:8092/health`
- Check Windows Firewall allows port 8092

### 7. Browser Console Errors
Common errors to look for:
- `CORS policy` - CORS headers issue
- `Failed to load resource` - Network issue
- `HLS error: networkError` - Can't fetch segments
- `HLS error: mediaError` - Can't decode video

## Next Steps
1. Check browser console for specific errors
2. Check server console for FFmpeg output
3. Test RTSP URL in VLC to confirm it works
4. Run manual FFmpeg test to isolate the issue

