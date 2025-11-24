import React, { useState, useEffect, useRef, useContext, useCallback } from 'react'
import Hls from 'hls.js'
import Notification from '../components/Notification'
import { StreamContext } from '../context/StreamContext'
import { loadSavedButtons, saveButtons } from '../utils/storage'
import { createWebSocketConnection, reconnectWebSocket, sendWebSocketMessage } from '../utils/websocket'
import { detectStreamType, getPlayableUrl } from '../utils/streamConverter'
import policeLogo from '../assets/police-logo.png'
import './UserScreen.css'
import './PreviewScreen.css'

function UserScreen() {
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
  const retryDelay = 1500
  const hlsRef = useRef(null)
  const lastFrameRef = useRef(null)
  const frameCaptureIntervalRef = useRef(null)
  const canvasRef = useRef(null)

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 4000)
  }

  const checkStreamConnection = useCallback(async (rtspUrl) => {
    try {
      const urlMatch = rtspUrl.match(/rtsp:\/\/([^:]+):(\d+)/)
      if (!urlMatch) return false

      const ip = urlMatch[1]
      const port = urlMatch[2] || '8000'

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4000)

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
  }, [])

  useEffect(() => {
    savedButtonsRef.current = savedButtons
  }, [savedButtons])

  useEffect(() => {
    currentStreamUrlRef.current = currentStreamUrl
  }, [currentStreamUrl])

  const performConnectionCheck = useCallback(async (buttonsToCheck) => {
    const targetButtons = buttonsToCheck || savedButtonsRef.current
    if (!targetButtons || targetButtons.length === 0) return
    const statusUpdates = {}
    targetButtons.forEach(button => {
      statusUpdates[button.id] = 'checking'
    })
    setButtonStatus(prev => ({ ...prev, ...statusUpdates }))

    for (const button of targetButtons) {
      try {
        const isConnected = await checkStreamConnection(button.url)
        const newStatus = isConnected ? 'connected' : 'disconnected'
        statusUpdates[button.id] = newStatus
        setButtonStatus(prev => ({ ...prev, [button.id]: newStatus }))
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        console.error(`Error checking connection for button ${button.id}:`, error)
        statusUpdates[button.id] = 'disconnected'
        setButtonStatus(prev => ({ ...prev, [button.id]: 'disconnected' }))
      }
    }
  }, [checkStreamConnection])

  useEffect(() => {
    const loaded = loadSavedButtons()
    if (loaded && loaded.length > 0) {
      setSavedButtons(loaded)
      const initialStatus = {}
      loaded.forEach(button => {
        initialStatus[button.id] = 'checking'
      })
      setButtonStatus(initialStatus)
      performConnectionCheck(loaded)
    }
  }, [performConnectionCheck])

  useEffect(() => {
    if (savedButtons.length === 0) return
    performConnectionCheck()
    const interval = setInterval(() => {
      performConnectionCheck()
    }, 30000)
    return () => clearInterval(interval)
  }, [savedButtons, performConnectionCheck])

  const handleStreamLaunch = (button) => {
    setSelectedButtonId(button.id)
    setCurrentStreamUrl(button.url)
    setCurrentOverlayText(button.name)
    setStreamUrl(button.url)
    setOverlayText(button.name)
    setIsLoading(true)
    setHasError(false)

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWebSocketMessage(wsRef.current, 'streamUpdate', {
        streamUrl: button.url,
        overlayText: button.name
      })
    }

    showNotification(`Launching stream "${button.name}"`, 'success')
  }

  useEffect(() => {
    const handleMessage = (data) => {
      if (data.type === 'buttonCreated' || data.type === 'buttonDeleted' || data.type === 'buttonUpdated' || data.type === 'buttonsSync' || data.type === 'connected') {
        const incomingButtons = data.allButtons || data.buttons
        if (incomingButtons && Array.isArray(incomingButtons)) {
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
      }

      if (data.type === 'streamUpdate') {
        if (data.streamUrl && data.streamUrl !== currentStreamUrlRef.current) {
          currentStreamUrlRef.current = data.streamUrl
          setCurrentStreamUrl(data.streamUrl)
          setStreamUrl(data.streamUrl)
          setIsLoading(true)
          setHasError(false)
        }
        if (data.overlayText) {
          setCurrentOverlayText(data.overlayText)
          setOverlayText(data.overlayText)
        }
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
      handleMessage,
      handleError,
      () => {
        setWsConnected(true)
        setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            sendWebSocketMessage(wsRef.current, 'requestButtons', {})
          }
        }, 500)
      }
    )

    wsRef.current = createWebSocketConnection(handleMessage, handleError, handleOpen, handleClose)

    return () => {
      if (reconnectRef.current) {
        reconnectRef.current.cancel()
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'User page unmounting')
      }
    }
  }, [performConnectionCheck, setOverlayText, setStreamUrl])

  const captureLastFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return

    try {
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas')
        canvasRef.current.width = video.videoWidth || 1920
        canvasRef.current.height = video.videoHeight || 1080
      }

      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')

      if (video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      lastFrameRef.current = canvas.toDataURL('image/jpeg', 0.9)
    } catch (error) {
      console.error('Error capturing frame:', error)
    }
  }, [])

  const scheduleRetry = useCallback(() => {
    retryCountRef.current++
    retryTimeoutRef.current = setTimeout(() => {
      if (playableUrl && videoRef.current) {
        setIsLoading(true)
        setHasError(false)
        videoRef.current.load()
        const playPromise = videoRef.current.play()
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
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

  const reloadStream = useCallback(() => {
    if (!playableUrl || !videoRef.current) return

    setIsLoading(true)
    setHasError(false)
    retryCountRef.current = 0

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    if (hlsRef.current) {
      if (hlsRef.current.fragmentStallTimer) {
        clearTimeout(hlsRef.current.fragmentStallTimer)
      }
      if (hlsRef.current.releaseAutoLevelTimeout) {
        clearTimeout(hlsRef.current.releaseAutoLevelTimeout)
      }
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    const video = videoRef.current
    const isHLS = playableUrl.includes('.m3u8') || playableUrl.includes('/hls/')

    if (isHLS && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 120,
        maxBufferLength: 45,
        maxMaxBufferLength: 90,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.4,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.05,
        nudgeMaxRetry: 3,
        maxFragLoadingTimeOut: 20000,
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 10000,
        levelLoadingTimeOut: 10000,
        startLevel: 0,
        capLevelToPlayerSize: true,
        capLevelOnFPSDrop: true,
        autoStartLoad: true,
        startPosition: -1,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6
      })

      hlsRef.current = hls
      hls.loadSource(playableUrl)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
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
        }, 15000)
        video.play().catch(err => {
          console.error('Error playing HLS video:', err)
          setIsLoading(false)
          setHasError(true)
          scheduleRetry()
        })
      })

      let fragmentStallTimer = null
      const resetFragmentStallTimer = () => {
        if (fragmentStallTimer) {
          clearTimeout(fragmentStallTimer)
        }
        fragmentStallTimer = setTimeout(() => {
          scheduleRetry()
        }, 30000)
      }

      hls.on(Hls.Events.FRAG_LOADED, () => {
        captureLastFrame()
        resetFragmentStallTimer()
      })

      resetFragmentStallTimer()

      hls.on(Hls.Events.FRAG_PARSING_DATA, () => {
        if (isLoading && video.readyState >= 2) {
          video.play()
            .then(() => {
              setIsLoading(false)
              setHasError(false)
              retryCountRef.current = 0
              if (frameCaptureIntervalRef.current) {
                clearInterval(frameCaptureIntervalRef.current)
              }
              frameCaptureIntervalRef.current = setInterval(() => {
                captureLastFrame()
              }, 1000)
            })
            .catch(err => console.error('Error playing HLS video:', err))
        }
      })

      video.addEventListener('canplay', () => {
        if (isLoading && !video.paused) {
          setIsLoading(false)
          setHasError(false)
          retryCountRef.current = 0
        }
      }, { once: true })

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data)
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              try {
                hls.startLoad()
              } catch (e) {
                setIsLoading(false)
                setHasError(true)
                scheduleRetry()
              }
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              try {
                hls.recoverMediaError()
              } catch (e) {
                setIsLoading(false)
                setHasError(true)
                scheduleRetry()
              }
              break
            default:
              setIsLoading(false)
              setHasError(true)
              scheduleRetry()
          }
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
        })
        .catch(err => {
          console.error('Error playing native HLS:', err)
          setIsLoading(false)
          setHasError(true)
          scheduleRetry()
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
          })
          .catch(err => {
            console.error('Error playing video:', err)
            setIsLoading(false)
            setHasError(true)
            scheduleRetry()
          })
      }
    }
  }, [captureLastFrame, isLoading, playableUrl, scheduleRetry])

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

    const info = detectStreamType(currentStreamUrl)
    setStreamInfo(info)
    const url = getPlayableUrl(currentStreamUrl, { preferHLS: true })
    setPlayableUrl(url)
  }, [contextOverlayText, contextStreamUrl, currentStreamUrl])

  useEffect(() => {
    if (!playableUrl || !videoRef.current) {
      return
    }

    retryCountRef.current = 0
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    if (hlsRef.current) {
      if (hlsRef.current.fragmentStallTimer) {
        clearTimeout(hlsRef.current.fragmentStallTimer)
      }
      if (hlsRef.current.releaseAutoLevelTimeout) {
        clearTimeout(hlsRef.current.releaseAutoLevelTimeout)
      }
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    const video = videoRef.current
    if (video) {
      video.pause()
      video.src = ''
      video.load()
    }

    setTimeout(() => {
      reloadStream()
    }, 100)

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      if (hlsRef.current) {
        if (hlsRef.current.fragmentStallTimer) {
          clearTimeout(hlsRef.current.fragmentStallTimer)
        }
        if (hlsRef.current.releaseAutoLevelTimeout) {
          clearTimeout(hlsRef.current.releaseAutoLevelTimeout)
        }
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [playableUrl, reloadStream])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playableUrl) return

    const handleError = (e) => {
      console.error('Video error detected:', e)
      setHasError(true)
      setIsLoading(false)
      if (playableUrl) {
        scheduleRetry()
      }
    }

    const handleStalled = () => {
      if (playableUrl) {
        scheduleRetry()
      }
    }

    const handleSuspended = () => {
      if (!video.paused) {
        scheduleRetry()
      }
    }

    let waitingTimeout = null
    const handleWaiting = () => {
      if (waitingTimeout) clearTimeout(waitingTimeout)
      waitingTimeout = setTimeout(() => {
        if (video.readyState < 3) {
          scheduleRetry()
        }
      }, 10000)
      video.addEventListener('canplay', () => {
        if (waitingTimeout) {
          clearTimeout(waitingTimeout)
          waitingTimeout = null
        }
      }, { once: true })
    }

    const handleEnded = () => {
      if (playableUrl) {
        scheduleRetry()
      }
    }

    video.addEventListener('error', handleError)
    video.addEventListener('stalled', handleStalled)
    video.addEventListener('suspend', handleSuspended)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('ended', handleEnded)

    return () => {
      if (waitingTimeout) clearTimeout(waitingTimeout)
      video.removeEventListener('error', handleError)
      video.removeEventListener('stalled', handleStalled)
      video.removeEventListener('suspend', handleSuspended)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('ended', handleEnded)
    }
  }, [playableUrl, scheduleRetry])

  useEffect(() => {
    return () => {
      if (frameCaptureIntervalRef.current) {
        clearInterval(frameCaptureIntervalRef.current)
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [])

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
                const status = buttonStatus[button.id] || 'checking'
                const isSelected = selectedButtonId === button.id
                return (
                  <button
                    key={button.id}
                    className={`user-button ${isSelected ? 'active' : ''} status-${status}`}
                    onClick={() => handleStreamLaunch(button)}
                  >
                    <div className="user-button-header">
                      <div className="user-button-name-group">
                        <span className="user-button-name">{button.name}</span>
                        <span className="user-button-url">{button.ip || button.url.replace('rtsp://', '').split('/')[0]}</span>
                      </div>
                      <div className="user-button-meta">
                        <span className={`status-dot status-dot-${status}`}></span>
                        <span className="status-text">
                          {status === 'connected' && 'Connected'}
                          {status === 'disconnected' && 'Disconnected'}
                          {status === 'checking' && 'Checking...'}
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
            <h1>User Page</h1>
          </header>

          <div className="user-player">
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
                  captureLastFrame()
                }}
                onTimeUpdate={() => {
                  if (videoRef.current && !videoRef.current.paused && videoRef.current.readyState >= 2) {
                    captureLastFrame()
                  }
                }}
                onError={(e) => {
                  console.error('Video element error:', e)
                  setIsLoading(false)
                  setHasError(true)
                  captureLastFrame()
                }}
                onStalled={() => {
                  console.warn('Video stalled')
                  captureLastFrame()
                  if (playableUrl) {
                    scheduleRetry()
                  }
                }}
              />
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
                  <img src={policeLogo} alt="Police logo" style={{ width: '120px', marginBottom: '16px' }} />
                  <p>📺 Waiting for stream selection</p>
                  <p className="error-subtitle">Please select a stream from the panel to begin.</p>
                </div>
              )}
              {currentOverlayText && (
                <div className="overlay-text">
                  {currentOverlayText}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default UserScreen


