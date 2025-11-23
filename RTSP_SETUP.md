# RTSP Stream Conversion Setup Guide

## Problem
Browsers cannot directly play RTSP streams. RTSP streams need to be converted to web-compatible formats like HLS or WebRTC.

## Solution Options

### Option 1: RTSP to HLS Conversion (Recommended)

#### Using MediaMTX (Easy Setup)
1. Download MediaMTX from: https://github.com/bluenviron/mediamtx
2. Run MediaMTX:
   ```bash
   ./mediamtx
   ```
3. MediaMTX will convert RTSP streams to HLS automatically
4. Access streams at: `http://localhost:8554/<stream_path>/index.m3u8`

#### Using nginx with RTMP module
1. Install nginx with RTMP module
2. Configure nginx to convert RTSP to HLS
3. Streams will be available as HLS

### Option 2: WebRTC Gateway

#### Using Janus Gateway
1. Install Janus Gateway
2. Configure RTSP plugin
3. Streams accessible via WebRTC

#### Using Kurento Media Server
1. Install Kurento
2. Configure RTSP endpoint
3. Use WebRTC for playback

### Option 3: Custom Conversion Server

You can create your own conversion server using:
- FFmpeg to convert RTSP to HLS
- Node.js with libraries like `node-rtsp-stream`
- Python with OpenCV or similar

## Configuration in Van System

To use a conversion server, update `src/utils/streamConverter.js`:

```javascript
const url = getPlayableUrl(currentStreamUrl, {
  conversionServer: 'http://localhost:8080', // Your RTSP->HLS server
  webrtcServer: 'http://localhost:8080',     // Your WebRTC gateway
  preferHLS: true
})
```

## Quick Test Setup

For testing, you can use a simple FFmpeg command:

```bash
ffmpeg -i rtsp://your-ip:8000/media/video2 -c copy -f hls -hls_time 2 -hls_list_size 3 -hls_flags delete_segments http://localhost:8080/hls/stream.m3u8
```

Then access: `http://localhost:8080/hls/stream.m3u8`

## Current Implementation

The app currently:
- Detects RTSP streams automatically
- Shows helpful error messages when RTSP streams can't be played
- Provides conversion options in the error message
- Supports HLS streams natively (if converted)
- Supports HTTP video streams natively

## Future Enhancements

- Automatic RTSP detection and conversion
- Built-in conversion server option
- Support for multiple conversion methods
- Stream quality selection

