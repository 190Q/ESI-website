import { useEffect } from 'react'

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = reject
    document.body.appendChild(script)
  })
}

export default function useScriptLoader() {
  useEffect(() => {
    ;(async () => {
      await loadScript('/js/data-cache.js')
      await loadScript('/js/toast.js')

      // Inline bootstrap (originally between toast.js and activity_prefetch.js)
      window.aspectsDataPromise = window.DataCache.cachedFetch('/api/guild/aspects')
        .then(function (result) { window.aspectsData = result.data })
        .catch(function () { window.aspectsData = { total_aspects: 0, members: {} } })

      await loadScript('/js/activity_prefetch.js')
      await loadScript('/js/purify.min.js')
      await loadScript('/js/html2canvas.min.js')
      await loadScript('/js/app.js')
      await loadScript('/js/graph-shared.js')
      await loadScript('/js/player.js')
      await loadScript('/js/guild.js')
      await loadScript('/js/bot.js')
      await loadScript('/js/inactivity.js')
      await loadScript('/js/promotions.js')
    })()
  }, [])
}
