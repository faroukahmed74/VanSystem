// LocalStorage utilities for persistence

const STORAGE_KEY = 'van-system-saved-buttons'

export function loadSavedButtons() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('Error loading saved buttons from storage:', error)
  }
  return []
}

export function saveButtons(buttons) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buttons))
  } catch (error) {
    console.error('Error saving buttons to storage:', error)
  }
}

