require('dotenv').config(); // ต้องอยู่บรรทัดแรกสุดเสมอ ก่อนโค้ดอื่นที่จะอ่าน process.env

const express = require('express');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

// 🎯 แก้ปัญหา: express-rate-limit แจ้งเตือนเรื่อง X-Forwarded-For เมื่อรันผ่าน Ngrok
app.set('trust proxy', 1);

// ----------------------------------------------------
// Supabase Storage client (ใช้ service role key เพื่อ bypass RLS)
// ----------------------------------------------------
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    supabaseKey
);

// 🎯 ตรวจสอบ Environment Variables ที่จำเป็นทั้งหมด
const REQUIRED_ENV_VARS = [
    'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'DATABASE_URL', 'JWT_SECRET', 'SUPABASE_URL',
];
const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (!supabaseKey) missingEnvVars.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY');

if (missingEnvVars.length > 0) {
    throw new Error(
        `Missing required environment variable(s): ${missingEnvVars.join(', ')}. ` +
        'Please set them in your .env file before starting the server.'
    );
}

const prisma = new PrismaClient();

// ----------------------------------------------------
// ตั้งค่าการส่งอีเมลผ่าน Gmail SMTP (Nodemailer)
// ----------------------------------------------------
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});
const MAIL_FROM = `Thai Pronunciation <${process.env.GMAIL_USER}>`;

const sendEmail = ({ to, subject, html }) =>
    transporter.sendMail({ from: MAIL_FROM, to, subject, html });

// ----------------------------------------------------
// CORS Configuration
// ----------------------------------------------------
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || /\.vercel\.app$/.test(new URL(origin).hostname)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    credentials: true
}));

app.use(express.json());

// ----------------------------------------------------
// Rate limiting กัน brute-force
// ----------------------------------------------------
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { message: "ลองมากเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง" },
    standardHeaders: true,
    legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: "ลองมากเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง" },
    standardHeaders: true,
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: "เข้าสู่ระบบผิดพลาดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง" },
    standardHeaders: true,
    legacyHeaders: false,
});

// ----------------------------------------------------
// Helpers: Validation & Encryption
// ----------------------------------------------------
// กัน HTML injection ในอีเมล (username มาจากผู้ใช้โดยตรง)
const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalizeEmail = (email) => (email || '').trim().toLowerCase();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);
const hashOtp = (otpCode) => bcrypt.hash(otpCode, 8);
const verifyOtp = (otpCode, hashedOtp) => bcrypt.compare(otpCode, hashedOtp);

const JWT_EXPIRES_IN = '7d';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const createAuthSession = async (user) => {
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const session = await prisma.session.create({
        data: {
            user_id: user.user_id,
            expired_at: expiresAt,
        },
    });

    return jwt.sign(
        { userId: user.user_id, email: user.email, sessionId: session.session_id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
};

// ----------------------------------------------------
// Middlewares
// ----------------------------------------------------
const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);

        if (!payload.sessionId) {
            return res.status(401).json({ message: "เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" });
        }

        const session = await prisma.session.findUnique({
            where: { session_id: BigInt(payload.sessionId) },
        });

        if (!session || session.user_id !== payload.userId || session.expired_at < new Date()) {
            return res.status(401).json({ message: "เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" });
        }

        req.user = payload; // { userId, email, sessionId }
        next();
    } catch (error) {
        return res.status(401).json({ message: "เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" });
    }
};

const requireAdmin = async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({ where: { user_id: req.user.userId } });
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: "คุณไม่มีสิทธิ์ใช้งานส่วนนี้ (ต้องเป็น admin เท่านั้น)" });
        }
        next();
    } catch (error) {
        console.error('requireAdmin error:', error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์" });
    }
};

// ----------------------------------------------------
// Helpers: Supabase Storage & Paths
// ----------------------------------------------------
const sanitizeStorageSegment = (segment, fallback = 'item') => {
    const sanitized = String(segment || '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_\-]/g, '');
    return sanitized || fallback;
};

const toSafePath = (str) =>
    (str || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

const buildSafeAudioName = (originalName, mimeType) => {
    const raw = originalName || '';
    const dot = raw.lastIndexOf('.');
    let ext = dot >= 0 ? toSafePath(raw.slice(dot + 1)).toLowerCase() : '';
    if (!ext) {
        const m = (mimeType || '').toLowerCase();
        ext = m.includes('wav') ? 'wav' : m.includes('mpeg') || m.includes('mp3') ? 'mp3' : 'm4a';
    }
    const base = toSafePath(dot >= 0 ? raw.slice(0, dot) : raw) || 'audio';
    return `${base}_${Date.now()}.${ext}`;
};

const topicFolder = (topicId) => `topic_${topicId}`;

const uploadToSupabase = async (bucket, filePath, fileBuffer, mimeType) => {
    const { error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(filePath, fileBuffer, {
            contentType: mimeType,
            upsert: true,
        });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);

    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(filePath);
    return data.publicUrl;
};

const storagePathFromUrl = (url, bucket) => {
    if (!url) return '';
    const marker = '/' + bucket + '/';
    const idx = url.indexOf(marker);
    if (idx < 0) return '';
    try {
        return decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
    } catch {
        return '';
    }
};

// ----------------------------------------------------
// Authentication Endpoints
// ----------------------------------------------------
app.post('/api/auth/register-request', otpLimiter, async (req, res) => {
    const { username, password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }
    if (!username || username.length < 5) {
        return res.status(400).json({ message: "Username ต้องยาวอย่างน้อย 5 ตัวอักษร" });
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+])[A-Za-z\d!@#$%^&*()_+]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ message: "Password ไม่เป็นไปตามเงื่อนไขความปลอดภัย" });
    }

    try {
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: "อีเมลนี้ถูกใช้งานไปแล้ว" });
        }

        // ผู้ใช้กด Resend ซ้ำเร็วเกินไป (เช่น กลับเข้าแอปแล้วกดซ้ำ) -> ไม่ส่งเมลซ้ำ แต่ OTP เดิมยังใช้ได้ จึงตอบสำเร็จ
        const existingVerification = await prisma.emailVerification.findUnique({ where: { email_purpose: { email, purpose: 'register' } } });
        if (existingVerification
            && Date.now() - existingVerification.createdAt.getTime() < RESET_OTP_MIN_INTERVAL_MS
            && Date.now() < existingVerification.expiresAt.getTime()) {
            return res.status(200).json({ message: "ส่งรหัส OTP ไปยังอีเมลเรียบร้อยแล้ว (โปรดรอสักครู่ก่อนขอรหัสใหม่)" });
        }

        const otpCode = require('crypto').randomInt(100000, 1000000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const hashedOtpCode = await hashOtp(otpCode);
        const verification = await prisma.emailVerification.upsert({
            where: { email_purpose: { email, purpose: 'register' } },
            update: { otpCode: hashedOtpCode, expiresAt, createdAt: new Date() },
            create: { email, purpose: 'register', otpCode: hashedOtpCode, expiresAt }
        });
        console.log(`[EmailVerification] register upserted: id=${verification.emailveri_id} email=${email} expiresAt=${verification.expiresAt.toISOString()}`);

        // ตอบแอปทันทีหลังตรวจข้อมูลและบันทึก OTP ลงฐานข้อมูลแล้ว (ไม่รอ Gmail SMTP ซึ่งอาจช้าหลายวินาที)
        // เพื่อให้หน้า OTP ขึ้นเร็วและแอปไม่ค้างรอ response ตอนผู้ใช้สลับไปเปิดเมล
        // ส่งเมลเป็นงานเบื้องหลังหลังตอบแล้ว ถ้าล้มเหลวแค่ log ไว้ ผู้ใช้กด Resend OTP เพื่อขอใหม่ได้
        res.status(200).json({ message: "ส่งรหัส OTP ไปยังอีเมลเรียบร้อยแล้ว" });

        sendEmail({
            to: email,
            subject: 'Your OTP Verification Code for Registration',
            html: `
                <div style="font-family: 'Prompt', Arial, sans-serif; padding: 25px; border: 1px solid #e5e7eb; border-radius: 20px; max-width: 500px; margin: auto; background-color: #fdf6ec;">
                    <h2 style="color: #f97316; text-align: center; font-size: 24px;">Welcome to Thai Pronunciation! 🐣</h2>
                    <p style="font-size: 16px; color: #333;">Hello <b>${escapeHtml(username)}</b>,</p>
                    <p style="font-size: 15px; color: #555;">Thank you for registering. Please use the One-Time Password (OTP) below to verify your account and complete your sign-up process:</p>
                    <div style="background-color: #ffffff; padding: 18px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #f97316; margin: 25px 0; border-radius: 16px; border: 2px dashed #f97316;">
                        ${otpCode}
                    </div>
                    <p style="color: #ef4444; font-size: 13px; font-weight: bold; text-align: center;">* This OTP code is valid for 5 minutes only.</p>
                    <p style="font-size: 12px; color: #9ca3af; margin-top: 30px; text-align: center;">If you did not request this code, please safely ignore this email.</p>
                </div>
            `
        }).catch((mailError) => {
            console.error(`[Register OTP] send email failed: email=${email}`, mailError);
        });
        return;

    } catch (error) {
        console.error("Register Request Error:", error);
        if (res.headersSent) return;
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในระบบเซิร์ฟเวอร์" });
    }
});

