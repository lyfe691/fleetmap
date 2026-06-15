# Live delivery tracking — V1 spec

Real-time map of the delivery fleet: each vehicle's phone streams GPS to the backend, the office TV shows every truck moving live, with on-demand route + ETA. Same "fleet telemetry + live map" shape as Uber, minus rider matching. **Fully self-hosted — every component runs as a Docker container, no external SaaS.**

**V1 scope:** live vehicle tracking + route/ETA. No order/delivery model yet — but the schema and API are seamed so orders, assignment, and per-delivery ETA drop in without a rewrite.

## Stack

- **Driver client — PWA.** Web app on the mounted phone. `navigator.geolocation.watchPosition` + the Screen Wake Lock API to keep the screen on. Kiosk / full-screen is *recommended* (stops the OS backgrounding the tab and dropping the wake lock) but not required. Reliable because the phone is mounted and foregrounded — the one condition under which web GPS holds. *Escape hatch:* when phones go in pockets, sleep, or run nav up front, switch the client to a native Expo app with background geolocation. The backend doesn't change.
- **API + WebSocket service — dedicated persistent process** (Node + Fastify + `ws`, or Go). Ingests positions, fans them out to dashboards over WebSocket, proxies OSRM. Kept separate from the frontend because a WS server needs a long-lived process — which Next.js route handlers fight.
- **Dashboard — Next.js or React(Vite)**, served as a static build. MapLibre GL (`react-map-gl`) for the map. A TV wall display needs no SSR, so a static SPA behind the proxy is leanest.
- **Storage — Postgres** (container). Position history + vehicle state.
- **Live bus — Redis** (container). A `vehicle:latest` hash for instant dashboard snapshots, plus a pub/sub channel the API uses to fan live updates to every connected dashboard (and across API replicas).
- **Routing — OSRM** (container), Switzerland extract.
- **Tiles — self-hosted** (Protomaps pmtiles, or TileServer-GL with a CH extract). No rate limits, no external dependency.
- **Ingress — Caddy** (or Traefik). TLS termination + routing. **Geolocation and Wake Lock require HTTPS**, so the PWA is served over TLS and the socket is `wss://`.

*Scale path:* swap the internal bus for **MQTT** (EMQX) if the fleet grows large or you want offline detection for free (last-will) and retained last-known position. Phones can then publish over MQTT-over-WS instead of HTTP. Not needed for V1.

## Data flow

Phone reads GPS → `POST /api/location` (JWT) → API validates, writes to Postgres (history), updates the `vehicle:latest` hash, and `PUBLISH`es the position to a Redis channel → every API instance subscribed to that channel pushes the update over WebSocket to its connected dashboards → the dashboard moves that truck's marker. Separately, the dashboard calls `/api/route` (→ OSRM) for route lines + ETA, and the browser pulls map tiles from the self-hosted tile server. All traffic enters through Caddy over HTTPS/WSS.

## Data model (Postgres)

`vehicles` — one row per tracked unit (truck + phone + courier). Holds the latest position for durability; the hot copy also lives in Redis for instant snapshots.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| label | text | e.g. "Van 3", shown on the map |
| status | text | `active` / `idle` / `offline` |
| assigned_user_id | uuid | the driver's login; nullable |
| last_lat | double precision | latest position |
| last_lng | double precision | |
| last_heading | real | degrees, for marker rotation |
| last_speed | real | optional |
| last_seen_at | timestamptz | drives the offline indicator |
| dest_lat / dest_lng | double precision | dispatcher-set destination for route/ETA (nullable). *Becomes the delivery dropoff once orders exist.* |

`vehicle_positions` — append-only history (replay + audit later).

| column | type | notes |
|---|---|---|
| id | bigint pk | |
| vehicle_id | uuid fk | |
| lat / lng | double precision | |
| heading / speed / accuracy | real | |
| recorded_at | timestamptz | from the device |

Index `vehicle_positions (vehicle_id, recorded_at desc)`.

**Expansion seam (not built in V1):** an `orders` / `deliveries` table — `id, vehicle_id, pickup, dropoff_lat, dropoff_lng, status, eta, created_at`. When it lands, `dest_lat/lng` auto-populates from the active delivery's dropoff and `status` (assigned → picked up → en route → delivered) feeds the dashboard. Nothing in V1 changes to add it.

## API

- `POST /api/location` — **JWT auth (driver).** Body: `{ lat, lng, heading?, speed?, accuracy?, recorded_at }`. Validates ranges, rejects stale/implausible jumps, writes `vehicle_positions`, updates the `vehicles` row + `vehicle:latest` Redis hash, publishes to the Redis channel. The token carries the vehicle/driver id; the API enforces that a driver only writes their own vehicle.
- `WS /ws` — dashboard connection. On connect: send a snapshot of all vehicles (from the Redis hash), then stream live updates as they arrive on the Redis channel. Read-only, gated by a display token.
- `GET /api/route?vehicleId=&destLat=&destLng=` — proxies OSRM's route service from the vehicle's current position to the destination. Returns `{ geometry, duration, distance }` (duration = ETA). Proxying keeps OSRM internal and lets you cache.

