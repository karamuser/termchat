import {
    db, auth, googleProvider,
    collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc,
    query, orderBy, limit, onSnapshot, serverTimestamp, where,
    signInWithPopup, signOut, onAuthStateChanged
} from "./firebase.js";

// ==================== ثوابت ====================
const NEON_COLORS = [
    "#ff006e", "#fb5607", "#ffbe0b", "#8338ec",
    "#3a86ff", "#06ffa5", "#f15bb5", "#00bbf9",
    "#c77dff", "#ff4d6d", "#fee440", "#9b5de5",
    "#7b2cbf", "#06d6a0", "#ef476f", "#118ab2"
];

const ROOMS = [
    { id: "general", name: "عام" },
    { id: "study", name: "دراسة" },
    { id: "games", name: "ألعاب" },
    { id: "code", name: "برمجة" }
];

const EMOJIS = [
    "😀","😂","🤣","😊","😍","🥰","😎","🤔","😅","😢",
    "😭","😡","👍","👎","🙏","👋","💪","🔥","⭐","💯",
    "❤️","💔","✨","🎉","🎮","🎯","💻","📱","🚀","🌙",
    "☀️","🍕","🍔","☕","🎵","📚","⚡","🌟","💎","🏆"
];

const AVATARS = [
    "https://api.dicebear.com/7.x/bottts/svg?seed=",
    "https://api.dicebear.com/7.x/avataaars/svg?seed=",
    "https://api.dicebear.com/7.x/pixel-art/svg?seed=",
    "https://api.dicebear.com/7.x/adventurer/svg?seed="
];

// ==================== الحالة ====================
let currentUser = null;
let currentProfile = null;
let currentRoom = "general";
let unsubscribeMessages = null;
let allFriends = [];
let settings = {};

// ==================== الإعدادات ====================
function loadSettings() {
    const data = localStorage.getItem("termchat_settings");
    settings = data ? JSON.parse(data) : { theme: "neon", fontSize: 15, notif: true, sound: false, avatarStyle: 0 };
    applySettings();
    return settings;
}

function saveSettings() {
    localStorage.setItem("termchat_settings", JSON.stringify(settings));
    applySettings();
}

function applySettings() {
    document.body.classList.remove("theme-dark", "theme-ocean");
    if (settings.theme === "dark") document.body.classList.add("theme-dark");
    if (settings.theme === "ocean") document.body.classList.add("theme-ocean");
    document.documentElement.style.setProperty("--font-size", settings.fontSize + "px");
}

// ==================== أدوات ====================
function colorForUser(uid) {
    if (!uid) return NEON_COLORS[0];
    let hash = 0;
    for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) | 0;
    return NEON_COLORS[Math.abs(hash) % NEON_COLORS.length];
}

function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function getMyName() {
    return currentProfile?.name  || currentUser?.displayName || "?";
}

function getMyAvatar() {
    if (currentProfile?.avatar) return currentProfile.avatar;
    if (currentUser?.photoURL) return currentUser.photoURL;
    return AVATARS[settings.avatarStyle] + encodeURIComponent(getMyName());
}

function defaultAvatarFor(name) {
    return AVATARS[settings.avatarStyle] + encodeURIComponent(name);
}

// ==================== صفحة الدخول ====================
function setupLogin() {
    const btn = document.getElementById("googleLoginBtn");
    const status = document.getElementById("loginStatus");
    if (!btn) return;

    onAuthStateChanged(auth, (user) => {
        if (user) window.location.href = "chat.html";
    });

    btn.addEventListener("click", async () => {
        btn.disabled = true;
        status.textContent = "جاري تسجيل الدخول...";
        try {
            const result = await signInWithPopup(auth, googleProvider);
            const user = result.user;
            await setDoc(doc(db, "users", user.uid), {
                email: user.email,
                name: user.displayName || user.email.split("@")[0],
                avatar: user.photoURL || "",
                createdAt: serverTimestamp()
            }, { merge: true });
            window.location.href = "chat.html";
        } catch (err) {
            console.error(err);
            btn.disabled = false;
            status.textContent = "";
            alert("فشل الدخول: " + (err.message || err.code));
        }
    });
}

