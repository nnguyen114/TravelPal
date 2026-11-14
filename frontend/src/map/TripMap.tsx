import { LngLatBounds, Map as MapLibre, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// MapLibre looks for its worker next to its own bundle, where production builds don't put it. Importing the file
// with ?url makes Vite ship it, and this points MapLibre at it.
setWorkerUrl(workerUrl)
import { useEffect, useRef } from 'react'
import type { Destination } from '../types'

/** home: where the day happens (its city), used when none of its places has a map location yet. */
type MapDay = { color: string; stops: Destination[]; home?: [number, number] }
type Props = { days: MapDay[]; activeDay: number | null; selectedId: string | null; onSelect: (id: string) => void; center?: [number, number] }

// ponytail: OpenFreeMap tiles are free and keyless; move to a paid tile provider (MapTiler etc.) if we need an SLA.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

/** Geographic context and visit order only. Lines connect stops in order; they are not routes. */
export function TripMap({ days, activeDay, selectedId, onSelect, center }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const markers = useRef<Marker[]>([])
  const loaded = useRef(false)
  const latest = useRef({ days, activeDay, selectedId, onSelect })
  latest.current = { days, activeDay, selectedId, onSelect }

  function draw() {
    const m = map.current
    if (!m || !loaded.current) return
    const { days, activeDay, selectedId, onSelect } = latest.current
    markers.current.forEach((mk) => mk.remove())
    markers.current = []
    const features: GeoJSON.Feature[] = []
    const bounds = new LngLatBounds()

    days.forEach((day, i) => {
      const active = activeDay === null || activeDay === i
      const pts = day.stops.filter((s) => s.lat != null && s.lng != null)
      if (pts.length > 1) {
        features.push({
          type: 'Feature', properties: { color: day.color, opacity: active ? 1 : 0.25 },
          geometry: { type: 'LineString', coordinates: pts.map((s) => [s.lng!, s.lat!]) },
        })
      }
      pts.forEach((s) => {
        // MapLibre owns the marker element's transform/opacity, so style an inner button.
        const el = document.createElement('div')
        const btn = document.createElement('button')
        const selected = s.id === selectedId
        btn.className = 'map-marker'
        btn.textContent = String(day.stops.indexOf(s) + 1)
        btn.setAttribute('aria-label', `Day ${i + 1}: ${s.name}`)
        btn.style.cssText = `background:${day.color};opacity:${active ? 1 : 0.35};border-color:${selected ? '#FFD66B' : '#fff'};` +
          `transform:scale(${selected ? 1.2 : 1})`
        btn.addEventListener('click', (e) => { e.stopPropagation(); onSelect(s.id) })
        el.append(btn)
        el.style.zIndex = active ? '2' : '1'
        markers.current.push(new Marker({ element: el }).setLngLat([s.lng!, s.lat!]).addTo(m))
        if (active) bounds.extend([s.lng!, s.lat!])
      })
    })
    ;(m.getSource('routes') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    const home = activeDay === null ? undefined : days[activeDay]?.home
    if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: { top: 50, left: 50, right: 50, bottom: 100 }, maxZoom: 15, duration: 400 })
    else if (home) m.flyTo({ center: home, zoom: 10, duration: 400 }) // nothing to frame: at least show the right place
  }

  useEffect(() => {
    const m = new MapLibre({ container: box.current!, style: STYLE, center: center ?? [0, 20], zoom: center ? 11 : 1.5, attributionControl: { compact: true } })
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    // 'style.load' (not 'load', which waits for every tile) is all the route layer needs.
    m.on('style.load', () => {
      m.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'routes', type: 'line', source: 'routes', layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': ['get', 'opacity'], 'line-dasharray': [0.5, 2] },
      })
      loaded.current = true
      draw()
    })
    map.current = m
    return () => m.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(draw, [days, activeDay, selectedId])

  const shown = activeDay === null ? null : days[activeDay]
  const unmapped = shown && shown.stops.length > 0 && !shown.stops.some((s) => s.lat != null && s.lng != null)
  return (
    <>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} role="region" aria-label="Trip map" />
      {unmapped && (
        <div className="map-empty" role="status">
          Day {activeDay! + 1}'s places aren't on the map yet. Open one and search for it to place it.
        </div>
      )}
    </>
  )
}