## Driver PWA

1. Login → JWT, tied to a vehicle.
2. `watchPosition` for continuous GPS; request a Screen Wake Lock so the mounted screen never sleeps.
3. Throttle to a `POST /api/location` every ~5s (and/or only when moved > ~10m).
4. Offline buffer: queue points in IndexedDB on failure, flush on reconnect — trucks hit tunnels and dead zones.
5. Big, dumb UI: tracking on/off, status, last-sent time.

> Must be the foreground app on the mounted phone. Running turn-by-turn nav on the *same* phone backgrounds it and stalls GPS — that's the trigger to go native Expo. Served over HTTPS (Geolocation/Wake Lock require it).

## Dashboard / TV

- MapLibre GL map, self-hosted tiles.
- On WS connect: snapshot → a marker per vehicle. Then on each live update, **interpolate** the marker from old to new position over the ~5s window (rotate to `heading`) so trucks glide instead of teleporting.
- Click a vehicle → set a destination (click the map or enter an address) → `GET /api/route` → draw the route line + show ETA, refreshing as it moves.
- Grey out / flag vehicles whose `last_seen_at` is stale (offline).
- TV mode: read-only display token, auto-reconnect, kiosk/full-screen.

## Deployment (Docker Compose)

One stack, fully self-contained (indicative — envs/volumes trimmed):

```yaml
services:
  caddy:        # TLS + routing: / -> dashboard, /api + /ws -> api, /tiles -> tiles
    image: caddy:2
    ports: ["80:80", "443:443"]
  dashboard:    # static React build (nginx)
    build: ./dashboard
  api:          # ingest + WebSocket + OSRM proxy (persistent process)
    build: ./api
    depends_on: [postgres, redis, osrm]
  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7
  osrm:         # osrm-routed, prebuilt CH dataset (see OSRM build below)
    image: osrm/osrm-backend
    command: osrm-routed --algorithm mld /data/switzerland-latest.osrm
    volumes: ["./osrm:/data"]
  tiles:        # self-hosted vector tiles
    image: maptiler/tileserver-gl
    volumes: ["./tiles:/data"]
volumes:
  pgdata:
```

- Caddy is the only thing exposed; everything else talks over the internal compose network.
- `api` scales horizontally (`deploy.replicas`) — Redis pub/sub keeps fan-out consistent across instances.
- Caddy provides automatic HTTPS, which the PWA needs.

## OSRM build

One-time per map update, produces the dataset the `osrm` container serves:

```bash
wget https://download.geofabrik.de/europe/switzerland-latest.osm.pbf -P ./osrm
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/switzerland-latest.osm.pbf
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend osrm-partition /data/switzerland-latest.osrm
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend osrm-customize /data/switzerland-latest.osrm
```

CH is small, so RAM/CPU needs are modest. Re-run for road changes.

## Auth

- **Drivers:** log in → app-issued JWT, scoped to a `vehicles` row. The API enforces that a driver writes only their own vehicle. (You can keep Postgres RLS as defence-in-depth, but the API is the enforcement point — there's no PostgREST in front of the DB.)
- **TV / dashboard:** read-only display token; the WS stream and snapshot are select-only.

## Build order

- **M1 — pipe.** Compose with Postgres + Redis + the API service, `POST /api/location`, and a throwaway fake-GPS poster. Goal: rows landing, `vehicle:latest` updating.
- **M2 — see it move.** Dashboard map + WS subscription + markers driven by the fake poster. Goal: dots gliding, no phone yet.
- **M3 — real GPS.** Driver PWA: login + watchPosition + wake lock + POST loop + offline buffer, over HTTPS.
- **M4 — routing.** OSRM container + `/api/route` proxy + click-to-route + ETA + self-hosted tiles.
- **M5 — polish.** Marker interpolation, offline/stale flags, TV kiosk mode, lock down tokens, Caddy TLS.
- **Later (expansion):** orders/deliveries model, auto-assigned dropoffs + per-delivery status, geofenced "arrived" events (PostGIS), route replay from `vehicle_positions`, optional MQTT backbone.

## Open decision

ETA needs a destination, and V1 has no order model — so route/ETA runs against a **dispatcher-set destination per vehicle** (set on the dashboard). Alternatives: ETA to a fixed **depot**, or skip ETA until orders exist and only draw the **traveled path** (map-matched GPS trail). Spec assumes dispatcher-set; trivial to change.