app.post('/api/auth/register-confirm', otpLimiter, async (req, res) => {
    const { username, password, otpCode } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!username || username.length < 5) {
        return res.status(400).json({ message: "Username ต้องยาวอย่างน้อย 5 ตัวอักษร" });
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+])[A-Za-z\d!@#$%^&*()_+]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ message: "Password ไม่เป็นไปตามเงื่อนไขความปลอดภัย" });
    }

    if (typeof otpCode !== 'string' || !/^\d{6}$/.test(otpCode)) {
        return res.status(400).json({ message: "รหัส OTP ไม่ถูกต้อง" });
    }

    try {
        const record = await prisma.emailVerification.findUnique({ where: { email_purpose: { email, purpose: 'register' } } });
        if (!record) {
            return res.status(400).json({ message: "รหัส OTP ไม่ถูกต้อง หรือหมดอายุแล้ว กรุณากดขอรหัสใหม่" });
        }
        // เช็กหมดอายุก่อนค่อย bcrypt.compare (ประหยัดงาน และให้ข้อความที่ตรงกับสาเหตุ)
        if (new Date() > record.expiresAt) {
            return res.status(400).json({ message: "รหัส OTP หมดอายุแล้ว กรุณากดขอรหัสใหม่" });
        }
        if (!(await verifyOtp(otpCode, record.otpCode))) {
            return res.status(400).json({ message: "รหัส OTP ไม่ถูกต้อง" });
        }

        const emailTaken = await prisma.user.findUnique({ where: { email } });
        if (emailTaken) {
            await prisma.emailVerification.delete({ where: { email_purpose: { email, purpose: 'register' } } }).catch(() => { });
            return res.status(400).json({ message: "อีเมลนี้ถูกใช้งานไปแล้ว" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await prisma.user.create({
            data: { username, email, password: hashedPassword }
        });
        await prisma.emailVerification.delete({ where: { email_purpose: { email, purpose: 'register' } } });
        console.log(`[EmailVerification] register deleted after success: email=${email} userId=${newUser.user_id}`);

        return res.status(200).json({ message: "สมัครสมาชิกสำเร็จเรียบร้อยแล้ว" });
    } catch (error) {
        console.error("Register Confirm Error:", error);
        return res.status(500).json({ message: "ไม่สามารถบันทึกข้อมูลสมาชิกได้" });
    }
});

const sendChangeEmailOtp = async (email, otpCode) => {
    await sendEmail({
        to: email,
        subject: 'Confirm your new email address',
        html: `
            <div style="font-family: 'Prompt', Arial, sans-serif; padding: 25px; border: 1px solid #e5e7eb; border-radius: 20px; max-width: 500px; margin: auto; background-color: #fdf6ec;">
                <h2 style="color: #f97316; text-align: center; font-size: 24px;">Confirm your new email 📧</h2>
                <p style="font-size: 15px; color: #555;">You requested to change the email on your Thai Pronunciation account. Please use the One-Time Password (OTP) below to confirm this change:</p>
                <div style="background-color: #ffffff; padding: 18px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #f97316; margin: 25px 0; border-radius: 16px; border: 2px dashed #f97316;">
                    ${otpCode}
                </div>
                <p style="color: #ef4444; font-size: 13px; font-weight: bold; text-align: center;">* This OTP code is valid for 5 minutes only.</p>
                <p style="font-size: 12px; color: #9ca3af; margin-top: 30px; text-align: center;">If you did not request this change, please safely ignore this email.</p>
            </div>
        `
    });
};

app.post('/api/auth/change-email-request', requireAuth, otpLimiter, async (req, res) => {
    const currentEmail = req.user.email;
    const newEmail = normalizeEmail(req.body.newEmail);
    const { currentPassword } = req.body;

    if (!EMAIL_REGEX.test(newEmail)) {
        return res.status(400).json({ message: "รูปแบบอีเมลใหม่ไม่ถูกต้อง" });
    }
    if (currentEmail === newEmail) {
        return res.status(400).json({ message: "อีเมลใหม่ต้องไม่ซ้ำกับอีเมลปัจจุบัน" });
    }
    if (!currentPassword) {
        return res.status(400).json({ message: "กรุณายืนยันรหัสผ่านปัจจุบันก่อนเปลี่ยนอีเมล" });
    }

    try {
        const currentUser = await prisma.user.findUnique({ where: { email: currentEmail } });
        if (!currentUser) {
            return res.status(400).json({ message: "ไม่พบบัญชีผู้ใช้นี้ในระบบ" });
        }

        const isPasswordMatch = await bcrypt.compare(currentPassword, currentUser.password);
        if (!isPasswordMatch) {
            return res.status(401).json({ message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
        }

        const emailTaken = await prisma.user.findUnique({ where: { email: newEmail } });
        if (emailTaken) {
            return res.status(400).json({ message: "อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว" });
        }

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const hashedOtpCode = await hashOtp(otpCode);
        await prisma.emailVerification.upsert({
            where: { email_purpose: { email: newEmail, purpose: 'change_email' } },
            update: { otpCode: hashedOtpCode, expiresAt, createdAt: new Date() },
            create: { email: newEmail, purpose: 'change_email', otpCode: hashedOtpCode, expiresAt }
        });

        // ตอบแอปทันทีหลังตรวจข้อมูลและบันทึก OTP แล้ว (ไม่รอ Gmail SMTP) เหมือน register-request
        // ส่งเมลเป็นงานเบื้องหลัง ถ้าล้มเหลวแค่ log ไว้ ผู้ใช้กด Resend OTP เพื่อขอใหม่ได้
        res.status(200).json({ message: "ส่งรหัส OTP ไปยังอีเมลใหม่เรียบร้อยแล้ว" });
        sendChangeEmailOtp(newEmail, otpCode).catch((mailError) => {
            console.error(`[Change Email OTP] send email failed: email=${newEmail}`, mailError);
        });
        return;
    } catch (error) {
        console.error("Change Email Request Error:", error);
        if (res.headersSent) return;
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในระบบเซิร์ฟเวอร์" });
    }
});

app.post('/api/auth/change-email-confirm', requireAuth, otpLimiter, async (req, res) => {
    const currentEmail = req.user.email;
    const newEmail = normalizeEmail(req.body.newEmail);
    const { otpCode } = req.body;

    try {
        const record = await prisma.emailVerification.findUnique({ where: { email_purpose: { email: newEmail, purpose: 'change_email' } } });
        if (!record || !(await verifyOtp(otpCode, record.otpCode))) {
            return res.status(400).json({ message: "รหัส OTP ไม่ถูกต้อง" });
        }
        if (new Date() > record.expiresAt) {
            return res.status(400).json({ message: "รหัส OTP หมดอายุแล้ว กรุณากดขอรหัสใหม่" });
        }

        const emailTaken = await prisma.user.findUnique({ where: { email: newEmail } });
        if (emailTaken) {
            return res.status(400).json({ message: "อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว" });
        }

        const updatedUser = await prisma.user.update({
            where: { email: currentEmail },
            data: { email: newEmail }
        });

        await prisma.emailVerification.delete({ where: { email_purpose: { email: newEmail, purpose: 'change_email' } } });

        if (req.user.sessionId) {
            await prisma.session.delete({ where: { session_id: BigInt(req.user.sessionId) } }).catch(() => { });
        }
        const newToken = await createAuthSession(updatedUser);

        return res.status(200).json({
            message: "เปลี่ยนอีเมลสำเร็จเรียบร้อยแล้ว",
            token: newToken,
            user: { id: updatedUser.user_id, username: updatedUser.username, email: updatedUser.email }
        });
    } catch (error) {
        console.error("Change Email Confirm Error:", error);
        return res.status(500).json({ message: "ไม่สามารถอัปเดตอีเมลได้" });
    }
});

const RESET_OTP_VALID_MS = 5 * 60 * 1000;
const RESET_OTP_MIN_INTERVAL_MS = 30 * 1000;

app.post('/api/auth/forgot-password', passwordResetLimiter, async (req, res) => {
    const email = normalizeEmail(req.body.email);

    if (!email) {
        return res.status(400).json({ message: "กรุณากรอกอีเมล" });
    }
    if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: "รูปแบบอีเมลไม่ถูกต้อง" });
    }

    res.status(200).json({ message: "หากอีเมลนี้ลงทะเบียนไว้ ระบบได้ส่งรหัส OTP ไปให้แล้ว" });

    (async () => {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return;

        const existing = await prisma.emailVerification.findUnique({ where: { email_purpose: { email, purpose: 'reset_password' } } });
        if (existing) {
            if (Date.now() - existing.createdAt.getTime() < RESET_OTP_MIN_INTERVAL_MS) return;
        }

        const otpCode = require('crypto').randomInt(100000, 1000000).toString();
        const expiresAt = new Date(Date.now() + RESET_OTP_VALID_MS);
        const hashedOtpCode = await hashOtp(otpCode);
        await prisma.emailVerification.upsert({
            where: { email_purpose: { email, purpose: 'reset_password' } },
            update: { otpCode: hashedOtpCode, expiresAt, createdAt: new Date() },
            create: { email, purpose: 'reset_password', otpCode: hashedOtpCode, expiresAt }
        });

        await sendEmail({
            to: email,
            subject: 'Password Reset OTP',
            html: `
                <div style="font-family: 'Prompt', Arial, sans-serif; padding: 25px; border: 1px solid #e5e7eb; border-radius: 20px; max-width: 500px; margin: auto; background-color: #fdf6ec;">
                    <h2 style="color: #f97316; text-align: center; font-size: 24px;">Reset your password 🔑</h2>
                    <p style="font-size: 16px; color: #333;">Hello <b>${user.username}</b>,</p>
                    <p style="font-size: 15px; color: #555;">You requested to reset your password. Please use the One-Time Password (OTP) below to proceed:</p>
                    <div style="background-color: #ffffff; padding: 18px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #f97316; margin: 25px 0; border-radius: 16px; border: 2px dashed #f97316;">
                        ${otpCode}
                    </div>
                    <p style="color: #ef4444; font-size: 13px; font-weight: bold; text-align: center;">* This OTP code is valid for 5 minutes only.</p>
                    <p style="font-size: 12px; color: #9ca3af; margin-top: 30px; text-align: center;">If you did not request this, please safely ignore this email.</p>
                </div>
            `
        });
    })().catch((error) => console.error("Forgot Password Error:", error));
});

