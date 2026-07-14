# Terminal Quản Trị Hệ Thống

Ứng dụng web tự host để quản trị máy chủ Linux qua trình duyệt. Dự án cung cấp terminal thời gian thực, trình quản lý tệp, theo dõi tài nguyên, nhật ký hoạt động và xem trước nhiều loại tài liệu.

> [!WARNING]
> Backend có thể chạy với quyền `root`. Một tài khoản web bị chiếm quyền đồng nghĩa với toàn bộ máy chủ có thể bị kiểm soát. Chỉ triển khai qua HTTPS, dùng mật khẩu mạnh và giới hạn người có thể truy cập.

## Tính Năng

- Terminal tương tác thời gian thực bằng Xterm.js, Socket.IO và `node-pty`.
- Quản lý tệp: tạo, sửa, upload, download, đổi tên, di chuyển, sao chép và tìm kiếm.
- Thùng rác, khôi phục, xóa vĩnh viễn và thao tác hàng loạt.
- Nén ZIP/TAR/TAR.GZ, giải nén ZIP và tạo symbolic link.
- Chỉnh quyền `chmod`, `chown` và xem metadata tệp.
- Xem CPU, RAM và dung lượng ổ đĩa.
- Quản lý systemd service, journal logs và Linux processes.
- Nhật ký đăng nhập và thao tác quản trị.
- Trình chỉnh sửa tệp văn bản với kiểm tra xung đột khi lưu.
- Xem trước video, âm thanh, hình ảnh và PDF.
- Chuyển tài liệu Office sang PDF để xem bằng LibreOffice.
- Xác thực Argon2id và session cookie `HttpOnly`.
- Nhiều tài khoản với vai trò viewer, operator, admin và root.
- Vé ngắn hạn cho Socket.IO và URL xem trước, không đưa session token vào URL.

## Kiến Trúc

Production được tách thành hai phần:

```text
Trình duyệt
  |
  +-- https://terminal.example.com
  |     Cloudflare static assets (Next.js output: export)
  |
  +-- https://api-terminal.example.com
        Nginx/Caddy -> Express + Socket.IO trên VPS
                         |
                         +-- node-pty -> /bin/bash
                         +-- Linux filesystem
```

Frontend là static export trong thư mục `out/`. Express, Socket.IO, terminal, filesystem và database phải chạy trên VPS; Cloudflare Workers không thể thay thế backend này.

## Công Nghệ

- Next.js 16, React 19 và TypeScript
- Tailwind CSS
- Express 5 và Socket.IO
- Xterm.js và `node-pty`
- Argon2id
- Archiver và Unzipper
- Wrangler cho Cloudflare static assets
- LibreOffice cho xem trước tài liệu Office

## Yêu Cầu

- Node.js 20.9 trở lên
- npm
- Linux cho backend production
- Công cụ build native cần thiết cho `node-pty` và `argon2`
- LibreOffice nếu cần xem `docx`, `xlsx`, `pptx` hoặc OpenDocument
- Domain HTTPS cho frontend và backend

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y build-essential python3 libreoffice
```

## Cài Đặt Local

```bash
git clone https://github.com/your-user/teminal-quantrihethong.git
cd teminal-quantrihethong
npm install
```

Tạo `.env`:

```env
NEXT_PUBLIC_API_URL=
TERMINAL_PASSWORD=thay-bang-mat-khau-rat-manh
BACKEND_PORT=3001
FRONTEND_ORIGIN=http://localhost:3000
FILE_MANAGER_ROOT=.
FILE_MANAGER_TRASH_DIR=.terminal-trash
LIBREOFFICE_PATH=libreoffice
```

Chạy full-stack local:

```bash
npm run dev
```

Mở `http://localhost:3000`.

## Biến Môi Trường

