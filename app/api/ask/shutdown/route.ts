import { NextResponse } from "next/server";
import { handleApiError, jsonError, requireContext } from "@/lib/api/handler";
import { isShutdownConfigured, mayShutdown, sendShutdown, takeShutdownSlot } from "@/lib/ask/wol";

// Shuts down the PC that runs Ollama. Signed-in accounts only (requireContext),
// and of those only WAKE_ALLOWED_EMAILS.
export async function POST() {
  try {
    const { user } = await requireContext();
    if (!isShutdownConfigured()) return jsonError(503, "Shutting down the computer is not set up on this server.");
    if (!mayShutdown(user.email)) return jsonError(403, "You are not allowed to shut down the computer.");
    if (!takeShutdownSlot()) return jsonError(429, "Shutdown already requested. Give it a minute.");
    try {
      await sendShutdown();
    } catch (error) {
      console.error("Remote shutdown failed:", error);
      return jsonError(502, "Failed to shut down the computer. It may already be off.");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
