# Live delivery tracking — V1 spec

Real-time map of the delivery fleet: each vehicle's phone streams GPS to the backend, the office TV shows every truck moving live, with on-demand route + ETA. Same "fleet telemetry + live map" shape as Uber, minus rider matching.

**V1 scope:** live vehicle tracking + route/ETA. No order/delivery model yet — but the schema and API are seamed so orders, assignment, and per-delivery ETA drop in without a rewrite.

**Hosting stance (V1):** managed Supabase, app in a container. The DB is deliberately not a big deal — it's swappable. *If the client requires on-prem at handoff,* Supabase self-hosts as its own compose stack and tiles/routing can move in-house then — a deployment change, not a rewrite. So V1 stays lean (KISS / YAGNI): **no Redis, no custom WebSocket server, no self-hosted tiles** until something actually demands them.

## Stack

- **Driver client — PWA.** Web app on the mounted phone. `watchPosition` + the Screen Wake Lock API to keep the screen on. Kiosk/full-screen recommended (stops the OS backgrounding the tab and dropping the wake lock), not required. Reliable because the phone is mounted and foregrounded — the one condition under which web GPS holds. *Escape hatch:* when phones go in pockets, sleep, or run nav up front, switch the client to a native Expo app with background geolocation — the backend doesn't change.
- **API — Next.js route handlers** (App Router, TypeScript). Thin and **stateless**: ingest positions, proxy OSRM. The same app serves the dashboard. The live fan-out is not the API's job — see Data flow.
- **DB + Realtime + Auth — Supabase.** Postgres for vehicle state + history, Realtime to push position changes to dashboards, Auth + RLS as the security boundary.
- **Dashboard — Next.js + MapLibre GL** (`react-map-gl`). Subscribes to Supabase Realtime; renders each truck as a marker.
- **Routing — OSRM**, self-hosted (Docker, Switzerland extract) — M4. *(A hosted directions API is the zero-ops alternative if you'd rather not run OSRM for V1.)*
- **Tiles — MapTiler or Stadia** (free tier). Never the public OSM tile server. *(Self-host with Protomaps/TileServer at handoff if the client wants zero external deps.)*

## Data flow

Phone reads GPS → `POST /api/location` (authed) → upsert the latest position onto the vehicle row + append to `vehicle_positions` → **Supabase Realtime broadcasts the vehicle-row change** → the dashboard (subscribed) moves that truck's marker. Separately, the dashboard calls `GET /api/route` (→ OSRM) for route lines + ETA, and pulls map tiles from the provider.

No Redis, no socket server: holding connections open and fanning updates out is Supabase Realtime's job. The API just writes and returns.

## Data model (Supabase / Postgres)

`vehicles` — one row per tracked unit (truck + phone + courier). Holds the latest position so Realtime can broadcast a single, clean row per vehicle.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| label | text | e.g. "Van 3", shown on the map |
| status | text | `active` / `idle` / `offline` |
| assigned_user_id | uuid fk → auth.users | the driver's login; nullable |
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

- `POST /api/location` — **auth required (driver).** Body `{ lat, lng, heading?, speed?, accuracy?, recorded_at }`. Validates ranges, rejects future timestamps, appends to `vehicle_positions`, updates the `vehicles` row. Runs as the authenticated user, so RLS guarantees a driver only writes their own vehicle.
- `GET /api/route?vehicleId=&destLat=&destLng=` — proxies OSRM's route service from the vehicle's current position to the destination. Returns `{ geometry, duration, distance }` (duration = ETA). Proxying keeps OSRM internal and cacheable.
- The dashboard reads live positions via **Supabase Realtime** (a client-side subscription to `postgres_changes` on `vehicles`), not a polling endpoint or a WS server. On load it runs one snapshot query (`select * from vehicles`), then subscribes. *(Enable Realtime on the `vehicles` table.)*

## Driver PWA

1. Login → JWT (Supabase Auth), tied to a vehicle.
2. `watchPosition` for continuous GPS; request a Screen Wake Lock so the mounted screen never sleeps.
3. Throttle to a `POST /api/location` every ~5s (and/or only when moved > ~10m).
4. Offline buffer: queue points in IndexedDB on failure, flush on reconnect — trucks hit tunnels and dead zones.
5. Big, dumb UI: tracking on/off, status, last-sent time.

> Must be the foreground app on the mounted phone. Running turn-by-turn nav on the *same* phone backgrounds it and stalls GPS — that's the trigger to go native Expo. Served over HTTPS (Geolocation + Wake Lock require it).

## Dashboard / TV

- MapLibre GL map, provider tiles.
- On load: snapshot query → a marker per vehicle. Then subscribe to Realtime; on each update, **interpolate** the marker from old to new position over the ~5s window (rotate to `heading`) so trucks glide instead of teleporting.
- Click a vehicle → set a destination (click the map or enter an address) → `GET /api/route` → draw the route line + show ETA, refreshing as it moves.
- Grey out / flag vehicles whose `last_seen_at` is stale (offline).
- TV mode: read-only display session, auto-reconnect, kiosk/full-screen.

## Auth

- **Drivers:** Supabase Auth → JWT, linked to a `vehicles` row via `assigned_user_id`. The app accesses the DB as the user (`createUserClient(token)`), so RLS scopes writes to their own vehicle. Every new table gets RLS + explicit policies.
- **TV / dashboard:** read-only — a display token / anon read policy allowing `select` on `vehicles`. Which one is a deliberate M2 decision.

## OSRM build (M4)

One-time per map update, produces the dataset the `osrm` container serves:

```bash
wget https://download.geofabrik.de/europe/switzerland-latest.osm.pbf -P ./osrm
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/switzerland-latest.osm.pbf
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend osrm-partition /data/switzerland-latest.osrm
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend osrm-customize /data/switzerland-latest.osrm
```

CH is small, so RAM/CPU needs are modest. Re-run for road changes.

## Deployment (containers)

- **V1 footprint:** the Next.js app (dashboard + API routes) in one container; managed Supabase as the external data layer; OSRM joins as a second container at M4. HTTPS is required (Geolocation + Wake Lock) — terminate TLS at your host/platform.
- **At client handoff, if on-prem is required:** self-host Supabase (its own compose stack), move tiles to self-hosted Protomaps/TileServer, and front everything with a reverse proxy (Caddy/Traefik). Same containers, no app rewrite. Add Redis only if you ever run a custom multi-instance socket layer — not before.

## Build order

- **M1 — pipe.** Supabase schema + `POST /api/location` + a fake-GPS poster. Goal: rows landing, `vehicles` updating.
- **M2 — see it move.** Dashboard map + Supabase Realtime subscription + markers driven by the fake poster. Goal: dots gliding, no phone yet.
- **M3 — real GPS.** Driver PWA: login + watchPosition + wake lock + POST loop + offline buffer, over HTTPS.
- **M4 — routing.** OSRM container + `/api/route` proxy + click-to-route + ETA.
- **M5 — polish.** Marker interpolation, offline/stale flags, TV kiosk mode, lock down tokens/RLS.
- **Later (expansion):** orders/deliveries model, auto-assigned dropoffs + per-delivery status, geofenced "arrived" events (PostGIS), route replay from `vehicle_positions`.

## Open decision

ETA needs a destination, and V1 has no order model — so route/ETA runs against a **dispatcher-set destination per vehicle** (set on the dashboard). Alternatives: ETA to a fixed **depot**, or skip ETA until orders exist and only draw the **traveled path** (map-matched GPS trail). Spec assumes dispatcher-set; trivial to change.