import React, { useEffect } from 'react'
import './Notification.css'

function Notification({ message, type = 'error', onClose, duration = 4000 }) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        if (onClose) onClose()
      }, duration)
      return () => clearTimeout(timer)
    }
  }, [duration, onClose])

  return (
    <div className={`notification notification-${type}`}>
      <div className="notification-content">
        <span className="notification-icon">
          {type === 'error' ? '⚠️' : type === 'success' ? '✓' : 'ℹ️'}
        </span>
        <span className="notification-message">{message}</span>
        {onClose && (
          <button className="notification-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export default Notification

