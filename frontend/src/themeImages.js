function _api() {
  return (typeof window !== 'undefined' && window.ThemeImages) ? window.ThemeImages : null
}

export function resolveThemeImagePath(defaultPath) {
  const api = _api()
  if (api && typeof api.resolvePath === 'function') {
    return api.resolvePath(defaultPath)
  }
  return defaultPath
}

export function resolveThemeImageKey(key, fallbackPath) {
  const api = _api()
  if (api && typeof api.resolveKey === 'function') {
    return api.resolveKey(key, fallbackPath)
  }
  return resolveThemeImagePath(fallbackPath || '')
}
