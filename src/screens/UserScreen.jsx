import React, { useState, useEffect, useRef, useContext, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Hls from 'hls.js'
import Notification from '../components/Notification'
import GridVideoPlayer from '../components/GridVideoPlayer'
import { StreamContext } from '../context/StreamContext'
import { loadSavedButtons, saveButtons } from '../utils/storage'
import { createWebSocketConnection, reconnectWebSocket, sendWebSocketMessage } from '../utils/websocket'
import { detectStreamType, getPlayableUrl } from '../utils/streamConverter'
import policeLogo from '../assets/police-logo.png'
import './UserScreen.css'
import './PreviewScreen.css'

function UserScreen() {
  console.log('UserScreen component rendering')
  const navigate = useNavigate()
  const { streamUrl: contextStreamUrl, overlayText: contextOverlayText, setStreamUrl, setOverlayText } = useContext(StreamContext)
  const [savedButtons, setSavedButtons] = useState([])
  const [buttonStatus, setButtonStatus] = useState({})
  const [selectedButtonId, setSelectedButtonId] = useState(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [notification, setNotification] = useState(null)
  const PANEL_WIDTH = 320
  const [isPanelVisible, setIsPanelVisible] = useState(true)
  const panelRef = useRef(null)
  const savedButtonsRef = useRef([])
  const currentStreamUrlRef = useRef(contextStreamUrl)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  
  // Grid layout state
  const [gridX, setGridX] = useState(1)
  const [gridY, setGridY] = useState(1)
  const [gridStreams, setGridStreams] = useState({}) // { cellId: { streamUrl, overlayText, buttonId } }
  const gridStreamsRef = useRef({})
  const [draggedButton, setDraggedButton] = useState(null)

  // Keep ref in sync with state
  useEffect(() => {
    gridStreamsRef.current = gridStreams
  }, [gridStreams])

  // Video/player state (borrowed from Preview screen)
  const videoRef = useRef(null)
  const [currentStreamUrl, setCurrentStreamUrl] = useState(contextStreamUrl)
  const [currentOverlayText, setCurrentOverlayText] = useState(contextOverlayText)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [streamInfo, setStreamInfo] = useState(null)
  const [playableUrl, setPlayableUrl] = useState(null)
  const retryTimeoutRef = useRef(null)
  const retryCountRef = useRef(0)
  const maxRetries = Infinity // Keep retrying indefinitely until stream changes (like PreviewScreen)
  const retryDelay = 800 // quicker retries to mimic VLC responsiveness
  const hlsRef = useRef(null)
  const lastFrameRef = useRef(null)
  const frameCaptureIntervalRef = useRef(null)
  const canvasRef = useRef(null)
  const currentPlayingUrlRef = useRef(null)
  const isStreamPlayingRef = useRef(false)
  const isSwitchingStreamRef = useRef(false)
  const scheduleRetryRef = useRef(null) // Ref to store scheduleRetry function to avoid circular dependency
  const reloadStreamRef = useRef(null) // Ref to store reloadStream function to avoid circular dependency
  const STATUS_CHECK_INTERVAL_MS = 60000
  const STREAM_HEALTH_CHECK_INTERVAL_MS = 60000

  const getStreamLabel = useCallback((button) => {
    if (!button) return ''
    if (button.ip) return button.ip
    if (!button.url) return ''
    const withoutProtocol = button.url.replace(/^rtsp:\/\//i, '')
    const hostPart = withoutProtocol.split('/')[0] || ''
    return hostPart.split(':')[0] || hostPart
  }, [])

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 4000)
  }

  const stopCurrentStream = useCallback(() => {
    console.log('Stopping current stream...')
    isStreamPlayingRef.current = false

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    if (frameCaptureIntervalRef.current) {
      clearInterval(frameCaptureIntervalRef.current)
      frameCaptureIntervalRef.current = null
    }

    if (hlsRef.current) {
      try {
        if (hlsRef.current.fragmentStallTimer) {
          clearTimeout(hlsRef.current.fragmentStallTimer)
        }
        if (hlsRef.current.releaseAutoLevelTimeout) {
          clearTimeout(hlsRef.current.releaseAutoLevelTimeout)
        }
        if (hlsRef.current.latencyMonitorInterval) {
          clearInterval(hlsRef.current.latencyMonitorInterval)
        }
        hlsRef.current.destroy()
      } catch (error) {
        console.error('Error destroying HLS:', error)
      }
      hlsRef.current = null
    }

    const video = videoRef.current
    if (video) {
      try {
        video.pause()
        video.src = ''
        video.load()
      } catch (error) {
        console.error('Error stopping video:', error)
      }
    }

    console.log('Stream stopped')
  }, [])

  const cleanupStreamResources = useCallback(() => {
    stopCurrentStream()
    currentPlayingUrlRef.current = null
    setPlayableUrl(null)
    retryCountRef.current = 0
    lastFrameRef.current = null
  }, [stopCurrentStream])

  const applyStreamUpdate = useCallback((streamData, origin = 'server') => {
    if (!streamData || !streamData.streamUrl) return

    const isSameStream = currentStreamUrlRef.current === streamData.streamUrl
    if (isSameStream && !isSwitchingStreamRef.current) {
      console.log(`Stream update (${origin}) matches current stream, updating overlay only.`)
      setCurrentOverlayText(streamData.overlayText || '')
      setOverlayText(streamData.overlayText || '')
      return
    }

    console.log(`Applying stream update (${origin})`, streamData.streamUrl)
    cleanupStreamResources()

    currentStreamUrlRef.current = streamData.streamUrl
    setCurrentStreamUrl(streamData.streamUrl)
    setCurrentOverlayText(streamData.overlayText || '')
    setStreamUrl(streamData.streamUrl)
    setOverlayText(streamData.overlayText || '')
    setIsLoading(true)
    setHasError(false)
    isSwitchingStreamRef.current = false
  }, [cleanupStreamResources, setOverlayText, setStreamUrl])

  const requestLatestStream = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWebSocketMessage(wsRef.current, 'requestCurrentStream', {})
    }
  }, [])

  const checkStreamConnection = useCallback(async (rtspUrl) => {
    try {
      const urlMatch = rtspUrl.match(/rtsp:\/\/([^:\/]+)(?::(\d+))?/)
      if (!urlMatch) {
        console.warn('Invalid RTSP URL format:', rtspUrl)
        return false
      }

      const ip = urlMatch[1]
      const port = urlMatch[2] || '8000'

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000) // Increased timeout

      try {
        const pingUrl = `http://${window.location.hostname}:8092/ping?ip=${encodeURIComponent(ip)}&port=${encodeURIComponent(port)}`
        console.log('Checking connection:', pingUrl)
        
        const response = await fetch(pingUrl, {
          method: 'GET',
          signal: controller.signal
        })

        clearTimeout(timeout)
        
        if (!response.ok) {
          console.warn('Ping response not OK:', response.status, response.statusText)
          return false
        }
        
        const data = await response.json()
        console.log('Ping response for', ip, ':', data)
        
        const isReachable = data.reachable === true
        return isReachable
      } catch (error) {
        clearTimeout(timeout)
        if (error.name === 'AbortError') {
          console.warn('Ping timeout for IP:', ip)
        } else {
          console.error('Error pinging IP:', ip, error)
        }
        return false
      }
    } catch (error) {
      console.error('Error checking stream connection:', error)
      return false
    }
  }, [])

  useEffect(() => {
    savedButtonsRef.current = savedButtons
  }, [savedButtons])

  useEffect(() => {
    currentStreamUrlRef.current = currentStreamUrl
  }, [currentStreamUrl])

  const performConnectionCheck = useCallback(async (buttonsToCheck) => {
    const targetButtons = buttonsToCheck || savedButtonsRef.current
    if (!targetButtons || targetButtons.length === 0) {
      console.log('No buttons to check')
      return
    }
    
    console.log('Starting connection check for', targetButtons.length, 'buttons')
    
    // Check each button sequentially
    for (const button of targetButtons) {
      try {
        console.log('Checking button:', button.name, button.url)
        const isConnected = await checkStreamConnection(button.url)
        const newStatus = isConnected ? 'connected' : 'disconnected'
        console.log('Button', button.name, 'status:', newStatus)
        
        // Update status immediately
        setButtonStatus(prev => ({ ...prev, [button.id]: newStatus }))
        
        // Small delay between checks to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        console.error(`Error checking connection for button ${button.id} (${button.name}):`, error)
        // Set to disconnected on error
        setButtonStatus(prev => ({ ...prev, [button.id]: 'disconnected' }))
      }
    }
    
    console.log('Connection check completed')
  }, [checkStreamConnection])

  useEffect(() => {
    const loaded = loadSavedButtons()
    if (loaded && loaded.length > 0) {
      setSavedButtons(loaded)
      setButtonStatus(prev => {
        const nextStatus = { ...prev }
        loaded.forEach(button => {
          if (!nextStatus[button.id]) {
            nextStatus[button.id] = 'disconnected'
          }
        })
        return nextStatus
      })
      performConnectionCheck(loaded)
    }
  }, [performConnectionCheck])

  useEffect(() => {
    if (savedButtons.length === 0) return
    
    // Initial check
    performConnectionCheck()
    
    // Periodic checks every 30 seconds
    const interval = setInterval(() => {
      console.log('Periodic connection check triggered')
      performConnectionCheck()
    }, STATUS_CHECK_INTERVAL_MS)
    
    return () => clearInterval(interval)
  }, [performConnectionCheck, savedButtons, STATUS_CHECK_INTERVAL_MS])

  const handleStreamLaunch = (button) => {
    // Only change stream if it's a different button
    if (selectedButtonId === button.id && currentPlayingUrlRef.current === button.url && isStreamPlayingRef.current) {
      console.log('Same button clicked and stream is playing, keeping current stream')
      return
    }
    
    console.log('Launching stream for button:', button.name, button.url)
    
    // Stop and fully clean up previous stream before switching
    console.log('Cleaning up current stream before switching')
    isSwitchingStreamRef.current = true
    cleanupStreamResources()
    isSwitchingStreamRef.current = false
    
    setSelectedButtonId(button.id)
    setCurrentStreamUrl(button.url)
    setCurrentOverlayText(button.name)
    setStreamUrl(button.url)
    setOverlayText(button.name)
    setIsLoading(true)
    setHasError(false)
    isStreamPlayingRef.current = false
    currentPlayingUrlRef.current = null // Reset to allow new stream to load

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWebSocketMessage(wsRef.current, 'streamUpdate', {
        streamUrl: button.url,
        overlayText: button.name
      })
    }

    showNotification(`Launching stream "${button.name}"`, 'success')
  }

  // Drag and drop handlers
  const handleDragStart = (e, button) => {
    console.log('Drag start:', button.name, button.id)
    setDraggedButton(button)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', button.id)
    e.dataTransfer.setData('application/json', JSON.stringify(button))
    e.currentTarget.style.opacity = '0.5'
  }

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1'
    setDraggedButton(null)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    e.currentTarget.classList.add('drag-over')
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    // Only remove class if we're leaving the cell itself, not a child
    if (e.currentTarget === e.target) {
      e.currentTarget.classList.remove('drag-over')
    }
  }

  const handleDrop = (e, cellId) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.classList.remove('drag-over')
    
    console.log('Drop event on cell:', cellId)
    
    // Try to get button data from dataTransfer
    let buttonId = e.dataTransfer.getData('text/plain')
    let button = null
    
    // If text/plain didn't work, try JSON
    if (!buttonId) {
      try {
        const buttonData = e.dataTransfer.getData('application/json')
        if (buttonData) {
          button = JSON.parse(buttonData)
          buttonId = button.id
        }
      } catch (err) {
        console.error('Error parsing drag data:', err)
      }
    }
    
    // Fallback to state if dataTransfer didn't work
    if (!button && draggedButton) {
      button = draggedButton
      buttonId = button.id
    }
    
    // Last resort: find by ID from savedButtons
    if (!button && buttonId) {
      button = savedButtons.find(b => b.id === buttonId)
    }
    
    if (!button) {
      console.error('Could not find button data for drop')
      return
    }

    console.log('Adding stream to cell:', cellId, button.name, button.url)

    setGridStreams(prev => ({
      ...prev,
      [cellId]: {
        streamUrl: button.url,
        overlayText: button.name,
        buttonId: button.id
      }
    }))

    showNotification(`Stream "${button.name}" added to grid cell`, 'success')
    setDraggedButton(null)
  }

  const handleClearCell = (cellId) => {
    setGridStreams(prev => {
      const updated = { ...prev }
      delete updated[cellId]
      return updated
    })
    showNotification('Cell cleared', 'info')
  }

  // Generate grid cells
  const generateGridCells = () => {
    const cells = []
    const totalCells = gridX * gridY
    
    for (let i = 0; i < totalCells; i++) {
      const cellId = `cell-${i}`
      const cellData = gridStreams[cellId] || null
      cells.push({ id: cellId, data: cellData })
    }
    
    return cells
  }

  useEffect(() => {
    const handleMessage = (data, origin = 'server') => {
      if (!data || !data.type) return

      if (data.type === 'buttonCreated' || data.type === 'buttonDeleted' || data.type === 'buttonUpdated' || data.type === 'buttonsSync' || data.type === 'connected') {
        const incomingButtons = data.allButtons || data.buttons
        if (incomingButtons && Array.isArray(incomingButtons)) {
          // If a button was updated, update any grid cells using that button
          if (data.type === 'buttonUpdated' && data.buttonId) {
            const updatedButton = incomingButtons.find(b => b.id === data.buttonId)
            if (updatedButton) {
              // Check if any grid cells are using this button
              const currentGridStreams = gridStreamsRef.current
              let hasUpdates = false
              Object.keys(currentGridStreams).forEach(cellId => {
                if (currentGridStreams[cellId] && currentGridStreams[cellId].buttonId === data.buttonId) {
                  hasUpdates = true
                }
              })
              
              if (hasUpdates) {
                setGridStreams(prev => {
                  const updated = { ...prev }
                  Object.keys(updated).forEach(cellId => {
                    if (updated[cellId] && updated[cellId].buttonId === data.buttonId) {
                      updated[cellId] = {
                        streamUrl: updatedButton.url,
                        overlayText: updatedButton.name,
                        buttonId: updatedButton.id
                      }
                    }
                  })
                  return updated
                })
                showNotification(`Stream "${updatedButton.name}" updated in grid`, 'info')
              }
            }
          }
          
          setSavedButtons(incomingButtons)
          if (incomingButtons.length > 0) {
            saveButtons(incomingButtons)
            performConnectionCheck(incomingButtons)
          } else {
            try {
              localStorage.removeItem('van-system-saved-buttons')
            } catch (error) {
              console.error('Error clearing storage:', error)
            }
          }
        }
        if (data.type === 'connected' && data.currentStream) {
          applyStreamUpdate(data.currentStream, 'initial-state')
        }
      }

      if (data.type === 'streamUpdate') {
        applyStreamUpdate(data, origin)
      }

      if (data.type === 'currentStream') {
        applyStreamUpdate(data, 'current-state')
      }
    }

    const handleError = (error) => {
      console.error('User page WebSocket error:', error)
      setWsConnected(false)
    }

    const handleOpen = () => {
      setWsConnected(true)
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          sendWebSocketMessage(wsRef.current, 'requestButtons', {})
          requestLatestStream()
        }
      }, 500)
    }

    const handleClose = (event) => {
      setWsConnected(false)
      if (event.code !== 1000 && reconnectRef.current) {
        reconnectRef.current.attempt()
      }
    }

    reconnectRef.current = reconnectWebSocket(
      wsRef,
      (data) => handleMessage(data, 'reconnect'),
      handleError,
      () => {
        setWsConnected(true)
        setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            sendWebSocketMessage(wsRef.current, 'requestButtons', {})
            requestLatestStream()
          }
        }, 500)
      }
    )

    wsRef.current = createWebSocketConnection(
      (data) => handleMessage(data, 'primary'),
      handleError,
      handleOpen,
      handleClose
    )

    return () => {
      if (reconnectRef.current) {
        reconnectRef.current.cancel()
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'User page unmounting')
      }
    }
  }, [applyStreamUpdate, performConnectionCheck, requestLatestStream, setOverlayText, setStreamUrl])

  const ensureLiveEdge = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.seekable || video.seekable.length === 0) {
      return
    }
    try {
      const liveEdge = video.seekable.end(video.seekable.length - 1)
      const drift = liveEdge - video.currentTime
      if (Number.isFinite(drift) && drift > 2.5) {
        console.warn(`User view drifted ${drift.toFixed(2)}s behind live edge, skipping ahead`)
        const target = Math.max(video.seekable.start(video.seekable.length - 1), liveEdge - 0.3)
        if (Number.isFinite(target)) {
          video.currentTime = target
        }
      }
    } catch (error) {
      console.warn('Unable to snap playback to live edge:', error)
    }
  }, [])

  // Capture last frame from video (like PreviewScreen)
  const captureLastFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return // Need at least HAVE_CURRENT_DATA
    
    try {
      // Create canvas if it doesn't exist
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas')
        canvasRef.current.width = video.videoWidth || 1920
        canvasRef.current.height = video.videoHeight || 1080
      }
      
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      
      // Update canvas size if video size changed
      if (video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      
      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      
      // Convert to data URL and cache it
      lastFrameRef.current = canvas.toDataURL('image/jpeg', 0.9)
      console.log('Last frame captured and cached')
    } catch (error) {
      console.error('Error capturing frame:', error)
    }
  }, [])

  // Schedule retry if stream fails - retry indefinitely until stream starts (like PreviewScreen)
  const scheduleRetry = useCallback(() => {
    // Don't retry if stream is already playing successfully
    if (isStreamPlayingRef.current && videoRef.current && !videoRef.current.paused && videoRef.current.readyState >= 2) {
      console.log('Stream is playing, skipping retry')
      return
    }
    
    // Don't retry if we're switching streams
    if (isSwitchingStreamRef.current) {
      console.log('Stream switching in progress, skipping retry')
      return
    }
    
    // Always retry - no max limit, keep trying until stream starts
    retryCountRef.current++
    console.log(`Scheduling retry in ${retryDelay}ms (attempt ${retryCountRef.current})`)
    
    // Clear any existing retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
    }
    
    retryTimeoutRef.current = setTimeout(() => {
      // Check again if stream is playing or switching
      if (isStreamPlayingRef.current || isSwitchingStreamRef.current) {
        console.log('Stream state changed, cancelling retry')
        return
      }
      
      // Only retry if we have a playable URL and it matches the current stream
      if (playableUrl && videoRef.current && currentPlayingUrlRef.current === playableUrl) {
        console.log(`Attempting to reload stream (attempt ${retryCountRef.current})...`)
        // Use reloadStreamRef to avoid circular dependency
        if (reloadStreamRef.current) {
          reloadStreamRef.current()
        }
      } else if (playableUrl && !currentPlayingUrlRef.current) {
        // If playableUrl exists but currentPlayingUrlRef is null, we need to set it and reload
        console.log(`Setting current playing URL and reloading stream (attempt ${retryCountRef.current})...`)
        currentPlayingUrlRef.current = playableUrl
        if (reloadStreamRef.current) {
          reloadStreamRef.current()
        }
      } else {
        // If no playable URL yet, schedule another retry
        console.log('No playable URL yet, scheduling another retry...')
        if (scheduleRetryRef.current) {
          scheduleRetryRef.current()
        }
      }
    }, retryDelay)
  }, [playableUrl, retryDelay])

  const reloadStream = useCallback(() => {
    if (!playableUrl || !videoRef.current) {
      console.log('No playable URL or video ref, skipping reload')
      return
    }
    
    // Don't reload if we're switching streams
    if (isSwitchingStreamRef.current) {
      console.log('Stream switching in progress, skipping reload')
      return
    }

    console.log('Reloading stream:', playableUrl)
    setIsLoading(true)
    setHasError(false)
    retryCountRef.current = 0
    isStreamPlayingRef.current = false

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    if (hlsRef.current) {
      try {
        if (hlsRef.current.fragmentStallTimer) {
          clearTimeout(hlsRef.current.fragmentStallTimer)
        }
        if (hlsRef.current.releaseAutoLevelTimeout) {
          clearTimeout(hlsRef.current.releaseAutoLevelTimeout)
        }
        if (hlsRef.current.latencyMonitorInterval) {
          clearInterval(hlsRef.current.latencyMonitorInterval)
        }
        hlsRef.current.destroy()
      } catch (error) {
        console.error('Error destroying HLS:', error)
      }
      hlsRef.current = null
    }

    const video = videoRef.current
    const isHLS = playableUrl.includes('.m3u8') || playableUrl.includes('/hls/')
    
    // Use ref to call scheduleRetry to avoid circular dependency
    const retryFn = scheduleRetryRef.current

    if (isHLS && Hls.isSupported()) {
      // Use HLS.js for HLS streams (same config as PreviewScreen)
      console.log('Using HLS.js for HLS stream')
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        maxBufferSize: 25 * 1000 * 1000,
        maxBufferHole: 0.2,
        highBufferWatchdogPeriod: 1,
        nudgeOffset: 0.03,
        nudgeMaxRetry: 5,
        maxFragLoadingTimeOut: 8000,
        fragLoadingTimeOut: 8000,
        manifestLoadingTimeOut: 5000,
        levelLoadingTimeOut: 5000,
        startLevel: 0,
        capLevelToPlayerSize: true,
        capLevelOnFPSDrop: true,
        autoStartLoad: true,
        startPosition: -1,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
        maxLiveSyncPlaybackRate: 1.5,
        progressive: true,
        enableSoftwareAES: false
      })

      hlsRef.current = hls
      hls.loadSource(playableUrl)
      hls.attachMedia(video)

      if (hls.latencyMonitorInterval) {
        clearInterval(hls.latencyMonitorInterval)
      }
      hls.latencyMonitorInterval = setInterval(() => {
        ensureLiveEdge()
        const currentLatency = typeof hls.latency === 'number' ? hls.latency : null
        if (currentLatency && currentLatency > 2.5) {
          console.warn(`Detected ${currentLatency.toFixed(2)}s latency on user screen, nudging live edge`)
          ensureLiveEdge()
          try {
            hls.startLoad()
            video.play().catch(() => {})
          } catch (error) {
            console.warn('Unable to restart HLS load:', error)
            if (retryFn) retryFn()
          }
        }
      }, 4000)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed, starting playback')
        console.log('HLS levels available:', hls.levels?.length || 0)
        if (hls.levels && hls.levels.length > 0) {
          const lowestLevelIndex = 0
          hls.currentLevel = lowestLevelIndex
          hls.loadLevel = lowestLevelIndex
          hls.autoLevelCapping = lowestLevelIndex
          hls.nextAutoLevel = lowestLevelIndex
        }
        hls.releaseAutoLevelTimeout = setTimeout(() => {
          if (hlsRef.current === hls) {
            hls.autoLevelCapping = -1
            hls.nextAutoLevel = -1
          }
        }, 8000)
        // Start playback immediately without waiting (like PreviewScreen)
        video.play().catch(err => {
          console.error('Error playing HLS video:', err)
          setIsLoading(false)
          setHasError(true)
          if (retryFn) retryFn()
        })
      })
      
      let lastFragmentLoadTime = Date.now()
      const FRAGMENT_STALL_TIMEOUT = 15000 // 15 seconds - match PreviewScreen tolerance
      let fragmentStallTimer = null
      
      const resetFragmentStallTimer = () => {
        if (fragmentStallTimer) {
          clearTimeout(fragmentStallTimer)
        }
        lastFragmentLoadTime = Date.now()
        fragmentStallTimer = setTimeout(() => {
          const timeSinceLastFragment = Date.now() - lastFragmentLoadTime
          if (timeSinceLastFragment >= FRAGMENT_STALL_TIMEOUT && hlsRef.current === hls) {
            console.warn(`⚠️ No HLS fragments loaded for ${Math.round(timeSinceLastFragment / 1000)}s, reloading stream...`)
            if (retryFn) retryFn()
          }
        }, FRAGMENT_STALL_TIMEOUT)
      }
      
      // Store timer reference on HLS instance for cleanup
      hls.fragmentStallTimer = fragmentStallTimer
      
      hls.on(Hls.Events.FRAG_LOADED, () => {
        // Capture frame when new fragment loads
        captureLastFrame()
        // Reset stall timer
        resetFragmentStallTimer()
        // Update timer reference
        hls.fragmentStallTimer = fragmentStallTimer
      })
      
      // Start monitoring for fragment stalls
      resetFragmentStallTimer()
      hls.fragmentStallTimer = fragmentStallTimer

      // Start playing as soon as we have enough data (faster startup) - like PreviewScreen
      hls.on(Hls.Events.FRAG_PARSING_DATA, () => {
        if (isLoading && video.readyState >= 2) {
          console.log('HLS stream has enough data, starting playback')
          video.play()
            .then(() => {
              console.log('HLS stream playing successfully')
              setIsLoading(false)
              setHasError(false)
              retryCountRef.current = 0
              isStreamPlayingRef.current = true
              
              // Start capturing frames periodically
              if (frameCaptureIntervalRef.current) {
                clearInterval(frameCaptureIntervalRef.current)
              }
              frameCaptureIntervalRef.current = setInterval(() => {
                captureLastFrame()
              }, 1000) // Capture frame every second
            })
            .catch(err => {
              console.error('Error playing HLS video:', err)
            })
        }
      })
      
      // Also handle when video can play
      video.addEventListener('canplay', () => {
        if (isLoading && !video.paused) {
          console.log('Video can play, marking as loaded')
          setIsLoading(false)
          setHasError(false)
          retryCountRef.current = 0
          isStreamPlayingRef.current = true
          
          // Start capturing frames periodically
          if (frameCaptureIntervalRef.current) {
            clearInterval(frameCaptureIntervalRef.current)
          }
          frameCaptureIntervalRef.current = setInterval(() => {
            captureLastFrame()
          }, 1000)
        }
      }, { once: true })

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data)
        console.error('HLS error details:', {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          url: data.url,
          response: data.response
        })
        
        // Check if it's a 503 error (server not ready) - like PreviewScreen
        if (data.response && data.response.code === 503) {
          console.log('Server returned 503 - playlist not ready yet, will retry...')
          // Don't mark as error yet, just retry after a delay
          setTimeout(() => {
            if (hlsRef.current && playableUrl && currentPlayingUrlRef.current === playableUrl) {
              console.log('Retrying HLS load after 503...')
              try {
                hlsRef.current.loadSource(playableUrl)
              } catch (e) {
                console.error('Error retrying HLS load after 503:', e)
                // If retry fails, schedule a full reload
                if (retryFn) retryFn()
              }
            } else if (playableUrl && currentPlayingUrlRef.current === playableUrl) {
              // HLS instance was destroyed, schedule full reload
              if (retryFn) retryFn()
            }
          }, 2000)
          return
        }
        
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('HLS network error, attempting to recover')
              // If it's a manifest load error with 503, wait longer
              if (data.details === 'manifestLoadError' && data.response?.code === 503) {
                console.log('Manifest not ready (503), waiting longer...')
                setTimeout(() => {
                  if (hlsRef.current && playableUrl && currentPlayingUrlRef.current === playableUrl) {
                    try {
                      hlsRef.current.loadSource(playableUrl)
                    } catch (e) {
                      console.error('Error retrying manifest load after 503:', e)
                      if (retryFn) retryFn()
                    }
                  } else if (playableUrl && currentPlayingUrlRef.current === playableUrl) {
                    // HLS instance was destroyed, schedule full reload
                    if (retryFn) retryFn()
                  }
                }, 3000)
              } else {
                try {
                  hls.startLoad()
                } catch (e) {
                  console.error('Failed to recover from network error:', e)
                  setIsLoading(false)
                  setHasError(true)
                  if (retryFn) retryFn()
                }
              }
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('HLS media error, attempting to recover')
              try {
                hls.recoverMediaError()
              } catch (e) {
                console.error('Failed to recover from media error:', e)
                setIsLoading(false)
                setHasError(true)
                if (retryFn) retryFn()
              }
              break
            default:
              console.error('HLS fatal error, cannot recover')
              setIsLoading(false)
              setHasError(true)
              if (retryFn) retryFn()
              break
          }
        } else {
          // Non-fatal errors, just log
          console.warn('HLS non-fatal error:', data)
        }
      })
    } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playableUrl
      video.load()
      video.play()
        .then(() => {
          setIsLoading(false)
          setHasError(false)
          retryCountRef.current = 0
          isStreamPlayingRef.current = true
          console.log('Native HLS stream started playing successfully')
        })
        .catch(err => {
          console.error('Error playing native HLS:', err)
          setIsLoading(false)
          setHasError(true)
          isStreamPlayingRef.current = false
          if (retryFn) retryFn()
        })
    } else {
      video.src = playableUrl
      video.load()
      const playPromise = video.play()
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsLoading(false)
            setHasError(false)
            retryCountRef.current = 0
            isStreamPlayingRef.current = true
            console.log('Video stream started playing successfully')
          })
          .catch(err => {
            console.error('Error playing video:', err)
            setIsLoading(false)
            setHasError(true)
            isStreamPlayingRef.current = false
            if (retryFn) retryFn()
          })
      }
    }
  }, [captureLastFrame, ensureLiveEdge, isLoading, playableUrl])

  // Set refs to avoid circular dependencies
  useEffect(() => {
    scheduleRetryRef.current = scheduleRetry
    reloadStreamRef.current = reloadStream
  }, [scheduleRetry, reloadStream])

  // Detect stream type and convert if needed (like PreviewScreen)
  useEffect(() => {
    if (!currentStreamUrl) {
      if (!contextStreamUrl) {
        setIsLoading(false)
        setHasError(false)
        setStreamInfo(null)
        setPlayableUrl(null)
        currentPlayingUrlRef.current = null
        return
      }
      setCurrentStreamUrl(contextStreamUrl)
      setCurrentOverlayText(contextOverlayText)
      return
    }

    // Detect stream type
    const info = detectStreamType(currentStreamUrl)
    setStreamInfo(info)
    console.log('Stream info:', info)
    console.log('Original stream URL:', currentStreamUrl)

    // Try to get playable URL (with conversion if needed)
    // Uses local RTSP converter server on port 8092
    const url = getPlayableUrl(currentStreamUrl, {
      preferHLS: true // Use local HLS converter
    })
    console.log('Playable URL:', url)
    
    // Check if conversion server is accessible (for RTSP streams) - like PreviewScreen
    if (info.type === 'rtsp' && url.includes('/hls/')) {
      const converterHost = window.location.hostname
      const healthUrl = `http://${converterHost}:8092/health`
      fetch(healthUrl)
        .then(res => res.json())
        .then(data => {
          console.log('Conversion server health:', data)
          if (!data.ffmpegAvailable) {
            console.error('FFmpeg is not available on the conversion server!')
          }
        })
        .catch(err => {
          console.error('Cannot reach conversion server:', err)
          console.error('Make sure the conversion server is running on port 8092')
        })
    }
    
    setPlayableUrl(url)
  }, [currentStreamUrl, contextStreamUrl, contextOverlayText])

  // Update video stream when playable URL changes (like PreviewScreen)
  useEffect(() => {
    if (!playableUrl || !videoRef.current) {
      console.log('⏸️ Skipping stream reload - no playable URL or video element')
      return
    }

    // Only reload if the URL actually changed and stream is not already playing
    if (currentPlayingUrlRef.current === playableUrl && isStreamPlayingRef.current) {
      console.log('Stream already playing this URL, skipping reload:', playableUrl)
      return
    }

    console.log('🎥 Playable URL changed, reloading stream:', playableUrl)

    // Reset retry count when URL changes
    retryCountRef.current = 0
    
    // Clear any existing retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
    
    // Clean up old HLS instance before loading new stream
    if (hlsRef.current) {
      console.log('🧹 Cleaning up old HLS instance before loading new stream')
      if (hlsRef.current.fragmentStallTimer) {
        clearTimeout(hlsRef.current.fragmentStallTimer)
      }
      if (hlsRef.current.releaseAutoLevelTimeout) {
        clearTimeout(hlsRef.current.releaseAutoLevelTimeout)
      }
      if (hlsRef.current.latencyMonitorInterval) {
        clearInterval(hlsRef.current.latencyMonitorInterval)
      }
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    
    // Clear video element
    const video = videoRef.current
    if (video) {
      video.pause()
      video.src = ''
      video.load()
    }
    
    // Update current playing URL
    currentPlayingUrlRef.current = playableUrl
    isStreamPlayingRef.current = false
    
    // Small delay to ensure cleanup is complete
    setTimeout(() => {
      if (reloadStreamRef.current) {
        reloadStreamRef.current()
      }
    }, 100)

    // Set up a timeout to check if stream started playing - if not, retry
    const initialLoadTimeout = setTimeout(() => {
      const video = videoRef.current
      // If stream hasn't started playing after 5 seconds, trigger a retry
      if (video && playableUrl && currentPlayingUrlRef.current === playableUrl && 
          !isStreamPlayingRef.current && !isSwitchingStreamRef.current) {
        console.warn('Stream did not start playing after 5 seconds, triggering retry...')
        if (scheduleRetryRef.current) scheduleRetryRef.current()
      }
    }, 5000) // Check after 5 seconds

    // Cleanup on unmount or URL change
    return () => {
      console.log('🧹 Cleaning up stream on URL change')
      clearTimeout(initialLoadTimeout)
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      // Clean up HLS instance
      if (hlsRef.current) {
        if (hlsRef.current.fragmentStallTimer) {
          clearTimeout(hlsRef.current.fragmentStallTimer)
        }
        if (hlsRef.current.releaseAutoLevelTimeout) {
          clearTimeout(hlsRef.current.releaseAutoLevelTimeout)
        }
        if (hlsRef.current.latencyMonitorInterval) {
          clearInterval(hlsRef.current.latencyMonitorInterval)
        }
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [playableUrl])

  // Set up video event listeners for auto-refresh on errors (like PreviewScreen)
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playableUrl) return

    const handleError = (e) => {
      console.error('Video error detected:', e)
      const video = e.target
      if (video.error) {
        console.error('Video error code:', video.error.code, 'Message:', video.error.message)
      }
      setHasError(true)
      setIsLoading(false)
      isStreamPlayingRef.current = false
      // Only retry if we have a playable URL
      if (playableUrl && scheduleRetryRef.current) {
        scheduleRetryRef.current()
      }
    }

    const handleStalled = () => {
      console.warn('Video stalled, attempting to reload...')
      if (playableUrl && scheduleRetryRef.current) {
        scheduleRetryRef.current()
      }
    }

    const handleSuspend = () => {
      console.warn('Video suspended, checking if reload needed...')
      // Only retry if we're not paused by user
      if (!video.paused && scheduleRetryRef.current) {
        scheduleRetryRef.current()
      }
    }

    let waitingTimeout = null
    const handleWaiting = () => {
      // Video is waiting for data - this is normal, but if it persists, retry
      if (waitingTimeout) clearTimeout(waitingTimeout)
      
      waitingTimeout = setTimeout(() => {
        if (video.readyState < 3 && scheduleRetryRef.current) { // HAVE_FUTURE_DATA
          console.warn('Video waiting for too long, attempting reload...')
          scheduleRetryRef.current()
        }
      }, 10000) // Wait 10 seconds before considering it stuck

      const handleCanPlay = () => {
        if (waitingTimeout) {
          clearTimeout(waitingTimeout)
          waitingTimeout = null
        }
      }
      video.addEventListener('canplay', handleCanPlay, { once: true })
    }

    const handleEnded = () => {
      // Stream ended - try to reload (for live streams that end)
      console.log('Stream ended, attempting to reload...')
      if (playableUrl && scheduleRetryRef.current) {
        scheduleRetryRef.current()
      }
    }

    // Monitor connection state (like PreviewScreen)
    const checkConnection = () => {
      if (video.readyState === 0 && playableUrl) {
        console.warn('Video has no data, checking connection...')
        setTimeout(() => {
          if (video.readyState === 0 && !video.paused && scheduleRetryRef.current) {
            console.warn('Video still has no data, attempting reload...')
            scheduleRetryRef.current()
          }
        }, 15000)
      }
    }

    // Periodic connection check (like PreviewScreen)
    let connectionCheckInterval = null
    if (playableUrl) {
      connectionCheckInterval = setInterval(() => {
        if (video && playableUrl && !video.paused) {
          checkConnection()
        }
      }, STREAM_HEALTH_CHECK_INTERVAL_MS)
    }

    video.addEventListener('error', handleError)
    video.addEventListener('stalled', handleStalled)
    video.addEventListener('suspend', handleSuspend)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('ended', handleEnded)

    return () => {
      if (waitingTimeout) clearTimeout(waitingTimeout)
      if (connectionCheckInterval) clearInterval(connectionCheckInterval)
      video.removeEventListener('error', handleError)
      video.removeEventListener('stalled', handleStalled)
      video.removeEventListener('suspend', handleSuspend)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('ended', handleEnded)
    }
  }, [playableUrl, STREAM_HEALTH_CHECK_INTERVAL_MS])

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      stopCurrentStream()
    }
  }, [stopCurrentStream])

  return (
    <div className="user-screen">
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}
      <div className={`user-layout ${!isPanelVisible ? 'panel-collapsed' : ''}`}>
        <div
          className={`user-panel-wrapper ${!isPanelVisible ? 'collapsed' : ''}`}
          style={{ width: isPanelVisible ? `${PANEL_WIDTH}px` : '0px' }}
        >
          <aside className={`user-left-panel ${!isPanelVisible ? 'hidden' : ''}`} ref={panelRef}>
          <div className="user-panel-header">
            <h2>Available Streams</h2>
            <span className={`connection-status ${wsConnected ? 'connected' : 'disconnected'}`}>
              <span className="status-dot"></span>
              {wsConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="user-buttons">
            {savedButtons.length === 0 ? (
              <p className="user-empty">No streams available yet.</p>
            ) : (
              savedButtons.map((button) => {
                const status = buttonStatus[button.id] || 'disconnected'
                const isSelected = selectedButtonId === button.id
                const streamLabel = getStreamLabel(button)
                return (
                  <button
                    key={button.id}
                    className={`user-button ${isSelected ? 'active' : ''} status-${status}`}
                    onClick={() => handleStreamLaunch(button)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, button)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="user-button-header">
                      <div className="user-button-name-group">
                        <span className="user-button-name">{button.name}</span>
                        {streamLabel && (
                          <span className="user-button-url">{streamLabel}</span>
                        )}
                      </div>
                      <div className="user-button-meta">
                        <span className={`status-dot status-dot-${status}`}></span>
                        <span className="status-text">
                          {status === 'connected' ? 'Connected' : 'Disconnected'}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
          </aside>
          <button
            className="panel-toggle-arrow"
            onClick={() => setIsPanelVisible(prev => !prev)}
            aria-label={isPanelVisible ? 'Hide panel' : 'Show panel'}
          >
            {isPanelVisible ? '‹' : '›'}
          </button>
        </div>

        <main className="user-main">
          <header className="user-main-header">
            <div className="user-header-top">
              <h1>User Page</h1>
              <div className="header-buttons">
                <button 
                  onClick={() => navigate('/editor')}
                  className="nav-button"
                  title="Navigate to Editor Screen"
                >
                  ✏️ Editor Screen
                </button>
                <button 
                  onClick={() => navigate('/preview')}
                  className="nav-button"
                  title="Navigate to Preview Screen"
                >
                  📺 Preview Screen
                </button>
              </div>
            </div>
            <div className="grid-controls">
              <div className="grid-control-group">
                <label htmlFor="grid-x">Grid Columns (X):</label>
                <input
                  id="grid-x"
                  type="number"
                  min="1"
                  max="8"
                  value={gridX}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(8, parseInt(e.target.value) || 1))
                    setGridX(val)
                    // Clear streams that are outside new grid bounds
                    const newTotal = val * gridY
                    setGridStreams(prev => {
                      const updated = {}
                      Object.keys(prev).forEach(key => {
                        const cellIndex = parseInt(key.split('-')[1])
                        if (cellIndex < newTotal) {
                          updated[key] = prev[key]
                        }
                      })
                      return updated
                    })
                  }}
                  className="grid-input"
                />
              </div>
              <div className="grid-control-group">
                <label htmlFor="grid-y">Grid Rows (Y):</label>
                <input
                  id="grid-y"
                  type="number"
                  min="1"
                  max="8"
                  value={gridY}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(8, parseInt(e.target.value) || 1))
                    setGridY(val)
                    // Clear streams that are outside new grid bounds
                    const newTotal = gridX * val
                    setGridStreams(prev => {
                      const updated = {}
                      Object.keys(prev).forEach(key => {
                        const cellIndex = parseInt(key.split('-')[1])
                        if (cellIndex < newTotal) {
                          updated[key] = prev[key]
                        }
                      })
                      return updated
                    })
                  }}
                  className="grid-input"
                />
              </div>
              <div className="grid-info">
                <span>Total Cells: {gridX * gridY}</span>
              </div>
            </div>
          </header>

          <div className="user-player">
            <div 
              className="grid-container"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${gridX}, 1fr)`,
                gridTemplateRows: `repeat(${gridY}, 1fr)`,
                gap: '12px',
                width: '100%',
                height: '100%',
                minHeight: '600px'
              }}
            >
              {generateGridCells().map((cell) => (
                <div
                  key={cell.id}
                  className="grid-cell"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, cell.id)}
                >
                  {cell.data ? (
                    <div className="grid-cell-content">
                      <button
                        className="grid-cell-clear"
                        onClick={() => handleClearCell(cell.id)}
                        title="Clear cell"
                      >
                        ×
                      </button>
                      <GridVideoPlayer
                        streamUrl={cell.data.streamUrl}
                        overlayText={cell.data.overlayText}
                        cellId={cell.id}
                        onError={() => {
                          showNotification(`Stream error in ${cell.id}`, 'error')
                        }}
                      />
                    </div>
                  ) : (
                    <div className="grid-cell-empty">
                      <p>Drop stream here</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default UserScreen


