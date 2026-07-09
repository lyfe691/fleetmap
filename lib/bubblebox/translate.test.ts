import { describe, expect, it } from "vitest"
import {
  buildSyncPayloads,
  type BBRoute,
  type BBStatusEntry,
} from "./translate"

// Data mirrors Dmytro's rider-app example (docs/bubblebox-rider-route-example.json),
// reshaped to the agreed contract (spec: "Upstream contract").
const point = (over: Partial<BBRoute["routePoints"][number]> = {}) => ({
  type: "pickup",
  status: "processing",
  arrivalTime: "2026-07-08T08:00:00+02:00",
  fulfilledAt: null,
  latitude: 47.3245229,
  longitude: 8.5065959,
  orders: [{ orderCode: "3AB-7RG", type: "pickup" as const }],
  ...over,
})

const route = (over: Partial<BBRoute> = {}): BBRoute => ({
  riderRef: "rider_zurichcity1@bb.ch",
  date: "2026-07-08",
  type: "morning",
  routePoints: [point()],
  ...over,
})

const MAP = new Map([["rider_zurichcity1@bb.ch", "veh-1"]])

describe("buildSyncPayloads", () => {
  it("maps a pickup point to a pickup stop with eta from arrivalTime", () => {
    const { payloads } = buildSyncPayloads([route()], null, MAP)
    expect(payloads).toEqual([
      {
        vehicleId: "veh-1",
        orders: [
          {
            external_ref: "3AB-7RG",
            scheduled_date: "2026-07-08",
            stops: [
              {
                stop_type: "pickup",
                seq: 1,
                lat: 47.3245229,
                lng: 8.5065959,
                status: "planned",
                eta_at: "2026-07-08T08:00:00+02:00",
                completed_at: null,
              },
            ],
          },
        ],
      },
    ])
  })

  it("maps delivery to dropoff and done to completed with fulfilledAt", () => {
    const r = route({
      routePoints: [
        point({
          type: "delivery",
          status: "done",
          fulfilledAt: "2026-07-08T08:03:12+02:00",
          orders: [{ orderCode: "3AB-7RG", type: "delivery" }],
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    const stop = payloads[0].orders[0].stops[0]
    expect(stop.stop_type).toBe("dropoff")
    expect(stop.status).toBe("completed")
    expect(stop.completed_at).toBe("2026-07-08T08:03:12+02:00")
  })

  it("skips depot points and sorts the rest by arrivalTime", () => {
    // The real example lists endPoint FIRST — array order is untrustworthy.
    const r = route({
      routePoints: [
        point({ type: "endPoint", orders: [], arrivalTime: "2026-07-08T13:31:48+02:00" }),
        point({
          arrivalTime: "2026-07-08T09:00:00+02:00",
          orders: [{ orderCode: "BBB-222", type: "pickup" }],
        }),
        point({
          arrivalTime: "2026-07-08T08:00:00+02:00",
          orders: [{ orderCode: "AAA-111", type: "pickup" }],
        }),
        point({ type: "startPoint", orders: [], arrivalTime: "2026-07-08T05:49:28+02:00" }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    const refs = payloads[0].orders.map((o) => o.external_ref)
    expect(refs).toEqual(["AAA-111", "BBB-222"])
    expect(payloads[0].orders[0].stops[0].seq).toBe(1)
    expect(payloads[0].orders[1].stops[0].seq).toBe(2)
  })

  it("expands a collective point into one stop per order, consecutive seqs, same coords", () => {
    const r = route({
      routePoints: [
        point({
          type: "collective",
          orders: [
            { orderCode: "3AB-7RG", type: "delivery" },
            { orderCode: "BG9-QCH", type: "delivery" },
          ],
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    expect(payloads[0].orders).toHaveLength(2)
    const stops = payloads[0].orders.map((o) => o.stops[0])
    expect(stops.map((s) => s.seq)).toEqual([1, 2])
    expect(stops[0].lat).toBe(stops[1].lat)
  })

  it("continues seq across morning and evening routes of the same rider", () => {
    const morning = route({
      routePoints: [point({ orders: [{ orderCode: "AAA-111", type: "pickup" }] })],
    })
    const evening = route({
      type: "evening",
      routePoints: [
        point({
          arrivalTime: "2026-07-08T18:00:00+02:00",
          orders: [{ orderCode: "BBB-222", type: "delivery" }],
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([morning, evening], null, MAP)
    expect(payloads[0].orders.map((o) => o.stops[0].seq)).toEqual([1, 2])
  })

  it("merges pickup and delivery of the same order into one order with two stops", () => {
    const r = route({
      routePoints: [
        point({ orders: [{ orderCode: "SAME-DAY", type: "pickup" }] }),
        point({
          arrivalTime: "2026-07-08T11:00:00+02:00",
          orders: [{ orderCode: "SAME-DAY", type: "delivery" }],
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    expect(payloads[0].orders).toHaveLength(1)
    expect(payloads[0].orders[0].stops.map((s) => s.stop_type)).toEqual([
      "pickup",
      "dropoff",
    ])
  })

  it("applies status entries over the structure's point status", () => {
    const statuses: BBStatusEntry[] = [
      {
        orderCode: "3AB-7RG",
        type: "pickup",
        status: "done",
        fulfilledAt: "2026-07-08T08:10:00+02:00",
      },
    ]
    const { payloads } = buildSyncPayloads([route()], statuses, MAP)
    const stop = payloads[0].orders[0].stops[0]
    expect(stop.status).toBe("completed")
    expect(stop.completed_at).toBe("2026-07-08T08:10:00+02:00")
  })

  it("treats unknown upstream statuses as planned", () => {
    const r = route({ routePoints: [point({ status: "somethingNew" })] })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    expect(payloads[0].orders[0].stops[0].status).toBe("planned")
  })

  it("coerces string coordinates (their backend serializes decimals as strings)", () => {
    const r = route({
      routePoints: [point({ latitude: "47.32452290", longitude: "8.50659590" })],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    const stop = payloads[0].orders[0].stops[0]
    expect(stop.lat).toBe(47.3245229)
    expect(stop.lng).toBe(8.5065959)
  })

  it("reports unmatched riders and emits empty payloads for route-less vehicles", () => {
    const map = new Map([
      ["rider_zurichcity1@bb.ch", "veh-1"],
      ["rider_basel1@bb.ch", "veh-2"],
    ])
    const { payloads, unmatchedRiders } = buildSyncPayloads(
      [route(), route({ riderRef: "rider_unknown@bb.ch" })],
      null,
      map
    )
    expect(unmatchedRiders).toEqual(["rider_unknown@bb.ch"])
    const veh2 = payloads.find((p) => p.vehicleId === "veh-2")
    expect(veh2).toEqual({ vehicleId: "veh-2", orders: [] })
  })
})
