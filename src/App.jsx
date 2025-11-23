import React, { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import EditorScreen from './screens/EditorScreen'
import PreviewScreen from './screens/PreviewScreen'
import { StreamContext } from './context/StreamContext'

function App() {
  const [streamUrl, setStreamUrl] = useState(null)
  const [overlayText, setOverlayText] = useState('')

  return (
    <StreamContext.Provider value={{ streamUrl, setStreamUrl, overlayText, setOverlayText }}>
      <Router>
        <Routes>
          <Route path="/editor" element={<EditorScreen />} />
          <Route path="/preview" element={<PreviewScreen />} />
          <Route path="/" element={<Navigate to="/editor" replace />} />
        </Routes>
      </Router>
    </StreamContext.Provider>
  )
}

export default App

