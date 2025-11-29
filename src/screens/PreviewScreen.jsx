import React, { useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { StreamContext } from '../context/StreamContext'
import { createWebSocketConnection, reconnectWebSocket, sendWebSocketMessage } from '../utils/websocket'
import { detectStreamType, getPlayableUrl } from '../utils/streamConverter'
import { loadSavedButtons } from '../utils/storage'
import Hls from 'hls.js'
import './PreviewScreen.css'

function PreviewScreen() {
  const navigate = useNavigate()
  const { streamUrl: contextStreamUrl, overlayText: contextOverlayText, setStreamUrl, setOverlayText } = useContext(StreamContext)
  const videoRef = useRef(null)
  const wsRef = useRef(null)
  const reconnectRef = useRef(null)
  const [currentStreamUrl, setCurrentStreamUrl] = useState(contextStreamUrl)
  const [currentOverlayText, setCurrentOverlayText] = useState(contextOverlayText)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [streamInfo, setStreamInfo] = useState(null)
  const [playableUrl, setPlayableUrl] = useState(null)
  const [savedButtons, setSavedButtons] = useState([])
  const [currentButtonId, setCurrentButtonId] = useState(null)
  const retryTimeoutRef = useRef(null)
  const retryCountRef = useRef(0)
  const maxRetries = Infinity // Keep retrying indefinitely until IP changes
  const retryDelay = 800 // tighter retry loop for low-latency playback
  const hlsRef = useRef(null)
  const lastFrameRef = useRef(null) // Cache for last frame
  const frameCaptureIntervalRef = useRef(null)
  const canvasRef = useRef(null) // Canvas for capturing frames

  const cleanupStreamResources = useCallback(() => {
    if (hlsRef.current) {
      console.log('Destroying old HLS instance')
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

    if (videoRef.current) {
      console.log('Resetting video element')
      videoRef.current.pause()
      videoRef.current.src = ''
      videoRef.current.load()
    }

    if (frameCaptureIntervalRef.current) {
      clearInterval(frameCaptureIntervalRef.current)
      frameCaptureIntervalRef.current = null
    }
    lastFrameRef.current = null

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
    retryCountRef.current = 0

    setPlayableUrl(null)
  }, [])

  const applyStreamUpdate = useCallback((streamData, origin = 'server') => {
    if (!streamData || !streamData.streamUrl) return

    console.log(`Applying stream update (${origin})`, streamData.streamUrl)
    cleanupStreamResources()

    // Find which button this stream URL belongs to
    const matchingButton = savedButtons.find(btn => btn.url === streamData.streamUrl)
    const buttonId = matchingButton ? matchingButton.id : null

    setCurrentStreamUrl(streamData.streamUrl)
    setCurrentOverlayText(streamData.overlayText || '')
    setCurrentButtonId(buttonId)
    setStreamUrl(streamData.streamUrl)
    setOverlayText(streamData.overlayText || '')
    setIsLoading(true)
    setHasError(false)
  }, [cleanupStreamResources, setOverlayText, setStreamUrl, savedButtons])

  const requestLatestStream = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWebSocketMessage(wsRef.current, 'requestCurrentStream', {})
    }
  }, [])

  // Load saved buttons on mount
  useEffect(() => {
    const loaded = loadSavedButtons()
    if (loaded && loaded.length > 0) {
      setSavedButtons(loaded)
    }
  }, [])

  // Update currentButtonId when savedButtons or currentStreamUrl changes
  useEffect(() => {
    if (currentStreamUrl && savedButtons.length > 0) {
      const matchingButton = savedButtons.find(btn => btn.url === currentStreamUrl)
      if (matchingButton && matchingButton.id !== currentButtonId) {
        setCurrentButtonId(matchingButton.id)
      } else if (!matchingButton && currentButtonId) {
        setCurrentButtonId(null)
      }
    }
  }, [currentStreamUrl, savedButtons, currentButtonId])

  useEffect(() => {
    const handleMessage = (data, origin = 'server') => {
      if (!data || !data.type) return

      if (data.type === 'streamUpdate') {
        applyStreamUpdate(data, origin)
      } else if (data.type === 'connected') {
        if (data.currentStream) {
          applyStreamUpdate(data.currentStream, 'initial-state')
        }
      } else if (data.type === 'currentStream') {
        applyStreamUpdate(data, 'current-state')
      } else if (data.type === 'buttonUpdated' || data.type === 'buttonCreated' || data.type === 'buttonDeleted' || data.type === 'buttonsSync') {
        // Update saved buttons list
        const incomingButtons = data.allButtons || data.buttons
        if (incomingButtons && Array.isArray(incomingButtons)) {
          setSavedButtons(incomingButtons)
          
          // If a button was updated and it's currently playing, update the stream
          if (data.type === 'buttonUpdated' && data.buttonId && currentButtonId === data.buttonId) {
            const updatedButton = incomingButtons.find(b => b.id === data.buttonId)
            if (updatedButton && updatedButton.url !== currentStreamUrl) {
              console.log('Currently playing button was updated, updating stream to new URL')
              applyStreamUpdate({
                streamUrl: updatedButton.url,
                overlayText: updatedButton.name
              }, 'button-update')
            }
          }
        }
      }
    }

    const connect = () => {
      wsRef.current = createWebSocketConnection(
        (data) => handleMessage(data, 'primary'),
        (error) => {
          console.error('WebSocket error:', error)
        },
        () => {
          console.log('Preview Screen WebSocket connected')
          requestLatestStream()
        },
        (event) => {
          if (event.code !== 1000 && reconnectRef.current) {
            reconnectRef.current.attempt()
          }
        }
      )
    }

    connect()

    reconnectRef.current = reconnectWebSocket(
      wsRef,
      (data) => handleMessage(data, 'reconnect'),
      (error) => console.error('WebSocket error:', error),
      () => {
        console.log('Preview Screen WebSocket reconnected')
        requestLatestStream()
      }
    )

    return () => {
      if (reconnectRef.current) {
        reconnectRef.current.cancel()
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting')
      }
    }
  }, [applyStreamUpdate, requestLatestStream, currentButtonId, currentStreamUrl])

  const ensureLiveEdge = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.seekable || video.seekable.length === 0) {
      return
    }
    try {
      const liveEdge = video.seekable.end(video.seekable.length - 1)
      const drift = liveEdge - video.currentTime
      if (Number.isFinite(drift) && drift > 2.5) {
        console.warn(`Viewer drifted ${drift.toFixed(2)}s behind live edge, fast-forwarding`)
        const target = Math.max(video.seekable.start(video.seekable.length - 1), liveEdge - 0.3)
        if (Number.isFinite(target)) {
          video.currentTime = target
        }
      }
    } catch (error) {
      console.warn('Unable to evaluate live edge drift:', error)
    }
  }, [])

  // Capture last frame from video
  const captureLastFrame = React.useCallback(() => {
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

  // Schedule retry if stream fails - retry indefinitely until IP changes
  const scheduleRetry = React.useCallback(() => {
    // Always retry - no max limit, only stop when stream URL changes
    retryCountRef.current++
    console.log(`Scheduling retry in ${retryDelay}ms (attempt ${retryCountRef.current})`)
    
    retryTimeoutRef.current = setTimeout(() => {
      if (playableUrl && videoRef.current) {
        console.log(`Attempting to reload stream (attempt ${retryCountRef.current})...`)
        setIsLoading(true)
        setHasError(false)

        // Don't clear the video src - keep the last frame visible
        videoRef.current.load()
        
        const playPromise = videoRef.current.play()
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log('Stream playing successfully')
              setIsLoading(false)
              setHasError(false)
              retryCountRef.current = 0
            })
            .catch(err => {
              console.error('Error playing video:', err)
              setIsLoading(false)
              setHasError(true)
              scheduleRetry()
            })
        }
      }
    }, retryDelay)
  }, [playableUrl])

  // Function to reload/refresh the video stream
  const reloadStream = React.useCallback(() => {
    if (!playableUrl || !videoRef.current) return

    console.log(`Reloading stream: ${playableUrl}`)
    setIsLoading(true)
    setHasError(false)
    retryCountRef.current = 0 // Reset retry count

    // Clear any existing retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    // Clean up existing HLS instance
    if (hlsRef.current) {
      // Clear any fragment stall timers
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

    const video = videoRef.current
    const isHLS = playableUrl.includes('.m3u8') || playableUrl.includes('/hls/')

    if (isHLS && Hls.isSupported()) {
      // Use HLS.js for HLS streams
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
          console.warn(`Detected ${currentLatency.toFixed(2)}s latency, nudging live edge`)
          ensureLiveEdge()
          try {
            hls.startLoad()
            video.play().catch(() => {})
          } catch (error) {
            console.warn('Unable to nudge HLS stream:', error)
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
        // Start playback immediately without waiting
        video.play().catch(err => {
          console.error('Error playing HLS video:', err)
          setIsLoading(false)
          setHasError(true)
          scheduleRetry()
        })
      })
      
      let lastFragmentLoadTime = Date.now()
      const FRAGMENT_STALL_TIMEOUT = 15000 // 15 seconds - tighter tolerance for low latency
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
            scheduleRetry()
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
      
      // Start playing as soon as we have enough data (faster startup)
      hls.on(Hls.Events.FRAG_PARSING_DATA, () => {
        if (isLoading && video.readyState >= 2) {
          console.log('HLS stream has enough data, starting playback')
          video.play()
            .then(() => {
              console.log('HLS stream playing successfully')
              setIsLoading(false)
              setHasError(false)
              retryCountRef.current = 0
              
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
        
        // Check if it's a 503 error (server not ready)
        if (data.response && data.response.code === 503) {
          console.log('Server returned 503 - playlist not ready yet, will retry...')
          // Don't mark as error yet, just retry after a delay
          setTimeout(() => {
            if (hlsRef.current && playableUrl) {
              console.log('Retrying HLS load after 503...')
              hlsRef.current.loadSource(playableUrl)
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
                  if (hlsRef.current && playableUrl) {
                    hlsRef.current.loadSource(playableUrl)
                  }
                }, 3000)
              } else {
                try {
                  hls.startLoad()
                } catch (e) {
                  console.error('Failed to recover from network error:', e)
                  setIsLoading(false)
                  setHasError(true)
                  scheduleRetry()
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
                scheduleRetry()
              }
              break
            default:
              console.error('HLS fatal error, cannot recover')
              setIsLoading(false)
              setHasError(true)
              scheduleRetry()
              break
          }
        } else {
          // Non-fatal errors, just log
          console.warn('HLS non-fatal error:', data)
        }
      })
    } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      console.log('Using native HLS support')
      video.src = playableUrl
      video.load()
      video.play()
        .then(() => {
          console.log('Native HLS stream playing successfully')
          setIsLoading(false)
          setHasError(false)
          retryCountRef.current = 0
        })
        .catch(err => {
          console.error('Error playing native HLS:', err)
          setIsLoading(false)
          setHasError(true)
          scheduleRetry()
        })
    } else {
      // Regular video stream
      console.log('Using standard video playback')
      video.src = playableUrl
      video.load()
      
      const playPromise = video.play()
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('Stream playing successfully')
            setIsLoading(false)
            setHasError(false)
            retryCountRef.current = 0
          })
          .catch(err => {
            console.error('Error playing video:', err)
            setIsLoading(false)
            setHasError(true)
            scheduleRetry()
          })
      }
    }
  }, [captureLastFrame, ensureLiveEdge, playableUrl, scheduleRetry])

  // Detect stream type and convert if needed
  useEffect(() => {
    if (!currentStreamUrl) {
      if (!contextStreamUrl) {
        setIsLoading(false)
        setHasError(false)
        setStreamInfo(null)
        setPlayableUrl(null)
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
    
    // Check if conversion server is accessible (for RTSP streams)
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

  // Update video stream when playable URL changes
  useEffect(() => {
    if (!playableUrl || !videoRef.current) {
      console.log('⏸️ Skipping stream reload - no playable URL or video element')
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
    
    // Small delay to ensure cleanup is complete
    setTimeout(() => {
      reloadStream()
    }, 100)

    // Cleanup on unmount or URL change
    return () => {
      console.log('🧹 Cleaning up stream on URL change')
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
  }, [playableUrl, reloadStream])

  // Set up video event listeners for auto-refresh on errors
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
      // Only retry if we have a playable URL
      if (playableUrl) {
        scheduleRetry()
      }
    }

    const handleStalled = () => {
      console.warn('Video stalled, attempting to reload...')
      if (playableUrl) {
        scheduleRetry()
      }
    }

    const handleSuspend = () => {
      console.warn('Video suspended, checking if reload needed...')
      // Only retry if we're not paused by user
      if (!video.paused) {
        scheduleRetry()
      }
    }

    let waitingTimeout = null
    const handleWaiting = () => {
      // Video is waiting for data - this is normal, but if it persists, retry
      if (waitingTimeout) clearTimeout(waitingTimeout)
      
      waitingTimeout = setTimeout(() => {
        if (video.readyState < 3) { // HAVE_FUTURE_DATA
          console.warn('Video waiting for too long, attempting reload...')
          scheduleRetry()
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
      if (playableUrl) {
        scheduleRetry()
      }
    }

    // Monitor connection state
    const checkConnection = () => {
      if (video.readyState === 0 && playableUrl) {
        // HAVE_NOTHING - no information available
        console.warn('Video has no data, checking connection...')
        setTimeout(() => {
          if (video.readyState === 0) {
            console.warn('Video still has no data, attempting reload...')
            scheduleRetry()
          }
        }, 5000)
      }
    }

    // Periodic connection check
    let connectionCheckInterval = null
    if (playableUrl) {
      connectionCheckInterval = setInterval(() => {
        if (video && playableUrl && !video.paused) {
          checkConnection()
        }
      }, 10000) // Check every 10 seconds
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
  }, [playableUrl, scheduleRetry])

  const handleBack = () => {
    navigate('/editor')
  }

  const handleNavigateToEditor = () => {
    navigate('/editor')
  }

  const handleNavigateToUser = () => {
    navigate('/user')
  }

  return (
    <div className="preview-screen">
      <div className="preview-header-right">
        <div className="header-buttons">
          <button 
            onClick={handleNavigateToEditor}
            className="nav-button"
            title="Navigate to Editor Screen"
          >
            ✏️ Editor Screen
          </button>
          <button 
            onClick={handleNavigateToUser}
            className="nav-button"
            title="Navigate to User Screen"
          >
            👥 User Screen
          </button>
        </div>
      </div>
      <div className="video-container">
        <video
          ref={videoRef}
          className="video-stream"
          autoPlay
          muted
          playsInline
          controls
          onLoadedData={() => {
            setIsLoading(false)
            setHasError(false)
            // Capture frame when data loads
            captureLastFrame()
          }}
          onTimeUpdate={() => {
            // Capture frame periodically during playback
            if (videoRef.current && !videoRef.current.paused && videoRef.current.readyState >= 2) {
              // Capture every 2 seconds during playback
              const now = Date.now()
              if (!lastFrameRef.current || now % 2000 < 100) {
                captureLastFrame()
              }
            }
          }}
          onError={(e) => {
            console.error('Video element error:', e)
            setIsLoading(false)
            setHasError(true)
            // Capture last frame before error
            captureLastFrame()
            // Auto-retry will be handled by the event listener
          }}
          onStalled={() => {
            console.warn('Video stalled')
            // Capture frame when stalled
            captureLastFrame()
            if (playableUrl) {
              scheduleRetry()
            }
          }}
        />
        {/* Display cached last frame when stream is disconnected */}
        {hasError && lastFrameRef.current && (
          <img 
            src={lastFrameRef.current} 
            alt="Last frame" 
            className="last-frame-overlay"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              zIndex: 1,
              pointerEvents: 'none'
            }}
          />
        )}
        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <p>Loading stream...</p>
          </div>
        )}
        {!currentStreamUrl && !isLoading && (
          <div className="error-message">
            <p>📺 Waiting for stream selection</p>
            <p className="error-subtitle">Please select a stream from the Editor Screen</p>
          </div>
        )}
        {currentOverlayText && (
          <div className="overlay-text">
            {currentOverlayText}
          </div>
        )}
      </div>
    </div>
  )
}

export default PreviewScreen

