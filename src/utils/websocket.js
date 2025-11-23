// WebSocket utility for real-time communication
// Automatically detects the WebSocket server URL based on current hostname

export function getWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const hostname = window.location.hostname
  const port = 8091 // WebSocket server port
  
  // Log for debugging
  const url = `${protocol}//${hostname}:${port}/ws`
  console.log('WebSocket URL:', url)
  return url
}

export function createWebSocketConnection(onMessage, onError, onOpen, onClose) {
  const wsUrl = getWebSocketUrl()
  const ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    console.log('WebSocket connected')
    if (onOpen) onOpen()
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (onMessage) onMessage(data)
    } catch (error) {
      console.error('Error parsing WebSocket message:', error)
    }
  }

  ws.onerror = (error) => {
    console.error('WebSocket error:', error)
    if (onError) onError(error)
  }

  ws.onclose = (event) => {
    console.log('WebSocket disconnected', event.code, event.reason)
    if (onClose) onClose(event)
  }

  return ws
}

export function reconnectWebSocket(wsRef, onMessage, onError, onOpen, maxRetries = 5, retryDelay = 3000) {
  let retryCount = 0
  let reconnectTimeout = null

  const attemptReconnect = () => {
    if (retryCount >= maxRetries) {
      console.error('Max reconnection attempts reached')
      return
    }

    retryCount++
    console.log(`Attempting to reconnect WebSocket (${retryCount}/${maxRetries})...`)
    
    reconnectTimeout = setTimeout(() => {
      // Check if WebSocket is closed or doesn't exist
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current = createWebSocketConnection(
          onMessage,
          onError,
          () => {
            retryCount = 0 // Reset on successful connection
            if (onOpen) onOpen()
          },
          (event) => {
            // Only reconnect if not a normal closure
            if (event.code !== 1000) {
              attemptReconnect()
            }
          }
        )
      }
    }, retryDelay)
  }

  return {
    attempt: attemptReconnect,
    cancel: () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = null
      }
      retryCount = 0 // Reset retry count on cancel
    }
  }
}

export function sendWebSocketMessage(ws, type, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }))
  } else {
    console.warn('WebSocket is not open. Message not sent:', type)
  }
}

