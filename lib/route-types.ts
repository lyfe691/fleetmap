// OSRM with geometries=geojson returns a LineString for the route shape.
export type RouteGeometry = {
  type: "LineString"
  coordinates: [number, number][]
}

export type RouteLeg = {
  toStopId: string
  duration: number // seconds
  distance: number // metres
}

export type StopOffset = {
  stopId: string
  seq: number
  lineFraction: number // 0..1 along the full geometry; M8's grey boundary
}

export type RouteStop = {
  id: string
  seq: number
  stop_type: "pickup" | "dropoff"
  lat: number
  lng: number
  status: string
}

export type Route = {
  geometry: RouteGeometry
  totalDuration: number // seconds (ETA to the last stop)
  totalDistance: number // metres
  legs: RouteLeg[]
  stopOffsets: StopOffset[]
  stops: RouteStop[]
}
