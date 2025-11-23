// RTSP to HLS conversion server
// Converts RTSP streams to HLS format for browser playback
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const net = require('net');

const PORT = 8092; // Conversion server port
const HLS_OUTPUT_DIR = path.join(__dirname, 'hls-output');

// Create output directory if it doesn't exist
if (!fs.existsSync(HLS_OUTPUT_DIR)) {
  fs.mkdirSync(HLS_OUTPUT_DIR, { recursive: true });
}

// Store active FFmpeg processes
const activeStreams = new Map();

// Health check interval to monitor FFmpeg processes
let healthCheckInterval = null;

// Check if FFmpeg is available
function checkFFmpeg() {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-version']);
    ffmpeg.on('close', (code) => {
      resolve(code === 0);
    });
    ffmpeg.on('error', () => {
      resolve(false);
    });
  });
}

// Convert RTSP to HLS
function convertRTSPtoHLS(rtspUrl, streamId) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(HLS_OUTPUT_DIR, streamId);
    
    // Create directory for this stream
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const playlistPath = path.join(outputPath, 'playlist.m3u8');
    const segmentPattern = path.join(outputPath, 'segment_%03d.ts');

    console.log(`FFmpeg output directory: ${outputPath}`);
    console.log(`FFmpeg playlist path: ${playlistPath}`);
    console.log(`FFmpeg segment pattern: ${segmentPattern}`);

    // FFmpeg command to convert RTSP to HLS
    // Optimized for low latency and fast startup
    const ffmpegArgs = [
      '-rtsp_transport', 'tcp', // Use TCP for better reliability
      '-fflags', 'nobuffer', // Disable buffering for low latency
      '-flags', 'low_delay', // Low delay flag
      '-strict', 'experimental', // Allow experimental features
      '-i', rtspUrl,
      '-c:v', 'libx264',
      '-preset', 'ultrafast', // Fastest encoding preset
      '-tune', 'zerolatency', // Zero latency tuning
      '-profile:v', 'baseline', // Baseline profile for faster decoding
      '-level', '3.0', // H.264 level
      '-g', '30', // Smaller GOP size for faster seeking (30 frames = ~1 second at 30fps)
      '-keyint_min', '30', // Minimum keyframe interval
      '-sc_threshold', '0', // Disable scene change detection for faster encoding
      '-c:a', 'aac',
      '-ar', '44100',
      '-b:a', '96k', // Lower audio bitrate for faster encoding
      '-ac', '2', // Stereo
      '-hls_time', '2', // 2 second segments (balance between startup and stability)
      '-hls_list_size', '150', // Keep last 150 segments (5 minutes: 150 segments * 2 seconds = 300 seconds)
      '-hls_flags', 'delete_segments+omit_endlist+independent_segments', // Delete old segments, omit endlist, independent segments
      '-hls_segment_type', 'mpegts', // MPEG-TS segments
      '-hls_segment_filename', segmentPattern,
      '-f', 'hls',
      '-start_number', '0',
      '-hls_allow_cache', '0', // Disable caching for live streams
      playlistPath
    ];

    console.log(`Starting FFmpeg conversion for: ${rtspUrl}`);
    console.log(`FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    let errorOutput = '';
    let hasStarted = false;

    ffmpeg.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`FFmpeg stdout [${streamId}]:`, output.trim());
    });

    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;
      
      // Log ALL FFmpeg output for debugging (first 20 lines to avoid spam)
      const lines = output.split('\n').filter(l => l.trim());
      lines.forEach((line, idx) => {
        if (idx < 20) { // Limit initial logging
          console.log(`FFmpeg [${streamId}]: ${line.trim()}`);
        }
      });
      
      // Check for successful connection
      if (output.includes('Stream #') || output.includes('Output #') || output.includes('frame=') || output.includes('Duration: N/A') || output.includes('start:')) {
        if (!hasStarted) {
          hasStarted = true;
          console.log(`✅ FFmpeg [${streamId}]: Stream connection established`);
        }
      }
      
      // Log errors - be more verbose
      if (output.toLowerCase().includes('error') || 
          output.includes('Connection refused') || 
          output.includes('Connection timed out') ||
          output.includes('Unable to') ||
          output.includes('Server returned') ||
          output.includes('failed') ||
          output.includes('Invalid') ||
          output.includes('No route to host')) {
        console.error(`❌ FFmpeg ERROR [${streamId}]:`, output.trim());
      }
      
      // Log important messages
      if (output.includes('Stream #') || output.includes('Output #') || output.includes('Duration:') || output.includes('frame=') || output.includes('Opening')) {
        console.log(`ℹ️ FFmpeg [${streamId}]:`, output.trim());
      }
      
      // Log when first segment is created and update tracking
      if (output.includes('Opening') && output.includes('.ts')) {
        console.log(`✅ FFmpeg [${streamId}]: Creating segment file`);
        // Update segment tracking
        const streamInfo = activeStreams.get(streamId);
        if (streamInfo) {
          streamInfo.lastSegmentTime = Date.now();
          // Try to count segments
          try {
            const segmentFiles = fs.readdirSync(streamInfo.outputPath)
              .filter(f => f.endsWith('.ts'));
            streamInfo.lastSegmentCount = segmentFiles.length;
          } catch (err) {
            // Ignore errors counting segments
          }
        }
      }
      
      // Also track when frames are being processed (indicates stream is active)
      if (output.includes('frame=') && output.includes('fps=')) {
        const streamInfo = activeStreams.get(streamId);
        if (streamInfo) {
          // Update last activity time (use current time as proxy for segment generation)
          streamInfo.lastSegmentTime = Date.now();
        }
      }
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`❌ FFmpeg process exited with code ${code} for stream: ${streamId}`);
        console.error(`RTSP URL: ${rtspUrl}`);
        console.error(`FFmpeg error output (last 2000 chars):\n${errorOutput.substring(Math.max(0, errorOutput.length - 2000))}`);
        activeStreams.delete(streamId);
        
        // Provide more helpful error message
        let errorMessage = `FFmpeg conversion failed with code ${code}`;
        if (errorOutput.includes('Connection refused')) {
          errorMessage += ': Connection refused - Check if RTSP server is running and accessible';
        } else if (errorOutput.includes('Connection timed out')) {
          errorMessage += ': Connection timed out - Check network connectivity and RTSP URL';
        } else if (errorOutput.includes('401') || errorOutput.includes('Unauthorized')) {
          errorMessage += ': Authentication failed - Check RTSP credentials';
        } else if (errorOutput.includes('404')) {
          errorMessage += ': Stream not found - Check RTSP URL path';
        }
        
        reject(new Error(`${errorMessage}. Output: ${errorOutput.substring(0, 500)}`));
      } else {
        console.log(`FFmpeg process exited normally (code ${code}) for stream: ${streamId}`);
      }
    });

    ffmpeg.on('error', (error) => {
      console.error(`FFmpeg spawn error for stream ${streamId}:`, error);
      activeStreams.delete(streamId);
      reject(error);
    });

    // Wait a bit to see if FFmpeg starts successfully and connects
    setTimeout(() => {
      if (ffmpeg.killed) {
        console.error(`❌ FFmpeg process was killed before starting for: ${streamId}`);
        console.error(`Error output (first 2000 chars):\n${errorOutput.substring(0, 2000)}`);
        activeStreams.delete(streamId);
        reject(new Error(`FFmpeg process was killed. Error: ${errorOutput.substring(0, 500)}`));
      } else if (hasStarted) {
          activeStreams.set(streamId, { 
            process: ffmpeg, 
            rtspUrl, 
            outputPath,
            lastSegmentTime: Date.now(), // Track when last segment was created
            lastSegmentCount: 0, // Track segment count
            restartCount: 0 // Track how many times we've restarted
          });
          console.log(`✅ FFmpeg conversion started successfully for: ${streamId}`);
          resolve();
      } else {
        // Still waiting, but accept it anyway (might be slow connection)
        // Check if there are any critical errors
        const hasCriticalError = errorOutput.includes('Connection refused') || 
            errorOutput.includes('Connection timed out') || 
            errorOutput.includes('Unable to') ||
            errorOutput.includes('No route to host') ||
            errorOutput.includes('Invalid data found') ||
            errorOutput.includes('401 Unauthorized') ||
            errorOutput.includes('404 Not Found') ||
            errorOutput.includes('Server returned') ||
            errorOutput.toLowerCase().includes('authentication') ||
            errorOutput.toLowerCase().includes('unauthorized');
            
        if (hasCriticalError) {
          console.error(`❌ FFmpeg connection failed for: ${streamId}`);
          console.error(`RTSP URL: ${rtspUrl}`);
          console.error(`Error output (first 2000 chars):\n${errorOutput.substring(0, 2000)}`);
          ffmpeg.kill();
          activeStreams.delete(streamId);
          reject(new Error(`FFmpeg connection failed: ${errorOutput.substring(0, 500)}`));
        } else {
          // Check if we have any output at all (might be silent failure)
          if (errorOutput.length === 0) {
            console.log(`⏳ FFmpeg still initializing for: ${streamId} (no output yet, might be connecting)...`);
          } else {
            console.log(`⏳ FFmpeg still initializing for: ${streamId}, accepting anyway...`);
            console.log(`Current output (first 1000 chars):\n${errorOutput.substring(0, 1000)}`);
          }
          activeStreams.set(streamId, { 
            process: ffmpeg, 
            rtspUrl, 
            outputPath,
            lastSegmentTime: Date.now(),
            lastSegmentCount: 0,
            restartCount: 0
          });
          resolve();
        }
      }
    }, 10000); // Increased to 10 seconds to allow more time for RTSP connection
  });
}

// Generate stream ID from RTSP URL
// Use SHA256 hash to ensure unique IDs for different URLs
function getStreamId(rtspUrl) {
  // Create a hash of the full RTSP URL to ensure uniqueness
  const hash = crypto.createHash('sha256').update(rtspUrl).digest('hex');
  // Use first 32 characters of hash (enough for uniqueness, not too long for paths)
  return hash.substring(0, 32);
}

// Health check function to monitor FFmpeg processes and restart if needed
function performHealthCheck() {
  const now = Date.now();
  const STALL_THRESHOLD = 30000; // 30 seconds - if no new segments for 30s, restart
  const MAX_RESTARTS = 5; // Maximum number of restarts per stream
  
  activeStreams.forEach(async (streamInfo, streamId) => {
    const { process, rtspUrl, outputPath, lastSegmentTime, lastSegmentCount, restartCount } = streamInfo;
    
    // Check if process is still running
    if (!process || process.killed) {
      console.log(`⚠️ FFmpeg process ${streamId} is not running, removing from active streams`);
      activeStreams.delete(streamId);
      return;
    }
    
    // Check if segments are still being generated
    try {
      const segmentFiles = fs.readdirSync(outputPath)
        .filter(f => f.endsWith('.ts'))
        .map(f => {
          const filePath = path.join(outputPath, f);
          const stats = fs.statSync(filePath);
          return { name: f, mtime: stats.mtime.getTime(), size: stats.size };
        })
        .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first
      
      if (segmentFiles.length > 0) {
        const newestSegment = segmentFiles[0];
        const currentSegmentCount = segmentFiles.length;
        
        // Check if we have new segments or if the newest segment was recently modified
        const timeSinceLastSegment = now - newestSegment.mtime;
        const hasNewSegments = currentSegmentCount > lastSegmentCount;
        const segmentRecentlyModified = timeSinceLastSegment < STALL_THRESHOLD;
        
        if (hasNewSegments || segmentRecentlyModified) {
          // Stream is healthy - update tracking
          streamInfo.lastSegmentTime = newestSegment.mtime;
          streamInfo.lastSegmentCount = currentSegmentCount;
          return;
        }
        
        // No new segments and oldest segment is stale - stream might be stuck
        if (timeSinceLastSegment >= STALL_THRESHOLD && restartCount < MAX_RESTARTS) {
          console.warn(`⚠️ Stream ${streamId} appears stalled (no new segments for ${Math.round(timeSinceLastSegment / 1000)}s), restarting FFmpeg...`);
          console.warn(`  RTSP URL: ${rtspUrl}`);
          console.warn(`  Last segment: ${newestSegment.name} (${Math.round(timeSinceLastSegment / 1000)}s ago)`);
          console.warn(`  Total segments: ${currentSegmentCount}`);
          console.warn(`  Restart count: ${restartCount + 1}/${MAX_RESTARTS}`);
          
          // Kill the existing process
          if (process && !process.killed) {
            process.kill();
          }
          
          // Remove from active streams
          activeStreams.delete(streamId);
          
          // Clean up old output directory
          try {
            fs.rmSync(outputPath, { recursive: true, force: true });
            console.log(`Cleaned up output directory: ${outputPath}`);
          } catch (err) {
            console.error(`Error cleaning up output directory: ${err}`);
          }
          
          // Restart FFmpeg
          try {
            streamInfo.restartCount = restartCount + 1;
            await convertRTSPtoHLS(rtspUrl, streamId);
            // Update the restart count in the new stream info
            const newStreamInfo = activeStreams.get(streamId);
            if (newStreamInfo) {
              newStreamInfo.restartCount = restartCount + 1;
            }
            console.log(`✅ Restarted FFmpeg for stream ${streamId}`);
          } catch (error) {
            console.error(`❌ Failed to restart FFmpeg for stream ${streamId}:`, error.message);
            activeStreams.delete(streamId);
          }
        } else if (restartCount >= MAX_RESTARTS) {
          console.error(`❌ Stream ${streamId} has exceeded max restart attempts (${MAX_RESTARTS}), giving up`);
          if (process && !process.killed) {
            process.kill();
          }
          activeStreams.delete(streamId);
        }
      } else {
        // No segments at all - check if we should restart
        const timeSinceStart = now - (lastSegmentTime || now);
        if (timeSinceStart >= STALL_THRESHOLD && restartCount < MAX_RESTARTS) {
          console.warn(`⚠️ Stream ${streamId} has no segments after ${Math.round(timeSinceStart / 1000)}s, restarting FFmpeg...`);
          
          // Kill the existing process
          if (process && !process.killed) {
            process.kill();
          }
          
          // Remove from active streams
          activeStreams.delete(streamId);
          
          // Clean up and restart
          try {
            fs.rmSync(outputPath, { recursive: true, force: true });
          } catch (err) {
            console.error(`Error cleaning up output directory: ${err}`);
          }
          
          try {
            streamInfo.restartCount = restartCount + 1;
            await convertRTSPtoHLS(rtspUrl, streamId);
            const newStreamInfo = activeStreams.get(streamId);
            if (newStreamInfo) {
              newStreamInfo.restartCount = restartCount + 1;
            }
            console.log(`✅ Restarted FFmpeg for stream ${streamId}`);
          } catch (error) {
            console.error(`❌ Failed to restart FFmpeg for stream ${streamId}:`, error.message);
            activeStreams.delete(streamId);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error checking health for stream ${streamId}:`, error.message);
      // If we can't check the directory, the stream might be broken - restart it
      if (restartCount < MAX_RESTARTS) {
        console.warn(`⚠️ Cannot access output directory for ${streamId}, restarting...`);
        if (process && !process.killed) {
          process.kill();
        }
        activeStreams.delete(streamId);
        
        try {
          fs.rmSync(outputPath, { recursive: true, force: true });
        } catch (err) {
          // Ignore cleanup errors
        }
        
        try {
          streamInfo.restartCount = restartCount + 1;
          await convertRTSPtoHLS(rtspUrl, streamId);
          const newStreamInfo = activeStreams.get(streamId);
          if (newStreamInfo) {
            newStreamInfo.restartCount = restartCount + 1;
          }
        } catch (err) {
          console.error(`❌ Failed to restart FFmpeg:`, err.message);
          activeStreams.delete(streamId);
        }
      }
    }
  });
}