| Biến | Phạm vi | Mô tả |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Frontend | URL HTTPS của backend. Để trống khi chạy full-stack cùng origin. |
| `TERMINAL_PASSWORD` | Backend | Mật khẩu khởi tạo khi database chưa có password. Không thay đổi password đã lưu. |
| `BACKEND_PORT` | Backend | Port backend-only, mặc định `3001`. |
| `FRONTEND_ORIGIN` | Backend | Origin frontend chính xác, ví dụ `https://terminal.example.com`; không có dấu `/` cuối. |
| `TRUST_PROXY` | Backend | Proxy tin cậy của Express. Đặt `1` khi backend chỉ nằm sau đúng một reverse proxy; để trống nếu truy cập trực tiếp. |
| `FILE_MANAGER_ROOT` | Backend | Thư mục gốc hiển thị trong File Manager. Dùng `/` để quản lý toàn máy chủ. |
| `FILE_MANAGER_TRASH_DIR` | Backend | Nơi lưu thùng rác, phải có quyền ghi. |
| `FILE_MANAGER_SNAPSHOT_DIR` | Backend | Kho snapshot nội bộ, không đặt trong thư mục được web server phục vụ. |
| `SNAPSHOT_MAX_FILE_MB` | Backend | Dung lượng tối đa mỗi file được snapshot, mặc định `100`. |
| `SNAPSHOT_MAX_TOTAL_MB` | Backend | Tổng quota snapshot, mặc định `2048`; tự xóa bản cũ nhất khi vượt quota. |
| `LIBREOFFICE_PATH` | Backend | Binary LibreOffice, thường là `/usr/bin/libreoffice`. |
| `OFFICE_MAX_CONCURRENCY` | Backend | Số tác vụ chuyển đổi LibreOffice tối đa chạy đồng thời, mặc định `1`. |
| `AUTH_ENCRYPTION_KEY` | Backend | Khóa tối thiểu 32 ký tự dùng mã hóa AES-256-GCM cho TOTP secret. Không được thay đổi sau khi bật 2FA. |
| `TOTP_ISSUER` | Backend | Tên hiển thị trong ứng dụng Authenticator, mặc định `Terminal Admin`. |
| `NODE_ENV` | Backend | Đặt `production` để bật cookie `Secure`. |
| `PORT` | Full-stack | Port cho chế độ full-stack, mặc định `3000`. |

`.env` chứa bí mật và đã bị Git bỏ qua. Không commit file này.

## Chạy Backend Trên VPS

Cấu hình production mẫu:

```env
NODE_ENV=production
BACKEND_PORT=3001
FRONTEND_ORIGIN=https://terminal.example.com
TERMINAL_PASSWORD=mat-khau-khoi-tao-rat-manh
FILE_MANAGER_ROOT=/
FILE_MANAGER_TRASH_DIR=/root/.terminal-trash
FILE_MANAGER_SNAPSHOT_DIR=/root/.terminal-snapshots
SNAPSHOT_MAX_FILE_MB=100
SNAPSHOT_MAX_TOTAL_MB=2048
LIBREOFFICE_PATH=/usr/bin/libreoffice
AUTH_ENCRYPTION_KEY='thay-bang-mot-khoa-ngau-nhien-toi-thieu-32-ky-tu'
TOTP_ISSUER=Terminal Admin
```

Tạo khóa mã hóa ngẫu nhiên:

```bash
openssl rand -base64 48
```

Sao lưu `AUTH_ENCRYPTION_KEY` ở nơi an toàn. Nếu mất hoặc thay khóa sau khi bật 2FA, backend không thể giải mã TOTP secret hiện tại.

Đặt giá trị trong dấu nháy nếu khóa chứa `#`, khoảng trắng hoặc ký tự đặc biệt. Trong file `.env`, ký tự `#` không được đặt trong dấu nháy sẽ bắt đầu một comment và làm khóa bị cắt ngắn. Backend in trạng thái lúc khởi động nhưng không in nội dung khóa:

```text
[SECURITY] AUTH_ENCRYPTION_KEY: configured
```

Cài dependency và build:

```bash
npm ci
npm run build:backend
```

### Systemd

Tạo `/etc/systemd/system/terminal-admin.service`:

```ini
[Unit]
Description=Terminal Administration Backend
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/terminal-admin
EnvironmentFile=/opt/terminal-admin/.env
ExecStart=/usr/bin/node /opt/terminal-admin/dist/server.js --backend
Restart=always
RestartSec=5

NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
```

