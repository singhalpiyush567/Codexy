import emailjs from "@emailjs/browser";

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
const TO_EMAIL = import.meta.env.VITE_NOTIFY_TO_EMAIL || "piyushsinghal1234567@gmail.com";

/**
 * Sends a notification email to the app owner via EmailJS.
 * Uses only the public key (EmailJS public-key mechanism) — no secrets in the frontend.
 * Never throws: email failures are logged but must not break login/registration.
 * Only name, email, event and time are sent — never passwords.
 */
export async function notifyOwner({ name, email, event }) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    console.warn("[emailNotify] EmailJS not configured — skipping notification.");
    return;
  }
  try {
    await emailjs.send(
      SERVICE_ID,
      TEMPLATE_ID,
      {
        name: name || "",
        email: email || "",
        event,
        time: new Date().toISOString(),
        to_email: TO_EMAIL,
      },
      { publicKey: PUBLIC_KEY }
    );
  } catch (err) {
    console.error("[emailNotify] Failed to send notification:", err);
  }
}