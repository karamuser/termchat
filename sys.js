// ============================================================
// sys.js - نظام إدارة الرسائل في TermChat
// الوظيفة: ضمان إرسال الرسائل بدون تعليق، مع الحفاظ على
// تاريخ كل محادثة، ومنع الرسائل القديمة أو المكررة.
// ============================================================

import {
    db, auth,
    collection, doc, addDoc, setDoc, getDoc, getDocs,
    query, orderBy, limit, onSnapshot, serverTimestamp, where
} from "./firebase.js";

// ==================== الإعدادات ====================
const SYS_CONFIG = {
    MAX_RETRIES: 3,           // عدد محاولات الإرسال
    RETRY_DELAY: 1500,        // وقت الانتظار بين المحاولات (ms)
    MESSAGE_TIMEOUT: 20000,   // إذا الرسالة ما وصلت خلال 20 ثانية، فشل
    DEDUP_WINDOW: 3000,       // نافذة منع التكرار (ms)
    MAX_CACHE_PER_ROOM: 200,  // أقصى عدد رسائل محفوظة لكل غرفة
    STALE_AGE: 60000          // عمر الرسالة القديمة (ms)
};

// ==================== حالة النظام ====================
const sysState = {
    // الرسائل اللي قيد الإرسال: { localId -> { data, retries, room } }
    pending: new Map(),
    // آخر رسائل لكل غرفة: { roomId -> [messages] }
    cache: new Map(),
    // المشغلات (listeners) النشطة: { roomId -> unsubscribe function }
    listeners: new Map(),
    // آخر معرّف رسالة لكل غرفة (لمنع التكرار)
    lastIds: new Map(),
    // حالة الاتصال
    online: navigator.onLine,
    // هل النظام مهيأ
    ready: false
};

// ==================== أدوات مساعدة ====================
function sysLog(...args) {
    console.log("[SYS]", ...args);
}

function sysErr(...args) {
    console.error("[SYS-ERROR]", ...args);
}

