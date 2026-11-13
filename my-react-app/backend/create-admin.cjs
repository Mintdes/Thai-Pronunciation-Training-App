/**
 * สร้าง admin user หรือ promote user ที่มีอยู่แล้วให้เป็น admin
 * รัน: node create-admin.cjs <email> [password]
 *   - ถ้า user มีอยู่แล้ว: เปลี่ยน role เป็น admin
 *   - ถ้ายังไม่มี: สร้างใหม่ด้วย email + password ที่กำหนด
 *
 * ตัวอย่าง:
 *   node create-admin.cjs admin@example.com MyP@ssw0rd!
 *   node create-admin.cjs existing@user.com
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
    const email = process.argv[2];
    const password = process.argv[3];

    if (!email) {
        console.error('❌ ระบุ email: node create-admin.cjs <email> [password]');
        process.exit(1);
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existing) {
        // promote เป็น admin
        await prisma.user.update({
            where: { email: normalizedEmail },
            data: { role: 'admin' },
        });
        console.log(`✅ Promoted existing user "${existing.username}" (${normalizedEmail}) to admin`);
    } else {
        if (!password) {
            console.error('❌ user ยังไม่มีในระบบ — ต้องระบุ password ด้วย: node create-admin.cjs <email> <password>');
            process.exit(1);
        }
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+])[A-Za-z\d!@#$%^&*()_+]{8,}$/;
        if (!passwordRegex.test(password)) {
            console.error('❌ password ต้องมีตัวพิมพ์เล็ก/ใหญ่/ตัวเลข/อักขระพิเศษ และยาวอย่างน้อย 8 ตัว');
            process.exit(1);
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const username = normalizedEmail.split('@')[0];
        const newUser = await prisma.user.create({
            data: {
                username,
                email: normalizedEmail,
                password: hashedPassword,
                role: 'admin',
            },
        });
        console.log(`✅ Created admin user "${newUser.username}" (${normalizedEmail})`);
    }
}

main()
    .catch((err) => {
        console.error('❌ Error:', err.message);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
