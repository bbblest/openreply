"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "./index";

export async function setLocale(value: string) {
  if (value !== "zh-TW") throw new Error("本系統介面固定使用繁體中文。");
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}
