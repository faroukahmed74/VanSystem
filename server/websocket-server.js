const WebSocket = require('ws');
const http = require('http');
const { loadButtons, saveButtons } = require('./button-storage');

const PORT = 8091; // WebSocket server port (different from Vite)

// Create HTTP server
const server = http.createServer();

// Create WebSocket server with CORS support
const wss = new WebSocket.Server({ 
  server,
  path: '/ws',
  perMessageDeflate: false
});

// Store all connected clients
const clients = new Set();

// Load buttons from persistent storage
let sharedButtons = loadButtons();
console.log(`Server started with ${sharedButtons.length} saved buttons`);

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`New client connected from ${clientIp}, total clients: ${clients.size + 1}`);
  clients.add(ws);

  // Send welcome message with current buttons
  try {
    ws.send(JSON.stringify({ 
      type: 'connected', 
      message: 'Connected to server',
      buttons: sharedButtons
    }));
    console.log(`Sent ${sharedButtons.length} buttons to new client`);
  } catch (error) {
    console.error('Error sending welcome message:', error);
  }

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received:', data.type);

      // Handle different message types
      if (data.type === 'buttonCreate') {
        // Add button to shared state
        const newButton = data.button;
        if (!newButton || !newButton.id) {
          console.error('Invalid button data received');
          return;
        }
        
        // Check if button already exists (prevent duplicates)
        const exists = sharedButtons.find(btn => btn.id === newButton.id);
        if (!exists) {
          sharedButtons.push(newButton);
          // Save to persistent storage
          saveButtons(sharedButtons);
          console.log('Button created:', newButton.name, 'Total buttons:', sharedButtons.length, 'Clients:', clients.size);
        } else {
          console.log('Button already exists, skipping:', newButton.id);
        }
        
        // Broadcast to all clients (including sender)
        const message = JSON.stringify({
          type: 'buttonCreated',
          button: newButton,
          allButtons: sharedButtons
        });
        
        let sentCount = 0;
        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(message);
              sentCount++;
            } catch (error) {
              console.error('Error sending message to client:', error);
            }
          }
        });
        console.log(`Broadcasted button creation to ${sentCount} clients`);
      } else if (data.type === 'buttonDelete') {
        // Remove button from shared state
        const buttonId = data.buttonId;
        sharedButtons = sharedButtons.filter(btn => btn.id !== buttonId);
        // Save to persistent storage
        saveButtons(sharedButtons);
        console.log('Button deleted:', buttonId, 'Remaining buttons:', sharedButtons.length, 'Clients:', clients.size);
        
        // Broadcast to all clients (including sender)
        const deleteMessage = JSON.stringify({
          type: 'buttonDeleted',
          buttonId: buttonId,
          allButtons: sharedButtons
        });
        
        let sentCount = 0;
        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(deleteMessage);
              sentCount++;
            } catch (error) {
              console.error('Error sending delete message to client:', error);
            }
          }
        });
        console.log(`Broadcasted button deletion to ${sentCount} clients`);
      } else if (data.type === 'buttonUpdate') {
        // Update existing button in shared state
        const updatedButton = data.button;
        const buttonId = data.buttonId;
        
        if (!updatedButton || !buttonId) {
          console.error('Invalid button update data received');
          return;
        }
        
        // Find and update the button
        const buttonIndex = sharedButtons.findIndex(btn => btn.id === buttonId);
        if (buttonIndex !== -1) {
          sharedButtons[buttonIndex] = updatedButton;
          // Save to persistent storage
          saveButtons(sharedButtons);
          console.log('Button updated:', updatedButton.name, 'Total buttons:', sharedButtons.length, 'Clients:', clients.size);
        } else {
          console.log('Button not found for update:', buttonId);
        }
        
        // Broadcast to all clients (including sender)
        const updateMessage = JSON.stringify({
          type: 'buttonUpdated',
          buttonId: buttonId,
          button: updatedButton,
          allButtons: sharedButtons
        });
        
        let sentCount = 0;
        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(updateMessage);
              sentCount++;
            } catch (error) {
              console.error('Error sending update message to client:', error);
            }
          }
        });
        console.log(`Broadcasted button update to ${sentCount} clients`);
      } else if (data.type === 'requestButtons') {
        // Send current buttons to requesting client
        try {
          ws.send(JSON.stringify({
            type: 'buttonsSync',
            buttons: sharedButtons
          }));
          console.log(`Sent ${sharedButtons.length} buttons to requesting client`);
        } catch (error) {
          console.error('Error sending buttons to client:', error);
        }
      } else if (data.type === 'streamUpdate') {
        // Broadcast stream updates to ALL clients (including sender)
        // This ensures Preview Screens on the same machine and network get updates
        console.log('Broadcasting stream update:', data.streamUrl);
        const streamMessage = JSON.stringify(data);
        
        let sentCount = 0;
        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(streamMessage);
              sentCount++;
            } catch (error) {
              console.error('Error sending stream update to client:', error);
            }
          }
        });
        console.log(`Broadcasted stream update to ${sentCount} clients`);
      } else {
        // Broadcast other messages to all other clients only
        clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  // Handle client disconnect
  ws.on('close', () => {
    console.log(`Client disconnected, remaining clients: ${clients.size - 1}`);
    clients.delete(ws);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on ws://0.0.0.0:${PORT}/ws`);
  console.log(`Accessible from local network at ws://<your-ip>:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down WebSocket server...');
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

