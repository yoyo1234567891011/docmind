const NETWORK_ERROR_MESSAGE =
  "Une erreur de connexion est survenue. Rechargez la page puis réessayez.";

function isClientNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("load failed") ||
      msg.includes("network request failed")
    );
  }
  if (error instanceof DOMException && error.name === "NetworkError") {
    return true;
  }
  return false;
}

/** Message utilisateur pour erreurs réseau côté client (fetch / TypeError). */
export function formatClientNetworkError(
  error: unknown,
  fallback = "Action impossible.",
): string {
  if (isClientNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
