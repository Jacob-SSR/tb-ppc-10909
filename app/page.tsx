// หน้าหลัก — proxy.ts บังคับ login แล้ว; ข้อมูลโหลดฝั่ง client จาก /api/data (กรองสิทธิ์ที่ server)
import { App } from "@/components/app/App";

export default function Home() {
  return <App />;
}
