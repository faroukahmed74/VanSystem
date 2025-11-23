// Validation utilities

export function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') return false
  
  const trimmed = ip.trim()
  if (!trimmed) return false
  
  // More permissive IPv4 pattern - accepts any valid IP format
  // Supports all IP ranges: 0.0.0.0 to 255.255.255.255
  // Including: 10.0.0.21, 192.168.x.x, 172.16.x.x, 127.0.0.1, etc.
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  
  const match = trimmed.match(ipv4Pattern)
  if (!match) return false
  
  // Check that each octet is between 0-255
  for (let i = 1; i <= 4; i++) {
    const octet = parseInt(match[i], 10)
    if (isNaN(octet) || octet < 0 || octet > 255) {
      return false
    }
  }
  
  return true
}

export function validateInput(ip, directorateName) {
  const errors = []
  
  if (!ip || !ip.trim()) {
    errors.push('IP address is required')
  } else if (!isValidIP(ip.trim())) {
    errors.push('Please enter a valid IPv4 address (e.g., 192.168.1.100)')
  }
  
  if (!directorateName || !directorateName.trim()) {
    errors.push('Directorate name is required')
  } else if (directorateName.trim().length < 2) {
    errors.push('Directorate name must be at least 2 characters')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

