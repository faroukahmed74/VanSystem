# Setup Guide - RTSP Stream Conversion

## Overview

The app now includes a **local RTSP-to-HLS conversion server** that works entirely on your local network - **no internet required**!

## What Was Added

1. **RTSP Converter Server** (`server/rtsp-converter.js`)
   - Converts RTSP streams to HLS format
   - Runs on port 8092
   - Works locally on your network

2. **HLS.js Library**
   - Enables HLS playback in all browsers
   - Automatically handles HLS streams

3. **Automatic Conversion**
   - RTSP streams are automatically converted to HLS
   - No manual configuration needed

## Installation Steps

### 1. Install FFmpeg (Required)

FFmpeg is needed to convert RTSP streams. Choose one method:

**Windows (winget):**
```bash
winget install ffmpeg
```

**Windows (Chocolatey):**
```bash
choco install ffmpeg
```

**Manual:**
1. Download from: https://www.gyan.dev/ffmpeg/builds/
2. Extract and add to PATH

**Verify installation:**
```bash
ffmpeg -version
```

### 2. Install Dependencies

```bash
npm install
```

This will install:
- React and dependencies
- WebSocket server
- HLS.js library

### 3. Start the Application

```bash
npm run dev
```

This starts:
- **WebSocket server** on port 8091
- **RTSP converter** on port 8092  
- **Web app** on port 8090

## How It Works

1. **User enters RTSP URL** (e.g., `rtsp://10.0.0.21:8000/media/video2`)
2. **App detects RTSP** and automatically converts it
3. **Converter server** uses FFmpeg to convert RTSP → HLS
4. **Browser plays HLS** stream using HLS.js
5. **No internet required** - everything works locally!

## Ports Used

- **8090**: Web application (Vite)
- **8091**: WebSocket server (real-time sync)
- **8092**: RTSP converter server (stream conversion)

## Testing

1. Open Editor Screen
2. Enter IP: `10.0.0.21`
3. Enter Directorate name
4. Click "Save Button"
5. Click the button to send to Preview Screen
6. Stream should load automatically!

## Troubleshooting

### FFmpeg Not Found
- Make sure FFmpeg is installed and in PATH
- Restart terminal after installing FFmpeg
- Check with: `ffmpeg -version`

### Stream Not Loading
- Check server console for FFmpeg errors
- Verify RTSP stream is accessible from server
- Check firewall settings for ports 8090-8092

### Conversion Server Not Starting
- Check if port 8092 is available
- Look for errors in server console
- Verify FFmpeg is installed

## Network Access

All servers listen on `0.0.0.0`, so they're accessible from:
- Local: `http://localhost:8090`
- Network: `http://192.168.x.x:8090`

The RTSP converter automatically uses the correct hostname for network access.

