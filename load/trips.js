// Load test for the non-AI API: dashboard, trip reads and itinerary writes by many signed-in travelers.
// Target (docs/DEVELOPMENT_PLAN.md): p95 < 200 ms, < 1% errors. AI endpoints are excluded: they are capped per user
// and measured by queue wait instead.
//   k6 run -e BASE_URL=http://localhost:8081 load/trips.js
// Against AWS, run it from a few IPs or raise the per-IP limits first: register/login are capped at 10/minute per IP.
import http from 'k6/http'
import { check, fail } from 'k6'

const BASE = __ENV.BASE_URL || 'http://localhost:8081'
const USERS = Number(__ENV.USERS || 50)

export const options = {
  scenarios: {
    travelers: { executor: 'ramping-vus', startVUs: 0, stages: [
      { duration: __ENV.RAMP || '30s', target: USERS }, { duration: __ENV.HOLD || '2m', target: USERS }, { duration: '20s', target: 0 },
    ] },
  },
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{kind:api}': ['p(95)<200'] },
}

const json = (token) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, tags: { kind: 'api' } })

// One account and trip per virtual user, made up front (sign-up is rate limited, so it isn't part of the measurement).
export function setup() {
  const users = []
  for (let i = 0; i < USERS; i++) {
    const res = http.post(`${BASE}/api/auth/register`, JSON.stringify({
      email: `load-${Date.now()}-${i}@example.com`, password: 'load-test-password', displayName: `Load ${i}`,
    }), { headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.99.${i >> 8}.${i & 255}` } })
    if (res.status !== 201) fail(`register failed: ${res.status} ${res.body}`)
    const token = res.json('accessToken')
    const trip = http.post(`${BASE}/api/trips`, JSON.stringify({
      name: 'Load trip', startDate: '2027-06-10', endDate: '2027-06-16', destination: { name: 'Tokyo', lat: 35.68, lng: 139.76 },
    }), json(token))
    users.push({ token, tripId: trip.json('id') })
  }
  return users
}

export default function (users) {
  // ponytail: access tokens last 15 minutes, so keep runs shorter than that (no refresh in the loop).
  const { token, tripId } = users[(__VU - 1) % users.length]
  const p = json(token)
  check(http.get(`${BASE}/api/trips`, p), { dashboard: (r) => r.status === 200 })
  check(http.get(`${BASE}/api/trips/${tripId}`, p), { trip: (r) => r.status === 200 })
  const list = http.get(`${BASE}/api/trips/${tripId}/destinations`, p)
  check(list, { places: (r) => r.status === 200 })

  const day = Math.floor(Math.random() * 7)
  const add = http.post(`${BASE}/api/trips/${tripId}/destinations`, JSON.stringify({
    name: `Stop ${__ITER}`, lat: 35.6 + Math.random() / 10, lng: 139.7 + Math.random() / 10, dayIndex: day,
  }), p)
  check(add, { add: (r) => r.status === 201 })
  if (add.status === 201 && Math.random() < 0.5) {
    check(http.del(`${BASE}/api/trips/${tripId}/destinations/${add.json('id')}`, null, p), { remove: (r) => r.status === 204 })
  }
}
