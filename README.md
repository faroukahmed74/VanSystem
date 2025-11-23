# Van System - Video Stream Manager

A full web application for managing and previewing RTSP video streams with text overlays. Features real-time synchronization across multiple clients on your local network, automatic stream health monitoring, and seamless RTSP to HLS conversion for browser playback.

## Features

- **Editor Screen**: Create and manage video stream buttons with IP addresses and directorate names
  - Visual connection status indicators (green=connected, red=disconnected, orange=checking)
  - Edit existing buttons to update IP and name
  - Real-time synchronization across all Editor Screens on the network
- **Preview Screen**: Full-screen video stream preview with text overlay at the top center
  - Automatic stream reconnection on failure
  - Last frame caching during disconnections
  - Low-latency HLS streaming
- **Real-time Synchronization**: When you click a button in Editor Screen, all open Preview Screens automatically update
- **Local Network Support**: Accessible from any device on your local network via IPv4
- **RTSP to HLS Conversion**: Built-in server-side conversion using FFmpeg
- **Automatic Health Monitoring**: Server automatically restarts FFmpeg if streams stall
- Modern, responsive UI with smooth transitions and glassmorphism effects

## Prerequisites

- **Node.js** (v16 or higher)
- **FFmpeg** (required for RTSP stream conversion)
  - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html) or use `winget install ffmpeg`
  - Make sure FFmpeg is in your system PATH

## Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/van-system.git
cd van-system
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

This will start:
- **WebSocket server** on port **8091** (for real-time communication)
- **RTSP converter server** on port **8092** (for RTSP to HLS conversion)
- **Vite dev server** on port **8090** (for the web application)

3. Access the application:
   - **Local**: `http://localhost:8090`
   - **Network**: `http://<your-ipv4-address>:8090` (accessible from other devices on your local network)

## Usage

1. **Editor Screen** (`/editor`):
   - Enter an IP address
   - Enter the Directorate name (اسم المديرية)
   - Click "Save Button" to create a new button
   - Click on any saved button to preview the stream
   - The connection status indicator shows if WebSocket is connected

2. **Preview Screen** (`/preview`):
   - Displays the video stream in full screen
   - Shows the directorate name as an overlay at the center
   - **Automatically updates** when a button is clicked in Editor Screen (even if opened on another device)
   - Click "Back to Editor" to return

## Real-time Features

- When you click a button in the Editor Screen, it broadcasts the stream URL and overlay text to all connected Preview Screens
- Multiple users can have Preview Screens open simultaneously, and they all update in real-time
- Works across different devices on your local network

## Network Configuration

- **Web Application**: Port **8090** (accessible on `0.0.0.0` - all network interfaces)
- **WebSocket Server**: Port **8091** (for real-time communication)
- Make sure both ports are open in your firewall if accessing from other devices

## RTSP Stream Conversion

This application includes a built-in RTSP to HLS conversion server that:
- Automatically converts RTSP streams to HLS format for browser playback
- Uses FFmpeg for high-quality, low-latency conversion
- Monitors stream health and automatically restarts if streams stall
- Supports multiple concurrent streams

The conversion server runs on port **8092** and is automatically started with `npm run dev`.

## Project Structure

```
src/
  ├── screens/
  │   ├── EditorScreen.jsx    # Editor interface
  │   ├── EditorScreen.css
  │   ├── PreviewScreen.jsx   # Preview interface
  │   └── PreviewScreen.css
  ├── context/
  │   └── StreamContext.jsx   # State management
  ├── utils/
  │   └── websocket.js        # WebSocket utilities
  ├── App.jsx                 # Main app component
  ├── main.jsx                # Entry point
  └── index.css               # Global styles
server/
  └── websocket-server.js    # WebSocket server for real-time sync
```

## Technologies

- React 18
- React Router DOM
- Vite
- WebSocket (ws) for real-time communication
- CSS3 with modern styling

