# Lynntimes Ryder Cup: live tracker (Vercel)

A live scoreboard for the Red vs Blue pickleball tournament (18 doubles matches, side-out scoring to 11). Anyone with the link can watch without signing in. Scorekeepers unlock writing with a PIN.

- **Red team**, captain Trí Ơi: Trí Ơi · Huy, Phu, Hai, Mi Linh · Van Linh, Thinh
- **Blue team**, captain Quan: Quan · Anh Do, Khanh, Dũng, Tung Linh · Trinh, Hiếu

## What's in the folder

| File | Purpose |
|---|---|
| `index.html` | The whole app in one self-contained file: overview, 18-match schedule, side-out scoring pad (challenge, 60 s timeout), stats and MVP, rosters, rules. |
| `api/state.js` | A Vercel Function with no dependencies. It stores scores in Upstash Redis through the REST API. |

## Deploy (about 10 minutes)

1. **Create the project.** Pick one:
   - **CLI:** run `npm i -g vercel`, then `vercel` inside this folder, then `vercel --prod`.
   - **GitHub:** push the folder to a repo, then in Vercel choose **Add New → Project → Import** and set Framework Preset to **Other**.

   Vercel has no drag-and-drop upload, so use one of these two.
2. **Add the database.** Open the project, then **Storage → Create Database → Upstash for Redis** (Marketplace, Free plan) → **Connect** to this project for all environments. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The function also accepts `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. **Set the scorekeeper PIN.** Go to **Settings → Environment Variables** and add `SCORE_PIN`, for example a 4–6 digit code. Share it only with scorekeepers.
4. **Redeploy** (**Deployments → ⋯ → Redeploy**) so the function picks up the variables.
5. **Check it.** Open the site. The header pill should read **"Trực tiếp · đang xem"**. Tap **Nhập PIN** and enter the PIN; the pill changes to **"Trực tiếp · đang ghi điểm"**.

> Without `SCORE_PIN`, **anyone with the link can edit scores**.

## Test before match night

Score one match on one phone and confirm a second phone shows it within about 4 seconds. Then wipe the test data in **Luật → Quản lý giải → Xóa toàn bộ tỷ số**. This needs the PIN.

## How it works

- `GET /api/state?since=<rev>` returns `{ rev, matches, meta, pin }`, or just `{ rev, unchanged: true }` when nothing has changed since `rev`.
- `POST /api/state` with the header `x-score-pin` accepts these bodies:
  - `{ op: "match", id: "m01".."m18", data: {...} | null }`
  - `{ op: "meta", data: { ended, endedAt } }`
  - `{ op: "wipe" }`
  - `{ op: "check" }` (verifies the PIN only)
- Redis keys: `lynntimes:cup:v1:matches` (a hash, one field per match), `lynntimes:cup:v1:meta` and `lynntimes:cup:v1:rev`. Set `CUP_KEY_PREFIX` to run a second tournament on the same database.
- Each match is stored separately, so two courts can score at the same time without overwriting each other.
- Phones poll every 4 s while a match is live and every 15 s otherwise. Polling pauses when the tab is in the background.
- If the API is unreachable, or the page is opened as a local file, the page offers **"Dùng chế độ một máy"**: scores are saved in that browser only.

## Free-tier budget

Estimate for one evening with 20 phones watching for 2.5 hours:

| Resource | Estimate | Free monthly limit | Share of limit |
|---|---|---|---|
| Vercel Hobby function invocations | ~45,000 | 1,000,000 | ≈4.5% |
| Upstash Redis commands | ~90,000 | 500,000 | ≈18% |

The estimate assumes one poll per phone every 4 s and about two Redis commands per poll.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Máy chủ đã chạy nhưng chưa gắn database" | Repeat step 2, then redeploy (step 4). |
| "Không gọi được máy chủ" | The `api/` folder was not deployed, or there is no network. |
| "Mã PIN không đúng" | Check `SCORE_PIN` and redeploy. Phones that already unlocked must enter the new PIN. |
| A scorekeeper's phone should stop editing | **Luật → Quản lý giải → Khóa ghi điểm trên máy này**. |
