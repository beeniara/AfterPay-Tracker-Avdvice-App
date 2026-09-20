import { NextResponse } from "next/server";
import { handleApiError, jsonError, requireContext } from "@/lib/api/handler";
import { isWolConfigured, mayWake, sendWakePacket, takeWakeSlot } from "@/lib/ask/wol";

// Sends a Wake-on-LAN packet to the PC that runs Ollama. Signed-in accounts
// only (requireContext), and of those only WAKE_ALLOWED_EMAILS.
export async function POST() {
  try {
    const { user } = await requireContext();
    if (!isWolConfigured()) return jsonError(503, "Waking the computer is not set up on this server.");
    if (!mayWake(user.email)) return jsonError(403, "You are not allowed to wake the computer.");
    if (!takeWakeSlot()) return jsonError(429, "Wake signal already sent. Give it a minute.");
    try {
      await sendWakePacket();
    } catch (error) {
      console.error("Wake-on-LAN failed:", error);
      return jsonError(502, "Failed to send the wake signal.");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