const checkResetOtp = async (email, otpCode) => {
    if (!email || typeof otpCode !== 'string' || !/^\d{6}$/.test(otpCode)) {
        return { ok: false, message: "รหัส OTP ไม่ถูกต้อง" };
    }
    const record = await prisma.emailVerification.findUnique({ where: { email_purpose: { email, purpose: 'reset_password' } } });
    if (!record || !(await verifyOtp(otpCode, record.otpCode))) {
        return { ok: false, message: "รหัส OTP ไม่ถูกต้อง" };
    }
    if (new Date() > record.expiresAt) {
        return { ok: false, message: "รหัส OTP หมดอายุแล้ว กรุณากดขอรหัสใหม่" };
    }
    return { ok: true, record };
};

app.post('/api/auth/verify-reset-otp', passwordResetLimiter, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { otpCode } = req.body;

    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(400).json({ message: "รหัส OTP ไม่ถูกต้อง" });
        }

        const result = await checkResetOtp(email, otpCode);
        if (!result.ok) {
            return res.status(400).json({ message: result.message });
        }
        return res.status(200).json({ message: "ยืนยันรหัส OTP สำเร็จ" });
    } catch (error) {
        console.error("Verify Reset OTP Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในระบบเซิร์ฟเวอร์" });
    }
});

app.post('/api/auth/reset-password', passwordResetLimiter, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { otpCode, newPassword } = req.body;

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+])[A-Za-z\d!@#$%^&*()_+]{8,}$/;
    if (typeof newPassword !== 'string' || !passwordRegex.test(newPassword)) {
        return res.status(400).json({ message: "Password ไม่เป็นไปตามเงื่อนไขความปลอดภัย" });
    }

    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(400).json({ message: "รหัส OTP ไม่ถูกต้อง" });
        }

        const result = await checkResetOtp(email, otpCode);
        if (!result.ok) {
            return res.status(400).json({ message: result.message });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.$transaction([
            prisma.user.update({ where: { email }, data: { password: hashedPassword } }),
            prisma.emailVerification.delete({ where: { email_purpose: { email, purpose: 'reset_password' } } }),
            prisma.session.deleteMany({ where: { user_id: user.user_id } }),
        ]);

        return res.status(200).json({ message: "เปลี่ยนรหัสผ่านสำเร็จเรียบร้อยแล้ว" });
    } catch (error) {
        console.error("Reset Password Error:", error);
        return res.status(500).json({ message: "ไม่สามารถเปลี่ยนรหัสผ่านได้" });
    }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    try {
        if (!email || !password) {
            return res.status(400).json({ message: "กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน" });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const isPasswordMatch = await bcrypt.compare(password, user ? user.password : DUMMY_PASSWORD_HASH);
        if (!user || !isPasswordMatch) {
            return res.status(400).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง" });
        }

        const token = await createAuthSession(user);
        return res.status(200).json({
            message: "เข้าสู่ระบบสำเร็จ",
            token,
            user: { id: user.user_id, username: user.username, email: user.email }
        });
    } catch (error) {
        console.error("Login Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในระบบเซิร์ฟเวอร์" });
    }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { user_id: req.user.userId } });
        if (!user) {
            return res.status(401).json({ message: "ไม่พบบัญชีผู้ใช้นี้แล้ว กรุณาเข้าสู่ระบบใหม่" });
        }
        return res.status(200).json({
            user: { id: user.user_id, username: user.username, email: user.email }
        });
    } catch (error) {
        console.error("Get Me Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในระบบเซิร์ฟเวอร์" });
    }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
    try {
        if (req.user.sessionId) {
            await prisma.session.delete({ where: { session_id: BigInt(req.user.sessionId) } }).catch(() => { });
        }
        return res.status(200).json({ message: "ออกจากระบบเรียบร้อยแล้ว" });
    } catch (error) {
        console.error("Logout Error:", error);
        return res.status(500).json({ message: "เกิดข้อผิดพลาดภายในระบบเซิร์ฟเวอร์" });
    }
});

