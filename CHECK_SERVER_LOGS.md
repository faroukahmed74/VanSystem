# Check Server Console Logs

## The Problem
The browser is getting **503 (Service Unavailable)** from the conversion server, which means the HLS playlist file hasn't been created yet.

## What to Check

### 1. Open the Server Console
Look at the terminal/console where you ran `npm run dev`. You should see logs from the RTSP converter server.

### 2. Look for These Messages

#### ✅ Good Signs:
- `FFmpeg conversion started successfully for: [streamId]`
- `FFmpeg [streamId]: Stream connection established`
- `FFmpeg [streamId]: Creating segment file`
- `Serving playlist for stream: [streamId]`

#### ❌ Bad Signs (FFmpeg Connection Issues):
- `FFmpeg ERROR [streamId]: Connection refused`
- `FFmpeg ERROR [streamId]: Connection timed out`
- `FFmpeg ERROR [streamId]: Unable to`
- `FFmpeg process exited with code [number]`
- `FFmpeg process was killed`

### 3. Common Issues

#### Issue 1: FFmpeg Can't Connect to RTSP Stream
**Symptoms:**
- Server console shows "Connection refused" or "Connection timed out"
- Playlist never gets created

**Solutions:**
1. **Test RTSP URL in VLC first:**
   - Open VLC
   - Media → Open Network Stream
   - Enter: `rtsp://10.0.1.172:8000/media/video2`
   - If it works in VLC, the URL is correct
   - If it doesn't work in VLC, the RTSP server is not accessible

2. **Check Network Connectivity:**
   - Can the server machine reach `10.0.1.172:8000`?
   - Test with: `ping 10.0.1.172`
   - Check firewall settings

3. **Try UDP instead of TCP:**
   - Some RTSP servers work better with UDP
   - Edit `server/rtsp-converter.js` line 47:
     - Change `'-rtsp_transport', 'tcp'` to `'-rtsp_transport', 'udp'`

#### Issue 2: FFmpeg Takes Too Long
**Symptoms:**
- Server console shows FFmpeg is running but no segments created
- 503 errors continue

**Solutions:**
- The server now waits up to 15 seconds for the playlist
- If it takes longer, FFmpeg might be having connection issues
- Check server logs for FFmpeg output

#### Issue 3: FFmpeg Process Dies
**Symptoms:**
- Server console shows "FFmpeg process exited" or "FFmpeg process was killed"
- Browser gets 500 error instead of 503

**Solutions:**
- Check the error message in server console
- Usually means FFmpeg can't connect or RTSP URL is invalid
- Verify RTSP URL works in VLC

### 4. Manual FFmpeg Test
Test FFmpeg directly from command line:

```powershell
ffmpeg -rtsp_transport tcp -i rtsp://10.0.1.172:8000/media/video2 -c:v libx264 -c:a aac -f hls -hls_time 2 -hls_list_size 3 test-output/playlist.m3u8
```

**If this works:**
- FFmpeg can connect to the stream
- The issue is in the Node.js server code

**If this fails:**
- FFmpeg can't connect to the RTSP stream
- Check network connectivity
- Verify RTSP URL is correct
- Check if RTSP server requires authentication

### 5. Check Server Logs Right Now
**Please share the server console output** when you try to load the stream. Look for:
- Any lines starting with `FFmpeg`
- Any lines with `ERROR`
- The full output when the stream is requested

This will help identify the exact problem!

