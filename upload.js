import { IMGBB_API_KEY } from "./firebase.js";

export async function uploadToImgBB(file) {
    if (!file) throw new Error("ماكو ملف");
    if (!file.type.startsWith("image/")) throw new Error("الملف مو صورة");
    if (file.size > 32 * 1024 * 1024) throw new Error("الحجم أكبر من 32MB");

    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(
        `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
        {
            method: "POST",
            body: formData
        }
    );

    const data = await response.json();

    if (!data.success) {
        throw new Error(data.error?.message || "فشل الرفع");
    }

    return data.data.url;
}