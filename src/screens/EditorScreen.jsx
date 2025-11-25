import React, { useState, useContext, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { StreamContext } from '../context/StreamContext'
import { createWebSocketConnection, sendWebSocketMessage, reconnectWebSocket } from '../utils/websocket'
import { validateInput } from '../utils/validation'
import { loadSavedButtons, saveButtons } from '../utils/storage'
import Notification from '../components/Notification'
import './EditorScreen.css'

const DEFAULT_PANEL_WIDTH = 420
const MIN_PANEL_WIDTH = 360
const MAX_PANEL_WIDTH = 640

function EditorScreen() {
  const navigate = useNavigate()
  const { setStreamUrl, setOverlayText } = useContext(StreamContext)
  const [ip, setIp] = useState('')
  const [directorateName, setDirectorateName] = useState('')
  const [savedButtons, setSavedButtons] = useState([])
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [notification, setNotification] = useState(null)
  const [buttonStatus, setButtonStatus] = useState({}) // Track connection status: { buttonId: 'connected' | 'disconnected' }
  const [editingButton, setEditingButton] = useState(null) // Track which button is being edited: { id, name, url, ip }
  const [editIp, setEditIp] = useState('')
  const [editName, setEditName] = useState('')
  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = localStorage.getItem('editor-panel-width')
    return stored ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, parseInt(stored, 10))) : DEFAULT_PANEL_WIDTH
  })
  const resizeStateRef = useRef(null)
  const panelWidthRef = useRef(panelWidth)

  const getStreamLabel = useCallback((button) => {
    if (!button) return ''
    if (button.ip) return button.ip
    if (!button.url) return ''
    const withoutProtocol = button.url.replace(/^rtsp:\/\//i, '')
    const hostPart = withoutProtocol.split('/')[0] || ''
    return hostPart.split(':')[0] || hostPart
  }, [])

  useEffect(() => {
    panelWidthRef.current = panelWidth
  }, [panelWidth])

  // Check if IP is reachable (ping equivalent using TCP connection)
  const checkStreamConnection = async (rtspUrl) => {
    try {
      // Extract IP from RTSP URL (rtsp://IP:PORT/path)
      const urlMatch = rtspUrl.match(/rtsp:\/\/([^:]+):(\d+)/)
      if (!urlMatch) return false
      
      const ip = urlMatch[1]
      const port = urlMatch[2] || '8000'
      
      // Use the ping endpoint on the conversion server to check if IP is reachable
      const controller = new AbortController()
      const timeout = setTimeout(() => {
        controller.abort()
      }, 4000) // 4 second timeout
      
      try {
        const response = await fetch(
          `http://${window.location.hostname}:8092/ping?ip=${encodeURIComponent(ip)}&port=${encodeURIComponent(port)}`,
          {
            method: 'GET',
            signal: controller.signal
          }
        )
        
        clearTimeout(timeout)
        
        if (!response.ok) {
          return false
        }
        
        const data = await response.json()
        return data.reachable === true
      } catch (error) {
        clearTimeout(timeout)
        console.error('Error pinging IP:', ip, error)
        return false
      }
    } catch (error) {
      console.error('Error checking stream connection:', error)
      return false
    }
  }

  // Check connection status for all buttons
  const checkAllButtonConnections = async () => {
    if (savedButtons.length === 0) return
    
    const statusUpdates = {}
    
    // Check each button sequentially to avoid overwhelming the server
    for (const button of savedButtons) {
      try {
        const isConnected = await checkStreamConnection(button.url)
        const newStatus = isConnected ? 'connected' : 'disconnected'
        statusUpdates[button.id] = newStatus
        
        // Update status immediately for this button
        setButtonStatus(prev => ({ ...prev, [button.id]: newStatus }))
        
        // Small delay between checks to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        console.error(`Error checking connection for button ${button.id}:`, error)
        statusUpdates[button.id] = 'disconnected'
        setButtonStatus(prev => ({ ...prev, [button.id]: 'disconnected' }))
      }
    }
  }

  // Load saved buttons from localStorage on mount (as fallback)
  useEffect(() => {
    const loaded = loadSavedButtons()
    if (loaded && loaded.length > 0) {
      console.log('Loaded buttons from localStorage:', loaded)
      setSavedButtons(loaded)
      // Initialize all buttons as disconnected until a check runs
      const initialStatus = {}
      loaded.forEach(button => {
        initialStatus[button.id] = 'disconnected'
      })
      setButtonStatus(initialStatus)
      // Also try to sync with server if connected
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        sendWebSocketMessage(wsRef.current, 'requestButtons', {})
      }
    }
  }, [])

  // Check button connections periodically and when buttons change
  useEffect(() => {
    if (savedButtons.length === 0) return
    
    // Initial check
    checkAllButtonConnections()
    
    // Check every 30 seconds
    const interval = setInterval(() => {
      checkAllButtonConnections()
    }, 30000)
    
    return () => clearInterval(interval)
  }, [savedButtons])

  // Save buttons to localStorage whenever they change (but avoid infinite loops)
  useEffect(() => {
    // Only save if buttons actually changed (not from WebSocket sync)
    // This prevents overwriting with stale data
    if (savedButtons.length > 0) {
      const stored = loadSavedButtons()
      // Only update if different (to avoid unnecessary writes)
      if (JSON.stringify(stored) !== JSON.stringify(savedButtons)) {
        saveButtons(savedButtons)
      }
    } else {
      // Clear if empty
      try {
        const stored = loadSavedButtons()
        if (stored && stored.length > 0) {
          localStorage.removeItem('van-system-saved-buttons')
        }
      } catch (error) {
        console.error('Error clearing storage:', error)
      }
    }
  }, [savedButtons])

  const showNotification = (message, type = 'error') => {
    setNotification({ message, type })
  }

  const handleSaveButton = () => {
    const validation = validateInput(ip, directorateName)
    
    if (!validation.isValid) {
      showNotification(validation.errors.join('. '), 'error')
      return
    }

    const trimmedIp = ip.trim()
    const trimmedName = directorateName.trim()
    const rtspUrl = `rtsp://${trimmedIp}:8000/media/video2`
    const newButton = {
      id: Date.now(),
      name: trimmedName,
      url: rtspUrl,
      ip: trimmedIp
    }

    // Update local state immediately
    const updatedButtons = [...savedButtons, newButton]
    setSavedButtons(updatedButtons)
    setButtonStatus(prev => ({ ...prev, [newButton.id]: 'disconnected' }))
    setIp('')
    setDirectorateName('')
    
    // Broadcast to all other Editor Screens via WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWebSocketMessage(wsRef.current, 'buttonCreate', {
        button: newButton
      })
      console.log('Button creation broadcasted:', newButton)
      showNotification('Button saved and synchronized!', 'success')
    } else {
      console.warn('WebSocket not connected, button saved locally only')
      showNotification('Button saved locally (not connected to server)', 'info')
      // Try to send when connection is ready
      const checkConnection = setInterval(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          sendWebSocketMessage(wsRef.current, 'buttonCreate', {
            button: newButton
          })
          console.log('Button creation broadcasted after reconnection:', newButton)
          clearInterval(checkConnection)
        }
      }, 1000)
      // Clear interval after 10 seconds
      setTimeout(() => clearInterval(checkConnection), 10000)
    }
  }

  // Initialize WebSocket connection with reconnection
  useEffect(() => {
    const handleMessage = (data) => {
      console.log('Received WebSocket message:', data.type, data)
      
      // Handle button synchronization
      if (data.type === 'buttonCreated') {
        // Another user created a button - use server's button list
        console.log('Button created by another user, updating buttons:', data.allButtons)
        if (data.allButtons && Array.isArray(data.allButtons)) {
          setSavedButtons(data.allButtons)
          saveButtons(data.allButtons)
        }
      } else if (data.type === 'buttonDeleted') {
        // Another user deleted a button - use server's button list
        console.log('Button deleted by another user, updating buttons:', data.allButtons)
        if (data.allButtons && Array.isArray(data.allButtons)) {
          setSavedButtons(data.allButtons)
          if (data.allButtons.length > 0) {
            saveButtons(data.allButtons)
          } else {
            try {
              localStorage.removeItem('van-system-saved-buttons')
            } catch (error) {
              console.error('Error clearing storage:', error)
            }
          }
        }
      } else if (data.type === 'buttonUpdated') {
        // Another user updated a button - use server's button list
        console.log('Button updated by another user, updating buttons:', data.allButtons)
        if (data.allButtons && Array.isArray(data.allButtons)) {
          setSavedButtons(data.allButtons)
          saveButtons(data.allButtons)
          // Cancel editing if we're editing the same button
          if (editingButton && editingButton.id === data.buttonId) {
            setEditingButton(null)
            setEditIp('')
            setEditName('')
          }
        }
      } else if (data.type === 'buttonsSync') {
        // Received full button list (on connection or request)
        console.log('Received button sync from server:', data.buttons)
        if (data.buttons && Array.isArray(data.buttons) && data.buttons.length > 0) {
          setSavedButtons(data.buttons)
          saveButtons(data.buttons)
        } else if (data.buttons && Array.isArray(data.buttons) && data.buttons.length === 0) {
          // Empty array - clear buttons
          setSavedButtons([])
          try {
            localStorage.removeItem('van-system-saved-buttons')
          } catch (error) {
            console.error('Error clearing storage:', error)
          }
        }
      } else if (data.type === 'connected') {
        // Initial connection with buttons
        console.log('Connected to server, received buttons:', data.buttons)
        if (data.buttons && Array.isArray(data.buttons) && data.buttons.length > 0) {
          setSavedButtons(data.buttons)
          saveButtons(data.buttons)
        } else if (data.buttons && Array.isArray(data.buttons) && data.buttons.length === 0) {
          // Server has no buttons - keep local buttons but sync will happen
          console.log('Server has no buttons, keeping local buttons')
        }
      }
    }

    const handleError = (error) => {
      console.error('WebSocket error:', error)
      setWsConnected(false)
    }

    const handleOpen = () => {
      setWsConnected(true)
      console.log('WebSocket connected successfully, requesting buttons...')
      // Request current buttons from server when connected
      // Use a small delay to ensure connection is fully established
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          sendWebSocketMessage(wsRef.current, 'requestButtons', {})
          console.log('Button request sent to server')
        } else {
          console.warn('WebSocket not ready when trying to request buttons')
        }
      }, 500)
    }

    const handleClose = (event) => {
      setWsConnected(false)
      // Only reconnect if not a normal closure
      if (event.code !== 1000 && reconnectRef.current) {
        reconnectRef.current.attempt()
      }
    }

    // Set up reconnection handler first
    reconnectRef.current = reconnectWebSocket(
      wsRef,
      (data) => {
        handleMessage(data)
      },
      handleError,
      () => {
        setWsConnected(true)
        console.log('WebSocket reconnected, requesting buttons...')
        // Request buttons on reconnection
        setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            sendWebSocketMessage(wsRef.current, 'requestButtons', {})
            console.log('Button request sent after reconnection')
          }
        }, 500)
      }
    )

    // Initial connection
    wsRef.current = createWebSocketConnection(
      handleMessage,
      handleError,
      handleOpen,
      handleClose
    )

    return () => {
      if (reconnectRef.current) {
        reconnectRef.current.cancel()
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting')
      }
    }
  }, [])

  const handleButtonClick = (button) => {
    setStreamUrl(button.url)
    setOverlayText(button.name)
    
    // Broadcast to all connected Preview screens (don't navigate)
    sendWebSocketMessage(wsRef.current, 'streamUpdate', {
      streamUrl: button.url,
      overlayText: button.name
    })
    
    showNotification(`Stream "${button.name}" sent to Preview Screen`, 'success')
  }

  const handleOpenPreviewInNewTab = () => {
    // Get the current URL and navigate to preview screen
    const baseUrl = window.location.origin
    const currentPath = window.location.pathname
    // Remove /editor and add /preview
    const previewPath = currentPath.replace(/\/editor.*$/, '/preview')
    const previewUrl = baseUrl + previewPath
    window.open(previewUrl, '_blank')
    showNotification('Opening Preview Screen in new tab...', 'info')
  }

  const handleNavigateToUserScreen = () => {
    navigate('/user')
  }

  const handleEditButton = (button, e) => {
    e.stopPropagation()
    setEditingButton(button)
    setEditIp(button.ip || '')
    setEditName(button.name || '')
  }

  const handleSaveEdit = () => {
    if (!editingButton) return

    const validation = validateInput(editIp, editName)
    
    if (!validation.isValid) {
      showNotification(validation.errors.join('. '), 'error')
      return
    }

    const trimmedIp = editIp.trim()
    const trimmedName = editName.trim()
    const rtspUrl = `rtsp://${trimmedIp}:8000/media/video2`
    
    const updatedButtons = savedButtons.map(btn => 
      btn.id === editingButton.id 
        ? { ...btn, name: trimmedName, url: rtspUrl, ip: trimmedIp }
        : btn
    )
    
    setSavedButtons(updatedButtons)
    setButtonStatus(prev => ({ ...prev, [editingButton.id]: 'disconnected' }))
    saveButtons(updatedButtons)
    
    // Broadcast update to all Editor Screens
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWebSocketMessage(wsRef.current, 'buttonUpdate', {
        buttonId: editingButton.id,
        button: { id: editingButton.id, name: trimmedName, url: rtspUrl, ip: trimmedIp }
      })
    }
    
    setEditingButton(null)
    setEditIp('')
    setEditName('')
    showNotification('Button updated successfully!', 'success')
    
    // Recheck connection status for updated button
    setTimeout(() => {
      checkAllButtonConnections()
    }, 1000)
  }

  const handleCancelEdit = () => {
    setEditingButton(null)
    setEditIp('')
    setEditName('')
  }

  const handleDeleteButton = (id, e) => {
    e.stopPropagation()
    const updated = savedButtons.filter(btn => btn.id !== id)
    setSavedButtons(updated)
    
    if (updated.length === 0) {
      // Clear localStorage if no buttons left
      try {
        localStorage.removeItem('van-system-saved-buttons')
      } catch (error) {
        console.error('Error clearing storage:', error)
      }
    } else {
      saveButtons(updated)
    }
    
    // Broadcast deletion to all other Editor Screens via WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWebSocketMessage(wsRef.current, 'buttonDelete', {
        buttonId: id
      })
      console.log('Button deletion broadcasted:', id)
      showNotification('Button deleted and synchronized!', 'success')
    } else {
      console.warn('WebSocket not connected, button deleted locally only')
      showNotification('Button deleted locally (not connected to server)', 'info')
    }
  }

  const startPanelResize = (event) => {
    const clientX = event.type === 'touchstart' ? event.touches[0].clientX : event.clientX
    resizeStateRef.current = { startX: clientX, startWidth: panelWidth }
    document.addEventListener('mousemove', handlePanelResize)
    document.addEventListener('mouseup', stopPanelResize)
    document.addEventListener('touchmove', handlePanelResize, { passive: false })
    document.addEventListener('touchend', stopPanelResize)
  }

  const handlePanelResize = (event) => {
    if (!resizeStateRef.current) return
    event.preventDefault()
    const clientX = event.type === 'touchmove' ? event.touches[0].clientX : event.clientX
    const delta = clientX - resizeStateRef.current.startX
    const nextWidth = Math.min(
      MAX_PANEL_WIDTH,
      Math.max(MIN_PANEL_WIDTH, resizeStateRef.current.startWidth + delta)
    )
    setPanelWidth(nextWidth)
  }

  const stopPanelResize = () => {
    if (!resizeStateRef.current) return
    localStorage.setItem('editor-panel-width', String(Math.round(panelWidthRef.current)))
    resizeStateRef.current = null
    document.removeEventListener('mousemove', handlePanelResize)
    document.removeEventListener('mouseup', stopPanelResize)
    document.removeEventListener('touchmove', handlePanelResize)
    document.removeEventListener('touchend', stopPanelResize)
  }

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handlePanelResize)
      document.removeEventListener('mouseup', stopPanelResize)
      document.removeEventListener('touchmove', handlePanelResize)
      document.removeEventListener('touchend', stopPanelResize)
    }
  }, [])

  return (
    <div className="editor-screen">
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}
      <div
        className="editor-layout"
        style={{ gridTemplateColumns: `${Math.round(panelWidth)}px minmax(0, 1fr)` }}
      >
        <div
          className="editor-panel-wrapper"
          style={{ width: `${panelWidth}px`, minWidth: `${MIN_PANEL_WIDTH}px` }}
        >
          <aside className="editor-left-panel">
            <div className="editor-panel-header">
              <div>
                <h2>Saved Streams</h2>
                <p>Click a button to send it to the preview screen</p>
              </div>
              <span className={`connection-status ${wsConnected ? 'connected' : 'disconnected'}`}>
                <span className="status-dot"></span>
                {wsConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="editor-panel-buttons">
              {savedButtons.length === 0 ? (
                <p className="editor-empty">No buttons saved yet. Create one on the right.</p>
              ) : (
                savedButtons.map((button) => {
                  const status = buttonStatus[button.id] || 'disconnected'
                  const isEditing = editingButton && editingButton.id === button.id
                  const streamLabel = getStreamLabel(button)
                  return (
                    <div
                      key={button.id}
                      className={`editor-panel-button status-${status} ${isEditing ? 'editing' : ''}`}
                    >
                      {isEditing ? (
                        <div className="editor-panel-edit-form">
                          <div className="editor-panel-input">
                            <label htmlFor={`edit-ip-${button.id}`}>IP Address</label>
                            <input
                              id={`edit-ip-${button.id}`}
                              type="text"
                              value={editIp}
                              onChange={(e) => setEditIp(e.target.value)}
                              className="input-field"
                              placeholder="Enter IP address"
                            />
                          </div>
                          <div className="editor-panel-input">
                            <label htmlFor={`edit-name-${button.id}`}>اسم المديرية (Directorate Name)</label>
                            <input
                              id={`edit-name-${button.id}`}
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="input-field"
                              placeholder="Enter Directorate name"
                            />
                          </div>
                          <div className="edit-actions">
                            <button onClick={handleSaveEdit} className="save-edit-button">
                              Save
                            </button>
                            <button onClick={handleCancelEdit} className="cancel-edit-button">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            className="editor-panel-button-content"
                            role="button"
                            tabIndex={0}
                            onClick={() => handleButtonClick(button)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                handleButtonClick(button)
                              }
                            }}
                          >
                            <div className="editor-panel-button-header">
                              <div className="editor-panel-name-group">
                                <span className="editor-panel-name">{button.name}</span>
                                {streamLabel && (
                                  <span className="editor-panel-ip">{streamLabel}</span>
                                )}
                              </div>
                              <div className="editor-panel-status">
                                <span className={`status-dot status-dot-${status}`}></span>
                                <span className="status-text">
                                  {status === 'connected' ? 'Connected' : 'Disconnected'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="editor-panel-button-actions">
                            <button
                              className="icon-button"
                              onClick={(e) => handleEditButton(button, e)}
                              title="Edit IP and name"
                            >
                              ✏️
                            </button>
                            <button
                              className="icon-button danger"
                              onClick={(e) => handleDeleteButton(button.id, e)}
                              title="Delete button"
                            >
                              ×
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </aside>
          <div
            className="editor-panel-resize-handle"
            onMouseDown={startPanelResize}
            onTouchStart={startPanelResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize saved streams panel"
          />
        </div>

        <main className="editor-main">
      <div className="editor-container">
        <div className="header-section">
          <h1 className="editor-title">Editor Screen</h1>
          <div className="header-buttons">
            <button 
              onClick={handleNavigateToUserScreen}
              className="preview-button"
              title="Navigate to User Screen"
            >
              👥 Go to User Screen
            </button>
            <button 
              onClick={handleOpenPreviewInNewTab}
              className="preview-button"
              title="Open Preview Screen in new tab"
            >
              📺 Go to Preview Screen
            </button>
          </div>
        </div>
        
        <div className="input-section">
          <div className="input-group">
            <label htmlFor="ip-input">IP Address</label>
            <input
              id="ip-input"
              type="text"
              placeholder="Enter IP address (e.g., 192.168.1.100)"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="input-group">
            <label htmlFor="directorate-input">اسم المديرية (Directorate Name)</label>
            <input
              id="directorate-input"
              type="text"
              placeholder="Enter Directorate name"
              value={directorateName}
              onChange={(e) => setDirectorateName(e.target.value)}
              className="input-field"
            />
          </div>

          <button onClick={handleSaveButton} className="save-button">
            Save Button
          </button>
        </div>

            <div className="editor-help-card">
              <p>Saved buttons now live in the left panel. Select any entry to broadcast it instantly, or use the ✏️ / × icons to edit or delete.</p>
                        </div>
                      </div>
        </main>
      </div>
    </div>
  )
}

export default EditorScreen