app.get('/api/auth/me/role', requireAuth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { user_id: req.user.userId },
            select: { role: true },
        });
        if (!user) return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
        return res.status(200).json({ role: user.role });
    } catch (error) {
        console.error('GET /api/auth/me/role error:', error);
        return res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
    }
});

// ----------------------------------------------------
// Learning Stats Endpoints
// ----------------------------------------------------
const DEFAULT_LEARNING_STATS = {
    exercisesCompleted: 0,
    completedSentenceIds: [],
};

const toStatsResponse = (record) => ({
    exercisesCompleted: record.exercisesCompleted,
    completedSentenceIds: record.completedSentenceIds,
});

app.get('/api/learning-stats', requireAuth, async (req, res) => {
    try {
        const record = await prisma.learningStats.findUnique({ where: { userId: req.user.userId } });
        return res.status(200).json({
            stats: record ? toStatsResponse(record) : DEFAULT_LEARNING_STATS,
        });
    } catch (error) {
        console.error("Get Learning Stats Error:", error);
        return res.status(500).json({ message: "ไม่สามารถโหลดสถิติการเรียนได้" });
    }
});

app.put('/api/learning-stats', requireAuth, async (req, res) => {
    // ไม่ destructure streakDays/totalMinutes/lastActiveDate/practiceHistory → แอปเวอร์ชันเก่าที่ยังส่งมาจะถูกเมินเฉยๆ
    const { exercisesCompleted, completedSentenceIds } = req.body;

    try {
        const clampNonNegativeInt = (value) =>
            Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

        const data = {
            exercisesCompleted: clampNonNegativeInt(exercisesCompleted),
            completedSentenceIds: Array.isArray(completedSentenceIds)
                ? completedSentenceIds.filter((id) => typeof id === 'string')
                : [],
        };

        const record = await prisma.learningStats.upsert({
            where: { userId: req.user.userId },
            update: data,
            create: { userId: req.user.userId, ...data },
        });

        return res.status(200).json({ stats: toStatsResponse(record) });
    } catch (error) {
        console.error("Save Learning Stats Error:", error);
        return res.status(500).json({ message: "ไม่สามารถบันทึกสถิติการเรียนได้" });
    }
});

// ----------------------------------------------------
// Public Lessons & Index Endpoints (สำหรับ ChooseSentenceScreen & App)
// ----------------------------------------------------
const normalizeTitle = (t) => (t || '').trim().replace(/\s+/g, ' ').toLowerCase();

const mergeTopicsByTitle = (topics, mapSentence = (s) => s) => {
    const byTitle = new Map();
    for (const topic of topics) {
        const key = normalizeTitle(topic.title);
        const sentences = topic.sentences.map(mapSentence);
        const main = byTitle.get(key);
        if (!main) {
            byTitle.set(key, { id: topic.topic_id, title: topic.title, icon_url: topic.icon_url, sentences });
        } else {
            main.sentences.push(...sentences);
            if (!main.icon_url && topic.icon_url) main.icon_url = topic.icon_url;
        }
    }
    return [...byTitle.values()];
};

