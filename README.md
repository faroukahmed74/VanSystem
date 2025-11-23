# Van System - Video Stream Manager

A full web application for managing and previewing video streams with text overlays. Features real-time synchronization across multiple clients on your local network.

## Features

- **Editor Screen**: Create and manage video stream buttons with IP addresses and directorate names
- **Preview Screen**: Full-screen video stream preview with text overlay at the center
- **Real-time Synchronization**: When you click a button in Editor Screen, all open Preview Screens automatically update
- **Local Network Support**: Accessible from any device on your local network via IPv4
- Modern, responsive UI with smooth transitions

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

This will start:
- WebSocket server on port **8091** (for real-time communication)
- Vite dev server on port **8090** (for the web application)

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

## Important Note

Browsers don't natively support RTSP streams. For production use, you'll need:
- A streaming server that converts RTSP to HLS or WebRTC
- Or use libraries like HLS.js for HLS streams
- Or implement a WebRTC solution for RTSP conversion

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

