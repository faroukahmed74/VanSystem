import React, { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import EditorScreen from './screens/EditorScreen'
import PreviewScreen from './screens/PreviewScreen'
import UserScreen from './screens/UserScreen'
import { StreamContext } from './context/StreamContext'

function AppCredit() {
  const location = useLocation()
  if (location.pathname === '/user') return null
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 6,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: '11px',
        color: '#888',
        opacity: 0.7,
        pointerEvents: 'none',
        zIndex: 9999,
        fontFamily: 'inherit',
      }}
      aria-hidden="true"
    >
      تطوير وتصميم المنظومة .. نقيب / احمد فاروق
    </div>
  )
}

function App() {
  const [streamUrl, setStreamUrl] = useState(null)
  const [overlayText, setOverlayText] = useState('')

  return (
    <StreamContext.Provider value={{ streamUrl, setStreamUrl, overlayText, setOverlayText }}>
      <Router>
        <Routes>
          <Route path="/editor" element={<EditorScreen />} />
          <Route path="/preview" element={<PreviewScreen />} />
          <Route path="/user" element={<UserScreen />} />
          <Route path="/users" element={<Navigate to="/user" replace />} />
          <Route path="/" element={<Navigate to="/editor" replace />} />
        </Routes>
        <AppCredit />
      </Router>
    </StreamContext.Provider>
  )
}

export default App

