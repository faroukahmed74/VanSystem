import React, { useRef, useEffect, useState, useCallback } from 'react'
import Hls from 'hls.js'
import { detectStreamType, getPlayableUrl } from '../utils/streamConverter'
import './GridVideoPlayer.css'

function GridVideoPlayer({ streamUrl, overlayText, onError, cellId }) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [playableUrl, setPlayableUrl] = useState(null)
  const retryTimeoutRef = useRef(null)
  const retryCountRef = useRef(0)
  const lastFrameRef = useRef(null)
  const frameCaptureIntervalRef = useRef(null)
  const canvasRef = useRef(null)
  const currentPlayingUrlRef = useRef(null)
  const isStreamPlayingRef = useRef(false)
  const errorReportedRef = useRef(false)
  const scheduleRetryRef = useRef(null) // Ref to store scheduleRetry function to avoid circular dependency
  const reloadStreamRef = useRef(null) // Ref to store reloadStream function to avoid circular dependency
  const retryDelay = 800
  const MAX_RETRIES_BEFORE_ERROR = 3

  const ensureLiveEdge = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.seekable || video.seekable.length === 0) {
      return
    }
    try {
      const liveEdge = video.seekable.end(video.seekable.length - 1)
      const drift = liveEdge - video.currentTime
      if (Number.isFinite(drift) && drift > 2.5) {
        console.warn(`Grid cell ${cellId}: drifted ${drift.toFixed(2)}s behind live edge, skipping ahead`)
        const target = Math.max(video.seekable.start(video.seekable.length - 1), liveEdge - 0.3)
        if (Number.isFinite(target)) {
          video.currentTime = target
        }
      }
    } catch (error) {
      console.warn(`Grid cell ${cellId}: Unable to snap playback to live edge:`, error)
    }
  }, [cellId])

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
    // Don't retry if stream is already playing successfully
    if (isStreamPlayingRef.current && videoRef.current && !videoRef.current.paused && videoRef.current.readyState >= 2) {
      console.log(`Grid cell ${cellId}: Stream is playing, skipping retry`)
      return
    }
    
    // Always retry - no max limit, keep trying until stream starts (like PreviewScreen)
    retryCountRef.current++
    console.log(`Grid cell ${cellId}: Scheduling retry in ${retryDelay}ms (attempt ${retryCountRef.current})`)
    
    // Only report error after multiple retries have failed
    if (retryCountRef.current >= MAX_RETRIES_BEFORE_ERROR && !errorReportedRef.current && onError) {
      errorReportedRef.current = true
      // Delay error notification to give stream more time
      setTimeout(() => {
        if (!isStreamPlayingRef.current && hasError) {
          onError()
        }
      }, 5000)
    }
    
    // Clear any existing retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
    }
    
    retryTimeoutRef.current = setTimeout(() => {
      // Check again if stream is playing
      if (isStreamPlayingRef.current) {
        console.log(`Grid cell ${cellId}: Stream state changed, cancelling retry`)
        return
      }
      
      // Only retry if we have a playable URL and it matches the current stream
      if (playableUrl && videoRef.current && currentPlayingUrlRef.current === playableUrl) {
        console.log(`Grid cell ${cellId}: Attempting to reload stream (attempt ${retryCountRef.current})...`)
        setIsLoading(true)
        setHasError(false)
        // Don't clear the video src - keep the last frame visible
        videoRef.current.load()
        
        const playPromise = videoRef.current.play()
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log(`Grid cell ${cellId}: Stream playing successfully`)
              setIsLoading(false)
              setHasError(false)
              retryCountRef.current = 0
              isStreamPlayingRef.current = true
              errorReportedRef.current = false
            })
            .catch(err => {
              console.error(`Grid cell ${cellId}: Error playing video:`, err)
              setIsLoading(false)
              setHasError(true)
              scheduleRetry()
            })
        }
      } else if (playableUrl && !currentPlayingUrlRef.current) {
        // If playableUrl exists but currentPlayingUrlRef is null, we need to set it and reload
        console.log(`Grid cell ${cellId}: Setting current playing URL and reloading stream (attempt ${retryCountRef.current})...`)
        currentPlayingUrlRef.current = playableUrl
        if (reloadStreamRef.current) {
          reloadStreamRef.current()
        }
      } else {
        // If no playable URL yet, schedule another retry
        console.log(`Grid cell ${cellId}: No playable URL yet, scheduling another retry...`)
        if (scheduleRetryRef.current) {
          scheduleRetryRef.current()
        }
      }
    }, retryDelay)
  }, [playableUrl, cellId, retryDelay, onError, hasError])

  const reloadStream = useCallback(() => {
    if (!playableUrl || !videoRef.current) {
      console.log(`Grid cell ${cellId}: No playable URL or video ref, skipping reload`)
      return
    }

    const video = videoRef.current
    
    // Check if video element is visible and has dimensions before loading
    // Accept any size > 10px to work with dynamic grid dimensions
    if (video && video.parentElement) {
      const rect = video.getBoundingClientRect()
      const computedStyle = window.getComputedStyle(video)
      const hasMinSize = rect.width > 10 && rect.height > 10
      const isNotHidden = computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden'
      
      if (!hasMinSize || !isNotHidden) {
        console.warn(`Grid cell ${cellId}: Video element not ready (width: ${rect.width.toFixed(0)}, height: ${rect.height.toFixed(0)}), retrying in 200ms...`)
        setTimeout(() => {
          if (reloadStreamRef.current && playableUrl === currentPlayingUrlRef.current) {
            reloadStreamRef.current()
          }
        }, 200)
        return
      }
    }

    console.log(`Grid cell ${cellId}: Reloading stream:`, playableUrl)
    setIsLoading(true)
    setHasError(false)
    retryCountRef.current = 0
    isStreamPlayingRef.current = false
    errorReportedRef.current = false

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
        console.error(`Grid cell ${cellId}: Error destroying HLS:`, error)
      }
      hlsRef.current = null
    }

    const isHLS = playableUrl.includes('.m3u8') || playableUrl.includes('/hls/')
    
    // Use ref to call scheduleRetry to avoid circular dependency
    const retryFn = scheduleRetryRef.current
    
    // Ensure video is ready before starting stream
    if (!video) {
      console.warn(`Grid cell ${cellId}: Video element not ready, retrying...`)
      setTimeout(() => {
        if (reloadStreamRef.current) {
          reloadStreamRef.current()
        }
      }, 100)
      return
    }

    if (isHLS && Hls.isSupported()) {
      console.log(`Grid cell ${cellId}: Using HLS.js for HLS stream`)
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
          console.warn(`Grid cell ${cellId}: Detected ${currentLatency.toFixed(2)}s latency, nudging live edge`)
          ensureLiveEdge()
          try {
            hls.startLoad()
            video.play().catch(() => {})
          } catch (error) {
            console.warn(`Grid cell ${cellId}: Unable to nudge HLS stream:`, error)
            if (retryFn) retryFn()
          }
        }
      }, 4000)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log(`Grid cell ${cellId}: HLS manifest parsed, starting playback`)
        console.log(`Grid cell ${cellId}: HLS levels available:`, hls.levels?.length || 0)
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
          console.error(`Grid cell ${cellId}: Error playing HLS video:`, err)
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
            console.warn(`Grid cell ${cellId}: ⚠️ No HLS fragments loaded for ${Math.round(timeSinceLastFragment / 1000)}s, reloading stream...`)
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
        if (video.readyState >= 2 && !isStreamPlayingRef.current) {
          console.log(`Grid cell ${cellId}: HLS stream has enough data, starting playback`)
          video.play()
            .then(() => {
              console.log(`Grid cell ${cellId}: HLS stream playing successfully`)
              setIsLoading(false)
              setHasError(false)
              retryCountRef.current = 0
              isStreamPlayingRef.current = true
              errorReportedRef.current = false // Reset error flag on success
              
              // Start capturing frames periodically
              if (frameCaptureIntervalRef.current) {
                clearInterval(frameCaptureIntervalRef.current)
              }
              frameCaptureIntervalRef.current = setInterval(() => {
                captureLastFrame()
              }, 1000) // Capture frame every second
            })
            .catch(err => {
              console.error(`Grid cell ${cellId}: Error playing HLS video:`, err)
            })
        }
      })
      
      // Also handle when video can play
      video.addEventListener('canplay', () => {
        if (!video.paused && !isStreamPlayingRef.current) {
          console.log(`Grid cell ${cellId}: Video can play, marking as loaded`)
          setIsLoading(false)
          setHasError(false)
          retryCountRef.current = 0
          isStreamPlayingRef.current = true
          errorReportedRef.current = false // Reset error flag on success
          
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
        console.error(`Grid cell ${cellId}: HLS error:`, data)
        console.error(`Grid cell ${cellId}: HLS error details:`, {
          type: data.type,
          details: data.details,
          fatal: data.fatal,
          url: data.url,
          response: data.response
        })
        
        // Check if it's a 503 error (server not ready) - like PreviewScreen
        if (data.response && data.response.code === 503) {
          console.log(`Grid cell ${cellId}: Server returned 503 - playlist not ready yet, will retry...`)
          // Don't mark as error yet, just retry after a delay
          setTimeout(() => {
            if (hlsRef.current && playableUrl && currentPlayingUrlRef.current === playableUrl) {
              console.log(`Grid cell ${cellId}: Retrying HLS load after 503...`)
              try {
                hlsRef.current.loadSource(playableUrl)
              } catch (e) {
                console.error(`Grid cell ${cellId}: Error retrying HLS load after 503:`, e)
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
              console.error(`Grid cell ${cellId}: HLS network error, attempting to recover`)
              // If it's a manifest load error with 503, wait longer
              if (data.details === 'manifestLoadError' && data.response?.code === 503) {
                console.log(`Grid cell ${cellId}: Manifest not ready (503), waiting longer...`)
                setTimeout(() => {
                  if (hlsRef.current && playableUrl && currentPlayingUrlRef.current === playableUrl) {
                    try {
                      hlsRef.current.loadSource(playableUrl)
                    } catch (e) {
                      console.error(`Grid cell ${cellId}: Error retrying manifest load after 503:`, e)
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
                  console.error(`Grid cell ${cellId}: Failed to recover from network error:`, e)
                  setIsLoading(false)
                  setHasError(true)
                  if (retryFn) retryFn()
                }
              }
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error(`Grid cell ${cellId}: HLS media error, attempting to recover`)
              try {
                hls.recoverMediaError()
              } catch (e) {
                console.error(`Grid cell ${cellId}: Failed to recover from media error:`, e)
                setIsLoading(false)
                setHasError(true)
                if (retryFn) retryFn()
              }
              break
            default:
              console.error(`Grid cell ${cellId}: HLS fatal error, cannot recover`)
              setIsLoading(false)
              setHasError(true)
              if (retryFn) retryFn()
              break
          }
        } else {
          // Non-fatal errors, just log
          console.warn(`Grid cell ${cellId}: HLS non-fatal error:`, data)
        }
      })
    } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      console.log(`Grid cell ${cellId}: Using native HLS support`)
      video.src = playableUrl
      video.load()
      video.play()
        .then(() => {
          console.log(`Grid cell ${cellId}: Native HLS stream playing successfully`)
          setIsLoading(false)
          setHasError(false)
          retryCountRef.current = 0
          isStreamPlayingRef.current = true
          errorReportedRef.current = false
        })
        .catch(err => {
          console.error(`Grid cell ${cellId}: Error playing native HLS:`, err)
          setIsLoading(false)
          setHasError(true)
          if (retryFn) retryFn()
        })
    } else {
      // Regular video stream
      console.log(`Grid cell ${cellId}: Using standard video playback`)
      video.src = playableUrl
      video.load()
      
      const playPromise = video.play()
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log(`Grid cell ${cellId}: Stream playing successfully`)
            setIsLoading(false)
            setHasError(false)
            retryCountRef.current = 0
            isStreamPlayingRef.current = true
            errorReportedRef.current = false
          })
          .catch(err => {
            console.error(`Grid cell ${cellId}: Error playing video:`, err)
            setIsLoading(false)
            setHasError(true)
            if (retryFn) retryFn()
          })
      }
    }
  }, [captureLastFrame, ensureLiveEdge, playableUrl, cellId, scheduleRetry, onError])

  // Detect stream type and get playable URL
  useEffect(() => {
    if (!streamUrl) {
      setIsLoading(false)
      setHasError(false)
      setPlayableUrl(null)
      currentPlayingUrlRef.current = null
      isStreamPlayingRef.current = false
      errorReportedRef.current = false
      retryCountRef.current = 0
      // Clean up HLS instance
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
          console.error(`Grid cell ${cellId}: Error destroying HLS:`, error)
        }
        hlsRef.current = null
      }
      return
    }

    // Reset error state when stream URL changes
    errorReportedRef.current = false
    retryCountRef.current = 0
    isStreamPlayingRef.current = false
    setIsLoading(true)
    setHasError(false)
    
    // Clear any existing retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    const info = detectStreamType(streamUrl)
    const url = getPlayableUrl(streamUrl, {
      preferHLS: true
    })
    
    console.log(`Grid cell ${cellId}: Stream URL changed, setting playable URL:`, url)
    setPlayableUrl(url)
  }, [streamUrl, cellId])

  // Update video stream when playable URL changes
  useEffect(() => {
    if (!playableUrl || !videoRef.current) {
      console.log(`Grid cell ${cellId}: ⏸️ Skipping stream reload - no playable URL or video element`)
      return
    }

    // Only reload if the URL actually changed and stream is not already playing
    if (currentPlayingUrlRef.current === playableUrl && isStreamPlayingRef.current) {
      console.log(`Grid cell ${cellId}: Stream already playing this URL, skipping reload:`, playableUrl)
      return
    }

    console.log(`Grid cell ${cellId}: 🎥 Playable URL changed, reloading stream:`, playableUrl)

    // Check if video element is visible and has dimensions
    // Accept any size > 10px to work with dynamic grid dimensions
    const video = videoRef.current
    const checkElementReady = () => {
      if (!video || !video.parentElement) return false
      
      const rect = video.getBoundingClientRect()
      const computedStyle = window.getComputedStyle(video)
      const hasMinSize = rect.width > 10 && rect.height > 10
      const isNotHidden = computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden'
      
      console.log(`Grid cell ${cellId}: Video element check - width: ${rect.width.toFixed(0)}, height: ${rect.height.toFixed(0)}, hasMinSize: ${hasMinSize}, not hidden: ${isNotHidden}`)
      
      return hasMinSize && isNotHidden
    }

    // Reset retry count when URL changes
    retryCountRef.current = 0
    errorReportedRef.current = false
    
    // Clear any existing retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
    
    // Clean up old HLS instance before loading new stream
    if (hlsRef.current) {
      console.log(`Grid cell ${cellId}: 🧹 Cleaning up old HLS instance before loading new stream`)
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
    if (video) {
      video.pause()
      video.src = ''
      video.load()
    }
    
    // Update current playing URL
    currentPlayingUrlRef.current = playableUrl
    isStreamPlayingRef.current = false
    
    // Wait for element to be ready before loading stream
    const attemptLoad = () => {
      if (checkElementReady()) {
        console.log(`Grid cell ${cellId}: Video element is ready, loading stream`)
        if (reloadStreamRef.current) {
          reloadStreamRef.current()
        }
      } else {
        console.log(`Grid cell ${cellId}: Video element not ready yet, retrying in 100ms...`)
        setTimeout(attemptLoad, 100)
      }
    }
    
    // Small delay to ensure cleanup is complete, then check if element is ready
    setTimeout(attemptLoad, 100)

    // Set up a timeout to check if stream started playing - if not, retry
    const initialLoadTimeout = setTimeout(() => {
      const video = videoRef.current
      // If stream hasn't started playing after 5 seconds, trigger a retry
      if (video && playableUrl && currentPlayingUrlRef.current === playableUrl && 
          !isStreamPlayingRef.current) {
        console.warn(`Grid cell ${cellId}: Stream did not start playing after 5 seconds, triggering retry...`)
        if (scheduleRetryRef.current) {
          scheduleRetryRef.current()
        }
      }
    }, 5000) // Check after 5 seconds

    // Cleanup on unmount or URL change
    return () => {
      console.log(`Grid cell ${cellId}: 🧹 Cleaning up stream on URL change`)
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
  }, [playableUrl, cellId])

  // Set up video event listeners for auto-refresh on errors (like PreviewScreen)
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playableUrl) return

    const handleError = (e) => {
      console.error(`Grid cell ${cellId}: Video error detected:`, e)
      const video = e.target
      if (video.error) {
        console.error(`Grid cell ${cellId}: Video error code:`, video.error.code, 'Message:', video.error.message)
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
      console.warn(`Grid cell ${cellId}: Video stalled, attempting to reload...`)
      if (playableUrl && scheduleRetryRef.current) {
        scheduleRetryRef.current()
      }
    }

    const handleSuspend = () => {
      console.warn(`Grid cell ${cellId}: Video suspended, checking if reload needed...`)
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
          console.warn(`Grid cell ${cellId}: Video waiting for too long, attempting reload...`)
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
      console.log(`Grid cell ${cellId}: Stream ended, attempting to reload...`)
      if (playableUrl && scheduleRetryRef.current) {
        scheduleRetryRef.current()
      }
    }

    // Monitor connection state (like PreviewScreen)
    const checkConnection = () => {
      if (video.readyState === 0 && playableUrl) {
        console.warn(`Grid cell ${cellId}: Video has no data, checking connection...`)
        setTimeout(() => {
          if (video.readyState === 0 && !video.paused && scheduleRetryRef.current) {
            console.warn(`Grid cell ${cellId}: Video still has no data, attempting reload...`)
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
      }, 60000) // Check every 60 seconds
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
  }, [playableUrl, cellId])

  // Set refs to avoid circular dependencies
  useEffect(() => {
    scheduleRetryRef.current = scheduleRetry
    reloadStreamRef.current = reloadStream
  }, [scheduleRetry, reloadStream])

  // Use IntersectionObserver to detect when video element becomes visible
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playableUrl) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0) {
            const rect = entry.boundingClientRect
            // Only trigger if element has meaningful dimensions (even small cells like 50x50px)
            if (rect.width > 10 && rect.height > 10) {
              console.log(`Grid cell ${cellId}: Video element became visible (${rect.width.toFixed(0)}x${rect.height.toFixed(0)}px)`)
              
              // If stream is already playing, just ensure it's playing
              if (isStreamPlayingRef.current && !video.paused) {
                console.log(`Grid cell ${cellId}: Stream already playing`)
                return
              }
              
              // If we have a playable URL but stream isn't playing, trigger reload
              if (playableUrl && currentPlayingUrlRef.current === playableUrl) {
                if (!isStreamPlayingRef.current) {
                  console.log(`Grid cell ${cellId}: Triggering stream reload due to visibility`)
                  if (reloadStreamRef.current) {
                    reloadStreamRef.current()
                  }
                } else if (video.paused && video.readyState >= 2) {
                  // Stream is loaded but paused, try to play
                  console.log(`Grid cell ${cellId}: Stream loaded but paused, attempting to play`)
                  video.play().catch(err => {
                    console.error(`Grid cell ${cellId}: Error playing video on visibility:`, err)
                  })
                }
              }
            }
          }
        })
      },
      {
        threshold: 0.01, // Trigger when at least 1% visible (works for any cell size)
        rootMargin: '0px'
      }
    )

    observer.observe(video)

    return () => {
      observer.disconnect()
    }
  }, [playableUrl, cellId])

  // Use ResizeObserver to detect when grid cell dimensions change
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playableUrl) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        // Only act if element has meaningful dimensions
        if (width > 10 && height > 10) {
          console.log(`Grid cell ${cellId}: Cell resized to ${width.toFixed(0)}x${height.toFixed(0)}px`)
          
          // If stream is loaded but not playing, try to play after resize
          if (playableUrl && currentPlayingUrlRef.current === playableUrl && 
              video.readyState >= 2 && video.paused && !isStreamPlayingRef.current) {
            console.log(`Grid cell ${cellId}: Cell resized, attempting to play stream`)
            video.play().catch(err => {
              console.error(`Grid cell ${cellId}: Error playing video after resize:`, err)
              // If play fails, trigger reload
              if (reloadStreamRef.current) {
                setTimeout(() => {
                  if (reloadStreamRef.current && playableUrl === currentPlayingUrlRef.current) {
                    reloadStreamRef.current()
                  }
                }, 500)
              }
            })
          }
        }
      }
    })

    resizeObserver.observe(video)

    return () => {
      resizeObserver.disconnect()
    }
  }, [playableUrl, cellId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
      if (frameCaptureIntervalRef.current) {
        clearInterval(frameCaptureIntervalRef.current)
      }
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
      }
    }
  }, [])

  return (
    <div className="grid-video-player">
      <div className="grid-video-container">
        <video
          ref={videoRef}
          className="grid-video-stream"
          autoPlay
          muted
          playsInline
          controls
          onLoadedData={() => {
            setIsLoading(false)
            setHasError(false)
            isStreamPlayingRef.current = true
            captureLastFrame()
          }}
          onError={(e) => {
            const video = e.target
            const error = video.error
            if (error) {
              console.error(`Grid cell ${cellId}: Video element error:`, {
                code: error.code,
                message: error.message
              })
            }
            setIsLoading(false)
            setHasError(true)
            captureLastFrame()
            // Don't call onError immediately - let retry mechanism handle it
            if (scheduleRetryRef.current) {
              scheduleRetryRef.current()
            }
          }}
          onStalled={() => {
            captureLastFrame()
            if (scheduleRetryRef.current) {
              scheduleRetryRef.current()
            }
          }}
        />
        {hasError && lastFrameRef.current && (
          <img 
            src={lastFrameRef.current} 
            alt="Last frame" 
            className="grid-last-frame-overlay"
          />
        )}
        {isLoading && (
          <div className="grid-loading-indicator">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        )}
        {!streamUrl && !isLoading && (
          <div className="grid-empty-message">
            <p>Drop stream here</p>
          </div>
        )}
        {overlayText && (
          <div className="grid-overlay-text">
            {overlayText}
          </div>
        )}
      </div>
    </div>
  )
}

export default GridVideoPlayer