// ==================== صفحة الدردشة ====================
function setupChat() {
    const messagesEl = document.getElementById("messages");
    if (!messagesEl) return;

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = "index.html";
            return;
        }
        currentUser = user;

        // اجلب/أنشئ البروفايل
        try {
            const userRef = doc(db, "users", user.uid);
            const snap = await getDoc(userRef);
            if (snap.exists()) {
                currentProfile = snap.data();
            } else {
                currentProfile = {
                    email: user.email,
                    name: user.displayName || user.email.split("@")[0],
                    avatar: user.photoURL || ""
                };
                await setDoc(userRef, { ...currentProfile, createdAt: serverTimestamp() });
            }
        } catch (e) {
            console.error(e);
            currentProfile = { name: user.displayName, email: user.email, avatar: user.photoURL };
        }

        loadSettings();
        updateMyHeader();
        buildRoomsList();
        setupComposer();
        setupEmojiPicker();
        setupSettings();
        setupProfileEdit();
        setupSidebarToggle();
        setupAddFriend();
        loadFriends();
        listenMessages();
    });
}

function updateMyHeader() {
    const myIdEl = document.getElementById("myUserId");
    const myAvatarEl = document.getElementById("myAvatar");
    if (myIdEl) myIdEl.textContent = getMyName();
    if (myAvatarEl) myAvatarEl.src = getMyAvatar();
}

// ==================== الغرف ====================
function buildRoomsList() {
    const list = document.getElementById("roomsList");
    if (!list) return;
    list.innerHTML = "";
    ROOMS.forEach(room => {
        const li = document.createElement("li");
        li.textContent = room.name;
        li.dataset.room = room.id;
        if (room.id === currentRoom) li.classList.add("active");
        li.addEventListener("click", () => switchRoom(room.id, room.name, li));
        list.appendChild(li);
    });
}

function switchRoom(roomId, roomName, li) {
    currentRoom = roomId;
    document.querySelectorAll("#roomsList li, #friendsList li").forEach(x => x.classList.remove("active"));
    li.classList.add("active");
    document.getElementById("roomTitle").textContent = "# " + roomName;
    listenMessages();
    closeSidebar();
}

// ==================== الأصدقاء ====================
function setupAddFriend() {
    const form = document.getElementById("addFriendForm");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = document.getElementById("friendInput");
        const friendEmail = input.value.trim().toLowerCase();
        input.value = "";
        if (!friendEmail.includes("@")) { alert("اكتب إيميل صحيح"); return; }
        if (friendEmail === currentUser.email.toLowerCase()) { alert("ما تكدر تضيف نفسك"); return; }

        try {
            const q = query(collection(db, "users"), where("email", "==", friendEmail), limit(1));
            const snap = await getDocs(q);
            if (snap.empty) { alert("هذا المستخدم ما مسجل بعد"); return; }

            const friendDoc = snap.docs[0];
            const friendUid = friendDoc.id;
            const friendData = friendDoc.data();
            await setDoc(doc(db, "users", currentUser.uid, "friends", friendUid), {
                friendUid: friendUid,
                friendName: friendData.name || friendEmail,
                friendEmail: friendEmail,
                friendAvatar: friendData.avatar || "",
                addedAt: serverTimestamp()
            });
        } catch (err) {
            console.error(err);
            alert("خطأ: " + err.message);
        }
    });
}

function loadFriends() {
    if (!currentUser) return;
    const ref = collection(db, "users", currentUser.uid, "friends");
    onSnapshot(ref, (snap) => {
        allFriends = [];
        snap.forEach(d => allFriends.push(d.data()));
        renderFriends();
    });
}

function renderFriends() {
    const list = document.getElementById("friendsList");
    if (!list) return;
    list.innerHTML = "";
    if (allFriends.length === 0) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "لا يوجد أصدقاء";
        list.appendChild(li);
        return;
    }
    allFriends.forEach(friend => {
        const li = document.createElement("li");
        li.className = "friend-item";
        const img = document.createElement("img");
        img.src = friend.friendAvatar || defaultAvatarFor(friend.friendName);
        img.className = "friend-avatar";
        const span = document.createElement("span");
        span.textContent = friend.friendName;
        li.appendChild(img);
        li.appendChild(span);
        li.addEventListener("click", (e) => {
            if (e.target === img) {
                showFriendProfile(friend);
            } else {
                openPrivateChat(friend, li);
            }
        });
        list.appendChild(li);
    });
}

function openPrivateChat(friend, li) {
    const ids = [currentUser.uid, friend.friendUid].sort();
    const chatId = "private_" + ids[0] + "_" + ids[1];
    currentRoom = chatId;
    document.querySelectorAll("#roomsList li, #friendsList li").forEach(x => x.classList.remove("active"));
    li.classList.add("active");
    document.getElementById("roomTitle").textContent = "@ " + friend.friendName;
    listenMessages();
    closeSidebar();
}

