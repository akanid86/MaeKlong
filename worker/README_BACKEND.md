# Mae Klong API v0.11 — Cloudflare Worker + D1

Backend แยกจาก GERARAI/Supabase โดยสมบูรณ์

## ความสามารถ
- รายงานจากประชาชนบันทึกใน D1 และทุกคนเห็นข้อมูลกลางชุดเดียวกัน
- Owner token ให้เจ้าของรายงานแก้/คลี่คลาย/ลบของตัวเอง
- Admin token อยู่ใน Worker secret เท่านั้น
- Admin ยืนยัน แก้ ซ่อน ปฏิเสธ นำกลับ ลบ และล้างข้อมูลได้
- ประชาชนกด flag รายงานผิดได้ โดย 1 IP (hash) ต่อ 1 รายงานนับครั้งเดียว
- มี `moderation_log` สำหรับ audit
- รายงาน hidden/rejected ไม่ถูกส่งออกใน public GET
- กรอบพิกัดตรวจใน backend ใช้ study envelope ของลุ่มน้ำแม่กลอง ไม่ใช้เส้นจังหวัด
- rate limit เบื้องต้น และไม่เก็บ IP ดิบ

## สร้าง D1 ใหม่
1. สร้าง D1 database ชื่อ `maeklong-flood`
2. รัน `schema.sql`
3. เอา database_id จริงไปแทน `REPLACE_WITH_D1_DATABASE_ID` ใน `wrangler.jsonc`
4. ตั้ง Worker secrets:
   - `ADMIN_TOKEN` — สุ่มยาวอย่างน้อย 32 ตัวอักษร
   - `RATE_SALT` — สุ่มยาวอย่างน้อย 32 ตัวอักษร
5. Deploy Worker
6. ผูก route/domain เป็น `api.maeklong.online`

## ถ้ามีฐาน v0.10 อยู่แล้ว
รัน `migration-v011.sql` เพียงครั้งเดียว แทนการรัน schema ใหม่ทับ

## Endpoints หลัก
Public:
- GET `/api/health`
- GET `/api/reports`
- POST `/api/reports`
- PATCH `/api/reports/:id` (owner/admin)
- DELETE `/api/reports/:id` (owner/admin)
- POST `/api/reports/:id/flag`

Admin:
- POST `/api/admin/verify`
- GET `/api/admin/reports?view=queue|all`
- POST `/api/admin/reports/:id/moderate`
- GET `/api/admin/reports/:id/history`
- DELETE `/api/admin/reports`

## ก่อนเปิดให้คนใช้จำนวนมาก
ควรเพิ่ม Cloudflare Turnstile ใน POST `/api/reports` และ `/flag` อีกชั้น
