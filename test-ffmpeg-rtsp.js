// Test script to verify FFmpeg can connect to RTSP stream
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const rtspUrl = process.argv[2] || 'rtsp://10.0.0.122:8000/media/video2';
const testOutputDir = path.join(__dirname, 'test-output');

if (!fs.existsSync(testOutputDir)) {
  fs.mkdirSync(testOutputDir, { recursive: true });
}

console.log(`Testing FFmpeg connection to: ${rtspUrl}`);
console.log('This will run for 10 seconds to test the connection...\n');

const ffmpegArgs = [
  '-rtsp_transport', 'tcp',
  '-fflags', 'nobuffer',
  '-flags', 'low_delay',
  '-strict', 'experimental',
  '-i', rtspUrl,
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-tune', 'zerolatency',
  '-profile:v', 'baseline',
  '-level', '3.0',
  '-g', '30',
  '-keyint_min', '30',
  '-sc_threshold', '0',
  '-c:a', 'aac',
  '-ar', '44100',
  '-b:a', '96k',
  '-ac', '2',
  '-hls_time', '2',
  '-hls_list_size', '3',
  '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
  '-hls_segment_type', 'mpegts',
  '-hls_segment_filename', path.join(testOutputDir, 'segment_%03d.ts'),
  '-f', 'hls',
  '-start_number', '0',
  '-hls_allow_cache', '0',
  '-t', '10', // Only run for 10 seconds
  path.join(testOutputDir, 'playlist.m3u8')
];

console.log('FFmpeg command:');
console.log(`ffmpeg ${ffmpegArgs.join(' ')}\n`);

const ffmpeg = spawn('ffmpeg', ffmpegArgs);

let errorOutput = '';
let hasStarted = false;

ffmpeg.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(`STDOUT: ${output.trim()}`);
});

ffmpeg.stderr.on('data', (data) => {
  const output = data.toString();
  errorOutput += output;
  
  // Log all output
  const lines = output.split('\n').filter(l => l.trim());
  lines.forEach((line) => {
    console.log(`STDERR: ${line.trim()}`);
  });
  
  // Check for successful connection
  if (output.includes('Stream #') || output.includes('Output #') || output.includes('frame=') || output.includes('Duration: N/A') || output.includes('start:')) {
    if (!hasStarted) {
      hasStarted = true;
      console.log('\n✅ Stream connection established!\n');
    }
  }
  
  // Log errors
  if (output.toLowerCase().includes('error') || 
      output.includes('Connection refused') || 
      output.includes('Connection timed out') ||
      output.includes('Unable to') ||
      output.includes('Server returned') ||
      output.includes('failed') ||
      output.includes('Invalid') ||
      output.includes('No route to host')) {
    console.error(`\n❌ ERROR: ${output.trim()}\n`);
  }
});

ffmpeg.on('close', (code) => {
  console.log(`\n\nFFmpeg process exited with code: ${code}`);
  
  if (code === 0) {
    console.log('✅ FFmpeg completed successfully!');
    
    // Check if files were created
    const playlistPath = path.join(testOutputDir, 'playlist.m3u8');
    if (fs.existsSync(playlistPath)) {
      console.log('✅ Playlist file created!');
      const playlist = fs.readFileSync(playlistPath, 'utf8');
      console.log('\nPlaylist content:');
      console.log(playlist);
    } else {
      console.log('❌ Playlist file not created');
    }
    
    const segmentFiles = fs.readdirSync(testOutputDir).filter(f => f.endsWith('.ts'));
    if (segmentFiles.length > 0) {
      console.log(`✅ ${segmentFiles.length} segment files created!`);
      segmentFiles.forEach(file => {
        const filePath = path.join(testOutputDir, file);
        const stats = fs.statSync(filePath);
        console.log(`  ${file}: ${stats.size} bytes`);
      });
    } else {
      console.log('❌ No segment files created');
    }
  } else {
    console.error('❌ FFmpeg failed!');
    console.error('\nError output:');
    console.error(errorOutput.substring(Math.max(0, errorOutput.length - 2000)));
  }
  
  process.exit(code);
});

ffmpeg.on('error', (error) => {
  console.error(`❌ FFmpeg spawn error: ${error.message}`);
  process.exit(1);
});

// Timeout after 15 seconds
setTimeout(() => {
  if (!ffmpeg.killed) {
    console.log('\n⏰ Test timeout (15 seconds), killing FFmpeg...');
    ffmpeg.kill();
  }
}, 15000);