// ==================== بروفايل الصديق ====================
function showFriendProfile(friend) {
    const modal = document.getElementById("friendProfileModal");
    const avatar = document.getElementById("friendProfileAvatar");
    const name = document.getElementById("friendProfileName");
    const email = document.getElementById("friendProfileEmail");
    const chatBtn = document.getElementById("friendProfileChat");

    avatar.src = friend.friendAvatar || defaultAvatarFor(friend.friendName);
    name.textContent = friend.friendName;
    email.textContent = friend.friendEmail;

    chatBtn.onclick = () => {
        modal.classList.add("hidden");
        const li = [...document.querySelectorAll("#friendsList li")].find(
            el => el.textContent.includes(friend.friendName)
        );
        if (li) openPrivateChat(friend, li);
    };

    modal.classList.remove("hidden");
}

// ==================== الرسائل ====================
function listenMessages() {
    const messagesEl = document.getElementById("messages");
    if (!messagesEl || !currentUser) return;

    if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    messagesEl.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px">تحميل الرسائل...</p>';

    const q = query(
        collection(db, "rooms", currentRoom, "messages"),
        orderBy("time", "asc"),
        limit(150)
    );

    unsubscribeMessages = onSnapshot(q, (snap) => {
        messagesEl.innerHTML = "";
        let lastSender = null;
        let lastGroup = null;
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.senderUid === lastSender && lastGroup) {
                addBubbleToGroup(lastGroup, data);
            } else {
                lastGroup = createMessageGroup(data);
                messagesEl.appendChild(lastGroup);
                lastSender = data.senderUid;
            }
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }, (err) => {
        messagesEl.innerHTML = `<p style="color:var(--danger);padding:20px">خطأ: ${err.message}</p>`;
    });
}

function createMessageGroup(data) {
    const group = document.createElement("div");
    group.className = "message-group";
    if (data.senderUid === currentUser.uid) group.classList.add("own");

    const color = colorForUser(data.senderUid);

    const nameEl = document.createElement("div");
    nameEl.className = "sender-name";
    nameEl.textContent = data.senderName || "?";
    nameEl.style.color = color;
    nameEl.style.textShadow = `0 0 8px ${color}`;
    group.appendChild(nameEl);

    addBubbleToGroup(group, data);
    return group;
}

function addBubbleToGroup(group, data) {
    const color = colorForUser(data.senderUid);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.style.borderColor = color;
    bubble.style.background = `linear-gradient(135deg, rgba(0,0,0,0.4), ${hexToRgba(color, 0.15)})`;
    bubble.style.boxShadow = `0 0 12px ${hexToRgba(color, 0.3)}`;

    const textEl = document.createElement("div");
    textEl.className = "text";
    textEl.textContent = data.text;
    bubble.appendChild(textEl);

    const timeEl = document.createElement("span");
    timeEl.className = "time";
    if (data.time && data.time.seconds) {
        const d = new Date(data.time.seconds * 1000);
        timeEl.textContent = d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    } else {
        timeEl.textContent = "...";
    }
    bubble.appendChild(timeEl);
    group.appendChild(bubble);
}

// ==================== الإرسال ====================
function setupComposer() {
    const input = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendBtn");
    if (!input || !sendBtn) return;
    sendBtn.addEventListener("click", sendMessage);
    input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
    });
}

async function sendMessage() {
    const input = document.getElementById("messageInput");
    const text = input.value.trim();
    if (!text || !currentUser) return;
    input.value = "";
    try {
        await addDoc(collection(db, "rooms", currentRoom, "messages"), {
            text: text,
            senderUid: currentUser.uid,
            senderName: getMyName(),
            time: serverTimestamp()
        });
    } catch (err) { alert("صار خطأ: " + err.message); }
}