function generateLocalId() {
    return local_`${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== مراقبة الاتصال ====================
function setupConnectivity() {
    window.addEventListener("online", () => {
        sysState.online = true;
        sysLog("الاتصال رجع. جاري إرسال الرسائل المعلقة...");
        flushPending();
    });

    window.addEventListener("offline", () => {
        sysState.online = false;
        sysLog("انقطع الاتصال. الرسائل راح تنتظر.");
    });
}

// ==================== إرسال رسالة (مع إعادة المحاولة) ====================
async function sendMessageSys(roomId, messageData) {
    // 1. نولّد معرّف محلي
    const localId = generateLocalId();
    const fullMessage = {
        ...messageData,
        localId: localId,
        senderUid: auth.currentUser?.uid || "",
        status: "pending"
    };

    // 2. نحفظه في الطابور
    sysState.pending.set(localId, {
        data: fullMessage,
        room: roomId,
        retries: 0,
        createdAt: Date.now()
    });

    // 3. نحدّث الكاش المحلي فوراً (عشان المستخدم يشوف رسالته)
    addToCache(roomId, fullMessage);

    // 4. نحاول نرسله
    return await trySend(localId, roomId);
}

async function trySend(localId, roomId) {
    const entry = sysState.pending.get(localId);
    if (!entry) return false;

    if (!sysState.online) {
        sysLog(`الاتصال مقطوع. الرسالة ${localId} راح تنتظر.`);
        return false;
    }

    const { data } = entry;

    try {
        // نرسل لـ Firestore
        const cleanData = {
            text: data.text || "",
            imageUrl: data.imageUrl || "",
            senderUid: data.senderUid,
            senderName: data.senderName,
            time: serverTimestamp(),
            localId: localId
        };

        if (data.replyTo) {
            cleanData.replyTo = data.replyTo;
        }

        const docRef = await addDoc(
            collection(db, "rooms", roomId, "messages"),
            cleanData
        );

        // نجح الإرسال
        sysLog(`الرسالة ${localId} وصلت. ID: ${docRef.id}`);
        sysState.pending.delete(localId);
        updateCacheStatus(roomId, localId, "sent");
        return true;

    } catch (err) {
        sysErr(`فشل إرسال ${localId}:`, err);
        entry.retries++;
        if (entry.retries < SYS_CONFIG.MAX_RETRIES) {
            // ننتظر ونحاول مرة ثانية
            await sleep(SYS_CONFIG.RETRY_DELAY * entry.retries);
            return await trySend(localId, roomId);
        } else {
            // فشل نهائي
            sysErr(`الرسالة ${localId} فشلت بعد ${SYS_CONFIG.MAX_RETRIES} محاولات`);
            updateCacheStatus(roomId, localId, "failed");
            sysState.pending.delete(localId);
            return false;
        }
    }
}

// ==================== إرسال كل الرسائل المعلقة ====================
async function flushPending() {
    const entries = [...sysState.pending.entries()];
    for (const [localId, entry] of entries) {
        await trySend(localId, entry.room);
    }
}

// ==================== تنظيف الرسائل القديمة ====================
function cleanupStale() {
    const now = Date.now();
    for (const [localId, entry] of sysState.pending.entries()) {
        if (now - entry.createdAt > SYS_CONFIG.STALE_AGE) {
            sysLog(`حذف رسالة قديمة: ${localId}`);
            sysState.pending.delete(localId);
        }
    }
}

// ==================== الكاش المحلي ====================
function addToCache(roomId, message) {
    if (!sysState.cache.has(roomId)) {
        sysState.cache.set(roomId, []);
    }
    const list = sysState.cache.get(roomId);
    // نتحقق من عدم وجود تكرار
    const exists = list.some(m => m.localId === message.localId);
    if (!exists) {
        list.push(message);
        // نحافظ على الحد الأقصى
        if (list.length > SYS_CONFIG.MAX_CACHE_PER_ROOM) {
            list.shift();
        }
    }
}

function updateCacheStatus(roomId, localId, status) {
    const list = sysState.cache.get(roomId);
    if (!list) return;
    const msg = list.find(m => m.localId === localId);
    if (msg) msg.status = status;
}

function getCache(roomId) {
    return sysState.cache.get(roomId) || [];
}

function clearCache(roomId) {
    sysState.cache.delete(roomId);
}

// ==================== الاستماع للرسائل (مع cache) ====================
function listenRoom(roomId, callback) {
    // إذا في listener قديم، نلغيه
    if (sysState.listeners.has(roomId)) {
        sysState.listeners.get(roomId)();
        sysState.listeners.delete(roomId);
    }

    const q = query(
        collection(db, "rooms", roomId, "messages"),
        orderBy("time", "asc"),
        limit(150)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
        const messages = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            data._id = docSnap.id;
            // نحفظ آخر ID
            if (data.localId) {
                sysState.lastIds.set(`${roomId}_${data.localId}`, true);
            }
            messages.push(data);
        });

        // نحدّث الكاش
        sysState.cache.set(roomId, messages);

        // ننادي callback
        callback(messages, null);
    }, (err) => {
        sysErr(`خطأ في listener ${roomId}:`, err);
        callback(null, err);
    });

    sysState.listeners.set(roomId, unsubscribe);
    return unsubscribe;
}

// ==================== إلغاء الاستماع ====================
function stopListening(roomId) {
    if (sysState.listeners.has(roomId)) {
        sysState.listeners.get(roomId)();
        sysState.listeners.delete(roomId);
        sysLog(`توقف الاستماع للغرفة: ${roomId}`);
    }
}

// ==================== حالة النظام ====================
function getStatus() {
    return {
        online: sysState.online,
        pending: sysState.pending.size,
        cachedRooms: sysState.cache.size,
        activeListeners: sysState.listeners.size
    };
}

// ==================== التهيئة ====================
function initSys() {
    if (sysState.ready) return;
    setupConnectivity();
    // تنظيف دوري كل دقيقة
    setInterval(cleanupStale, 60000);
    sysState.ready = true;
    sysLog("النظام جاهز.");
}

// ==================== التصدير ====================
export {
    initSys,
    sendMessageSys,
    listenRoom,
    stopListening,
    flushPending,
    getCache,
    clearCache,
    getStatus,
    SYS_CONFIG
};