Kích hoạt service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now terminal-admin
sudo systemctl status terminal-admin
```

Xem log:

```bash
sudo journalctl -u terminal-admin -f
```

Nếu không cần quản lý toàn filesystem, nên chạy service bằng user không phải root và đặt:

```env
FILE_MANAGER_ROOT=/home/admin
FILE_MANAGER_TRASH_DIR=/home/admin/.terminal-trash
```

## Reverse Proxy Nginx

Ví dụ backend tại `api-terminal.example.com`:

```nginx
server {
    listen 443 ssl http2;
    server_name api-terminal.example.com;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

Không công khai trực tiếp port `3001`; chỉ cho phép kết nối nội bộ hoặc qua firewall.

## Deploy Frontend Lên Cloudflare

Đặt biến môi trường build trên Cloudflare:

```env
NEXT_PUBLIC_API_URL=https://api-terminal.example.com
```

Build frontend:

```bash
npm run build
```

Kết quả nằm trong `out/`. Deploy bằng Wrangler:

```bash
npx wrangler deploy
```

Hoặc chạy cả build và deploy:

```bash
npm run deploy
```

Nếu dùng Cloudflare Builds:

```text
Build command: npm run build
Deploy command: npx wrangler deploy
```

Không dùng OpenNext cho cấu hình hiện tại. Dự án dùng `output: 'export'` và Wrangler phục vụ trực tiếp thư mục `out/` theo `wrangler.jsonc`.

## Bảo Mật Xác Thực

- Mật khẩu được lưu bằng Argon2id.
- Hash HMAC-SHA256 cũ được tự động nâng cấp sau lần đăng nhập hợp lệ đầu tiên.
- Session tồn tại 12 giờ trong cookie `HttpOnly`, `Secure`, `SameSite=Strict`.
- Database chỉ lưu SHA-256 của session token.
- Đổi mật khẩu thu hồi các session cũ.
- Socket.IO sử dụng vé một lần hết hạn sau 30 giây.
- Media và Office preview dùng vé theo từng file, hết hạn sau 60 giây.
- Backend-only kiểm tra `Origin` đối với request thay đổi dữ liệu.

Frontend và backend production nên nằm dưới cùng một site, ví dụ:

```text
https://terminal.example.com
https://api-terminal.example.com
```

Cookie `SameSite=Strict` có thể không hoạt động nếu frontend dùng `*.pages.dev` nhưng backend nằm trên domain gốc khác.

## Phân Quyền

Sau lần chạy đầu tiên của phiên bản nhiều người dùng, tài khoản và 2FA hiện tại được chuyển thành user `root`. Tên đăng nhập mặc định là:

```text
root
```

Mật khẩu hiện tại không thay đổi.

| Vai trò | Xem file | Sửa file | Terminal | Audit log | Quản lý user | chmod/chown |
| --- | --- | --- | --- | --- | --- | --- |
| `viewer` | Có | Không | Không | Không | Không | Không |
| `operator` | Có | Có | Không | Không | Không | Không |
| `admin` | Có | Có | Có | Có | Không | Không |
| `root` | Có | Có | Có | Có | Có | Có |

Quyền được kiểm tra tại backend. Việc ẩn nút trên frontend chỉ hỗ trợ trải nghiệm và không phải lớp bảo mật chính.

## Xác Nhận Thao Tác Nguy Hiểm

Backend yêu cầu xác nhận lại mật khẩu và mã 2FA trước các thao tác nhạy cảm:

- Ghi, move, upload, archive hoặc xóa trong `/etc`, `/boot`, `/usr`, `/root`, `/var`, `/bin`, `/sbin`, `/lib`.
- Thay đổi `chmod` hoặc `chown`.
- Khôi phục, xóa vĩnh viễn hoặc dọn thùng rác.

Sau khi xác nhận, quyền tăng cường tồn tại trong cookie `HttpOnly` riêng và hết hạn sau 5 phút. Cookie được gắn với session hiện tại, không thể dùng lại với session khác. Nếu user đã bật 2FA thì cần cả mật khẩu và mã TOTP/recovery code; nếu chưa bật 2FA thì chỉ cần mật khẩu.

## Snapshot Và Khôi Phục

Backend tự tạo snapshot cho file thường trước khi chỉnh sửa, move/rename, đổi metadata hoặc chuyển vào thùng rác. Snapshot gồm nội dung file, đường dẫn gốc, mode, mtime và checksum SHA-256.

- File lớn hơn `SNAPSHOT_MAX_FILE_MB` không được snapshot tự động.
- Thư mục không được sao chép đệ quy tự động.
- Khi tổng kho vượt `SNAPSHOT_MAX_TOTAL_MB`, bản cũ nhất bị xóa trước.
- Khôi phục xác minh checksum, snapshot trạng thái hiện tại rồi ghi file theo cách atomic.
- Khôi phục và xóa snapshot luôn yêu cầu step-up authorization.
- Kho snapshot bị chặn khỏi File Manager thông thường.

## Quản Lý Systemd Và Process

Tab `Hệ thống` dành cho role `admin` và `root`:

- Liệt kê tất cả systemd service và trạng thái `active/sub`.
- Start, stop, restart, enable và disable service.
- Xem 200 dòng `journalctl` gần nhất của từng unit.
- Liệt kê tối đa 500 process theo CPU.
- Xem PID, PPID, user, CPU, RAM, RSS, elapsed time và command.
- Gửi `SIGTERM` hoặc `SIGKILL`.

Mọi action thay đổi service hoặc gửi signal đều yêu cầu step-up authorization và được ghi audit. Backend không dùng shell string; `systemctl`, `journalctl` và `ps` được gọi bằng `execFile` với danh sách tham số đã kiểm tra. Không cho gửi signal tới PID 1 hoặc PID của chính backend.

Tính năng này chỉ hoạt động trên Linux có systemd và các lệnh `systemctl`, `journalctl`, `ps`. User chạy backend phải có quyền tương ứng; cấu hình hiện tại chạy root nên có đầy đủ quyền.

## Xem Trước Tệp

Định dạng hỗ trợ:

- Video: MP4, WebM, OGV, MOV, M4V
- Âm thanh: MP3, WAV, OGG, AAC, M4A, FLAC, Opus
- Hình ảnh: PNG, JPEG, GIF, WebP, AVIF, BMP, SVG, ICO
- PDF
- Office: DOC, DOCX, XLS, XLSX, PPT, PPTX
- OpenDocument: ODT, ODS, ODP

Video và audio hỗ trợ HTTP Range để tua mà không tải toàn bộ tệp. Tài liệu Office được chuyển thành PDF tạm và file tạm được xóa sau khi response kết thúc.

Kiểm tra LibreOffice:

```bash
libreoffice --headless --version
```

## Scripts

| Lệnh | Mô tả |
| --- | --- |
| `npm run dev` | Chạy frontend và backend local qua `server.ts`. |
| `npm run backend` | Chạy backend-only bằng TSX. |
| `npm run build` | Build static frontend vào `out/`. |
| `npm run build:backend` | Bundle backend vào `dist/server.js`. |
| `npm run start` | Chạy full-stack bằng TSX. |
| `npm run deploy` | Build và deploy frontend lên Cloudflare. |
| `npm run lint` | Chạy ESLint. |

## Cập Nhật Production

Backend:

```bash
git pull
npm ci
npm run build:backend
sudo systemctl restart terminal-admin
sudo journalctl -u terminal-admin -n 100 --no-pager
```

Frontend:

```bash
npm ci
npm run deploy
```

## Xử Lý Lỗi

### Cookie đăng nhập không được lưu

- Kiểm tra frontend và backend đều dùng HTTPS.
- Kiểm tra `NODE_ENV=production` trên backend.
- Kiểm tra `FRONTEND_ORIGIN` khớp chính xác domain frontend.
- Kiểm tra frontend và backend thuộc cùng site/domain gốc.

### Socket.IO không kết nối

- Reverse proxy phải chuyển header `Upgrade` và `Connection`.
- Kiểm tra port backend và firewall.
- Kiểm tra `FRONTEND_ORIGIN`.
- Xem `journalctl -u terminal-admin -f`.

### `EACCES: permission denied`

User chạy backend không có quyền ghi vào đường dẫn yêu cầu. Kiểm tra:

```bash
systemctl show terminal-admin -p User -p Group
ls -ld /duong/dan/can-quan-ly
```

Không cấp quyền rộng như `chmod -R 777`. Sửa owner/group hoặc giới hạn `FILE_MANAGER_ROOT`.

### Không xem được tài liệu Office

```bash
which libreoffice
libreoffice --headless --version
```

Đặt `LIBREOFFICE_PATH` đúng và khởi động lại backend.

### Cloudflare tìm `.next/standalone`

Không để Wrangler tự migrate dự án sang OpenNext. Repository phải có `wrangler.jsonc` với:

```jsonc
{
  "assets": {
    "directory": "./out"
  }
}
```

## Kiểm Tra Trước Khi Deploy

```bash
npm run lint
npm run build
npm run build:backend
npx wrangler deploy --dry-run
```

## Lưu Ý

- `terminal_database.json` chứa hash mật khẩu, session hash và nhật ký. Không phục vụ file này qua web server và nên giới hạn quyền đọc.
- `TERMINAL_PASSWORD` chỉ dùng lúc khởi tạo database; đổi biến này không đổi mật khẩu hiện tại.
- Upload hiện giới hạn 25 MB trong backend. Nginx phải có `client_max_body_size` không thấp hơn giới hạn này.
- Editor văn bản giới hạn 2 MB; media và tài liệu dùng endpoint streaming riêng.
- Chạy backend bằng root chỉ khi thực sự cần quản lý toàn hệ thống.

## License

Chưa khai báo license. Mặc định mọi quyền thuộc chủ sở hữu repository.
