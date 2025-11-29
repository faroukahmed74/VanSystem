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
  const retryDelay = 800
  const MAX_RETRIES_BEFORE_ERROR = 3

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
    if (isStreamPlayingRef.current && videoRef.current && !videoRef.current.paused && videoRef.current.readyState >= 2) {
      return
    }
    
    retryCountRef.current++
    
    // Only report error after multiple retries have failed
    if (retryCountRef.current >= MAX_RETRIES_BEFORE_ERROR && !errorReportedRef.current && onError) {
      errorReportedRef.current = true
      // Delay error notification to give stream more time
      setTimeout(() => {
        if (!isStreamPlayingRef.current) {
          onError()
        }
      }, 5000)
    }
    
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
    }
    
    retryTimeoutRef.current = setTimeout(() => {
      if (playableUrl && videoRef.current && currentPlayingUrlRef.current === playableUrl) {
        console.log(`Grid cell ${cellId}: Retrying stream (attempt ${retryCountRef.current})...`)
        videoRef.current.load()
        videoRef.current.play().catch(() => {
          scheduleRetry()
        })
      }
    }, retryDelay)
  }, [playableUrl, cellId, retryDelay, onError])

  const reloadStream = useCallback(() => {
    if (!playableUrl || !videoRef.current) return

    console.log(`Grid cell ${cellId}: Loading stream:`, playableUrl)
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
    
    const retryFn = scheduleRetry

    if (isHLS && Hls.isSupported()) {
      console.log(`Grid cell ${cellId}: Using HLS.js`)
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
        const currentLatency = typeof hls.latency === 'number' ? hls.latency : null
        if (currentLatency && currentLatency > 2.5) {
          try {
            hls.startLoad()
            video.play().catch(() => {})
          } catch (error) {
            console.warn(`Grid cell ${cellId}: Unable to nudge HLS stream:`, error)
          }
        }
      }, 4000)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.levels && hls.levels.length > 0) {
          hls.currentLevel = 0
          hls.loadLevel = 0
        }
        video.play().catch(err => {
          console.error(`Grid cell ${cellId}: Error playing HLS:`, err)
          setIsLoading(false)
          setHasError(true)
          if (onError) onError()
          retryFn()
        })
      })
      
      let lastFragmentLoadTime = Date.now()
      const FRAGMENT_STALL_TIMEOUT = 15000
      let fragmentStallTimer = null
      
      const resetFragmentStallTimer = () => {
        if (fragmentStallTimer) {
          clearTimeout(fragmentStallTimer)
        }
        lastFragmentLoadTime = Date.now()
        fragmentStallTimer = setTimeout(() => {
          const timeSinceLastFragment = Date.now() - lastFragmentLoadTime
          if (timeSinceLastFragment >= FRAGMENT_STALL_TIMEOUT && hlsRef.current === hls) {
            console.warn(`Grid cell ${cellId}: No fragments for ${Math.round(timeSinceLastFragment / 1000)}s, retrying...`)
            retryFn()
          }
        }, FRAGMENT_STALL_TIMEOUT)
      }
      
      hls.fragmentStallTimer = fragmentStallTimer
      
      hls.on(Hls.Events.FRAG_LOADED, () => {
        captureLastFrame()
        resetFragmentStallTimer()
        hls.fragmentStallTimer = fragmentStallTimer
      })
      
      resetFragmentStallTimer()
      hls.fragmentStallTimer = fragmentStallTimer

      hls.on(Hls.Events.FRAG_PARSING_DATA, () => {
        if (isLoading && video.readyState >= 2) {
          video.play()
            .then(() => {
              setIsLoading(false)
              setHasError(false)
              retryCountRef.current = 0
              isStreamPlayingRef.current = true
              errorReportedRef.current = false // Reset error flag on success
              
              if (frameCaptureIntervalRef.current) {
                clearInterval(frameCaptureIntervalRef.current)
              }
              frameCaptureIntervalRef.current = setInterval(() => {
                captureLastFrame()
              }, 1000)
            })
            .catch(err => {
              console.error(`Grid cell ${cellId}: Error playing:`, err)
            })
        }
      })

      video.addEventListener('canplay', () => {
        if (isLoading && !video.paused) {
          setIsLoading(false)
          setHasError(false)
          retryCountRef.current = 0
          isStreamPlayingRef.current = true
          errorReportedRef.current = false // Reset error flag on success
          
          if (frameCaptureIntervalRef.current) {
            clearInterval(frameCaptureIntervalRef.current)
          }
          frameCaptureIntervalRef.current = setInterval(() => {
            captureLastFrame()
          }, 1000)
        }
      }, { once: true })

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.response && data.response.code === 503) {
          setTimeout(() => {
            if (hlsRef.current && playableUrl && currentPlayingUrlRef.current === playableUrl) {
              try {
                hlsRef.current.loadSource(playableUrl)
              } catch (e) {
                retryFn()
              }
            }
          }, 2000)
          return
        }
        
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              try {
                hls.startLoad()
              } catch (e) {
                console.error(`Grid cell ${cellId}: Network error recovery failed:`, e)
                setIsLoading(false)
                setHasError(true)
                // Don't call onError immediately - let retry mechanism handle it
                retryFn()
              }
              break
            case Hls.ErrorTypes.MEDIA_ERROR:
              try {
                hls.recoverMediaError()
              } catch (e) {
                console.error(`Grid cell ${cellId}: Media error recovery failed:`, e)
                setIsLoading(false)
                setHasError(true)
                // Don't call onError immediately - let retry mechanism handle it
                retryFn()
              }
              break
            default:
              console.error(`Grid cell ${cellId}: Fatal HLS error:`, data)
              setIsLoading(false)
              setHasError(true)
              // Don't call onError immediately - let retry mechanism handle it
              retryFn()
              break
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
          isStreamPlayingRef.current = true
        })
        .catch(err => {
          console.error(`Grid cell ${cellId}: Native HLS play error:`, err)
          setIsLoading(false)
          setHasError(true)
          // Don't call onError immediately - let retry mechanism handle it
          retryFn()
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
          })
          .catch(err => {
            console.error(`Grid cell ${cellId}: Video play error:`, err)
            setIsLoading(false)
            setHasError(true)
            // Don't call onError immediately - let retry mechanism handle it
            retryFn()
          })
      }
    }
  }, [captureLastFrame, isLoading, playableUrl, cellId, scheduleRetry, onError])

  // Detect stream type and get playable URL
  useEffect(() => {
    if (!streamUrl) {
      setIsLoading(false)
      setHasError(false)
      setPlayableUrl(null)
      currentPlayingUrlRef.current = null
      errorReportedRef.current = false
      retryCountRef.current = 0
      return
    }

    // Reset error state when stream URL changes
    errorReportedRef.current = false
    retryCountRef.current = 0
    setIsLoading(true)
    setHasError(false)

    const info = detectStreamType(streamUrl)
    const url = getPlayableUrl(streamUrl, {
      preferHLS: true
    })
    
    setPlayableUrl(url)
  }, [streamUrl])

  // Update video stream when playable URL changes
  useEffect(() => {
    if (!playableUrl || !videoRef.current) {
      return
    }

    if (currentPlayingUrlRef.current === playableUrl && isStreamPlayingRef.current) {
      return
    }

    currentPlayingUrlRef.current = playableUrl
    isStreamPlayingRef.current = false

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
        hlsRef.current = null
      }
    }
  }, [playableUrl, reloadStream])

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
            scheduleRetry()
          }}
          onStalled={() => {
            captureLastFrame()
            scheduleRetry()
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

