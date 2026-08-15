# Kiểm thử & build devman ở local

Hướng dẫn này mô tả quy trình đã dùng để QA thực tế cho `devman`: build từ
source, dựng một **test project cách ly** (nằm ngoài repo, không đụng tới
config thật của bạn), rồi chạy qua toàn bộ các lệnh/luồng chính để xác nhận
mọi thứ hoạt động đúng trước khi merge hoặc release.

Tài liệu liên quan: [ARCHITECTURE.md](./ARCHITECTURE.md) (thiết kế),
[UI-UX.md](./UI-UX.md) (quy ước output terminal), [CLAUDE.md](./CLAUDE.md)
(quy tắc khi sửa code).

## 1. Build & kiểm tra tĩnh

```bash
npm install          # cài dependencies
npm run typecheck    # tsc --noEmit — strict mode, phải sạch
npm run lint          # eslint --max-warnings 0 — cảnh báo cũng tính là fail
npm test              # vitest run — unit + integration
npm run build          # compile src/ -> dist/, cần trước khi chạy CLI thật
```

Cả 4 bước trên phải xanh trước khi đi tiếp. `npm run build` bắt buộc vì
`bin.devman` trỏ vào `dist/cli/index.js` — chạy trực tiếp `src/` không được.

`npm link` là optional, giúp có lệnh `devman` trên PATH thay vì gọi
`node dist/cli/index.js`. Trong hướng dẫn này dùng dạng đầy đủ
`node <repo>/dist/cli/index.js` để không phụ thuộc PATH của máy.

## 2. Dựng test project cách ly

**Không test trong chính thư mục repo devman** — devman tự quản lý
`config/`, `logs/`, `runtime/` dựa trên `--home`/cwd, nên cần một thư mục
hoàn toàn tách biệt để mô phỏng "một dự án dùng devman".

```bash
mkdir -p ~/devman-qa
cd ~/devman-qa
```

### Fixture scripts

Vài script Node nhỏ, cross-platform, dùng làm "service giả" — tránh phụ
thuộc `sleep`/`sh` (không có trên Windows) và cho kết quả xác định:

**`heartbeat.js`** — service chạy dài hạn, in log đều đặn (test
`status`/`log`/dependency ordering):

```js
const name = process.argv[2] || 'svc';
let i = 0;
process.stdout.write(`${name} starting\n`);
setInterval(() => {
  process.stdout.write(`${name} tick ${i++}\n`);
}, 300);
```

**`crash.js`** — thoát ngay với code 1 (test restart policy `on-failure`):

```js
process.stdout.write('crash: about to exit 1\n');
process.exitCode = 1;
```

**`clean-exit.js`** — thoát ngay với code 0 (test restart policy `always`):

```js
process.stdout.write('clean-exit: exiting 0\n');
process.exitCode = 0;
```

**`tcp-server.js`** / **`http-server.js`** — dùng để test `healthCheck`
kiểu `tcp`/`http`:

```js
// tcp-server.js
const net = require('node:net');
const port = Number(process.argv[2] || 7801);
net.createServer((sock) => sock.end()).listen(port, '127.0.0.1');
setInterval(() => {}, 1000);
```

```js
// http-server.js
const http = require('node:http');
const port = Number(process.argv[2] || 7802);
http
  .createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404);
    res.end();
  })
  .listen(port, '127.0.0.1');
```

### Cấu trúc thư mục gợi ý

Mỗi kịch bản test là **một `--home` riêng** (tự có `config/`, `logs/`,
`runtime/`) — cách ly hoàn toàn, không service nào ảnh hưởng service khác:

```text
devman-qa/
├── heartbeat.js
├── crash.js
├── clean-exit.js
├── tcp-server.js
├── http-server.js
├── happy/config/services.json       # luồng chính: dependsOn + profile
├── restart-onfail/config/services.json
├── health-tcp/config/services.json
├── badcmd/config/services.json      # lệnh không tồn tại
└── badcwd/config/services.json      # cwd không tồn tại
```

Ví dụ `happy/config/services.json` — hai service với dependency và env var:

```json
{
  "services": [
    { "id": "db", "command": "node", "args": ["../heartbeat.js", "db"] },
    {
      "id": "api",
      "command": "node",
      "args": ["../heartbeat.js", "api"],
      "dependsOn": ["db"],
      "env": { "FOO": "bar-value" }
    }
  ]
}
```

> `cwd` mặc định `.` được resolve theo `--home`, không phải theo
> `config/`. Vì `services.json` nằm trong `<home>/config/`, đường dẫn tới
> script ở gốc `devman-qa/` là `../heartbeat.js` (lùi một cấp từ `<home>`),
> **không phải** `../../heartbeat.js`.

`happy/config/profiles.json`:

```json
{ "backend": ["db", "api"] }
```

## 3. Checklist smoke test theo lệnh

Chạy từ trong từng thư mục `--home` tương ứng. Đặt biến cho gọn:

```bash
DEVMAN="node /path/to/devman/dist/cli/index.js"
```

