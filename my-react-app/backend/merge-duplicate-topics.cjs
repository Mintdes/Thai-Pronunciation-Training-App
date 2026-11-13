// รวม Topic ที่ชื่อซ้ำใน DB ให้เหลืออันเดียว (ย้ายประโยคไปที่อันเก่าสุด แล้วลบตัวซ้ำ)
// และสร้าง Topic ให้บทเรียน hardcode ในแอปที่ยังไม่มีใน DB เพื่อให้ admin เลือกเพิ่มประโยคได้
//
// วิธีใช้ (รันในโฟลเดอร์ backend):
//   node merge-duplicate-topics.cjs           -> dry-run แค่แสดงสิ่งที่จะทำ ไม่แก้ DB
//   node merge-duplicate-topics.cjs --apply   -> ทำจริง
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// ต้องตรงกับชื่อใน TOPICS_BY_LEVEL ของ ChooseSentenceScreen.js
const HARDCODED = {
    easy: ['First Meeting', 'Greeting', 'Ordering Food'],
    medium: ['Where to go?', 'Making An Appointment', 'Asking and Telling Time'],
};
const norm = (t) => (t || '').trim().replace(/\s+/g, ' ').toLowerCase();

(async () => {
    console.log(APPLY ? '== APPLY MODE ==' : '== DRY RUN (ใส่ --apply เพื่อทำจริง) ==');
    const topics = await prisma.topic.findMany({
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { sentences: true } } },
    });

    // 1) หากลุ่มที่ซ้ำ
    const groups = new Map();
    for (const t of topics) {
        const key = `${t.level}::${norm(t.title)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
    }
    for (const [key, list] of groups) {
        if (list.length < 2) continue;
        const [main, ...dups] = list;
        const dupIds = dups.map((d) => d.id);
        const moved = dups.reduce((n, d) => n + d._count.sentences, 0);
        console.log(`• ${key}: เก็บ id=${main.id}, ลบ id=[${dupIds}] (ย้ายประโยค ${moved} รายการ)`);
        if (APPLY) {
            const icon = main.icon_url || dups.find((d) => d.icon_url)?.icon_url || null;
            await prisma.$transaction([
                prisma.sentence.updateMany({ where: { topic_id: { in: dupIds } }, data: { topic_id: main.id } }),
                prisma.topic.deleteMany({ where: { id: { in: dupIds } } }),
                ...(icon && !main.icon_url ? [prisma.topic.update({ where: { id: main.id }, data: { icon_url: icon } })] : []),
            ]);
        }
    }

    // 2) สร้าง Topic ให้บทเรียน hardcode ที่ยังไม่มีใน DB
    for (const [level, titles] of Object.entries(HARDCODED)) {
        for (const title of titles) {
            if (groups.has(`${level}::${norm(title)}`)) continue;
            console.log(`+ สร้าง topic "${title}" (${level})`);
            if (APPLY) await prisma.topic.create({ data: { title, level } });
        }
    }
    console.log('เสร็จแล้ว');
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());