// Get server's network IP address
function getServerNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (url.pathname === '/health') {
    const hasFFmpeg = await checkFFmpeg();
    const streamList = Array.from(activeStreams.keys());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      ffmpegAvailable: hasFFmpeg,
      activeStreams: activeStreams.size,
      streams: streamList.map(id => {
        const stream = activeStreams.get(id);
        return {
          id,
          rtspUrl: stream?.rtspUrl,
          outputPath: stream?.outputPath
        };
      })
    }));
    return;
  }

  // Ping endpoint - check if an IP is reachable
  if (url.pathname === '/ping') {
    const ip = url.searchParams.get('ip');
    const port = url.searchParams.get('port') || '8000';
    
    if (!ip) {
      res.writeHead(400, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: 'IP parameter required' }));
      return;
    }
    
    // Validate IP format
    const ipPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipPattern.test(ip)) {
      res.writeHead(400, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: 'Invalid IP format' }));
      return;
    }
    
    // Try to connect to the IP:port using a TCP socket
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 3000; // 3 second timeout
      
      socket.setTimeout(timeout);
      
      socket.on('connect', () => {
        const responseTime = Date.now() - startTime;
        socket.destroy();
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ 
          reachable: true, 
          ip, 
          port,
          responseTime 
        }));
        resolve();
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ 
          reachable: false, 
          ip, 
          port,
          error: 'Connection timeout'
        }));
        resolve();
      });
      
      socket.on('error', (error) => {
        socket.destroy();
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ 
          reachable: false, 
          ip, 
          port,
          error: error.message || 'Connection failed'
        }));
        resolve();
      });
      
      socket.connect(parseInt(port), ip);
    });
  }

  // Convert RTSP to HLS endpoint
  if (url.pathname.startsWith('/hls/')) {
    // Extract encoded URL from path
    // Format: /hls/{encodedUrl}/playlist.m3u8 or /hls/{encodedUrl}/segment_000.ts
    // The encoded URL may contain slashes, so we need to be careful
    let pathAfterHls = url.pathname.replace('/hls/', '');
    
    let encodedUrl;
    // Check if it's a playlist request
    if (pathAfterHls.endsWith('/playlist.m3u8')) {
      encodedUrl = pathAfterHls.replace('/playlist.m3u8', '');
    } else if (pathAfterHls.includes('/segment_')) {
      // For segment requests, extract the encoded URL part (everything before /segment_)
      const segmentIndex = pathAfterHls.indexOf('/segment_');
      encodedUrl = pathAfterHls.substring(0, segmentIndex);
    } else {
      // Fallback: try to extract everything before the last slash
      const lastSlash = pathAfterHls.lastIndexOf('/');
      if (lastSlash > 0) {
        encodedUrl = pathAfterHls.substring(0, lastSlash);
      } else {
        encodedUrl = pathAfterHls;
      }
    }
    
    // Remove leading/trailing slashes from encoded URL
    encodedUrl = encodedUrl.replace(/^\/+|\/+$/g, '');
    
    // CRITICAL FIX: The encoded URL might contain the full server URL if it was incorrectly
    // constructed in the playlist. We need to extract only the RTSP URL part.
    // Look for the pattern "rtsp%3A%2F%2F" (encoded "rtsp://") to find where the RTSP URL starts
    const rtspUrlStartPattern = /rtsp%3A%2F%2F/i; // Case-insensitive match for "rtsp://"
    const rtspStartIndex = encodedUrl.search(rtspUrlStartPattern);
    
    if (rtspStartIndex > 0) {
      // The encoded URL contains extra stuff before the RTSP URL
      // Extract only the RTSP URL part (from "rtsp://" to the end, but before any http:// or https://)
      const rtspPart = encodedUrl.substring(rtspStartIndex);
      // Also check if there's an http:// or https:// after the RTSP URL (which would be wrong)
      const httpIndex = rtspPart.search(/https?%3A%2F%2F/i);
      if (httpIndex > 0) {
        // There's an HTTP URL after the RTSP URL - this is wrong, extract only the RTSP part
        encodedUrl = rtspPart.substring(0, httpIndex);
      } else {
        encodedUrl = rtspPart;
      }
    } else if (rtspStartIndex === -1) {
      // No RTSP URL found in the encoded string - might be a malformed request
      // Try to find if there's an http:// or https:// in the encoded URL (which would be wrong)
      const httpPattern = /https?%3A%2F%2F/i;
      const httpIndex = encodedUrl.search(httpPattern);
      if (httpIndex >= 0) {
        // There's an HTTP URL in the encoded string - this is wrong
        // Try to extract the RTSP URL that might be after it
        const afterHttp = encodedUrl.substring(httpIndex);
        const rtspInAfter = afterHttp.search(rtspUrlStartPattern);
        if (rtspInAfter >= 0) {
          // Found RTSP URL after the HTTP URL
          const rtspPart = afterHttp.substring(rtspInAfter);
          // Check if there's another HTTP URL after this RTSP URL
          const nextHttp = rtspPart.search(/https?%3A%2F%2F/i);
          if (nextHttp > 0) {
            encodedUrl = rtspPart.substring(0, nextHttp);
          } else {
            encodedUrl = rtspPart;
          }
        } else {
          // No RTSP URL found - this is a malformed request
          console.error(`❌ No RTSP URL found in encoded string: ${encodedUrl}`);
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid request: No RTSP URL found');
          return;
        }
      }
    }
    
    // Remove any trailing slashes or path segments that might have been incorrectly included
    // The encoded RTSP URL should end with the path part of the RTSP URL
    // We know it should start with "rtsp%3A%2F%2F" and end with the media path
    // Remove any trailing "/" or path-like segments that don't belong
    encodedUrl = encodedUrl.replace(/\/+$/, ''); // Remove trailing slashes
    
    let rtspUrl;
    try {
      rtspUrl = decodeURIComponent(encodedUrl);
      console.log(`📺 Request path: ${url.pathname}`);
      console.log(`📺 Encoded URL (after cleanup): ${encodedUrl}`);
      console.log(`📺 Decoded RTSP URL: ${rtspUrl}`);
      
      // Validate RTSP URL format - it must start with rtsp://
      if (!rtspUrl.startsWith('rtsp://')) {
        console.error(`❌ Invalid RTSP URL format: ${rtspUrl}`);
        console.error(`❌ Original encoded URL was: ${encodedUrl}`);
        res.writeHead(400, { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        res.end('Invalid RTSP URL format');
        return;
      }
      
      // Additional validation: ensure the RTSP URL doesn't contain http:// or https://
      if (rtspUrl.includes('http://') || rtspUrl.includes('https://')) {
        console.error(`❌ RTSP URL contains HTTP URL (malformed): ${rtspUrl}`);
        // Try to extract just the RTSP part
        const rtspIndex = rtspUrl.indexOf('rtsp://');
        const httpIndex = rtspUrl.indexOf('http://', rtspIndex + 7);
        const httpsIndex = rtspUrl.indexOf('https://', rtspIndex + 7);
        const firstHttpIndex = httpIndex > 0 ? httpIndex : (httpsIndex > 0 ? httpsIndex : -1);
        
        if (firstHttpIndex > 0) {
          rtspUrl = rtspUrl.substring(0, firstHttpIndex);
          console.log(`📺 Extracted RTSP URL: ${rtspUrl}`);
        } else {
          console.error(`❌ Could not extract valid RTSP URL from: ${rtspUrl}`);
          res.writeHead(400, { 
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          });
          res.end('Invalid RTSP URL: contains HTTP URLs');
          return;
        }
      }
    } catch (error) {
      console.error(`❌ Error decoding RTSP URL: ${error.message}`);
      console.error(`❌ Encoded URL: ${encodedUrl}`);
      console.error(`❌ Full path: ${url.pathname}`);
      res.writeHead(400, { 
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      res.end('Invalid RTSP URL encoding');
      return;
    }
    
    const streamId = getStreamId(rtspUrl);
    console.log(`🆔 Stream ID for ${rtspUrl}: ${streamId}`);
    const playlistPath = path.join(HLS_OUTPUT_DIR, streamId, 'playlist.m3u8');

    // Check if stream is already being converted
    const existingStream = activeStreams.get(streamId);
    if (existingStream) {
      // Verify that the existing stream is for the same RTSP URL
      if (existingStream.rtspUrl !== rtspUrl) {
        console.log(`⚠️ Stream ID collision detected!`);
        console.log(`  Existing stream RTSP URL: ${existingStream.rtspUrl}`);
        console.log(`  New stream RTSP URL: ${rtspUrl}`);
        console.log(`  Stream ID: ${streamId}`);
        console.log(`  Killing old stream and starting new one...`);
        
        // Kill the old FFmpeg process
        if (existingStream.process && !existingStream.process.killed) {
          existingStream.process.kill();
        }
        activeStreams.delete(streamId);
        
        // Clean up old output directory
        const oldOutputPath = path.join(HLS_OUTPUT_DIR, streamId);
        if (fs.existsSync(oldOutputPath)) {
          try {
            fs.rmSync(oldOutputPath, { recursive: true, force: true });
            console.log(`Cleaned up old output directory: ${oldOutputPath}`);
          } catch (err) {
            console.error(`Error cleaning up output directory: ${err}`);
          }
        }
      } else {
        // Same RTSP URL, check if FFmpeg process is still running and healthy
        const isRunning = existingStream.process && !existingStream.process.killed;
        if (!isRunning) {
          console.log(`FFmpeg process for ${streamId} is not running, restarting...`);
          activeStreams.delete(streamId);
          // Clean up old output directory
          const oldOutputPath = path.join(HLS_OUTPUT_DIR, streamId);
          if (fs.existsSync(oldOutputPath)) {
            try {
              fs.rmSync(oldOutputPath, { recursive: true, force: true });
              console.log(`Cleaned up old output directory: ${oldOutputPath}`);
            } catch (err) {
              console.error(`Error cleaning up output directory: ${err}`);
            }
          }
        } else {
          // Check if segments are being created (not empty)
          const segmentPath = path.join(existingStream.outputPath, 'segment_000.ts');
          if (fs.existsSync(segmentPath)) {
            const stats = fs.statSync(segmentPath);
            if (stats.size === 0) {
              console.log(`Segment file is empty for ${streamId}, restarting FFmpeg...`);
              existingStream.process.kill();
              activeStreams.delete(streamId);
              // Clean up old output directory
              try {
                fs.rmSync(existingStream.outputPath, { recursive: true, force: true });
                console.log(`Cleaned up empty output directory: ${existingStream.outputPath}`);
              } catch (err) {
                console.error(`Error cleaning up output directory: ${err}`);
              }
            } else {
              console.log(`✅ Stream ${streamId} is already active with valid segments (${stats.size} bytes) for ${rtspUrl}`);
            }
          }
        }
      }
    }
    
    // Start conversion if not already running or if we cleaned up
    if (!activeStreams.has(streamId)) {
      try {
        console.log(`🚀 Starting new FFmpeg conversion for: ${rtspUrl}`);
        console.log(`🆔 Stream ID: ${streamId}`);
        await convertRTSPtoHLS(rtspUrl, streamId);
        console.log(`✅ FFmpeg conversion initiated successfully`);
      } catch (error) {
        console.error('❌ Conversion error:', error.message);
        console.error('❌ Full error:', error);
        res.writeHead(500, { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(`Failed to start conversion: ${error.message}. Check server console for details.`);
        return;
      }
    } else {
      console.log(`ℹ️ Stream ${streamId} is already being converted`);
    }

    // Wait for playlist file to be created and first segment to have content
    let attempts = 0;
    const maxAttempts = 30; // Wait up to 15 seconds (30 * 500ms)
    let playlistReady = false;
    let segmentReady = false;
    const outputPath = path.join(HLS_OUTPUT_DIR, streamId);
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
      
      // Check if FFmpeg process is still running
      const streamInfo = activeStreams.get(streamId);
      if (streamInfo && streamInfo.process.killed) {
        console.error(`FFmpeg process was killed while waiting for playlist: ${streamId}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('FFmpeg conversion process failed. Check server logs for details.');
        return;
      }
      
      // Check if playlist exists
      if (fs.existsSync(playlistPath)) {
        playlistReady = true;
        
        // Check if at least one segment exists and has content
        const firstSegment = path.join(outputPath, 'segment_000.ts');
        if (fs.existsSync(firstSegment)) {
          const stats = fs.statSync(firstSegment);
          if (stats.size > 0) {
            segmentReady = true;
            console.log(`✅ Playlist and segment ready for ${streamId} (segment size: ${stats.size} bytes)`);
            break;
          } else {
            console.log(`⏳ Waiting for segment content... (attempt ${attempts}/${maxAttempts}, segment size: ${stats.size} bytes)`);
          }
        } else {
          console.log(`⏳ Waiting for first segment... (attempt ${attempts}/${maxAttempts})`);
        }
      } else {
        console.log(`⏳ Waiting for playlist... (attempt ${attempts}/${maxAttempts})`);
      }
    }
    
    if (!playlistReady || !segmentReady) {
      console.error(`❌ Playlist or segment not ready after ${maxAttempts} attempts for ${streamId}`);
      const streamInfo = activeStreams.get(streamId);
      const isRunning = streamInfo && streamInfo.process && !streamInfo.process.killed;
      console.log(`FFmpeg process running: ${isRunning}`);
      
      if (fs.existsSync(playlistPath)) {
        const playlistContent = fs.readFileSync(playlistPath, 'utf8');
        console.log(`Playlist content (first 500 chars):\n${playlistContent.substring(0, 500)}`);
      }
      
      // Check segment files
      if (fs.existsSync(outputPath)) {
        const segmentFiles = fs.readdirSync(outputPath).filter(f => f.endsWith('.ts'));
        console.log(`Segment files found: ${segmentFiles.length}`);
        segmentFiles.forEach(file => {
          const filePath = path.join(outputPath, file);
          const stats = fs.statSync(filePath);
          console.log(`  ${file}: ${stats.size} bytes`);
        });
      }
    }

    if (playlistReady && segmentReady) {
      console.log(`Serving playlist for stream: ${streamId} (waited ${attempts * 500}ms)`);
      // Serve HLS playlist
      if (url.pathname.endsWith('.m3u8')) {
        const playlist = fs.readFileSync(playlistPath, 'utf8');
        console.log(`Original playlist for ${streamId} (first 300 chars):`, playlist.substring(0, 300));
        // Get the server host and port from the request
        // Use the request's host header, which contains the IP the client used to connect
        let host = req.headers.host;
        
        // Extract IP from host header (remove port if present)
        let clientIP = null;
        if (host) {
          const hostParts = host.split(':');
          clientIP = hostParts[0];
        }
        
        // If host is localhost or 127.0.0.1, or if we need to ensure network access
        // Try to get the actual network IP
        if (!host || host.includes('localhost') || host.includes('127.0.0.1') || clientIP === '127.0.0.1') {
          // Get the actual network interface IP
          const networkIP = getServerNetworkIP();
          if (networkIP) {
            host = `${networkIP}:${PORT}`;
            console.log(`Using network IP for playlist: ${host}`);
          } else {
            // Fallback: try to get from the request socket
            const localAddress = req.socket.localAddress;
            if (localAddress && localAddress !== '::' && localAddress !== '0.0.0.0' && localAddress !== '127.0.0.1') {
              host = `${localAddress}:${PORT}`;
              console.log(`Using socket address for playlist: ${host}`);
            } else {
              // Last resort: use the host header or default
              host = host || `localhost:${PORT}`;
              console.log(`Using host header for playlist: ${host}`);
            }
          }
        } else {
          // Host header looks good, use it
          console.log(`Using client-provided host for playlist: ${host}`);
        }
        
        const protocol = req.connection.encrypted ? 'https' : 'http';
        const baseUrl = `${protocol}://${host}`;
        
        console.log(`Serving playlist with baseUrl: ${baseUrl} (original host header: ${req.headers.host})`);
        
        // Update segment paths to be absolute URLs pointing to this server
        // This ensures network users can access segments from the server
        // Handle both relative paths (segment_000.ts) and absolute paths
        let updatedPlaylist = playlist;
        
        // CRITICAL: Use the clean encoded URL (the one we extracted/cleaned earlier)
        // This ensures we don't create malformed URLs
        const cleanEncodedUrl = encodeURIComponent(rtspUrl);
        
        // Step 1: Replace ALL absolute URLs (including malformed ones) with correct ones
        // This pattern matches any absolute URL that contains /hls/ and ends with segment_XXX.ts
        // It will catch malformed URLs like: http://.../hls/.../http://.../hls/.../segment_000.ts
        updatedPlaylist = updatedPlaylist.replace(
          /https?:\/\/[^\s\r\n]*\/hls\/[^\s\r\n]*\/segment_\d+\.ts/gi,
          (match) => {
            // Extract just the segment filename (last occurrence in case of malformed URL)
            const segmentMatches = match.match(/segment_\d+\.ts/g);
            if (segmentMatches && segmentMatches.length > 0) {
              const segmentName = segmentMatches[segmentMatches.length - 1]; // Get last match
              return `${baseUrl}/hls/${cleanEncodedUrl}/${segmentName}`;
            }
            return match;
          }
        );
        
        // Step 2: Handle relative segment paths (lines that just have segment_XXX.ts)
        // Match segment names that are on their own line (after #EXTINF)
        // Only match if the line doesn't already start with http:// or https://
        updatedPlaylist = updatedPlaylist.replace(
          /^(segment_\d+\.ts)$/gm,
          (match) => {
            return `${baseUrl}/hls/${cleanEncodedUrl}/${match}`;
          }
        );
        
        // Step 3: Handle any remaining relative paths that might have been missed
        // This catches segment_XXX.ts that might be on lines with other content
        updatedPlaylist = updatedPlaylist.replace(
          /([\r\n])(segment_\d+\.ts)([\r\n\s]|$)/g,
          (match, lineBreak, segmentName, suffix) => {
            // Check if this line already has an absolute URL by looking at the line
            const lineStart = match;
            if (lineStart.includes('http://') || lineStart.includes('https://')) {
              // Already has an absolute URL, skip
              return match;
            }
            // Make it absolute with correct server IP and clean encoded URL
            return `${lineBreak}${baseUrl}/hls/${cleanEncodedUrl}/${segmentName}${suffix}`;
          }
        );
        
        // Step 4: Replace any localhost or 127.0.0.1 in existing absolute URLs with the correct host
        updatedPlaylist = updatedPlaylist.replace(
          /https?:\/\/(localhost|127\.0\.0\.1):8092/g,
          baseUrl
        );
        
        console.log(`Updated playlist for ${streamId} (first 500 chars):`, updatedPlaylist.substring(0, 500));
        res.writeHead(200, { 
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(updatedPlaylist);
      } else if (url.pathname.endsWith('.ts')) {
        // Serve HLS segments
        const segmentName = url.pathname.split('/').pop();
        const segmentPath = path.join(HLS_OUTPUT_DIR, streamId, segmentName);
        console.log(`Segment request: ${segmentName} from ${req.headers.host || 'unknown'}, path: ${segmentPath}`);
        if (fs.existsSync(segmentPath)) {
          const segment = fs.readFileSync(segmentPath);
          console.log(`Serving segment: ${segmentName} (${segment.length} bytes)`);
          res.writeHead(200, { 
            'Content-Type': 'video/mp2t',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(segment);
        } else {
          console.error(`Segment not found: ${segmentPath}`);
          res.writeHead(404, { 
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          });
          res.end('Segment not found');
        }
      } else {
        console.log(`404: Segment not found: ${url.pathname}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    } else {
      const streamInfo = activeStreams.get(streamId);
      const isRunning = streamInfo && !streamInfo.process.killed;
      console.log(`503: Playlist not ready yet for stream: ${streamId}, attempts: ${attempts}/${maxAttempts}, FFmpeg running: ${isRunning}`);
      
      // Check if FFmpeg is still running
      if (!isRunning) {
        console.error(`FFmpeg process died for stream: ${streamId}`);
        activeStreams.delete(streamId);
        res.writeHead(500, { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        });
        res.end('FFmpeg conversion failed. The RTSP stream may be unreachable or invalid. Check server console for details.');
        return;
      }
      
      res.writeHead(503, { 
        'Content-Type': 'text/plain',
        'Retry-After': '2',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(`Stream is starting, please wait... (attempt ${attempts}/${maxAttempts})`);
    }
    return;
  }

  // Default response
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', async () => {
  const hasFFmpeg = await checkFFmpeg();
  const networkIP = getServerNetworkIP();
  console.log(`RTSP Conversion Server running on http://0.0.0.0:${PORT}`);
  if (networkIP) {
    console.log(`Network access: http://${networkIP}:${PORT}`);
  }
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`FFmpeg available: ${hasFFmpeg ? 'Yes' : 'No (FFmpeg is required for RTSP conversion)'}`);
  
  if (!hasFFmpeg) {
    console.log('\n⚠️  WARNING: FFmpeg is not installed or not in PATH');
    console.log('Please install FFmpeg to enable RTSP stream conversion:');
    console.log('  Windows: Download from https://ffmpeg.org/download.html');
    console.log('  Or use: winget install ffmpeg');
    console.log('  Or use: choco install ffmpeg');
  }
  
  // Start health check interval (check every 10 seconds)
  healthCheckInterval = setInterval(() => {
    performHealthCheck();
  }, 10000);
  console.log('✅ Health check monitor started (checks every 10 seconds)');
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\nShutting down RTSP converter...');
  
  // Stop health check interval
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  
  activeStreams.forEach((stream, streamId) => {
    console.log(`Stopping stream: ${streamId}`);
    if (stream.process && !stream.process.killed) {
      stream.process.kill();
    }
  });
  server.close(() => {
    process.exit(0);
  });
});

