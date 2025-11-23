// Stream conversion utilities for RTSP to web-compatible formats

/**
 * Converts RTSP URL to HLS URL (if you have a conversion server)
 * @param {string} rtspUrl - RTSP stream URL
 * @param {string} conversionServer - URL of your RTSP to HLS conversion server
 * @returns {string} HLS URL
 */
export function convertRTSPtoHLS(rtspUrl, conversionServer = 'http://localhost:8092') {
  // Encode the RTSP URL for the conversion server
  const encodedUrl = encodeURIComponent(rtspUrl)
  // Return HLS playlist URL - the server will convert RTSP to HLS
  return `${conversionServer}/hls/${encodedUrl}/playlist.m3u8`
}

/**
 * Converts RTSP URL to WebRTC URL (if you have a WebRTC gateway)
 * @param {string} rtspUrl - RTSP stream URL
 * @param {string} webrtcServer - URL of your WebRTC gateway
 * @returns {string} WebRTC URL
 */
export function convertRTSPtoWebRTC(rtspUrl, webrtcServer = 'http://localhost:8080') {
  const encodedUrl = encodeURIComponent(rtspUrl)
  return `${webrtcServer}/webrtc?url=${encodedUrl}`
}

/**
 * Detects if URL is RTSP and suggests conversion
 * @param {string} url - Stream URL
 * @returns {object} Detection result
 */
export function detectStreamType(url) {
  if (!url) return { type: 'unknown', needsConversion: false }
  
  if (url.startsWith('rtsp://')) {
    return {
      type: 'rtsp',
      needsConversion: true,
      message: 'RTSP streams require conversion to HLS or WebRTC for browser playback'
    }
  }
  
  if (url.includes('.m3u8') || url.includes('hls')) {
    return {
      type: 'hls',
      needsConversion: false,
      message: 'HLS stream - compatible with browsers'
    }
  }
  
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // Check if it's a video file
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov']
    if (videoExtensions.some(ext => url.toLowerCase().includes(ext))) {
      return {
        type: 'http',
        needsConversion: false,
        message: 'HTTP video stream - compatible with browsers'
      }
    }
  }
  
  return {
    type: 'unknown',
    needsConversion: false,
    message: 'Unknown stream type'
  }
}

/**
 * Gets the best playable URL for a stream
 * @param {string} originalUrl - Original stream URL
 * @param {object} options - Conversion options
 * @returns {string} Playable URL
 */
export function getPlayableUrl(originalUrl, options = {}) {
  const { conversionServer, webrtcServer, preferHLS = true } = options
  const streamInfo = detectStreamType(originalUrl)
  
  if (!streamInfo.needsConversion) {
    return originalUrl
  }
  
  // Try to convert RTSP
  if (streamInfo.type === 'rtsp') {
    // Use conversion server (runs on same host as web app)
    // window.location.hostname will be the server's IP when accessed from network
    // e.g., if accessing via 192.168.4.217:8090, hostname will be 192.168.4.217
    const serverHost = window.location.hostname
    const localConverter = `http://${serverHost}:8092`
    
    console.log('Using converter server:', localConverter, 'from hostname:', serverHost)
    
    if (preferHLS) {
      // Use converter server
      return convertRTSPtoHLS(originalUrl, localConverter)
    } else if (webrtcServer) {
      return convertRTSPtoWebRTC(originalUrl, webrtcServer)
    }
  }
  
  // Return original if no conversion available
  return originalUrl
}

