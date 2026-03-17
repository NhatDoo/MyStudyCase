# Hệ thống Thực thi Mã nguồn Từ xa (Remote Code Execution System)

## 🔗 Demo

**Live API Docs (Swagger UI):** [https://mystudycase-production.up.railway.app/api-docs/](https://mystudycase-production.up.railway.app/api-docs/)

---

## 1. Overview (Tổng quan)

Dự án này là một nền tảng thực thi mã nguồn từ xa mô phỏng các hệ thống như LeetCode hay HackerRank. Người dùng có thể tạo một phiên bản code (Code Session), chỉnh sửa code (Autosave) và chạy code một cách bất đồng bộ. Hệ thống được thiết kế để chịu tải cao, cách ly mã độc an toàn qua Docker và đảm bảo API luôn phản hồi nhanh chóng mà không bị block.

---

## 2. Architecture (Kiến trúc)

Hệ thống sử dụng kiến trúc **Lập lịch Bất đồng bộ (Asynchronous Task Scheduling)** thông qua Publisher/Subscriber pattern:

- **API Server**: Nhận request từ người dùng, lưu vào Database và đẩy Job ID thông qua RabbitMQ, trả về thư xác nhận ngay lập tức cho Client.
- **Message Queue (RabbitMQ)**: Lưu trữ các lệnh thực thi ở trạng thái `QUEUED`, giúp hệ thống điều tiết luồng công việc (Load Leveling) và không bị quá tải cục bộ.
- **Background Worker**: Các tiến trình chạy ngầm (Node Worker) sẽ tự động lấy Job từ RabbitMQ, điều khiển Docker bằng Docker-out-of-Docker để tạo container sandbox, thực thi mã nguồn, bắt `stdout/stderr` và cập nhật lại Database.

### Pipeline Overview

![Code Execution Pipeline Overview](docs/images/pipeline-overview.png)

### Pipeline Detail Flow

![Code Execution Pipeline Detail](docs/images/pipeline-detail.png)

---

## 3. Tech Stack (Công nghệ sử dụng)

| Thành phần | Công nghệ |
|---|---|
| Ngôn ngữ | TypeScript / Node.js |
| Framework REST API | Express.js |
| Cơ sở dữ liệu | PostgreSQL (Supabase) + Prisma ORM |
| Message Queue | RabbitMQ (thông qua amqplib) |
| Sandbox | Docker (`node:18-alpine`, `python:3.9-alpine`) |
| Tài liệu API | Swagger JSDoc |
| Chống Spam | Express Rate Limit |
| Deploy | Railway |

---

## 4. Database Design (Thiết kế Cơ sở dữ liệu)

Được quản lý thông qua Prisma cho PostgreSQL:

- **`CodeSession`**: Chứa thông tin về người dùng, loại ngôn ngữ (`language`), mã nguồn gốc (`sourceCode`), trạng thái (`status: ACTIVE/CLOSED`).
- **`Execution`**: Mỗi lần Run code sẽ tạo một bản ghi Execution (quan hệ 1-N với Session). Thể hiện trạng thái từ lúc bắt đầu đến lúc kết thúc (`QUEUED`, `WAITING`, `RUNNING`, `COMPLETED`, `FAILED`, `TIMEOUT`), chứa kết quả `stdout/stderr` và thời gian chạy tính bằng mi-li giây.
- **`ExecutionLog`**: (Nested Writes từ Prisma). Lưu lại toàn bộ vòng đời (Lifecycle) chuyển giao trạng thái để phục vụ cho việc kiểm toán (Audit tracking) và cảnh báo độ trễ.

---

## 5. API Endpoints (Các API chính)

> Xem đầy đủ tài liệu tương tác tại: [https://mystudycase-production.up.railway.app/api-docs/](https://mystudycase-production.up.railway.app/api-docs/)

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/code-sessions` | Khởi tạo Session mới |
| `PATCH` | `/code-sessions/:id` | Auto-save lưu mã nguồn |
| `POST` | `/code-sessions/:id/run` | Request chạy code, xếp vào Queue (giới hạn 10 req/phút) |
| `GET` | `/executions/:id` | Client Polling lấy kết quả chạy |
| `GET` | `/executions/slow-jobs` | Giám sát danh sách Job bị ngâm trong Queue quá lâu |

---

## 6. Execution Flow (Luồng thực thi)

1. **QUEUED**: User nhấn Run → API lưu trạng thái `QUEUED` xuống DB → Đẩy ID vào RabbitMQ. Nhận phản hồi UUID.
2. **WAITING**: Worker gắp Job ra khỏi RabbitMQ (Prefetch 5 jobs/lần) → Update DB sang `WAITING` trong khi mount file `/tmp`.
3. **RUNNING**: Worker ra lệnh `docker run` → Update DB sang `RUNNING`.
4. **COMPLETED / FAILED / TIMEOUT**: Khởi động Container, xử lý mã → Bắt `close/error` event bằng Node.js stream → Xóa file rác → Lưu DB trạng thái cuối.

---

## 7. Use Cases (Các ca sử dụng thành công)

- **Run thành công**: Mã chuẩn cú pháp, in ra Hello World → Cập nhật stdout, thời gian (ms), trạng thái `COMPLETED` cho người dùng.
- **Chịu tải cao**: Hàng ngàn người dùng gọi cùng một lúc, tốc độ API vẫn tính bằng <10ms nhờ RabbitMQ đệm tải.
- **Spam Control**: User gọi API `/run` quá 10 lần trong vòng 1 phút sẽ bị khước từ với HTTP `429 Too Many Requests`.

---

## 8. Error Handling (Xử lý Ngoại lệ)

- **Ngôn ngữ không hỗ trợ**: Docker Executor chặn đứng và từ chối xử lý, cập nhật trạng thái `FAILED`.
- **Runtime Error / Lỗi cú pháp**: Thu lại Stream Output. Chuyển đổi trạng thái về `FAILED`, lưu trữ thông báo trực tiếp vào trường `stderr` trong DB.
- **Infinite Loop / Timeout**: Nếu process trong Docker chạy quá 10.000ms → Gọi `kill()` cứng container cướp lại CPU, đánh cờ `TIMEOUT`.
- **Worker Crash**: RabbitMQ được cấu hình `noAck: false`. Nếu Worker sập lúc Job đang chạy → RabbitMQ nhét lại Job lên hàng đợi, không bao giờ mất việc.

---

## 9. Security Considerations (Bảo mật)

- **Chặn Mạng**: Docker sandbox cấu hình với `--network=none` cấm User truy cập mạng ngoài.
- **Chặn CPU**: Cờ Docker `--cpus=0.5` chia hạn mức CPU để tránh mã User vắt kiệt Host.
- **Chặn Memory (Leak/OOM)**: Giới hạn bộ nhớ `--memory=128m`. Bất kì mã nào cấp phát quá 128MB RAM sẽ bị báo mã Linux `137` → Cắt lập tức với lệnh `Memory limit exceeded`.

---

## 10. Setup Instructions (Cài đặt)

Môi trường yêu cầu: Node.js >= 18, Docker CLI, RabbitMQ cục bộ (hoặc thay bằng Docker Compose)

**1. Clone source code và cài đặt NPM:**
```bash
git clone https://github.com/NhatDoo/MyStudyCase.git
cd MyStudyCase
npm install
```

**2. Thêm file cấu hình bảo mật `.env` ở thư mục dự án:**

> Dự án dùng **Supabase** (PostgreSQL cloud) — lấy connection string từ Supabase Dashboard → Project Settings → Database → URI.

```env
DATABASE_URL="postgresql://user:password@aws-xxxx.supabase.co:5432/postgres?schema=public"
RABBITMQ_URL="amqp://localhost"
```

**3. Generate Prisma Client và chạy Server:**

> `npx prisma generate` **bắt buộc** phải chạy để tạo Prisma Client cục bộ.
> `npx prisma db push` chỉ cần chạy **lần đầu** (hoặc khi schema thay đổi) để sync schema lên Supabase DB.

```bash
npx prisma generate
npx prisma db push   # Bỏ qua nếu DB đã có sẵn tables
npm run dev
```

**4. Ở màn hình Terminal mới (hoặc để Deploy), bật Background Worker:**
```bash
npm run worker
```

---

## 11. Running Tests (Cách chạy thử nghiệm)

1. Có thể dùng **Swagger UI** tại [https://mystudycase-production.up.railway.app/api-docs/](https://mystudycase-production.up.railway.app/api-docs/) để gọi API trực tiếp trên trình duyệt.
2. Có thể dùng **Postman** chọc thẳng vào cổng API `http://localhost:3000`.
3. Có thể dùng file giả lập tự động bằng TypeScript để test song song hàng loạt Job:
```bash
npx ts-node test-parallel.ts
```

---

## 12. Future Improvements (Cải tiến tương lai)

- **WebSocket**: Thay vì Client phải Polling liên tục `GET /executions/:id`, tự động hóa Socket.io bắn kết quả về trình duyệt khi Job ở Worker hoàn tất.
- **Scale Docker (Kubernetes)**: Cluster hóa RabbitMQ + Worker kết hợp Orchestration tự Scale khi `queue_delay_ms` vượt ngưỡng đỏ.
- **Authentication & JWT Token**: Cấp quyền người dùng để chấm điểm và xếp hạng trên Leaderboard.