// ==================== الإيموجي ====================
function setupEmojiPicker() {
    const picker = document.getElementById("emojiPicker");
    const btn = document.getElementById("emojiBtn");
    if (!picker || !btn) return;
    picker.innerHTML = "";
    EMOJIS.forEach(emoji => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = emoji;
        b.addEventListener("click", () => {
            const input = document.getElementById("messageInput");
            input.value += emoji;
            input.focus();
        });
        picker.appendChild(b);
    });
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        picker.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
        if (!picker.contains(e.target) && e.target !== btn) picker.classList.add("hidden");
    });
}
// ==================== بروفايلي (في الإعدادات) ====================
function setupProfileEdit() {
    const nameInput = document.getElementById("profileName");
    const avatarInput = document.getElementById("profileAvatarUrl");
    const previewImg = document.getElementById("profileAvatarPreview");
    const saveBtn = document.getElementById("saveProfileBtn");
    const eyeBtn = document.getElementById("eyePreview");

    if (!nameInput || !saveBtn) return;

    // ملء الحقول
    nameInput.value = getMyName();
    avatarInput.value = currentProfile?.avatar || "";
    previewImg.src = getMyAvatar();

    // العين: إظهار/إخفاء الـ URL
    if (eyeBtn) {
        eyeBtn.classList.add("active");
        eyeBtn.onclick = () => {
            if (avatarInput.type === "password") {
                avatarInput.type = "text";
                eyeBtn.classList.add("active");
            } else {
                avatarInput.type = "password";
                eyeBtn.classList.remove("active");
            }
        };
    }

    // معاينة عند تغيير الرابط
    avatarInput.addEventListener("input", () => {
        const val = avatarInput.value.trim();
        previewImg.src = val  `defaultAvatarFor(nameInput.value  "?")`;
    });

    // معاينة عند تغيير الاسم
    nameInput.addEventListener("input", () => {
        if (!avatarInput.value.trim()) {
            previewImg.src = defaultAvatarFor(nameInput.value || "?");
        }
    });

    // حفظ
    saveBtn.onclick = async () => {
        const newName = nameInput.value.trim();
        const newAvatar = avatarInput.value.trim();
        if (newName.length < 2) { alert("الاسم قصير"); return; }

        saveBtn.disabled = true;
        saveBtn.textContent = "جاري الحفظ...";

        try {
            await setDoc(doc(db, "users", currentUser.uid), {
                name: newName,
                avatar: newAvatar,
                email: currentUser.email
            }, { merge: true });

            currentProfile.name = newName;
            currentProfile.avatar = newAvatar;
            updateMyHeader();

            saveBtn.textContent = "تم الحفظ ✓";
            setTimeout(() => { saveBtn.textContent = "حفظ"; saveBtn.disabled = false; }, 1500);
        } catch (err) {
            alert("خطأ: " + err.message);
            saveBtn.textContent = "حفظ";
            saveBtn.disabled = false;
        }
    };
}

// ==================== الإعدادات ====================
function setupSettings() {
    const modal = document.getElementById("settingsModal");
    const openBtn = document.getElementById("openSettings");
    const closeBtn = document.getElementById("closeSettings");
    if (!modal || !openBtn) return;

    const themeSelect = document.getElementById("themeSelect");
    const fontSize = document.getElementById("fontSize");
    const notifToggle = document.getElementById("notifToggle");
    const soundToggle = document.getElementById("soundToggle");
    const logoutBtn = document.getElementById("logoutBtn");

    if (themeSelect) themeSelect.value = settings.theme;
    if (fontSize) fontSize.value = settings.fontSize;
    if (notifToggle) notifToggle.checked = settings.notif;
    if (soundToggle) soundToggle.checked = settings.sound;

    openBtn.addEventListener("click", () => modal.classList.remove("hidden"));
    closeBtn.addEventListener("click", () => modal.classList.add("hidden"));

    themeSelect?.addEventListener("change", () => { settings.theme = themeSelect.value; saveSettings(); });
    fontSize?.addEventListener("input", () => { settings.fontSize = parseInt(fontSize.value); saveSettings(); });
    notifToggle?.addEventListener("change", () => { settings.notif = notifToggle.checked; saveSettings(); });
    soundToggle?.addEventListener("change", () => { settings.sound = soundToggle.checked; saveSettings(); });

    logoutBtn?.addEventListener("click", async () => {
        if (confirm("متأكد من الخروج؟")) {
            await signOut(auth);
            window.location.href = "index.html";
        }
    });
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
    });

    // Friend profile modal
    const fpModal = document.getElementById("friendProfileModal");
    const fpClose = document.getElementById("closeFriendProfile");
    if (fpModal && fpClose) {
        fpClose.addEventListener("click", () => fpModal.classList.add("hidden"));
        fpModal.addEventListener("click", (e) => {
            if (e.target === fpModal) fpModal.classList.add("hidden");
        });
    }
}

// ==================== Sidebar للجوال ===========
function setupSidebarToggle() {
    const btn = document.getElementById("toggleSidebar");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.getElementById("sidebar").classList.toggle("open");
    });
}

function closeSidebar() {
    const s = document.getElementById("sidebar");
    if (s) s.classList.remove("open");
}

// ==================== التشغيل ====================
setupLogin();
setupChat();