app.get('/api/topics', async (req, res) => {
    const { level } = req.query;
    if (!level || !['easy', 'medium'].includes(level)) {
        return res.status(400).json({ message: 'level ต้องเป็น easy หรือ medium' });
    }
    try {
        const topics = await prisma.topic.findMany({
            where: { level },
            include: {
                sentences: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                        sentence_id: true,
                        thai: true,
                        karaoke: true,
                        pronunciation: true,
                        eng: true,
                        label: true,
                        audio_url: true,
                        audio_file_name: true,
                        image_url: true,
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        const result = mergeTopicsByTitle(topics, (s) => ({
            sentence_id: String(s.sentence_id),
            thai: s.thai,
            karaoke: s.karaoke,
            pronunciation: s.pronunciation,
            eng: s.eng,
            label: s.label,
            audio_url: s.audio_url,
            audio_file_name: storagePathFromUrl(s.audio_url, 'sentences-audio') || s.audio_file_name || '',
            image_url: s.image_url,
        }));

        return res.status(200).json({ topics: result });
    } catch (error) {
        console.error('GET /api/topics error:', error);
        return res.status(500).json({ message: 'โหลดบทเรียนไม่สำเร็จ' });
    }
});

// ---------------- Weekly Sentence ----------------
// ประโยค Weekly เก็บในตาราง Sentence (is_weekly = true, topic_id = null) ส่วนสัปดาห์ที่แสดงเก็บแยกในตาราง WeeklySchedule (week_start = วันจันทร์ YYYY-MM-DD เวลาไทย)
// ประโยคที่แสดงตอนนี้ = ประโยคที่ week_start <= วันจันทร์ของสัปดาห์นี้ และเริ่มล่าสุด (ไม่มีประโยคตรงสัปดาห์ก็ใช้อันล่าสุดที่เริ่มไปแล้ว)
// ถ้ายังไม่มีประโยคที่กำหนดสัปดาห์เลย (ข้อมูลเก่า) ใช้ประโยคที่เพิ่มล่าสุดแทน
const THAI_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

const currentWeekStart = () => {
    const t = new Date(Date.now() + THAI_UTC_OFFSET_MS);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
};

// รับวันที่ใดก็ได้ (YYYY-MM-DD) คืนวันจันทร์ของสัปดาห์นั้น (null ถ้ารูปแบบไม่ถูกต้อง)
const normalizeWeekStart = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
    const d = new Date(`${value.trim()}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
};

// แถว Sentence ที่ include weeklySchedule -> เพิ่ม weekly_start (null ถ้ายังไม่กำหนดสัปดาห์)
const withWeekStart = ({ weeklySchedule, ...s }) => ({ ...s, weekly_start: weeklySchedule ? weeklySchedule.week_start : null });

// ตั้งสัปดาห์ให้ประโยค Weekly: ประโยคอื่นของระดับเดียวกันที่ถือสัปดาห์นั้นอยู่จะกลายเป็น "ยังไม่กำหนด" (ไม่ถูกลบ)
const setWeeklySchedule = (sentenceId, level, weekStart) => [
    prisma.weeklySchedule.deleteMany({ where: { level, week_start: weekStart, sentence_id: { not: sentenceId } } }),
    prisma.weeklySchedule.upsert({
        where: { sentence_id: sentenceId },
        update: { level, week_start: weekStart },
        create: { sentence_id: sentenceId, level, week_start: weekStart },
    }),
];

const pickActiveWeekly = (rows, weekStart) => {
    const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
    const started = rows
        .filter((r) => r.weekly_start && r.weekly_start <= weekStart)
        .sort((a, b) => b.weekly_start.localeCompare(a.weekly_start) || byNewest(a, b));
    if (started.length > 0) return started[0];
    return rows.filter((r) => !r.weekly_start).sort(byNewest)[0] || null;
};

app.get('/api/weekly', async (req, res) => {
    const { level } = req.query;
    if (!level || !['easy', 'medium'].includes(level)) {
        return res.status(400).json({ message: 'level ต้องเป็น easy หรือ medium' });
    }
    try {
        const rows = (await prisma.sentence.findMany({
            where: { level, is_weekly: true },
            include: { weeklySchedule: true },
        })).map(withWeekStart);
        const s = pickActiveWeekly(rows, currentWeekStart());
        if (!s) return res.status(200).json({ sentence: null });
        return res.status(200).json({
            sentence: {
                sentence_id: String(s.sentence_id),
                level: s.level,
                thai: s.thai,
                karaoke: s.karaoke,
                pronunciation: s.pronunciation,
                eng: s.eng,
                label: s.label,
                audio_url: s.audio_url,
                audio_file_name: storagePathFromUrl(s.audio_url, 'sentences-audio') || s.audio_file_name || '',
                image_url: s.image_url,
                weekly_start: s.weekly_start,
            },
        });
    } catch (error) {
        console.error('GET /api/weekly error:', error);
        return res.status(500).json({ message: 'โหลดประโยค Weekly ไม่สำเร็จ' });
    }
});

app.get('/api/sentence-index', async (req, res) => {
    try {
        const topics = await prisma.topic.findMany({
            orderBy: { createdAt: 'asc' },
            select: { level: true, title: true, sentences: { select: { thai: true } } },
        });
        const index = { easy: new Set(), medium: new Set() };
        const grouped = { easy: new Map(), medium: new Map() };
        for (const t of topics) {
            if (!index[t.level]) continue;
            const key = normalizeTitle(t.title);
            let group = grouped[t.level].get(key);
            if (!group) {
                group = { title: t.title, sentences: new Set() };
                grouped[t.level].set(key, group);
            }
            for (const s of t.sentences) {
                if (!s.thai) continue;
                index[t.level].add(s.thai);
                group.sentences.add(s.thai);
            }
        }
        const toList = (map) => [...map.values()].map((g) => ({ title: g.title, sentences: [...g.sentences] }));
        return res.status(200).json({
            easy: [...index.easy],
            medium: [...index.medium],
            topics: { easy: toList(grouped.easy), medium: toList(grouped.medium) },
        });
    } catch (error) {
        console.error('GET /api/sentence-index error:', error);
        return res.status(500).json({ message: 'โหลดข้อมูลความคืบหน้าไม่สำเร็จ' });
    }
});

// ============================================================
// ADMIN ENDPOINTS — จัดการ Topic และ Sentence
// ============================================================
const adminUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});

const AUDIO_BUCKET = 'sentences-audio';
const ICON_BUCKET = 'sentences-audio';

app.get('/api/admin/topics', requireAuth, requireAdmin, async (req, res) => {
    const { level } = req.query;
    if (!level || !['easy', 'medium'].includes(level)) {
        return res.status(400).json({ message: 'level ต้องเป็น easy หรือ medium' });
    }
    try {
        const topics = await prisma.topic.findMany({
            where: { level },
            include: {
                sentences: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                        sentence_id: true,
                        thai: true,
                        karaoke: true,
                        pronunciation: true,
                        eng: true,
                        label: true,
                        audio_file_name: true,
                        audio_url: true,
                        image_url: true,
                    }
                }
            },
            orderBy: { createdAt: 'asc' },
        });

        const mappedTopics = mergeTopicsByTitle(topics, (s) => ({ ...s, sentence_id: s.sentence_id }));

        // ประโยค Weekly ของระดับนี้ + id ของประโยคที่กำลังแสดงที่หน้า Home ตอนนี้ (ตามสัปดาห์ปัจจุบันเวลาไทย)
        const weeklyRows = await prisma.sentence.findMany({
            where: { level, is_weekly: true },
            orderBy: { createdAt: 'desc' },
            select: {
                sentence_id: true, thai: true, karaoke: true, pronunciation: true, eng: true,
                label: true, audio_file_name: true, audio_url: true, image_url: true,
                createdAt: true,
                weeklySchedule: { select: { week_start: true } },
            },
        });
        const weeklyFlat = weeklyRows.map(withWeekStart);
        const weekStart = currentWeekStart();
        const activeWeekly = pickActiveWeekly(weeklyFlat, weekStart);
        const weekly = weeklyFlat.map(({ createdAt, ...s }) => ({ ...s, sentence_id: s.sentence_id }));

        return res.status(200).json({
            topics: mappedTopics,
            weekly,
            active_weekly_id: activeWeekly ? activeWeekly.sentence_id : null,
            current_week_start: weekStart,
        });
    } catch (error) {
        console.error('GET /api/admin/topics error:', error);
        return res.status(500).json({ message: 'โหลดรายการบทเรียนไม่สำเร็จ' });
    }
});

app.post('/api/admin/topics', requireAuth, requireAdmin,
    adminUpload.single('icon'),
    async (req, res) => {
        const { level, title } = req.body;
        if (!level || !title || !title.trim()) {
            return res.status(400).json({ message: 'ต้องระบุ level และ title' });
        }
        if (!['easy', 'medium'].includes(level)) {
            return res.status(400).json({ message: 'level ต้องเป็น easy หรือ medium' });
        }
        try {
            const dup = await prisma.topic.findFirst({
                where: { level, title: { equals: title.trim(), mode: 'insensitive' } },
                orderBy: { createdAt: 'asc' },
            });
            if (dup) {
                return res.status(200).json({ id: dup.topic_id, title: dup.title, icon_url: dup.icon_url, existed: true });
            }

            if (!req.file) {
                return res.status(400).json({ message: 'ต้องแนบรูป icon ของบทเรียนใหม่' });
            }
            if (!(req.file.mimetype || '').startsWith('image/')) {
                return res.status(400).json({ message: 'ไฟล์ icon ต้องเป็นรูปภาพ' });
            }

            const ext = path.extname(req.file.originalname || '.png') || '.png';
            const safeLevel = sanitizeStorageSegment(level, 'level');
            const iconPath = `icons/${safeLevel}/${Date.now()}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`;
            const icon_url = await uploadToSupabase(ICON_BUCKET, iconPath, req.file.buffer, req.file.mimetype);

            const topic = await prisma.topic.create({
                data: { title: title.trim(), level, icon_url },
            });
            return res.status(201).json({ id: topic.topic_id, title: topic.title, icon_url: topic.icon_url });
        } catch (error) {
            console.error('POST /api/admin/topics error:', error);
            return res.status(500).json({ message: 'สร้างบทเรียนไม่สำเร็จ' });
        }
    }
);

// ลบไฟล์ใน Supabase Storage จาก public URL (best-effort: ล้มเหลวไม่ทำให้ request พัง)
const removeStorageFileByUrl = async (bucket, url) => {
    const filePath = storagePathFromUrl(url, bucket);
    if (!filePath) return;
    const { error } = await supabaseAdmin.storage.from(bucket).remove([filePath]);
    if (error) console.error('remove old storage file failed:', error.message);
};

// แก้ไขบทเรียน: เปลี่ยนชื่อ (title) และ/หรือรูป icon (ส่งเฉพาะที่ต้องการเปลี่ยนก็ได้)
// ชื่อใหม่จะอัปเดตให้ทุกแถวของบทเรียนเดียวกัน (ชื่อเดียวกันหลัง normalize ใน level เดียวกัน) เพราะ API รวมบทที่ชื่อซ้ำเป็นบทเดียว
app.put('/api/admin/topics/:id', requireAuth, requireAdmin,
    adminUpload.single('icon'),
    async (req, res) => {
        const topicId = parseInt(req.params.id);
        if (!topicId) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

        const rawTitle = typeof req.body.title === 'string' ? req.body.title.trim().replace(/\s+/g, ' ') : '';
        if (req.file && !(req.file.mimetype || '').startsWith('image/')) {
            return res.status(400).json({ message: 'ไฟล์ icon ต้องเป็นรูปภาพ' });
        }

        try {
            const existing = await prisma.topic.findUnique({ where: { topic_id: topicId } });
            if (!existing) return res.status(404).json({ message: 'ไม่พบบทเรียนนี้' });

            const newTitle = rawTitle || existing.title;
            const titleChanged = newTitle !== existing.title;
            if (!titleChanged && !req.file) {
                return res.status(200).json({ id: existing.topic_id, title: existing.title, icon_url: existing.icon_url, unchanged: true });
            }

            const sameLevel = await prisma.topic.findMany({
                where: { level: existing.level },
                select: { topic_id: true, title: true },
            });
            const oldKey = normalizeTitle(existing.title);
            const groupIds = sameLevel.filter((t) => normalizeTitle(t.title) === oldKey).map((t) => t.topic_id);

            // ห้ามชื่อไปชนกับบทอื่นในระดับเดียวกัน (ไม่งั้นสองบทจะถูกรวมเป็นบทเดียวในแอป)
            if (normalizeTitle(newTitle) !== oldKey) {
                const clash = sameLevel.some((t) => !groupIds.includes(t.topic_id) && normalizeTitle(t.title) === normalizeTitle(newTitle));
                if (clash) return res.status(409).json({ message: 'มีบทเรียนชื่อนี้ในระดับเดียวกันอยู่แล้ว' });
            }

            let newIconUrl = null;
            if (req.file) {
                const ext = path.extname(req.file.originalname || '.png') || '.png';
                const safeLevel = sanitizeStorageSegment(existing.level, 'level');
                const iconPath = `icons/${safeLevel}/${Date.now()}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`;
                newIconUrl = await uploadToSupabase(ICON_BUCKET, iconPath, req.file.buffer, req.file.mimetype);
            }

            const ops = [];
            if (titleChanged) {
                ops.push(prisma.topic.updateMany({ where: { topic_id: { in: groupIds } }, data: { title: newTitle } }));
            }
            if (newIconUrl) {
                ops.push(prisma.topic.update({ where: { topic_id: topicId }, data: { icon_url: newIconUrl } }));
            }
            await prisma.$transaction(ops);

            // ลบ icon เก่าออกจาก Storage ถ้าไม่มีบทไหนใช้ไฟล์นั้นอยู่แล้ว
            if (newIconUrl && existing.icon_url && existing.icon_url !== newIconUrl) {
                const stillUsed = await prisma.topic.count({ where: { icon_url: existing.icon_url } });
                if (stillUsed === 0) await removeStorageFileByUrl(ICON_BUCKET, existing.icon_url);
            }

            const updated = await prisma.topic.findUnique({ where: { topic_id: topicId } });
            return res.status(200).json({ id: updated.topic_id, title: updated.title, icon_url: updated.icon_url });
        } catch (error) {
            console.error('PUT /api/admin/topics/:id error:', error);
            return res.status(500).json({
                message: 'แก้ไขบทเรียนไม่สำเร็จ',
                ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
            });
        }
    }
);

// ลบบทเรียน: ต้องยืนยันด้วยรหัสผ่านของบัญชีแอดมินที่ล็อกอินอยู่
// ลบทุกแถวของบทเรียนเดียวกัน (ชื่อเดียวกันหลัง normalize ใน level เดียวกัน) พร้อมประโยคทั้งหมดในบทนั้น
// limiter แยกจาก login กันเดารหัสผ่านผ่านหน้าลบบทเรียน โดยไม่กินโควตาของการ login
const deleteTopicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: "ลองมากเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง" },
    standardHeaders: true,
    legacyHeaders: false,
});

app.delete('/api/admin/topics/:id', requireAuth, requireAdmin, deleteTopicLimiter, async (req, res) => {
    const topicId = parseInt(req.params.id);
    if (!topicId) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

    const { password } = req.body || {};
    if (typeof password !== 'string' || !password) {
        return res.status(400).json({ message: 'กรุณากรอกรหัสผ่านเพื่อยืนยันการลบบทเรียน' });
    }

    try {
        const user = await prisma.user.findUnique({ where: { user_id: req.user.userId } });
        const isPasswordMatch = await bcrypt.compare(password, user ? user.password : DUMMY_PASSWORD_HASH);
        if (!user || !isPasswordMatch) {
            return res.status(401).json({ message: 'Password is incorrect' });
        }

        const existing = await prisma.topic.findUnique({ where: { topic_id: topicId } });
        if (!existing) return res.status(404).json({ message: 'ไม่พบบทเรียนนี้' });

        const sameLevel = await prisma.topic.findMany({
            where: { level: existing.level },
            select: { topic_id: true, title: true, icon_url: true },
        });
        const key = normalizeTitle(existing.title);
        const group = sameLevel.filter((t) => normalizeTitle(t.title) === key);
        const groupIds = group.map((t) => t.topic_id);

        // เก็บ URL ไฟล์ไว้ลบจาก Storage หลังลบข้อมูลสำเร็จ
        const sentences = await prisma.sentence.findMany({
            where: { topic_id: { in: groupIds } },
            select: { audio_url: true, image_url: true },
        });

        await prisma.$transaction([
            prisma.sentence.deleteMany({ where: { topic_id: { in: groupIds } } }),
            prisma.topic.deleteMany({ where: { topic_id: { in: groupIds } } }),
        ]);

        // ลบไฟล์ใน Storage แบบ best-effort (ล้มเหลวไม่ทำให้ request พัง)
        const iconUrls = [...new Set(group.map((t) => t.icon_url).filter(Boolean))];
        for (const url of iconUrls) {
            const stillUsed = await prisma.topic.count({ where: { icon_url: url } });
            if (stillUsed === 0) await removeStorageFileByUrl(ICON_BUCKET, url);
        }
        for (const s of sentences) {
            if (s.audio_url) await removeStorageFileByUrl(AUDIO_BUCKET, s.audio_url);
            if (s.image_url) await removeStorageFileByUrl(ICON_BUCKET, s.image_url);
        }

        return res.status(200).json({ message: 'ลบบทเรียนสำเร็จ', deleted_sentences: sentences.length });
    } catch (error) {
        console.error('DELETE /api/admin/topics/:id error:', error);
        return res.status(500).json({
            message: 'ลบบทเรียนไม่สำเร็จ',
            ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
        });
    }
});

app.post('/api/admin/sentences', requireAuth, requireAdmin,
    adminUpload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]),
    async (req, res) => {
        const { level, topic_id, topic_title, is_weekly, weekly_start, thai, karaoke, pronunciation, eng, label, audio_file_name } = req.body;
        const isWeekly = is_weekly === 'true' || is_weekly === true;
        // ประโยค Weekly ต้องระบุสัปดาห์เสมอ (ไม่มีค่า default) ไม่งั้นเพิ่มเข้าระบบไม่ได้
        if (isWeekly && !(typeof weekly_start === 'string' && weekly_start.trim())) {
            return res.status(400).json({ message: 'ต้องเลือกสัปดาห์ (weekly_start) ก่อนเพิ่มประโยค Weekly' });
        }
        const weeklyStart = isWeekly ? normalizeWeekStart(weekly_start) : null;
        if (isWeekly && !weeklyStart) {
            return res.status(400).json({ message: 'รูปแบบวันที่ weekly_start ไม่ถูกต้อง (YYYY-MM-DD)' });
        }
        // สัปดาห์ที่ผ่านไปแล้ว หรือมีประโยคอื่นของระดับเดียวกันใช้อยู่ เลือกไม่ได้
        if (isWeekly && weeklyStart < currentWeekStart()) {
            return res.status(400).json({ message: 'ไม่สามารถเลือกสัปดาห์ที่ผ่านไปแล้วได้' });
        }
        if (isWeekly && ['easy', 'medium'].includes(level)) {
            const taken = await prisma.weeklySchedule.findFirst({ where: { level, week_start: weeklyStart }, select: { schedule_id: true } });
            if (taken) return res.status(409).json({ message: 'สัปดาห์นี้มีประโยค Weekly อยู่แล้ว กรุณาเลือกสัปดาห์อื่น' });
        }
        const audioFile = req.files?.audio?.[0];
        const imageFile = req.files?.image?.[0];

        if (!level || !thai || !karaoke || !eng || !audioFile) {
            return res.status(400).json({ message: 'ต้องระบุ level, thai, karaoke, eng และไฟล์เสียง' });
        }
        if (!['easy', 'medium'].includes(level)) {
            return res.status(400).json({ message: 'level ต้องเป็น easy หรือ medium' });
        }

        try {
            let resolvedTopicId = parseInt(topic_id) || null;
            if (isWeekly) {
                resolvedTopicId = null;   // ประโยค Weekly ไม่ผูกกับบทเรียนปกติ
            } else if (resolvedTopicId) {
                const topicExists = await prisma.topic.findUnique({ where: { topic_id: resolvedTopicId }, select: { topic_id: true } });
                if (!topicExists) return res.status(404).json({ message: 'ไม่พบบทเรียนนี้' });
            } else {
                const cleanTitle = (topic_title || '').trim();
                const existingTopic = cleanTitle
                    ? await prisma.topic.findFirst({
                        where: { level, title: { equals: cleanTitle, mode: 'insensitive' } },
                        orderBy: { createdAt: 'asc' },
                    })
                    : null;
                if (!existingTopic) {
                    return res.status(400).json({
                        message: 'ต้องระบุ topic_id ของบทเรียนที่มีอยู่ — ถ้าจะสร้างบทเรียนใหม่ ให้สร้างพร้อมรูป icon ผ่าน POST /api/admin/topics ก่อน',
                    });
                }
                resolvedTopicId = existingTopic.topic_id;
            }

            const safeName = buildSafeAudioName(audio_file_name || audioFile.originalname, audioFile.mimetype);
            const safeLevel = sanitizeStorageSegment(level, 'level');
            const audioPath = `${safeLevel}/${isWeekly ? 'weekly' : topicFolder(resolvedTopicId)}/${safeName}`;
            const audio_url = await uploadToSupabase(AUDIO_BUCKET, audioPath, audioFile.buffer, audioFile.mimetype);

            let image_url = null;
            if (imageFile) {
                const imgExt = path.extname(imageFile.originalname || '.jpg');
                const imgPath = `images/${safeLevel}/${Date.now()}${imgExt}`;
                image_url = await uploadToSupabase(ICON_BUCKET, imgPath, imageFile.buffer, imageFile.mimetype);
            }

            const resolvedLabel = label?.trim() || `${thai.trim()} (${eng.trim()})`;
            const createSentence = prisma.sentence.create({
                data: {
                    topic_id: resolvedTopicId,
                    is_weekly: isWeekly,
                    ...(isWeekly && { weeklySchedule: { create: { level, week_start: weeklyStart } } }),
                    level,
                    thai: thai.trim(),
                    karaoke: karaoke.trim(),
                    pronunciation: pronunciation?.trim() || null,
                    eng: eng.trim(),
                    label: resolvedLabel,
                    audio_file_name: safeName,
                    audio_url,
                    image_url,
                },
            });

            let sentence;
            if (isWeekly) {
                // เคลียร์สัปดาห์นั้นของระดับนี้ (ถ้ามีประโยคอื่นถืออยู่) แล้วสร้างประโยคพร้อมกำหนดสัปดาห์ในธุรกรรมเดียว
                const [, created] = await prisma.$transaction([
                    prisma.weeklySchedule.deleteMany({ where: { level, week_start: weeklyStart } }),
                    createSentence,
                ]);
                sentence = created;
            } else {
                sentence = await createSentence;
            }

            return res.status(201).json({ ...sentence, sentence_id: sentence.sentence_id, ...(isWeekly && { weekly_start: weeklyStart }) });
        } catch (error) {
            console.error('POST /api/admin/sentences error:', error);
            return res.status(500).json({
                message: 'เพิ่มประโยคไม่สำเร็จ',
                ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
            });
        }
    }
);

app.put('/api/admin/sentences/:id', requireAuth, requireAdmin,
    adminUpload.fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }]),
    async (req, res) => {
        const sentenceId = parseInt(req.params.id);
        if (!sentenceId) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

        const { thai, karaoke, pronunciation, eng, label, audio_file_name, weekly_start, image_url: existingImageUrl } = req.body;
        const audioFile = req.files?.audio?.[0];
        const imageFile = req.files?.image?.[0];

        try {
            const existing = await prisma.sentence.findUnique({ where: { sentence_id: sentenceId } });
            if (!existing) return res.status(404).json({ message: 'ไม่พบประโยคนี้' });

            const updateData = {};
            if (thai) updateData.thai = thai.trim();
            if (karaoke) updateData.karaoke = karaoke.trim();
            if (pronunciation !== undefined) updateData.pronunciation = pronunciation ? pronunciation.trim() : null;
            if (eng) updateData.eng = eng.trim();
            if (label) updateData.label = label.trim();

            // เปลี่ยนสัปดาห์ที่แสดง (เฉพาะประโยค Weekly)
            let newWeekStart = null;
            if (existing.is_weekly && weekly_start) {
                newWeekStart = normalizeWeekStart(weekly_start);
                if (!newWeekStart) return res.status(400).json({ message: 'รูปแบบวันที่ weekly_start ไม่ถูกต้อง (YYYY-MM-DD)' });

                // ตรวจเฉพาะตอนเปลี่ยนสัปดาห์จริง (ถ้าส่งสัปดาห์เดิมของประโยคนี้กลับมา ถือว่าไม่เปลี่ยน)
                const currentSchedule = await prisma.weeklySchedule.findUnique({ where: { sentence_id: sentenceId } });
                if (!currentSchedule || currentSchedule.week_start !== newWeekStart) {
                    if (newWeekStart < currentWeekStart()) {
                        return res.status(400).json({ message: 'ไม่สามารถเลือกสัปดาห์ที่ผ่านไปแล้วได้' });
                    }
                    const taken = await prisma.weeklySchedule.findFirst({
                        where: { level: existing.level, week_start: newWeekStart, sentence_id: { not: sentenceId } },
                        select: { schedule_id: true },
                    });
                    if (taken) return res.status(409).json({ message: 'สัปดาห์นี้มีประโยค Weekly อยู่แล้ว กรุณาเลือกสัปดาห์อื่น' });
                }
            }

            const safeLevel = sanitizeStorageSegment(existing.level, 'level');

            if (audioFile) {
                const safeName = buildSafeAudioName(audio_file_name || audioFile.originalname, audioFile.mimetype);
                const audioPath = `${safeLevel}/${existing.topic_id ? topicFolder(existing.topic_id) : 'weekly'}/${safeName}`;
                updateData.audio_url = await uploadToSupabase(AUDIO_BUCKET, audioPath, audioFile.buffer, audioFile.mimetype);
                updateData.audio_file_name = safeName;
            }

            if (imageFile) {
                const imgExt = path.extname(imageFile.originalname || '.jpg');
                const imgPath = `images/${safeLevel}/${Date.now()}${imgExt}`;
                updateData.image_url = await uploadToSupabase(ICON_BUCKET, imgPath, imageFile.buffer, imageFile.mimetype);
            } else if (existingImageUrl) {
                updateData.image_url = existingImageUrl;
            }

            if (label?.trim()) updateData.label = label.trim();
            else if (thai || eng) {
                updateData.label = `${(thai || existing.thai).trim()} (${(eng || existing.eng).trim()})`;
            }

            const updated = await prisma.sentence.update({
                where: { sentence_id: sentenceId },
                data: updateData,
            });
            if (newWeekStart) {
                await prisma.$transaction(setWeeklySchedule(sentenceId, existing.level, newWeekStart));
            }

            return res.status(200).json({ ...updated, sentence_id: updated.sentence_id });
        } catch (error) {
            console.error('PUT /api/admin/sentences/:id error:', error);
            return res.status(500).json({
                message: 'แก้ไขประโยคไม่สำเร็จ',
                ...(process.env.NODE_ENV !== 'production' && { detail: error.message }),
            });
        }
    }
);

app.delete('/api/admin/sentences/:id', requireAuth, requireAdmin, async (req, res) => {
    const sentenceId = parseInt(req.params.id);
    if (!sentenceId) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

    try {
        const existing = await prisma.sentence.findUnique({ where: { sentence_id: sentenceId } });
        if (!existing) return res.status(404).json({ message: 'ไม่พบประโยคนี้' });

        await prisma.sentence.delete({ where: { sentence_id: sentenceId } });
        return res.status(200).json({ message: 'ลบประโยคสำเร็จ' });
    } catch (error) {
        console.error('DELETE /api/admin/sentences/:id error:', error);
        return res.status(500).json({ message: 'ลบประโยคไม่สำเร็จ' });
    }
});

// ตั้งประโยค Weekly นี้เป็นของสัปดาห์นี้ทันที (แสดงที่หน้า Home เลย)
// ประโยคอื่นของระดับเดียวกันที่กำหนดไว้สัปดาห์นี้ จะกลายเป็น "ยังไม่กำหนดสัปดาห์" (ไม่ถูกลบ)
app.post('/api/admin/weekly/:id/activate', requireAuth, requireAdmin, async (req, res) => {
    const sentenceId = parseInt(req.params.id);
    if (!sentenceId) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });
    try {
        const existing = await prisma.sentence.findUnique({ where: { sentence_id: sentenceId } });
        if (!existing || !existing.is_weekly) {
            return res.status(404).json({ message: 'ไม่พบประโยค Weekly นี้' });
        }
        const weekStart = currentWeekStart();
        await prisma.$transaction(setWeeklySchedule(sentenceId, existing.level, weekStart));
        return res.status(200).json({ message: 'ตั้งเป็นประโยคประจำสัปดาห์นี้แล้ว', week_start: weekStart });
    } catch (error) {
        console.error('POST /api/admin/weekly/:id/activate error:', error);
        return res.status(500).json({ message: 'ตั้งประโยค Weekly ไม่สำเร็จ' });
    }
});

// ============================================================
// Proxy to Python (FastAPI Evaluator)
// ============================================================
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
});

app.post('/api/pronounce/evaluate', requireAuth, audioUpload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'กรุณาแนบไฟล์เสียง' });
    }
    try {
        const formData = new FormData();
        formData.append(
            'audio',
            new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/wav' }),
            req.file.originalname || 'user_input.wav'
        );

        // ดึงค่า id และ audio_file_name ไม่ว่าจะส่งมาในชื่อใด
        const sId = String(req.body.sentence_id || req.body.id || '1');
        const aFileName = String(req.body.audio_file_name || req.body.sentence_file_name || req.body.audio_file || '');

        // 🎯 ส่งทั้ง 2 รูปแบบชื่อ เพื่อให้ FastAPI รับได้เสมอ
        formData.append('sentence_id', sId);
        formData.append('id', sId);

        formData.append('sentence_file_name', aFileName);
        formData.append('audio_file_name', aFileName);

        formData.append('rec_history_id', req.body.rec_history_id || `REC_${Date.now()}`);

        let thaiText = '';
        const sentenceIdForLookup = parseInt(sId, 10);
        if (Number.isInteger(sentenceIdForLookup) && sentenceIdForLookup > 0) {
            try {
                const sentenceRow = await prisma.sentence.findUnique({
                    where: { sentence_id: sentenceIdForLookup },
                    select: { thai: true },
                });
                thaiText = sentenceRow?.thai || '';
            } catch (lookupErr) {
                console.error('Lookup Sentence.thai for word segmentation failed:', lookupErr);
            }
        }
        formData.append('thai_text', thaiText);

        const pyResponse = await fetch(`${PYTHON_API_URL}/api/pronounce/evaluate`, {
            method: 'POST',
            headers: {
                Authorization: req.headers.authorization,
            },
            body: formData,
        });

        const text = await pyResponse.text();

        if (pyResponse.ok) {
            try {
                const parsed = JSON.parse(text);
                const isPassed = parsed?.data?.is_passed ?? parsed?.is_passed;
                const numericSentenceId = parseInt(sId, 10);
                if (Number.isInteger(numericSentenceId) && numericSentenceId > 0) {
                    await prisma.practiceAttempt.create({
                        data: {
                            userId: req.user.userId,
                            sentenceId: numericSentenceId,
                            passed: typeof isPassed === 'boolean' ? isPassed : null,
                        },
                    });
                }
            } catch (logError) {
                console.error('Record practice attempt failed:', logError);
            }
        }

        res.status(pyResponse.status);
        res.set('Content-Type', pyResponse.headers.get('content-type') || 'application/json');
        return res.send(text);
    } catch (err) {
        console.error('Proxy to Python pronounce/evaluate failed:', err);
        return res.status(502).json({ message: 'ไม่สามารถเชื่อมต่อกับบริการประเมินการออกเสียงได้ (Python backend ไม่ตอบสนอง)' });
    }
});

// Speak to Match: ส่งเสียงผู้ใช้ไปให้ Python เทียบกับเสียงต้นแบบของทุกประโยคใน Supabase
// (Python อ่านรายการประโยคจากตาราง Sentence เอง แอปไม่ต้องส่งรายการมา)
app.post('/api/pronounce/match', requireAuth, audioUpload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'กรุณาแนบไฟล์เสียง' });
    }
    try {
        const formData = new FormData();
        formData.append(
            'audio',
            new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/wav' }),
            req.file.originalname || 'user_match.wav'
        );

        const pyResponse = await fetch(`${PYTHON_API_URL}/api/pronounce/match`, {
            method: 'POST',
            headers: { Authorization: req.headers.authorization },
            body: formData,
        });

        const text = await pyResponse.text();
        res.status(pyResponse.status);
        res.set('Content-Type', pyResponse.headers.get('content-type') || 'application/json');
        return res.send(text);
    } catch (err) {
        console.error('Proxy to Python pronounce/match failed:', err);
        return res.status(502).json({ message: 'ไม่สามารถเชื่อมต่อกับบริการจับคู่เสียงได้ (Python backend ไม่ตอบสนอง)' });
    }
});

// route ที่ไม่มีอยู่ -> ตอบเป็น JSON (เดิม Express ตอบ HTML "Cannot POST ..." ทำให้แอป parse JSON พัง)
app.use((req, res) => {
    return res.status(404).json({ message: `ไม่พบ endpoint: ${req.method} ${req.path}` });
});

// Error handler กลางต้องตอบเป็น JSON เสมอ ไม่เช่นนั้น Express จะตอบหน้า HTML (ขึ้นต้นด้วย '<')
// เช่น body JSON ผิดรูปแบบ, CORS error, หรือ error ที่ไม่ได้ถูกจับใน route
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: "ไฟล์ที่แนบมามีขนาดใหญ่เกินไป" });
        }
        return res.status(400).json({ message: `อัปโหลดไฟล์ไม่สำเร็จ: ${err.message}` });
    }
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ message: "รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง" });
    }
    if (err && err.message === 'Not allowed by CORS') {
        return res.status(403).json({ message: "Origin นี้ไม่ได้รับอนุญาต" });
    }

    console.error('Unhandled error:', err);
    return res.status(err.status || 500).json({ message: "เกิดข้อผิดพลาดภายในระบบเซิร์ฟเวอร์" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} and ready for Ngrok tunnel!`);
});