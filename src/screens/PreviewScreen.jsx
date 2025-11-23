import React, { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StreamContext } from '../context/StreamContext'
import { createWebSocketConnection, reconnectWebSocket } from '../utils/websocket'
import { detectStreamType, getPlayableUrl } from '../utils/streamConverter'
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
  const retryTimeoutRef = useRef(null)
  const retryCountRef = useRef(0)
  const maxRetries = Infinity // Keep retrying indefinitely until IP changes
  const retryDelay = 1500 // 1.5 seconds (faster retry)
  const hlsRef = useRef(null)
  const lastFrameRef = useRef(null) // Cache for last frame
  const frameCaptureIntervalRef = useRef(null)
  const canvasRef = useRef(null) // Canvas for capturing frames

  // Initialize WebSocket connection for real-time updates with reconnection
  useEffect(() => {
    const connect = () => {
      wsRef.current = createWebSocketConnection(
        (data) => {
          if (data.type === 'streamUpdate') {
            // Update stream when receiving broadcast from Editor
            console.log('Received stream update:', data)
            console.log('Old stream URL:', currentStreamUrl)
            console.log('New stream URL:', data.streamUrl)
            
            // Clean up old stream first
            if (hlsRef.current) {
              console.log('Destroying old HLS instance')
              hlsRef.current.destroy()
              hlsRef.current = null
            }
            
            if (videoRef.current) {
              console.log('Clearing video element')
              videoRef.current.pause()
              videoRef.current.src = ''
              videoRef.current.load()
            }
            
            // Clear frame capture
            if (frameCaptureIntervalRef.current) {
              clearInterval(frameCaptureIntervalRef.current)
              frameCaptureIntervalRef.current = null
            }
            lastFrameRef.current = null
            
            // Clear retry timeout
            if (retryTimeoutRef.current) {
              clearTimeout(retryTimeoutRef.current)
              retryTimeoutRef.current = null
            }
            retryCountRef.current = 0
            
            // Reset playable URL to force recalculation
            setPlayableUrl(null)
            
            // Update stream URL and overlay text
            setCurrentStreamUrl(data.streamUrl)
            setCurrentOverlayText(data.overlayText)
            setStreamUrl(data.streamUrl)
            setOverlayText(data.overlayText)
            
            // Force video reload
            setIsLoading(true)
            setHasError(false)
          }
        },
        (error) => {
          console.error('WebSocket error:', error)
        },
        () => {
          console.log('Preview Screen WebSocket connected')
        },
        (event) => {
          // Only reconnect if not a normal closure
          if (event.code !== 1000 && reconnectRef.current) {
            reconnectRef.current.attempt()
          }
        }
      )
    }

    connect()

    // Set up reconnection handler
    reconnectRef.current = reconnectWebSocket(
      wsRef,
      (data) => {
        if (data.type === 'streamUpdate') {
          console.log('Reconnection: Received stream update:', data)
          
          // Clean up old stream first
          if (hlsRef.current) {
            console.log('Destroying old HLS instance on reconnection')
            hlsRef.current.destroy()
            hlsRef.current = null
          }
          
          if (videoRef.current) {
            console.log('Clearing video element on reconnection')
            videoRef.current.pause()
            videoRef.current.src = ''
            videoRef.current.load()
          }
          
          // Clear frame capture
          if (frameCaptureIntervalRef.current) {
            clearInterval(frameCaptureIntervalRef.current)
            frameCaptureIntervalRef.current = null
          }
          lastFrameRef.current = null
          
          // Clear retry timeout
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current)
            retryTimeoutRef.current = null
          }
          retryCountRef.current = 0
          
          // Reset playable URL to force recalculation
          setPlayableUrl(null)
          
          setCurrentStreamUrl(data.streamUrl)
          setCurrentOverlayText(data.overlayText)
          setStreamUrl(data.streamUrl)
          setOverlayText(data.overlayText)
          setIsLoading(true)
          setHasError(false)
        }
      },
      (error) => console.error('WebSocket error:', error),
      () => console.log('Preview Screen WebSocket reconnected')
    )

    return () => {
      if (reconnectRef.current) {
        reconnectRef.current.cancel()
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting')
      }
    }
  }, [setStreamUrl, setOverlayText])

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
        lowLatencyMode: false, // Disable low latency for larger buffer
        backBufferLength: 300, // 5 minutes of back buffer (300 seconds)
        maxBufferLength: 300, // 5 minutes buffer (300 seconds)
        maxMaxBufferLength: 300, // 5 minutes max buffer
        maxBufferSize: 100 * 1000 * 1000, // 100MB buffer for 5 minutes of content
        maxBufferHole: 0.5, // Allow small gaps
        highBufferWatchdogPeriod: 2, // Check buffer every 2 seconds
        nudgeOffset: 0.1,
        nudgeMaxRetry: 3,
        maxFragLoadingTimeOut: 20000, // 20 second timeout
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 10000, // 10 second timeout for manifest
        levelLoadingTimeOut: 10000,
        startLevel: -1, // Auto-select best level
        capLevelToPlayerSize: true, // Cap level to player size
        autoStartLoad: true, // Start loading immediately
        startPosition: -1, // Start from live edge
        liveSyncDurationCount: 3, // Sync to live edge
        liveMaxLatencyDurationCount: 10 // Allow more latency for stability
      })
      
      hlsRef.current = hls
      hls.loadSource(playableUrl)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed, starting playback')
        console.log('HLS levels available:', hls.levels?.length || 0)
        // Start playback immediately without waiting
        video.play().catch(err => {
          console.error('Error playing HLS video:', err)
          setIsLoading(false)
          setHasError(true)
          scheduleRetry()
        })
      })
      
      let lastFragmentLoadTime = Date.now()
      const FRAGMENT_STALL_TIMEOUT = 30000 // 30 seconds - if no fragments load for 30s, retry
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
  }, [playableUrl, scheduleRetry])

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

  return (
    <div className="preview-screen">
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
        {hasError && !isLoading && currentStreamUrl && (
          <div className="error-message">
            <p>⚠️ Unable to load stream</p>
            <p className="error-subtitle">
              {streamInfo?.type === 'rtsp' 
                ? 'The RTSP stream conversion is not working. Please check the server console for FFmpeg errors.'
                : 'Stream could not be loaded. Auto-retrying...'}
            </p>
            {streamInfo?.type === 'rtsp' && (
              <div className="rtsp-help">
                <p><strong>Note:</strong> Browsers cannot play RTSP directly.</p>
                <p>The app uses a local conversion server (port 8092) to convert RTSP to HLS.</p>
                <p style={{marginTop: '10px', fontSize: '0.9rem', opacity: 0.9}}>
                  <strong>Troubleshooting:</strong>
                </p>
                <ul style={{textAlign: 'left', marginTop: '8px'}}>
                  <li>Check if the conversion server is running (port 8092)</li>
                  <li>Verify FFmpeg is installed and accessible</li>
                  <li>Check server console for FFmpeg connection errors</li>
                  <li>Verify the RTSP URL is correct: <code style={{fontSize: '0.85rem'}}>{currentStreamUrl}</code></li>
                  <li>Test the RTSP URL in VLC to confirm it works</li>
                </ul>
                <p style={{marginTop: '10px', fontSize: '0.85rem', opacity: 0.8}}>
                  The app will automatically retry loading the stream.
                </p>
              </div>
            )}
          </div>
        )}
        {currentOverlayText && (
          <div className="overlay-text">
            {currentOverlayText}
          </div>
        )}
      </div>
      <button className="back-button" onClick={handleBack}>
        Back to Editor
      </button>
    </div>
  )
}

export default PreviewScreen

