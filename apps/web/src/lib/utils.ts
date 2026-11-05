import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractVerifyDomain(url: string): string {
  if (!url) return "";
  try {
    const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const parsed = new URL(fullUrl);
    if (parsed.pathname === "/api/v1/license/verify" || parsed.pathname === "/" || parsed.pathname === "") {
      return parsed.host;
    }
    return url;
  } catch {
    return url;
  }
}
