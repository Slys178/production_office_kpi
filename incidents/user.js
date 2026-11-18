/**
 * Who is the current user? This is the ONLY place incidents reads identity.
 *
 * Today it reads what the existing login page stores (userName / userEmail),
 * plus the legacy keys the old incident code looked for. When this moves to
 * Azure, replace the body with your MSAL / Entra ID account lookup, e.g.
 *   const acc = msalInstance.getActiveAccount();
 *   return { name: acc?.name || "", email: acc?.username || "" };
 */
export function getLoggedInUser() {
  try {
    const name =
      localStorage.getItem("userName") ||
      sessionStorage.getItem("userName") ||
      "";
    const email =
      localStorage.getItem("userEmail") ||
      sessionStorage.getItem("userEmail") ||
      "";
    if (name || email) return { name: name.trim(), email: email.trim() };

    // Legacy keys used by the original incident code
    const raw =
      localStorage.getItem("po_user") ||
      localStorage.getItem("kpiUser") ||
      sessionStorage.getItem("po_user") ||
      "";
    if (!raw) return { name: "", email: "" };
    const u = raw.startsWith("{") ? JSON.parse(raw) : { name: raw };
    return {
      name: (u.name || u.userName || u.displayName || "").toString().trim(),
      email: (u.email || u.userEmail || "").toString().trim(),
    };
  } catch (_) {
    return { name: "", email: "" };
  }
}
