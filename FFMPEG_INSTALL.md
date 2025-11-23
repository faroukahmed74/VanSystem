# FFmpeg Installation Guide

The RTSP converter requires FFmpeg to convert RTSP streams to HLS format.

## Windows Installation

### Option 1: Using winget (Windows 10/11)
```bash
winget install ffmpeg
```

### Option 2: Using Chocolatey
```bash
choco install ffmpeg
```

### Option 3: Manual Installation
1. Download FFmpeg from: https://www.gyan.dev/ffmpeg/builds/
2. Extract the ZIP file
3. Add the `bin` folder to your system PATH:
   - Open "Environment Variables" in Windows
   - Edit "Path" variable
   - Add the path to FFmpeg's `bin` folder (e.g., `C:\ffmpeg\bin`)

### Verify Installation
After installation, restart your terminal and run:
```bash
ffmpeg -version
```

You should see FFmpeg version information.

## After Installing FFmpeg

1. Restart the server:
   ```bash
   npm run dev
   ```

2. The RTSP converter will automatically detect FFmpeg and start converting streams.

## How It Works

- RTSP streams (e.g., `rtsp://10.0.0.21:8000/media/video2`) are automatically converted to HLS format
- HLS streams can be played directly in web browsers
- Conversion happens locally on your server - no internet required
- Streams are converted in real-time as you watch them

