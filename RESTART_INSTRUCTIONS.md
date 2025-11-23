# How to Restart the Server

## Steps to Restart:

1. **Stop the current server** (if running):
   - Press `Ctrl + C` in the terminal where `npm run dev` is running
   - Or close the terminal window

2. **Start the server again**:
   ```bash
   npm run dev
   ```

## What Changed:

- Added persistent button storage (buttons saved to `server/buttons.json`)
- Improved WebSocket synchronization across network
- Better logging for debugging
- Buttons now persist across server restarts

## After Restart:

- All previously saved buttons will be loaded from storage
- Buttons will sync across all users on the network
- Check server console for: "Server started with X saved buttons"

