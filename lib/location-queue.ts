import { openDB, type DBSchema, type IDBPDatabase } from "idb"

export type QueuedPoint = {
  lat: number
  lng: number
  heading: number | null
  speed: number | null
  accuracy: number | null
  recorded_at: string // device ISO time at capture — never restamped
}

interface LocationDB extends DBSchema {
  pending: { key: number; value: QueuedPoint }
}

const DB_NAME = "fleetmap-driver"
const STORE = "pending"
const MAX_PENDING = 5000

let dbPromise: Promise<IDBPDatabase<LocationDB>> | undefined

function db() {
  if (!dbPromise) {
    dbPromise = openDB<LocationDB>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { autoIncrement: true })
      },
    })
  }
  return dbPromise
}

export async function enqueue(point: QueuedPoint): Promise<void> {
  const d = await db()
  await d.add(STORE, point)
  // Ring-buffer: drop oldest beyond the cap so a long tunnel can't grow forever.
  let n = await d.count(STORE)
  while (n > MAX_PENDING) {
    const oldest = await d.getAllKeys(STORE, null, 1)
    if (!oldest.length) break
    await d.delete(STORE, oldest[0])
    n--
  }
}

export async function peekOldest(): Promise<{
  key: number
  point: QueuedPoint
} | null> {
  const d = await db()
  const keys = await d.getAllKeys(STORE, null, 1)
  if (!keys.length) return null
  const key = keys[0]
  const point = await d.get(STORE, key)
  return point ? { key, point } : null
}

export async function deleteKey(key: number): Promise<void> {
  const d = await db()
  await d.delete(STORE, key)
}

export async function count(): Promise<number> {
  const d = await db()
  return d.count(STORE)
}
