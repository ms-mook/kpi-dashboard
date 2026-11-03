// ปี พ.ศ. ของลิขสิทธิ์ — เป็นค่าคงที่เพราะอ่านวันที่ใน layout ตอน prerender ไม่ได้
// (cacheComponents) แก้ปีนี้เมื่อขึ้นปีใหม่
const COPYRIGHT_YEAR_BE = 2569;

export function SiteFooter() {
  return (
    <footer className="mx-4 mt-2 border-t border-base-content/10 px-0 pb-6 pt-5 text-center sm:mx-6 lg:mx-10">
      <p className="text-xs leading-relaxed text-base-content/65">
        พัฒนาโดย ทนพญ. มุกดารัตน์ สุพัฒน์ · งานห้องปฏิบัติการเวชศาสตร์ชันสูตร โรงพยาบาลศรีนครินทร์
      </p>
      <p className="mt-1.5 text-[11px] text-base-content/40">
        © {COPYRIGHT_YEAR_BE} BRS KPI Center · สงวนลิขสิทธิ์
      </p>
    </footer>
  );
}
