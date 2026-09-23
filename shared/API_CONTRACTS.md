# EduAgentX — API Contracts

All services are accessed through the **API Gateway** at `http://localhost:8080`.
Internal service-to-service calls use the service hostname and port directly.
Every service exposes a `/health` endpoint returning `{"status":"ok","service":"<name>"}`.

---

## 1. API Gateway
**Internal port:** `4000` · **Exposed:** `8080`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Gateway health check |
| POST | `/auth/login` | Login, returns JWT token |
| POST | `/auth/register` | Register new user |
| — | `/registry/*` | Proxied → Agent Registry (4001) |
| — | `/curriculum/*` | Proxied → Curriculum Engine (4002) |
| — | `/training/*` | Proxied → Training Service (4003) |
| — | `/exam/*` | Proxied → Examination Engine (4004) |
| — | `/certification/*` | Proxied → Certification Service (4005) |
| — | `/marketplace/*` | Proxied → Marketplace (4006) |
| — | `/monitoring/*` | Proxied → Monitoring (4007) |

**Auth header (all protected endpoints):**
```
Authorization: Bearer <JWT_TOKEN>
```

---

## 2. Agent Registry Service
**Internal port:** `4001`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/agents` | Register a new agent |
| GET | `/agents` | List all agents |
| GET | `/agents/:id` | Get one agent profile |
| PATCH | `/agents/:id/status` | Update status (idle/training/examining/certified) |
| PATCH | `/agents/:id/skills` | Update skill list after training |
| DELETE | `/agents/:id` | Deregister agent |

**Agent object:**
```json
{
  "id": "uuid",
  "name": "hermes-1",
  "agent_type": "hermes",
  "status": "idle",
  "skills": ["skill_01", "skill_02"],
  "skill_count": 2,
  "created_at": "2026-09-23T00:00:00Z"
}
```

---

## 3. Curriculum Engine
**Internal port:** `4002`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/courses` | Create a new course |
| GET | `/courses` | List all courses |
| GET | `/courses/:id` | Get course content + metadata |
| POST | `/courses/:id/skills` | Add skills to a course |
| GET | `/courses/:id/skills` | List skills in a course |
| DELETE | `/courses/:id` | Delete a course |

**Course object:**
```json
{
  "id": "uuid",
  "title": "Course 1 — Reasoning Skills",
  "passing_score": 0.70,
  "skills": ["skill_01", "skill_02"],
  "exam_id": "uuid"
}
```

---

## 4. Training Session Service
**Internal port:** `4003`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/sessions` | Start training session (send agent to course) |
| GET | `/sessions/:id` | Get session status and result |
| GET | `/sessions` | List all sessions |
| POST | `/sessions/:id/retry` | Trigger retry after failed exam |

**Session object:**
```json
{
  "id": "uuid",
  "agent_id": "uuid",
  "course_id": "uuid",
  "status": "in_progress",
  "attempt_number": 1,
  "result": null
}
```

---

## 5. Examination Engine
**Internal port:** `4004`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/generate` | Generate exam from skill list |
| GET | `/exams` | List all exams |
| GET | `/exams/:id` | Get exam questions |
| POST | `/exams/:id/submit` | Submit answers for grading |
| GET | `/results/:session_id` | Get graded result |

---

## 6. Certification Service
**Internal port:** `4005`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/certify` | Issue certificate for passed agent |
| GET | `/certificates` | List all certificates |
| GET | `/certificates/:id` | Get one certificate |
| GET | `/agents/:agent_id/certificates` | All certs for one agent |

**Certificate object:**
```json
{
  "id": "uuid",
  "agent_id": "uuid",
  "course_id": "uuid",
  "score": 0.85,
  "issued_at": "2026-09-23T00:00:00Z",
  "valid": true
}
```

---

## 7. Talent Marketplace
**Internal port:** `4006`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/agents` | List all certified agents |
| GET | `/agents/:id` | Agent profile + certifications |
| GET | `/leaderboard` | Top agents ranked by score |

---

## 8. Monitoring Dashboard
**Internal port:** `4007`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | Aggregate health of all services |
| GET | `/metrics` | Prometheus-format metrics |
| GET | `/sessions/live` | All active training sessions |

---

## Error Response Format (all services)
```json
{
  "error": "short_error_code",
  "message": "Human readable description",
  "status_code": 400
}
```
