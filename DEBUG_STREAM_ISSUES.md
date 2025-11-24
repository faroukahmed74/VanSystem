# Debugging Stream Loading Issues

## Quick Test

Run this command to test if FFmpeg can connect to your RTSP stream:

```bash
node test-ffmpeg-rtsp.js rtsp://10.0.0.122:8000/media/video2
```

This will:
- Test FFmpeg connection to the RTSP stream
- Show all FFmpeg output (errors and info)
- Create test segments in `test-output/` directory
- Show if segments are being created successfully

## Common Issues and Solutions

### ✅ New Server-Side Protections (Nov 2025)

- **Automatic FFmpeg profile fallback**  
  The converter now tries three pipelines in order:  
  1. `copy-tcp` – copies the camera's H.264 bitstream (no re-encode, lowest CPU).  
  2. `transcode-tcp` – re-encodes when the raw bitstream is malformed.  
  3. `transcode-udp` – switches the transport layer when the camera rejects TCP/keeps dropping connections.  
  You will see log lines such as `🎬 Attempting FFmpeg profile "copy-tcp"` followed by the one that succeeds.

- **Idle-stream auto cleanup**  
  Streams with no playlist/segment requests for 2 minutes are stopped automatically. This prevents abandoned FFmpeg processes when you switch buttons. Override via `FFMPEG_IDLE_TIMEOUT_MS`.

- **Better diagnostics**  
  When FFmpeg exits you now get a human-readable classification (`Camera returned 5XX`, `Connection reset by peer (-10054)`, etc.) based on the stderr log, making it easier to match what you saw in VLC vs. Node.

- **Environment toggles**
  - `FFMPEG_PROFILE=transcode-tcp` (or any profile name) forces a specific pipeline.
  - `FFMPEG_HANDSHAKE_TIMEOUT`, `FFMPEG_RW_TIMEOUT`, `FFMPEG_ANALYZE_DURATION`, `FFMPEG_PROBE_SIZE` let you tune stubborn cameras without editing code.

### 1. Stream Works in VLC but Not in Web App

**Possible Causes:**
- FFmpeg connection timeout
- Network/firewall blocking FFmpeg
- RTSP authentication (VLC might have saved credentials)
- Different RTSP transport (UDP vs TCP)

**Check:**
- Server console logs for FFmpeg errors
- Run the test script above
- Check if FFmpeg process is running: `Get-Process | Where-Object {$_.ProcessName -eq "ffmpeg"}`

### 2. "Unable to load stream" Error

**Check Server Console For:**
- `📺 Decoded RTSP URL:` - Verify the URL is correct
- `🆔 Stream ID:` - Should be unique for each stream
- `❌ FFmpeg ERROR:` - Any connection or encoding errors
- `✅ FFmpeg [streamId]: Stream connection established` - Confirms connection
- `✅ Playlist and segment ready` - Confirms segments are created

### 3. Empty Segments (0 bytes)

**Symptoms:**
- Segments are created but are 0 bytes
- Playlist exists but video doesn't play

**Possible Causes:**
- FFmpeg not receiving data from RTSP stream
- Encoding errors
- Network issues

**Solution:**
- Check FFmpeg stderr output in server console
- Verify RTSP stream is actually streaming (test in VLC)
- Check network connectivity to RTSP server

### 4. Different Buttons Show Same Stream

**Fixed:** Stream ID now uses SHA256 hash for uniqueness

**If Still Happening:**
- Check server logs for "Stream ID collision detected!"
- Verify each button has a different IP address
- Check that `getStreamId()` is generating unique IDs

## Server Logs to Check

When you click a button, you should see in the server console:

1. **URL Decoding:**
   ```
   📺 Request path: /hls/rtsp%3A%2F%2F10.0.0.122%3A8000%2Fmedia%2Fvideo2/playlist.m3u8
   📺 Encoded URL: rtsp%3A%2F%2F10.0.0.122%3A8000%2Fmedia%2Fvideo2
   📺 Decoded RTSP URL: rtsp://10.0.0.122:8000/media/video2
   ```

2. **Stream ID:**
   ```
   🆔 Stream ID for rtsp://10.0.0.122:8000/media/video2: abc123...
   ```

3. **FFmpeg Start:**
   ```
   🚀 Starting new FFmpeg conversion for: rtsp://10.0.0.122:8000/media/video2
   Starting FFmpeg conversion for: rtsp://10.0.0.122:8000/media/video2
   FFmpeg command: ffmpeg -rtsp_transport tcp ...
   ```

4. **Connection Success:**
   ```
   ✅ FFmpeg [streamId]: Stream connection established
   ✅ FFmpeg [streamId]: Creating segment file
   ✅ Playlist and segment ready for streamId (segment size: X bytes)
   ```

5. **Errors (if any):**
   ```
   ❌ FFmpeg ERROR [streamId]: [error message]
   ❌ FFmpeg connection failed for: streamId
   ```

## Testing Steps

1. **Test FFmpeg Directly:**
   ```bash
   node test-ffmpeg-rtsp.js rtsp://10.0.0.122:8000/media/video2
   ```

2. **Check Server Health:**
   Open in browser: `http://localhost:8092/health`
   Should show: `{"status":"ok","ffmpegAvailable":true,...}`

3. **Check Active Streams:**
   Look for `activeStreams` in the health endpoint response

4. **Monitor Server Console:**
   Watch for errors when clicking buttons in Editor Screen

5. **Check Browser Console:**
   Open browser DevTools (F12) and check Console tab for:
   - HLS.js errors
   - Network errors (404, 503, etc.)
   - Stream URL being used

## Network Issues

If ping shows timeouts but VLC works:
- VLC might be using UDP (faster but less reliable)
- FFmpeg uses TCP (more reliable but slower)
- Try increasing timeout in FFmpeg command
- Check firewall settings

## Next Steps

1. Run the test script and share the output
2. Check server console logs when clicking a button
3. Share any error messages you see
4. Verify FFmpeg is installed: `ffmpeg -version`

