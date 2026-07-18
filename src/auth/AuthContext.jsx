import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getCurrentUser,
  loginWithGoogleCredential,
  loginWithPassword,
  logoutSession,
  saveStudentPhone,
} from '../services/authApi.js'
import { AUTH_UNAUTHORIZED_EVENT } from '../services/apiClient.js'
import { AuthContext } from './authContext.js'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const sessionRequest = useRef(null)
  const sessionRequestSequence = useRef(0)

  const refreshSession = useCallback(async ({ requestId, signal } = {}) => {
    const isCurrentRequest = () =>
      requestId === undefined || sessionRequestSequence.current === requestId

    try {
      const currentUser = await getCurrentUser({ signal })
      if (isCurrentRequest()) {
        setUser(currentUser)
        setError('')
      }
      return currentUser
    } catch (requestError) {
      if (requestError.name === 'AbortError') return null

      if (isCurrentRequest()) {
        setUser(null)
        if (requestError.status !== 401) setError(requestError.message)
      }
      return null
    } finally {
      if (isCurrentRequest()) setIsCheckingSession(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const requestId = sessionRequestSequence.current + 1
    sessionRequestSequence.current = requestId
    sessionRequest.current = controller
    const initialTimer = window.setTimeout(
      () => refreshSession({ requestId, signal: controller.signal }),
      0,
    )

    return () => {
      window.clearTimeout(initialTimer)
      if (sessionRequestSequence.current === requestId) {
        sessionRequestSequence.current += 1
      }
      controller.abort()
      if (sessionRequest.current === controller) sessionRequest.current = null
    }
  }, [refreshSession])

  useEffect(() => {
    function handleUnauthorized() {
      setUser(null)
      setError('')
      setMessage('Your session expired. Sign in again to continue.')
    }

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () =>
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [])

  const login = useCallback(async (identifier, password) => {
    setIsAuthenticating(true)
    setError('')
    setMessage('')

    try {
      const authenticatedUser = await loginWithPassword(identifier, password)
      setUser(authenticatedUser)
      return authenticatedUser
    } catch (requestError) {
      setError(requestError.message)
      throw requestError
    } finally {
      setIsAuthenticating(false)
    }
  }, [])

  const logout = useCallback(async () => {
    setIsLoggingOut(true)
    setError('')

    try {
      await logoutSession()
      setUser(null)
      setMessage('You have been signed out securely.')
    } catch (requestError) {
      setError(
        `${requestError.message} Your session remains active; please try logout again.`,
      )
      throw requestError
    } finally {
      setIsLoggingOut(false)
    }
  }, [])

  const googleLogin = useCallback(async (credential) => {
    setIsAuthenticating(true)
    setError('')
    setMessage('')

    try {
      const authenticatedUser = await loginWithGoogleCredential(credential)
      setUser(authenticatedUser)
      return authenticatedUser
    } catch (requestError) {
      setError(requestError.message)
      throw requestError
    } finally {
      setIsAuthenticating(false)
    }
  }, [])

  const completePhoneOnboarding = useCallback(async (phoneNumber) => {
    setIsCompletingOnboarding(true)
    setError('')

    try {
      const updatedUser = await saveStudentPhone(phoneNumber)
      setUser(updatedUser)
      return updatedUser
    } catch (requestError) {
      setError(requestError.message)
      throw requestError
    } finally {
      setIsCompletingOnboarding(false)
    }
  }, [])

  const clearFeedback = useCallback(() => {
    setError('')
    setMessage('')
  }, [])

  const value = useMemo(
    () => ({
      clearFeedback,
      completePhoneOnboarding,
      error,
      googleLogin,
      isAuthenticating,
      isCheckingSession,
      isCompletingOnboarding,
      isLoggingOut,
      login,
      logout,
      message,
      refreshSession,
      role: user?.role || null,
      user,
    }),
    [
      clearFeedback,
      completePhoneOnboarding,
      error,
      googleLogin,
      isAuthenticating,
      isCheckingSession,
      isCompletingOnboarding,
      isLoggingOut,
      login,
      logout,
      message,
      refreshSession,
      user,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
