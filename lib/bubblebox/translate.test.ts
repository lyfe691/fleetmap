import { describe, expect, it } from "vitest"
import {
  buildSyncPayloads,
  type BBRoute,
  type BBStatusEntry,
} from "./translate"

// Data mirrors the shipped fleet API (staging, 2026-07-22; sample response
// checked in at docs/bubblebox-fleet-routes-example.json).
const point = (over: Partial<BBRoute["routePoints"][number]> = {}) => ({
  type: "pickup",
  status: "processing",
  arrivalTime: "2026-07-08T08:00:00+02:00",
  actualFulfillmentTime: null,
  latitude: "47.32452290",
  longitude: "8.50659590",
  orders: [{ orderCode: "3AB-7RG", type: "pickup" as const }],
  ...over,
})

const route = (over: Partial<BBRoute> = {}): BBRoute => ({
  rider: { id: 6, fullName: "Rider Zurich City 1" },
  dueDate: "2026-07-08T00:00:00+02:00",
  type: "morning",
  routePoints: [point()],
  ...over,
})

const MAP = new Map([["6", "veh-1"]])

describe("buildSyncPayloads", () => {
  it("maps a pickup point to a pickup stop, eta from arrivalTime, date from dueDate", () => {
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

  it("completes a stop when actualFulfillmentTime is set", () => {
    const r = route({
      routePoints: [
        point({
          type: "delivery",
          status: "done",
          actualFulfillmentTime: "2026-07-08T08:03:12+02:00",
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

  it("completes a picked_up pickup point (fulfillment time set, status not done)", () => {
    const r = route({
      routePoints: [
        point({
          status: "picked_up",
          actualFulfillmentTime: "2026-07-08T08:05:00+02:00",
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    expect(payloads[0].orders[0].stops[0].status).toBe("completed")
  })

  it("keeps unfulfilled points planned whatever their pipeline status", () => {
    for (const status of ["ready_for_delivery", "loaded_for_delivery", "somethingNew"]) {
      const r = route({ routePoints: [point({ status })] })
      const { payloads } = buildSyncPayloads([r], null, MAP)
      expect(payloads[0].orders[0].stops[0].status).toBe("planned")
    }
  })

  it("skips depot points and sorts the rest by arrivalTime", () => {
    // The real feed lists endPoint first and gives startPoint no arrivalTime.
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
        point({ type: "startPoint", orders: [], arrivalTime: undefined }),
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

  it("applies status entries over the structure's point data", () => {
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

  it("coerces string coordinates (their backend serializes decimals as strings)", () => {
    const r = route({
      routePoints: [point({ latitude: "47.32452290", longitude: "8.50659590" })],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    const stop = payloads[0].orders[0].stops[0]
    expect(stop.lat).toBe(47.3245229)
    expect(stop.lng).toBe(8.5065959)
  })

  it("drops null-coordinate points without consuming seq and reports them", () => {
    const r = route({
      routePoints: [
        point({
          latitude: null,
          longitude: null,
          orders: [{ orderCode: "NO-GEO", type: "pickup" }],
        }),
        point({
          arrivalTime: "2026-07-08T09:00:00+02:00",
          orders: [{ orderCode: "HAS-GEO", type: "pickup" }],
        }),
      ],
    })
    const { payloads, droppedOrderCodes } = buildSyncPayloads([r], null, MAP)
    expect(droppedOrderCodes).toEqual(["NO-GEO"])
    expect(payloads[0].orders.map((o) => o.external_ref)).toEqual(["HAS-GEO"])
    expect(payloads[0].orders[0].stops[0].seq).toBe(1)
  })

  it("reports unmatched riders by id and name, emits empty payloads for route-less vehicles", () => {
    const map = new Map([
      ["6", "veh-1"],
      ["13", "veh-2"],
    ])
    const { payloads, unmatchedRiders } = buildSyncPayloads(
      [route(), route({ rider: { id: 99, fullName: "Rider Nowhere" } })],
      null,
      map
    )
    expect(unmatchedRiders).toEqual(["99 (Rider Nowhere)"])
    const veh2 = payloads.find((p) => p.vehicleId === "veh-2")
    expect(veh2).toEqual({ vehicleId: "veh-2", orders: [] })
  })
})