| Lệnh | Kỳ vọng |
| --- | --- |
| `$DEVMAN doctor` (chưa start) | In home/config/logs/runtime/socket, xác nhận config hợp lệ, báo daemon chưa chạy |
| `$DEVMAN start` | Spawn daemon, start service theo đúng thứ tự `dependsOn`, in bảng `running` |
| `$DEVMAN status` | Bảng khớp với `start`, `UPTIME` tăng dần |
| `$DEVMAN info <id>` | Bảng chi tiết: PID, Started, Health,... |
| `$DEVMAN info <id-không-tồn-tại>` | Exit `1`, có `hint:` |
| `$DEVMAN log <id>` | Stream log có timestamp + tag `OUT`/`ERR`, real-time |
| `$DEVMAN log <id> --no-follow --tail 3` | In 3 dòng cuối rồi **thoát ngay**, không treo |
| `$DEVMAN status --json` / `info <id> --json` | JSON hợp lệ, parse được bằng `jq`/`JSON.parse` |
| `$DEVMAN restart --profile <p>` | Chỉ service trong profile bị restart, PID đổi |
| `$DEVMAN stop --profile <p>` | Service trong profile dừng, **daemon vẫn chạy** (`doctor` vẫn thấy daemon) |
| `$DEVMAN stop` (không profile) | Toàn bộ service + daemon dừng |
| `$DEVMAN stop` (gọi lần 2) | Exit `0`, in "Daemon is not running." — không lỗi |
| `$DEVMAN status` (daemon đã dừng) | Exit `1`, `DAEMON_NOT_RUNNING` + hint `devman start` |
| `$DEVMAN --home ./happy doctor` (chạy từ thư mục khác) | Vẫn resolve đúng home |
| `$DEVMAN -v doctor` | Có thêm log debug |

## 4. Checklist các trường hợp lỗi / cấu hình sai

Đây là nhóm quan trọng nhất để bắt regression — tạo riêng một `--home` cho
mỗi case:

| Case | `services.json` | Kỳ vọng |
| --- | --- | --- |
| Dependency cycle | `a` dependsOn `b`, `b` dependsOn `a` | `devman doctor` **phải báo lỗi ngay** (`DEPENDENCY_CYCLE`) — không chờ tới `start` |
| Dependency thiếu | `a` dependsOn `ghost` (không tồn tại) | `doctor` báo `DEPENDENCY_MISSING`, có hint |
| Duplicate id | Hai service cùng `id` | `doctor` báo lỗi trùng id |
| JSON sai cú pháp | Thiếu dấu `"` quanh key | `doctor` báo lỗi **có hint**, exit `1` (không phải raw `SyntaxError` exit `2`) |
| Command không tồn tại | `"command": "khong-ton-tai-xyz"` | `devman start` phải **exit 1**, in `✖ Started 0/1...`, bảng status hiện `failed` (không phải `running` giả) |
| `cwd` không tồn tại | `"cwd": "./khong-co-thu-muc"` | Tương tự — exit 1, không báo thành công giả |
| `restart.policy: "no"` | dùng `crash.js` | Sau khi crash: `status: failed`, `restarts: 0`, **không** tự khởi động lại |
| `restart.policy: "on-failure", maxRetries: 2` | dùng `crash.js` | Thử lại đúng 2 lần rồi dừng ở `failed`, `restarts: 2` |
| `restart.policy: "always"` | dùng `clean-exit.js` | Vẫn tự khởi động lại dù exit code là 0 |
| `healthCheck: {type: "tcp", port}` | dùng `tcp-server.js` | `unhealthy` → `healthy` sau khi server mở port |
| `healthCheck: {type: "http", url}` | dùng `http-server.js` | Tương tự, dựa trên status HTTP 2xx/3xx |
| `healthCheck: {type: "tcp"}` (thiếu `port`) | bất kỳ | Tự "hạ cấp" về probe kiểu `process` — vẫn `healthy` nếu process đang chạy, không throw |

## 5. Kiểm tra riêng cho Windows

Bug đã từng gặp: tên named pipe bị đụng độ nếu hai `--home` khác nhau có
chung tiền tố đường dẫn dài (ví dụ hai project nằm cùng thư mục cha). Kiểm
tra nhanh không cần build:

```bash
node --input-type=module -e "
import { resolvePaths } from './dist/config/paths.js';
console.log(resolvePaths({ home: 'C:/work/project-a', env: {} }).socketPath);
console.log(resolvePaths({ home: 'C:/work/project-b', env: {} }).socketPath);
"
```

Hai dòng in ra **phải khác nhau hoàn toàn**. Nếu trùng, đó là regression
của bug named-pipe collision.

Test thực tế: mở `project-a` bằng `devman start`, **không** `stop`, rồi
chạy `devman start` trong `project-b` — `project-b` phải khởi động daemon
và service của chính nó, không được "dính" vào daemon của `project-a`.

## 6. Dọn dẹp sau khi test

```bash
# Đảm bảo không còn daemon nào sống sót
tasklist | findstr node.exe          # Windows
ps aux | grep 'dist/daemon'          # macOS/Linux

# Nếu còn sót, dừng thủ công qua từng --home, hoặc kill trực tiếp theo PID
$DEVMAN --home ./<workspace> stop

# Xoá state/log để lần chạy sau sạch sẽ (không xoá services.json)
rm -rf <workspace>/runtime <workspace>/logs
```

Không xoá `devman-qa/` khỏi máy — giữ lại để tái sử dụng cho lần kiểm thử
tiếp theo; mỗi workspace là một fixture độc lập, chạy lại bất cứ lúc nào
sau khi sửa code + `npm run build`.

## 7. Quy trình đầy đủ khi sửa code

1. Sửa code trong `src/`.
2. `npm run typecheck && npm run lint && npm test` — phải xanh.
3. `npm run build`.
4. Chạy lại checklist ở mục 3–4 liên quan tới phần vừa sửa (không cần chạy
   toàn bộ mỗi lần, nhưng **bắt buộc** chạy lại case đã từng lỗi để tránh
   regression).
5. Dọn dẹp theo mục 6 trước khi commit.
